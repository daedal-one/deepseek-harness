#!/usr/bin/python3
"""Operator-installed, systemd-owned deployment of one approved Harness revision.

The root-owned definition supplies commands and paths. Callers supply only an
operation id, a commit id, or the digest of a completed qualification receipt.
Builds and candidate applications run as the configured service account.
"""
import contextlib
import fcntl
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

CONFIG = Path('/etc/dsh-deploy.json')
ID = re.compile(r'[a-z0-9][a-z0-9-]{7,63}\Z')
REV = re.compile(r'[0-9a-f]{40}\Z')
DIGEST = re.compile(r'[0-9a-f]{64}\Z')


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path, size=None):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while size is None or size:
            block = stream.read(1048576 if size is None else min(size, 1048576))
            if not block:
                require(not size, 'Historical data was shortened')
                break
            h.update(block)
            if size is not None:
                size -= len(block)
    return h.hexdigest()


def atomic(path, value):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.deploy-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def json_write(path, value):
    atomic(path, (json.dumps(value, sort_keys=True, indent=2) + '\n').encode())


def link(path, target):
    path = Path(path)
    directory = Path(tempfile.mkdtemp(prefix='.deploy-link-', dir=path.parent))
    try:
        temporary = directory / 'link'
        temporary.symlink_to(target)
        os.replace(temporary, path)
    finally:
        directory.rmdir()


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, timeout=kwargs.pop('timeout', 120), **kwargs).strip()


def as_user(config, args):
    return ['/usr/sbin/runuser', '-u', config['user'], '--', '/usr/bin/env',
            'HOME=' + config['userHome'], 'PATH=' + config['path'], *args]


def status(directory, phase, **fields):
    result = {'operation': directory.name, 'phase': phase, 'time': time.time(), **fields}
    json_write(directory / 'status.json', result)
    return result


@contextlib.contextmanager
def operation_log(path, config):
    """The service account can diagnose its commands without altering their logs."""
    with path.open('w+') as stream:
        os.fchown(stream.fileno(), 0, config['gid'])
        os.fchmod(stream.fileno(), 0o640)
        yield stream


def inventory(home):
    return {str(p.relative_to(home)): {'size': p.stat().st_size, 'sha256': digest(p)}
            for p in (home / 'sessions').rglob('*') if p.is_file() and '.jsonl' in p.name}


def verify_prefixes(home, original):
    for name, item in original.items():
        p = home / name
        require(p.is_file() and p.stat().st_size >= item['size']
                and digest(p, item['size']) == item['sha256'], 'Session history changed: ' + name)


def replacement(target, releases, candidate):
    """Retarget only release-owned links; preserve unrelated package aliases."""
    try:
        relative = Path(target).relative_to(releases)
    except ValueError:
        return None
    require(len(relative.parts) > 1 and REV.fullmatch(relative.parts[0]), 'Invalid release link')
    new = candidate.joinpath(*relative.parts[1:])
    require(new.exists(), 'Candidate is missing linked dependency: ' + str(new))
    return str(new)


def retarget(home, config, candidate):
    changes = []
    releases = Path(config['releases'])
    for p in (home / 'profiles').rglob('*'):
        if p.is_symlink():
            new = replacement(os.readlink(p), releases, candidate)
            if new is not None:
                changes.append({'path': str(p.relative_to(home)), 'link': os.readlink(p), 'new': new})
    for relative in config['releaseReferences']:
        p = home / relative
        old = p.read_text()
        new = re.sub(re.escape(str(releases)) + r'/[0-9a-f]{40}(?=/)', str(candidate), old)
        if old != new:
            changes.append({'path': relative, 'text': old, 'new': new, 'mode': p.stat().st_mode & 0o777})
    return changes


@contextlib.contextmanager
def account(config):
    """User-owned paths never receive root filesystem authority."""
    uid, gid, groups = os.geteuid(), os.getegid(), os.getgroups()
    if uid == config['uid']:
        yield
        return
    require(uid == 0, 'Cannot change service identity')
    try:
        os.setgroups([])
        os.setegid(config['gid'])
        os.seteuid(config['uid'])
        yield
    finally:
        os.seteuid(uid)
        os.setegid(gid)
        os.setgroups(groups)


def apply_changes(home, changes, forward, config):
    for item in changes:
        path = home / item['path']
        if 'link' in item:
            link(path, item['new'] if forward else item['link'])
            os.lchown(path, config['uid'], config['gid'])
        else:
            atomic(path, (item['new'] if forward else item['text']).encode())
            os.chown(path, config['uid'], config['gid'])
            os.chmod(path, item['mode'])


def client(log, base):
    tokens = re.findall(re.escape(base) + r'/\?token=([A-Za-z0-9_-]+)', log)
    require(tokens, 'Authenticated readiness credential is unavailable')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with opener.open(base + '/?token=' + tokens[-1], timeout=15) as response:
        body = response.read().decode()
        require(response.status == 200 and '__DSH_BOOT__' in body, 'Authenticated boot failed')
    return opener, body


def health(log, base):
    opener, body = client(log, base)
    marker = 'globalThis["__DSH_BOOT__"] = '
    require(marker in body, 'Client boot manifest missing')
    graph = json.JSONDecoder().raw_decode(body.split(marker, 1)[1])[0]
    urls = {entry['url'] for entry in graph['entries'] if entry.get('url')}
    require(urls, 'No client assets advertised')
    for url in urls:
        require(url.startswith('/') and not url.startswith('//'), 'Non-local client asset')
        with opener.open(base + url, timeout=20) as response:
            require(response.status == 200 and len(response.read()) > 0, 'Client asset unavailable')
    return {'authenticatedBoot': True, 'clientAssets': len(urls)}


def live_health(config):
    invocation = run(['systemctl', 'show', config['service'], '-p', 'InvocationID', '--value'])
    log = run(['journalctl', '_SYSTEMD_INVOCATION_ID=' + invocation, '-o', 'cat', '--no-pager'])
    proof = health(log, config['url'])
    for url in config.get('additionalUrls', []):
        # The login secret stays local; each declared origin gets its own cookie jar.
        health(log.replace(config['url'] + '/?token=', url + '/?token='), url)
    for companion in config['companions']:
        require(run(['systemctl', 'is-active', companion]) == 'active', 'Companion unavailable: ' + companion)
    return proof


def wait_health(probe, timeout):
    deadline = time.monotonic() + timeout
    while True:
        try:
            return probe()
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
            if time.monotonic() >= deadline:
                raise RuntimeError('Authenticated readiness timed out') from None
            time.sleep(1)


@contextlib.contextmanager
def locked(path, config=None, timeout=0):
    identity = account(config) if config is not None else contextlib.nullcontext()
    with identity:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(min(1, max(0, deadline - time.monotonic())))
        yield


def load_config():
    require(os.geteuid() == 0, 'Use the installed sudo entrypoint')
    st = CONFIG.lstat()
    require(not CONFIG.is_symlink() and st.st_uid == 0 and not st.st_mode & 0o022,
            'Deployment definition must be root-owned and not writable by other users')
    return json.loads(CONFIG.read_text())


def service_args(config):
    pid = run(['systemctl', 'show', config['service'], '-p', 'MainPID', '--value'])
    require(pid != '0', 'Maintained service is not running')
    return Path('/proc', pid, 'cmdline').read_bytes().decode().rstrip('\0').split('\0')


def launch(directory, command, config):
    unit = 'dsh-deploy-' + directory.name + '-' + command[0].lstrip('_')
    run(['systemd-run', '--system', '--quiet', '--collect', '--unit=' + unit,
         '--property=Type=exec', '--property=KillMode=control-group',
         '--property=RuntimeMaxSec=' + str(config['operationTimeout']),
         '--property=TimeoutStopSec=90', '--property=UMask=0077',
         '/usr/bin/python3', '-I', '-B', config['controller'], *command])
    return unit


def qualification(config, directory, candidate, old_args):
    private = directory / 'qualification-home'
    private.mkdir(mode=0o700)
    os.chown(private, config['uid'], config['gid'])
    with account(config):
        shutil.copytree(config['home'], private, symlinks=True, dirs_exist_ok=True,
                        ignore=lambda p, names: [n for n in names if Path(p) == Path(config['home'])
                                                and n in ('sessions', 'storages', 'backups', 'deployments',
                                                          'environment-workspaces', 'provenance', 'provenance-recovery-backups')])
        (private / 'sessions').mkdir(mode=0o700)
        apply_changes(private, retarget(private, config, candidate), True, config)
    args = list(old_args)
    args[1] = str(candidate / 'apps/cli/lib/bin.js')
    args[args.index('--port') + 1] = str(config['qualificationPort'])
    env = dict(os.environ, DSH_HOME=str(private), DSH_TELEMETRY_DISABLED='1')
    for filename in config['environmentFiles']:
        for line in Path(filename).read_text().splitlines():
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env[key] = value.strip().strip('"').strip("'")
    env['DSH_HOME'] = str(private)
    with operation_log(directory / 'qualification.log', config) as log:
        process = subprocess.Popen(as_user(config, args), cwd=candidate, env=env,
                                   stdout=log, stderr=log, start_new_session=True)
        try:
            def probe():
                require(process.poll() is None, 'Candidate exited before readiness')
                return health((directory / 'qualification.log').read_text(),
                              'http://127.0.0.1:' + str(config['qualificationPort']))
            return wait_health(probe, config['healthTimeout'])
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=30)


def configuration_fingerprints(config, args):
    """Bind qualification to operator-declared configuration and launch patches."""
    paths = {Path(p) for p in [*config['environmentFiles'], *config.get('configurationFiles', [])]}
    paths.update(Path(args[i + 1]) for i, arg in enumerate(args[:-1]) if arg == '--patch')
    for root in config['configurationRoots']:
        paths.update(p for p in Path(root).rglob('*') if p.is_file() and not p.is_symlink())
    return {str(p): digest(p) for p in sorted(paths)}


def prepare(config, directory, revision):
    candidate = Path(config['releases']) / revision
    status(directory, 'waiting-for-build-lock', revision=revision)
    with locked(config['syncLock'], config, config['buildTimeout']):
        args = service_args(config)
        old = Path(args[1]).parents[3]
        require(candidate.resolve() != old.resolve(), 'Cannot rebuild the running release')
        retained = Path(config['state']) / 'previous'
        require(not retained.exists() or candidate.resolve() != retained.resolve(), 'Cannot rebuild the rollback release')
        status(directory, 'building', revision=revision)
        git = as_user(config, ['git', '-C', config['repository']])
        run([*git, 'fetch', '--no-prune', 'origin', 'refs/heads/master:refs/remotes/origin/master'])
        run([*git, 'merge-base', '--is-ancestor', revision, 'refs/remotes/origin/master'])
        if not candidate.exists():
            run([*git, 'worktree', 'add', '--detach', str(candidate), revision])
        require(run(as_user(config, ['git', '-C', str(candidate), 'rev-parse', 'HEAD'])) == revision,
                'Candidate revision mismatch')
        require(not run(as_user(config, ['git', '-C', str(candidate), 'status', '--porcelain'])),
                'Candidate has uncommitted files')
        require(shutil.disk_usage(candidate).free >= config['minimumFreeBytes'], 'Insufficient build disk space')
        with operation_log(directory / 'build.log', config) as output:
            for command in config['checks']:
                result = subprocess.run(as_user(config, command), cwd=candidate, stdout=output,
                                        stderr=output, timeout=config['buildTimeout'])
                require(result.returncode == 0, 'Candidate build/check failed; inspect build.log')
        for command in config['preservationChecks']:
            run(as_user(config, command), cwd=candidate)
        with account(config):
            changes = retarget(Path(config['home']), config, candidate)
        # Unchanged persistence implementation is the conservative automatic rollback criterion.
        for relative in config['compatibilityPaths']:
            diff = run(as_user(config, ['git', '-C', str(candidate), 'diff', '--name-only',
                                       old.name, revision, '--', relative]))
            require(not diff, 'Session compatibility requires operator review: ' + relative)
        status(directory, 'qualifying', revision=revision)
        configuration = configuration_fingerprints(config, args)
        proof = qualification(config, directory, candidate, args)
        require(configuration_fingerprints(config, args) == configuration,
                'Deployment configuration changed during qualification')
        tracked = set(run(as_user(config, ['git', '-C', str(candidate), 'ls-files'])).splitlines())
        files = {str(p.relative_to(candidate)): digest(p) for p in candidate.rglob('*')
                 if p.is_file() and not p.is_symlink() and
                 (str(p.relative_to(candidate)) in tracked or p.suffix in ('.node', '.wasm')
                  or any(part in p.relative_to(candidate).parts for part in ('lib', 'dist', 'bin', '.dsh-build')))
                 and 'node_modules' not in p.relative_to(candidate).parts}
        require(files, 'Candidate runtime artifacts are missing')
        plan = {'revision': revision, 'previous': str(old), 'argv': args, 'files': files,
                'definition': digest(CONFIG), 'changes': changes, 'qualification': proof,
                'configuration': configuration}
        json_write(directory / 'qualified.json', plan)
        status(directory, 'qualified', revision=revision, approvalDigest=digest(directory / 'qualified.json'),
               qualification=proof)


def activate(config, directory, approved_digest):
    require(digest(directory / 'qualified.json') == approved_digest, 'Approved candidate changed')
    plan = json.loads((directory / 'qualified.json').read_text())
    candidate = Path(config['releases']) / plan['revision']
    home = Path(config['home'])
    with locked(config['activationLock']), locked(config['syncLock'], config, config['buildTimeout']):
        require(digest(CONFIG) == plan['definition'], 'Deployment definition changed; prepare again')
        require(service_args(config) == plan['argv'], 'Running release changed; prepare again')
        require(configuration_fingerprints(config, plan['argv']) == plan['configuration'],
                'Deployment configuration changed; prepare again')
        for relative, expected in plan['files'].items():
            require(digest(candidate / relative) == expected, 'Candidate artifact changed; prepare again')
        with account(config):
            require(retarget(home, config, candidate) == plan['changes'], 'Release references changed; prepare again')
        status(directory, 'waiting-for-idle', revision=plan['revision'])
        deadline = time.monotonic() + config['idleTimeout']
        while True:
            try:
                run(config['idleCheck'])
                break
            except subprocess.CalledProcessError:
                require(time.monotonic() < deadline, 'Host stayed busy; no service change was made')
                time.sleep(2)
        dropin = Path(config['dropin'])
        old_dropin = dropin.read_bytes() if dropin.exists() else None
        new_args = list(plan['argv'])
        new_args[1] = str(candidate / 'apps/cli/lib/bin.js')
        require(all(not any(c in arg for c in '\n\r%$"\\') for arg in new_args), 'Unsupported service argument')
        new_dropin = ('[Service]\nExecStart=\nExecStart=' + ' '.join('"' + a + '"' for a in new_args) + '\n').encode()
        markers = {}
        for name in ('current', 'previous', 'deployed-revision'):
            path = Path(config['state']) / name
            if path.is_symlink():
                markers[name] = ('link', os.readlink(path))
            elif path.exists():
                markers[name] = ('file', path.read_bytes())
        stopped = False
        changed = False
        try:
            status(directory, 'stopping', revision=plan['revision'])
            stopped = True
            run(['systemctl', 'stop', config['service']], timeout=90)
            with account(config):
                original = inventory(home)
            json_write(directory / 'session-prefixes.json', original)
            with (directory / 'home-before.tar').open('wb') as archive:
                subprocess.run(as_user(config, ['tar', '--acls', '--xattrs', '--exclude=.dsh/backups',
                               '-C', str(home.parent), '-cf', '-', home.name]), stdout=archive,
                               check=True, timeout=config['buildTimeout'])
            changed = True
            with account(config):
                apply_changes(home, plan['changes'], True, config)
            atomic(dropin, new_dropin)
            run(['systemctl', 'daemon-reload'])
            status(directory, 'verifying', revision=plan['revision'])
            run(['systemctl', 'start', config['service']])
            proof = wait_health(lambda: live_health(config), config['healthTimeout'])
            require(service_args(config) == new_args, 'Active service command differs from approved command')
            with account(config):
                verify_prefixes(home, original)
            with account(config):
                link(Path(config['state']) / 'previous', plan['previous'])
                link(Path(config['state']) / 'current', str(candidate))
                atomic(Path(config['state']) / 'deployed-revision', (plan['revision'] + '\n').encode())
            status(directory, 'activated-and-verified', revision=plan['revision'], previous=plan['previous'],
                   sessionsPreserved=len(original), health=proof)
        except BaseException:
            if changed:
                run(['systemctl', 'stop', config['service']], timeout=90)
                with account(config):
                    apply_changes(home, plan['changes'], False, config)
                if old_dropin is None:
                    dropin.unlink(missing_ok=True)
                else:
                    atomic(dropin, old_dropin)
                run(['systemctl', 'daemon-reload'])
            for name, (kind, value) in markers.items():
                path = Path(config['state']) / name
                with account(config):
                    if kind == 'link':
                        link(path, value)
                    else:
                        atomic(path, value)
            if stopped:
                run(['systemctl', 'start', config['service']])
                wait_health(lambda: live_health(config), config['healthTimeout'])
                status(directory, 'recovered', revision=plan['revision'], previous=plan['previous'],
                       historiesRetained=True)
            raise


def main(argv):
    config = load_config()
    require(len(argv) in (2, 3), 'Usage: dsh-deploy prepare OP REV | activate OP DIGEST | status OP')
    command, operation = argv[:2]
    require(ID.fullmatch(operation), 'Invalid operation identity')
    directory = Path(config['operations']) / operation
    if command == 'status':
        require(len(argv) == 2, 'Status takes only an operation identity')
        print((directory / 'status.json').read_text())
        return
    require(len(argv) == 3, 'Missing immutable revision or approval digest')
    argument = argv[2]
    require((REV if command in ('prepare', '_prepare') else DIGEST).fullmatch(argument), 'Invalid revision or digest')
    if command == 'prepare':
        directory.mkdir(mode=0o711)
        directory.chmod(0o711)
        status(directory, 'preparation-requested', revision=argument)
        launch(directory, ['_prepare', operation, argument], config)
    elif command == 'activate':
        require(json.loads((directory / 'status.json').read_text())['phase'] == 'qualified', 'Operation is not qualified')
        require(digest(directory / 'qualified.json') == argument, 'Approval digest does not match qualification')
        # Exclusive creation makes an uncertain submit inspectable instead of replayable.
        with (directory / 'activation-request.json').open('x') as receipt:
            json.dump({'approvalDigest': argument, 'time': time.time()}, receipt)
            receipt.flush()
            os.fsync(receipt.fileno())
        status(directory, 'activation-requested', approvalDigest=argument)
        launch(directory, ['_activate', operation, argument], config)
    elif command in ('_prepare', '_activate'):
        require('SUDO_USER' not in os.environ, 'Workers run only through their independent systemd unit')
        try:
            (prepare if command == '_prepare' else activate)(config, directory, argument)
        except BaseException as error:
            previous = json.loads((directory / 'status.json').read_text())
            if previous['phase'] != 'recovered':
                status(directory, 'failed', reason=type(error).__name__ + ': ' + str(error))
            raise
    else:
        raise RuntimeError('Unknown deployment command')


if __name__ == '__main__':
    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise InterruptedError('Deployment worker was interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    main(sys.argv[1:])
