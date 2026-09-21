/** Host-side pidfd fencing for Incus virtiofs workers sharing the private source directory. @module */

/** Trusted Python controller; all process selection is revalidated through host-owned Incus metadata. */
export const VM_FILESYSTEM_FENCE = String.raw`
import json, os, pathlib, re, signal, sys, time
request = json.load(sys.stdin)
root = pathlib.Path(request['devicesRoot']) / (request['project'] + '_' + request['name'])
source = 'source=' + str(root / 'disk.workspace.workspace')
deadline = time.monotonic() + request['timeoutMs'] / 1000
members = []
fds = []

def inspect(pid):
    path = pathlib.Path('/proc') / str(pid)
    args = (path / 'cmdline').read_bytes().split(b'\0')
    if source.encode() not in args or '--cache=never'.encode() not in args:
        raise RuntimeError('workspace helper command does not match the owned source')
    if pathlib.Path(os.fsdecode(args[0])).name != 'virtiofsd':
        raise RuntimeError('workspace helper executable is not virtiofsd')
    status = (path / 'status').read_text()
    uid = re.search(r'^Uid:\s+(\d+)', status, re.M)
    if uid is None or int(uid[1]) != os.getuid():
        raise RuntimeError('workspace helper is not owned by the unprivileged workspace user')
    stat = (path / 'stat').read_text().rsplit(')', 1)[1].split()
    return stat[19]

def acquire(pid, expected=None):
    fd = os.pidfd_open(pid)
    fds.append(fd)
    started = inspect(pid)
    if expected is not None and started != expected:
        raise RuntimeError('workspace helper process identity changed')
    members.append({'pid': pid, 'started': started})
    return fd

def stopped(pid):
    task = pathlib.Path('/proc') / str(pid) / 'task'
    return all(re.search(r'^State:\s+T', (item / 'status').read_text(), re.M) for item in task.iterdir())

try:
    if request['action'] == 'freeze':
        metadata = (root / 'virtio-fs.workspace.pid').read_text()
        match = re.search(r'^pid: (\d+)$', metadata, re.M)
        if match is None: raise RuntimeError('missing virtiofs helper identity')
        pending = [int(match[1])]
        while pending:
            pid = pending.pop()
            if any(member['pid'] == pid for member in members): continue
            fd = acquire(pid)
            signal.pidfd_send_signal(fd, signal.SIGSTOP)
            while not stopped(pid):
                if time.monotonic() >= deadline: raise TimeoutError('workspace helper did not stop')
                time.sleep(0.001)
            for task in (pathlib.Path('/proc') / str(pid) / 'task').iterdir():
                pending.extend(int(value) for value in (task / 'children').read_text().split())
        print(json.dumps(members))
    elif request['action'] == 'thaw':
        for member in request['members']:
            acquire(member['pid'], member['started'])
        for fd in reversed(fds): signal.pidfd_send_signal(fd, signal.SIGCONT)
        print('[]')
    else:
        raise RuntimeError('invalid workspace fence operation')
finally:
    for fd in fds: os.close(fd)
`
