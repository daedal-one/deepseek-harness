"""Root-owned exact-directory exports through one shared, read-only catalogue root.

The operator installs this controller and its definition outside guest mounts.
Only the configured service uid may submit requests through the sudo wrapper.
Selected source contents remain writable; the catalogue and durable records do not.
"""
import contextlib
import ctypes
import fcntl
import hashlib
import heapq
import json
import os
import posixpath
import select
from pathlib import Path
import re
import stat
import sys
import tempfile

CONFIG = Path('/etc/dsh-workspace-exports.json')
HASH = re.compile(r'[0-9a-f]{64}\Z')
O_PATH = getattr(os, 'O_PATH', os.O_RDONLY)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(fd):
    info = os.fstat(fd)
    return {'device': info.st_dev, 'inode': info.st_ino}


def mount_id(fd):
    text = Path('/proc/self/fdinfo', str(fd)).read_text()
    return int(re.search(r'^mnt_id:\s+(\d+)$', text, re.M)[1])


def filesystem(fd):
    record = next((line for line in Path('/proc/self/mountinfo').read_text().splitlines()
                   if int(line.split()[0]) == mount_id(fd)), None)
    require(record is not None, 'Directory mount is not observable')
    return record.split(' - ')[1].split()[0]


@contextlib.contextmanager
def directory(path):
    """Pin every path component without following symlinks."""
    path = Path(path)
    require(path.is_absolute() and str(path) != '/' and '..' not in path.parts,
            'Expected a canonical non-root directory')
    fd = os.open('/', O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


class MountAttributes(ctypes.Structure):
    _fields_ = [('set', ctypes.c_uint64), ('clear', ctypes.c_uint64),
                ('propagation', ctypes.c_uint64), ('userns', ctypes.c_uint64)]


def syscall(number, *arguments):
    """Linux generic open_tree, move_mount and mount_setattr ABI on qualified 64-bit hosts."""
    require(os.uname().machine in ['x86_64', 'aarch64'], 'Unqualified mount syscall architecture')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    result = libc.syscall(number, *arguments)
    if result < 0:
        raise OSError(ctypes.get_errno(), 'Namespace export mount operation failed')
    return result


def process_bytes(path, limit):
    with open(path, 'rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'Process descriptor exceeds its byte bound')
    return data


@contextlib.contextmanager
def namespace(config, portal):
    """Pin only the root-owned Incus virtiofsd worker whose sandbox root is this catalogue."""
    import yaml
    path = Path(config['processFile'])
    private_ancestors(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o022 == 0,
                'Incus process descriptor must be root-controlled')
        raw = stream.read(config['maxRecordBytes'] + 1)
        require(len(raw) <= config['maxRecordBytes'], 'Process descriptor exceeds its byte bound')
    try:
        descriptor = yaml.safe_load(raw)
    except yaml.YAMLError as error:
        raise RuntimeError('Invalid Incus process descriptor') from error
    require(isinstance(descriptor, dict) and type(descriptor.get('pid')) is int and descriptor['pid'] > 0,
            'Invalid Incus process descriptor')
    executable = str(Path(config['virtiofsd']).resolve(strict=True))
    private_ancestors(Path(executable).parent)
    binary = Path(executable).stat()
    require(binary.st_uid == 0 and binary.st_mode & 0o022 == 0, 'virtiofsd must be root-controlled')
    require(str(Path(descriptor['name']).resolve(strict=True)) == executable
            and isinstance(descriptor['args'], list)
            and descriptor['args'].count('--shared-dir=' + config['sharePath']) == 1,
            'Incus descriptor does not identify the configured catalogue')
    parent = descriptor['pid']; limit = config['maxRecordBytes']
    with contextlib.ExitStack() as stack:
        def pin(fd):
            stack.callback(os.close, fd)
            return fd
        parent_pid = pin(os.pidfd_open(parent))
        original = pin(os.open('/proc/self/ns/mnt', os.O_RDONLY))
        with directory(portal) as catalogue:
            expected = identity(catalogue)
        candidates = process_bytes(f'/proc/{parent}/task/{parent}/children', limit).decode().split()
        require(all(value.isdecimal() for value in candidates), 'Invalid virtiofsd worker list')
        workers = []
        for candidate in candidates:
            pid = int(candidate)
            try:
                process = pin(os.pidfd_open(pid))
                root = pin(os.open(f'/proc/{pid}/root', O_PATH | os.O_DIRECTORY))
                target = pin(os.open(f'/proc/{pid}/ns/mnt', os.O_RDONLY))
            except ProcessLookupError:
                continue
            if identity(root) != expected:
                continue
            require(os.readlink(f'/proc/{pid}/exe') == executable
                    and process_bytes(f'/proc/{pid}/cmdline', limit).split(b'\0')[1:-1]
                    == [value.encode() for value in descriptor['args']], 'Unexpected virtiofsd worker executable')
            status = process_bytes(f'/proc/{pid}/status', limit).decode()
            require(re.search(r'^Uid:\s+0\s+0\s+0\s+0\s*$', status, re.M), 'virtiofsd worker must be operator-owned')
            require(os.stat(f'/proc/{pid}/ns/user').st_ino == os.stat('/proc/self/ns/user').st_ino
                    and os.fstat(target).st_ino != os.fstat(original).st_ino, 'Unexpected virtiofsd namespace ownership')
            root_mount = mount_id(root)
            with open(f'/proc/{pid}/mountinfo') as mounts:
                while True:
                    line = mounts.readline(limit + 1)
                    require(len(line.encode()) <= limit, 'Mount descriptor exceeds its byte bound')
                    require(line, 'Sandbox root mount is not observable')
                    if int(line.split()[0]) == root_mount:
                        require(not any(field.startswith('shared:') for field in line.split(' - ')[0].split()),
                                'Sandbox exports must not propagate to the Host')
                        break
            workers.append((process, root, target, pid))
        require(len(workers) == 1 and not select.select([parent_pid, workers[0][0]], [], [], 0)[0],
                'Expected one live catalogue worker')
        process, root, target, pid = workers[0]
        stamp = process_bytes(f'/proc/{pid}/stat', limit).decode().rsplit(') ', 1)[1].split()[19]
        generation = hashlib.sha256(f'{pid}:{stamp}:{os.fstat(target).st_ino}'.encode()).hexdigest()
        yield original, target, root, process, generation
        require(not select.select([parent_pid, process], [], [], 0)[0], 'Catalogue worker exited during attachment')


def attach(source, target, original, destination, root, name):
    tree = syscall(428, source, ctypes.c_char_p(b''), 0x80000 | 0x1000 | 1)
    try:
        # MOUNT_ATTR_NOSUID | MOUNT_ATTR_NODEV, MS_PRIVATE, AT_EMPTY_PATH.
        attributes = MountAttributes(2 | 4, 0, 1 << 18, 0)
        syscall(442, tree, ctypes.c_char_p(b''), 0x1000, ctypes.byref(attributes), ctypes.sizeof(attributes))
        try:
            os.setns(destination, 0x20000)
            syscall(429, tree, ctypes.c_char_p(b''), target, ctypes.c_char_p(b''), 0x4 | 0x40)
            observed = os.open(name, O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        finally:
            os.setns(original, 0x20000)
        return observed
    finally:
        os.close(tree)


def write_record(path, value, limit):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(data) <= limit, 'Export record exceeds its byte bound')
    fd, temporary = tempfile.mkstemp(prefix='.export-', dir=path.parent.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        for parent in [path.parent, path.parent.parent]:
            descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_record(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and info.st_mode & 0o077 == 0, 'Export record must be private and owner-controlled')
        data = stream.read(limit + 1)
        require(len(data) <= limit, 'Export record exceeds its byte bound')
    return json.loads(data)


def inside(parent, child):
    return child.startswith(parent + '/')


def private_ancestors(path):
    """Root storage cannot be replaced through a writable ancestor directory."""
    for parent in [Path(path), *Path(path).parents]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o022 == 0,
                'Export storage ancestors must be root-controlled')


class Exports:
    """Serial recovery owner for one operator-defined environment's directory catalogue."""

    def __init__(self, config):
        self.config = config
        self.portal = Path(config['portal'])
        self.state = Path(config['state'])
        self.records = self.state / 'records'
        self.limit = config['maxRecordBytes']

    def validate(self):
        c = self.config
        require(re.fullmatch(r'[a-z][a-z0-9-]{0,62}', c['environmentId']), 'Invalid environment identity')
        require(type(c['uid']) is int and c['uid'] > 0, 'Invalid service uid')
        for key in ['maxRecordBytes', 'maxRequestBytes', 'maxResponseBytes', 'pageSize']:
            require(type(c[key]) is int and c[key] > 0, 'Invalid export bounds')
        require(c['guestPath'].startswith('/workspace/') and not c['guestPath'].endswith('/'),
                'Invalid guest catalogue path')
        require(posixpath.normpath(c['guestPath']) == c['guestPath'] and '\0' not in c['guestPath'], 'Guest catalogue path must be canonical')
        require(c['roots'] and len(set(c['roots'])) == len(c['roots']), 'Distinct selection roots are required')
        require(isinstance(c['reservedSources'], list) and all(isinstance(path, str)
                and path.startswith('/') and posixpath.normpath(path) == path and path != '/'
                for path in c['reservedSources']), 'Invalid reserved source directories')
        for key in ['processFile', 'sharePath', 'virtiofsd']:
            require(isinstance(c[key], str) and c[key].startswith('/') and posixpath.normpath(c[key]) == c[key]
                    and '\0' not in c[key], 'Canonical operator process paths are required')
        require(Path(c['processFile']).parent == Path(c['sharePath']).parent,
                'Catalogue process and device paths must share the Incus device directory')
        for path in [str(self.portal), str(self.state), *c['roots']]:
            require(str(Path(path)) == path and not path.endswith('/'), 'Canonical directories are required')
            with directory(path) as fd:
                info = os.fstat(fd)
                if path in [str(self.portal), str(self.state)]:
                    require(info.st_uid == os.geteuid() and info.st_mode & 0o022 == 0,
                            'Export storage must be owner-controlled')
                    require(filesystem(fd) != 'tmpfs', 'Export storage must be disk-backed')
        private_ancestors(self.portal)
        private_ancestors(self.state)
        require(not (inside(str(self.portal), str(self.state)) or inside(str(self.state), str(self.portal))
                     or self.portal == self.state), 'Export state must be outside the catalogue')
        for root in [*c['roots'], *c['reservedSources']]:
            for private in [str(self.portal), str(self.state)]:
                require(root != private and not inside(root, private) and not inside(private, root),
                        'Export storage must be outside selection roots and other native sources')
        require(self.state.stat().st_mode & 0o077 == 0, 'Export state must be private')
        with directory(self.records) as fd:
            info = os.fstat(fd)
            require(info.st_uid == os.geteuid() and info.st_mode & 0o077 == 0,
                    'Export records must be private')

    def names(self, after=''):
        with os.scandir(self.records) as entries:
            for entry in entries:
                name = entry.name
                require(name.endswith('.json') and HASH.fullmatch(name[:-5]), 'Unknown export record')
                if name[:-5] > after:
                    yield name[:-5]

    def authorize_source(self, path):
        require(isinstance(path, str) and any(inside(root, path) for root in self.config['roots']),
                'Directory is outside configured selection roots')
        require(posixpath.normpath(path) == path and not path.endswith('/'), 'Source must be canonical')
        require('\0' not in path and all(path != other and not inside(path, other)
                and not inside(other, path) for other in self.config['reservedSources']),
                'Source overlaps an existing operator mount')

    @contextlib.contextmanager
    def source(self, path):
        self.authorize_source(path)
        with directory(path) as fd:
            require(filesystem(fd) != 'tmpfs', 'Source must be a disk-backed directory')
            yield fd

    def ready_portal(self):
        with directory(self.portal) as fd, directory(self.portal.parent) as parent:
            require(mount_id(fd) == mount_id(parent), 'Host catalogue must not contain a root bind mount')

    def placeholder(self, name):
        with directory(self.portal) as parent:
            try:
                os.mkdir(name, mode=0o000, dir_fd=parent)
            except FileExistsError:
                pass
            target = os.open(name, O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                info = os.fstat(target)
                require(info.st_uid == 0 and info.st_mode & 0o777 == 0 and mount_id(target) == mount_id(parent),
                        'Host export target must be an unmounted root-only placeholder')
                require(not os.listdir(self.portal / name), 'Unattached export target is not empty')
            finally:
                os.close(target)

    def prepare(self):
        """Validate durable sources and create placeholders without a running VM or Host submounts."""
        self.validate()
        self.ready_portal()
        for name in self.names():
            value = self.record(name)
            with self.source(value['source']) as fd:
                require(identity(fd) == value['identity'], 'Selected source identity changed')
            self.placeholder(name)
        return {'ready': True}

    def record(self, name):
        value = read_record(self.records / (name + '.json'), self.limit)
        require(isinstance(value, dict) and set(value) == {
            'version', 'environmentId', 'source', 'identity', 'phase'}, 'Invalid export record')
        require(value['version'] == 1 and value['environmentId'] == self.config['environmentId']
                and value['phase'] in ['pending', 'ready'], 'Invalid export record identity')
        require(isinstance(value['source'], str) and hashlib.sha256(value['source'].encode()).hexdigest() == name, 'Export record source mismatch')
        self.authorize_source(value['source'])
        require(isinstance(value['identity'], dict) and set(value['identity']) == {'device', 'inode'}
                and all(type(x) is int and x >= 0 for x in value['identity'].values()), 'Invalid source identity')
        return value

    def recover(self, name):
        value = self.record(name)
        with self.source(value['source']) as source:
            require(identity(source) == value['identity'], 'Selected source identity changed')
            self.placeholder(name)
            with namespace(self.config, self.portal) as (original, destination, root, _process, _generation):
                target = os.open(name, O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
                try:
                    if mount_id(target) == mount_id(root):
                        observed = attach(source, target, original, destination, root, name)
                        try:
                            require(identity(observed) == value['identity'] and mount_id(observed) != mount_id(root),
                                    'Export attachment identity mismatch')
                        finally:
                            os.close(observed)
                    else:
                        require(identity(target) == value['identity'], 'Unexpected export target mount')
                finally:
                    os.close(target)
            with self.source(value['source']) as observed:
                require(identity(observed) == value['identity'], 'Source changed during attachment')
        if value['phase'] != 'ready':
            write_record(self.records / (name + '.json'), {**value, 'phase': 'ready'}, self.limit)
        return {'source': value['source'], 'path': self.config['guestPath'] + '/' + name}

    def select(self, source):
        self.ready_portal()
        with self.source(source) as fd:
            name = hashlib.sha256(source.encode()).hexdigest()
            path = self.records / (name + '.json')
            if not path.exists():
                for existing in self.names():
                    old = self.record(existing)['source']
                    require(not inside(old, source) and not inside(source, old), 'Selected directories overlap')
                value = {'version': 1, 'environmentId': self.config['environmentId'], 'source': source,
                         'identity': identity(fd), 'phase': 'pending'}
                write_record(path, value, self.limit)
        return self.recover(name)

    def page(self, after):
        self.ready_portal()
        require(after == '' or HASH.fullmatch(after), 'Invalid export cursor')
        names = heapq.nsmallest(self.config['pageSize'] + 1, self.names(after))
        mounts = []
        for name in names[:self.config['pageSize']]:
            candidate = self.recover(name)
            response = {'mounts': [*mounts, candidate], 'next': name}
            if len(json.dumps({'ok': True, 'value': response}).encode()) > self.config['maxResponseBytes']:
                require(mounts, 'Export entry exceeds response bounds')
                return {'mounts': mounts, 'next': names[len(mounts) - 1]}
            mounts.append(candidate)
        return {'mounts': mounts, 'next': names[len(mounts) - 1] if len(names) > len(mounts) else None}

    def request(self, value):
        self.validate()
        require(isinstance(value, dict) and value.get('environmentId') == self.config['environmentId'],
                'Request environment does not match')
        action = value.get('operation')
        if action == 'generation':
            require(set(value) == {'operation', 'environmentId'}, 'Invalid generation request')
            with namespace(self.config, self.portal) as (_original, _destination, _root, _process, generation):
                return generation
        if action == 'select':
            require(set(value) == {'operation', 'environmentId', 'source'}, 'Invalid selection request')
            return self.select(value['source'])
        if action == 'list':
            require(set(value) == {'operation', 'environmentId', 'after'}, 'Invalid list request')
            return self.page(value['after'])
        raise RuntimeError('Unknown export operation')


def main():
    require(os.geteuid() == 0, 'The export controller requires operator installation')
    config = read_record(CONFIG, 65536)
    require(os.environ.get('SUDO_UID', '0') in ['0', str(config['uid'])], 'Caller is not the service account')
    owner = Exports(config)
    owner.validate()
    with (owner.state / 'lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if sys.argv[1:] == ['prepare']:
            require(os.environ.get('SUDO_UID', '0') == '0', 'Only the operator may prepare exports')
            value = owner.prepare()
        else:
            require(not sys.argv[1:], 'The service entrypoint accepts no arguments')
            raw = sys.stdin.buffer.read(config['maxRequestBytes'] + 1)
            require(len(raw) <= config['maxRequestBytes'], 'Export request exceeds its byte bound')
            value = owner.request(json.loads(raw))
    response = json.dumps({'ok': True, 'value': value}, separators=(',', ':'))
    require(len(response.encode()) <= config['maxResponseBytes'], 'Export response exceeds its byte bound')
    print(response)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, separators=(',', ':')))
        sys.exit(1)
