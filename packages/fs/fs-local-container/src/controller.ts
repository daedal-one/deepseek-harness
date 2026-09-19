/**
 * Immutable Python controller loaded through the runtime owner's bounded exec API.
 * @module @deepseek-ai/dsh-fs-local-container/controller
 */

/** Controller program that performs every filesystem syscall in the container namespace. */
export const FILESYSTEM_CONTROLLER = String.raw`import base64
import errno
import json
import os
import stat
import sys
import tempfile
import uuid

WORKSPACE = '/workspace'
BINARY_SAMPLE_BYTES = 8192

class Failure(Exception):
    def __init__(self, code):
        self.code = code

def response(value):
    sys.stdout.write(json.dumps(value, separators=(',', ':')))
    sys.stdout.flush()

def fail(code):
    raise Failure(code)

def code_for(error):
    if error.errno in (errno.ENOENT, errno.ENOTDIR):
        return 'FS_NOT_FOUND'
    if error.errno in (errno.EACCES, errno.EPERM):
        return 'FS_PERMISSION_DENIED'
    return 'FS_IO_ERROR'

def require_string(value):
    if not isinstance(value, str):
        fail('FS_IO_ERROR')
    return value

def decode(value):
    value = require_string(value)
    try:
        data = base64.b64decode(value.encode('ascii'), validate=True)
    except Exception:
        fail('FS_IO_ERROR')
    if base64.b64encode(data).decode('ascii') != value:
        fail('FS_IO_ERROR')
    return data

def encode(value):
    return base64.b64encode(value).decode('ascii')

def inside(path):
    try:
        return os.path.commonpath((WORKSPACE, path)) == WORKSPACE
    except ValueError:
        return False

def lexical_path(raw):
    raw = require_string(raw)
    if raw.strip() == '':
        fail('FS_NOT_FOUND')
    path = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(WORKSPACE, raw))
    if not inside(path):
        fail('FS_PERMISSION_DENIED')
    return path

def resolved_path(raw):
    display = lexical_path(raw)
    canonical = os.path.realpath(display)
    if not inside(canonical):
        fail('FS_PERMISSION_DENIED')
    return display, canonical

def lstat_path(raw):
    display = lexical_path(raw)
    parent = os.path.realpath(os.path.dirname(display))
    if not inside(parent):
        fail('FS_PERMISSION_DENIED')
    return display

def version(info):
    return '{}:{}:{}:{}:{}'.format(info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def entry_type(info):
    if stat.S_ISREG(info.st_mode):
        return 'file'
    if stat.S_ISDIR(info.st_mode):
        return 'directory'
    return 'other'

def lentry_type(info):
    if stat.S_ISLNK(info.st_mode):
        return 'symlink'
    return entry_type(info)

def optional_stat(path, follow=True):
    try:
        return os.stat(path) if follow else os.lstat(path)
    except OSError as error:
        if error.errno in (errno.ENOENT, errno.ENOTDIR):
            return None
        raise

def regular(path):
    info = optional_stat(path)
    if info is None:
        fail('FS_NOT_FOUND')
    if not stat.S_ISREG(info.st_mode):
        fail('FS_NOT_REGULAR_FILE')
    return info

def bounded_read(path, limit):
    info = regular(path)
    if info.st_size > limit:
        fail('FS_TOO_LARGE')
    with open(path, 'rb') as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        fail('FS_TOO_LARGE')
    return data, info

def text_data(data, all_nul=False):
    sample = data if all_nul else data[:BINARY_SAMPLE_BYTES]
    if b'\x00' in sample:
        fail('FS_NOT_TEXT')
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        fail('FS_NOT_TEXT')

def normalize(value):
    return value.replace('\r\n', '\n')

def restore(value, original):
    sample = original[:4096]
    crlf = sample.count('\r\n')
    lf = sample.count('\n') - crlf
    return normalize(value).replace('\n', '\r\n') if crlf > lf else value

def atomic_write(path, data, old_mode, create_only):
    parent = os.path.dirname(path)
    parent_info = optional_stat(parent)
    if parent_info is None or not stat.S_ISDIR(parent_info.st_mode):
        fail('FS_NOT_FOUND')
    stage = os.path.join(parent, '.dsh-fs-' + uuid.uuid4().hex)
    temp_path = None
    published = False
    try:
        os.mkdir(stage, 0o700)
        descriptor, temp_path = tempfile.mkstemp(prefix='file-', dir=stage)
        if old_mode is not None:
            os.fchmod(descriptor, old_mode)
        with os.fdopen(descriptor, 'wb', closefd=True) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if create_only:
            try:
                os.link(temp_path, path, follow_symlinks=False)
            except FileExistsError:
                visible = optional_stat(path, follow=False)
                if visible is not None and not stat.S_ISREG(visible.st_mode):
                    fail('FS_NOT_REGULAR_FILE')
                fail('FS_NOT_OBSERVED')
        else:
            os.replace(temp_path, path)
        published = True
        directory = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temp_path is not None:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
        try:
            os.rmdir(stage)
        except OSError:
            if not published:
                raise

def checked_target(request):
    display, canonical = resolved_path(request.get('path'))
    declared = require_string(request.get('targetKey'))
    if canonical != declared:
        fail('FS_STALE_VERSION')
    return display, canonical

def write(request):
    display, path = checked_target(request)
    data = decode(request.get('content'))
    limit = request.get('maxFileBytes')
    diff_limit = request.get('diffBasisMaxBytes')
    if not isinstance(limit, int) or not isinstance(diff_limit, int) or len(data) > limit:
        fail('FS_TOO_LARGE')
    existing = optional_stat(path)
    visible = optional_stat(display, follow=False)
    if visible is not None and stat.S_ISLNK(visible.st_mode) and existing is None:
        fail('FS_NOT_REGULAR_FILE')
    if existing is not None and not stat.S_ISREG(existing.st_mode):
        fail('FS_NOT_REGULAR_FILE')
    expected = request.get('expected')
    if expected is not None:
        kind = expected.get('kind') if isinstance(expected, dict) else None
        if kind == 'replaceIfVersion':
            if existing is None or version(existing) != require_string(expected.get('version')):
                fail('FS_STALE_VERSION')
        elif kind == 'createIfAbsent':
            if existing is not None:
                fail('FS_NOT_OBSERVED')
        else:
            fail('FS_IO_ERROR')
    before = None
    if existing is not None and existing.st_size < diff_limit and len(data) < diff_limit:
        try:
            previous, _ = bounded_read(path, diff_limit - 1)
            before = encode(normalize(text_data(previous)).encode('utf-8'))
        except Failure as error:
            if error.code != 'FS_NOT_TEXT':
                raise
    atomic_write(path, data, stat.S_IMODE(existing.st_mode) if existing is not None else None, expected is not None and expected.get('kind') == 'createIfAbsent')
    committed = regular(path)
    return {'operation': 'update' if existing is not None else 'create', 'version': version(committed), 'before': before}

def edit(request):
    _display, path = checked_target(request)
    limit = request.get('maxFileBytes')
    if not isinstance(limit, int):
        fail('FS_IO_ERROR')
    existing = optional_stat(path)
    if existing is None:
        fail('FS_STALE_VERSION')
    if not stat.S_ISREG(existing.st_mode):
        fail('FS_NOT_REGULAR_FILE')
    expected = request.get('expected')
    if expected is not None:
        if not isinstance(expected, dict) or version(existing) != require_string(expected.get('version')):
            fail('FS_STALE_VERSION')
    raw, existing = bounded_read(path, limit)
    original = text_data(raw, True)
    edit_request = request.get('edit')
    if not isinstance(edit_request, dict):
        fail('FS_IO_ERROR')
    old = normalize(require_string(edit_request.get('oldString')))
    new = normalize(require_string(edit_request.get('newString')))
    if old == '':
        fail('FS_EDIT_NOT_FOUND')
    matches = original.count(old)
    if matches == 0:
        fail('FS_EDIT_NOT_FOUND')
    replace_all = edit_request.get('replaceAll')
    if not isinstance(replace_all, bool):
        fail('FS_IO_ERROR')
    if not replace_all and matches != 1:
        fail('FS_AMBIGUOUS_EDIT')
    before = normalize(original)
    after = before.replace(old, new) if replace_all else before.replace(old, new, 1)
    stored = restore(after, original).encode('utf-8')
    if len(stored) > limit:
        fail('FS_TOO_LARGE')
    atomic_write(path, stored, stat.S_IMODE(existing.st_mode), False)
    committed = regular(path)
    return {'version': version(committed), 'before': encode(before.encode('utf-8')), 'after': encode(after.encode('utf-8'))}

def list_dir(request):
    _display, path = checked_target(request)
    info = optional_stat(path)
    if info is None:
        fail('FS_NOT_FOUND')
    if not stat.S_ISDIR(info.st_mode):
        fail('FS_NOT_DIRECTORY')
    entries = []
    with os.scandir(path) as scan:
        for entry in sorted(scan, key=lambda item: item.name):
            display, canonical = resolved_path(entry.path)
            child = optional_stat(canonical)
            values = {'name': entry.name, 'type': entry_type(child) if child is not None else 'other', 'target': {'targetKey': canonical, 'displayPath': display}}
            if child is not None:
                values['version'] = version(child)
                if stat.S_ISREG(child.st_mode):
                    values['size'] = child.st_size
            entries.append(values)
    return entries

def dispatch(request):
    operation = request.get('operation')
    if operation == 'resolve':
        display, canonical = resolved_path(request.get('path'))
        return {'targetKey': canonical, 'displayPath': display}
    if operation == 'stat':
        _display, path = checked_target(request)
        info = optional_stat(path)
        if info is None:
            return None
        values = {'version': version(info), 'type': entry_type(info)}
        if stat.S_ISREG(info.st_mode):
            values['size'] = info.st_size
        return values
    if operation == 'lstat':
        path = lstat_path(request.get('path'))
        info = optional_stat(path, follow=False)
        if info is None:
            return None
        values = {'version': version(info), 'type': lentry_type(info)}
        if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            values['size'] = info.st_size
        return values
    if operation == 'readText':
        _display, path = checked_target(request)
        data, _info = bounded_read(path, request.get('maxFileBytes'))
        return {'data': encode(text_data(data).encode('utf-8'))}
    if operation == 'readBytes':
        _display, path = checked_target(request)
        limit = request.get('maxBytes')
        if not isinstance(limit, int) or limit < 0:
            fail('FS_IO_ERROR')
        data, _info = bounded_read(path, limit)
        return {'data': encode(data)}
    if operation == 'readByteRange':
        _display, path = checked_target(request)
        offset = request.get('offset')
        length = request.get('length')
        max_file = request.get('maxFileBytes')
        if not isinstance(offset, int) or not isinstance(length, int) or not isinstance(max_file, int) or offset < 0 or length < 0 or length > max_file:
            fail('FS_IO_ERROR')
        regular(path)
        with open(path, 'rb') as handle:
            handle.seek(offset)
            data = handle.read(length)
        return {'data': encode(data)}
    if operation == 'listDir':
        return list_dir(request)
    if operation == 'writeText':
        return write(request)
    if operation == 'editText':
        return edit(request)
    fail('FS_IO_ERROR')

try:
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        fail('FS_IO_ERROR')
    response({'ok': True, 'value': dispatch(request)})
except Failure as error:
    response({'ok': False, 'code': error.code})
except OSError as error:
    response({'ok': False, 'code': code_for(error)})
except Exception:
    response({'ok': False, 'code': 'FS_IO_ERROR'})
`
