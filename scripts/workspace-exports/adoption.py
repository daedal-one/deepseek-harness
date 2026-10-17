"""Operator-owned adoption of one catalogue device at an approved service start.

The service prerequisite reads the deployment controller's exact launcher override.
It neither starts a Harness nor stops a VM. Retained aliases prohibit a downgrade
to a runtime that cannot reconstruct them.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

spec = importlib.util.spec_from_file_location('exports_controller', Path(__file__).with_name('controller.py'))
exports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exports)
CONFIG = Path('/etc/dsh-workspace-exports-adoption.json')
REVISION = re.compile(r'[0-9a-f]{40}\Z')


def configured_revision(config, definition):
    """Read only the operator-owned override; never execute release-owned code as root."""
    override = Path(definition['dropin'])
    exports.private_ancestors(override.parent)
    fd = os.open(override, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        exports.require(info.st_uid == 0 and info.st_mode & 0o022 == 0,
                        'Deployment override must be root-controlled')
        data = stream.read(65537)
    exports.require(len(data.encode()) <= 65536, 'Deployment override exceeds its byte bound')
    commands = [line[len('ExecStart='):] for line in data.splitlines()
                if line.startswith('ExecStart=') and line != 'ExecStart=']
    exports.require(len(commands) == 1, 'Expected one approved deployment launcher')
    arguments = shlex.split(commands[0])
    exports.require(len(arguments) >= 4 and arguments[0] == config['node']
                    and arguments[2:4] == ['--profile', 'web'], 'Unexpected deployment launcher')
    launcher = Path(arguments[1])
    relative = launcher.relative_to(Path(definition['releases']))
    exports.require(len(relative.parts) == 5 and relative.parts[1:] == ('apps', 'cli', 'lib', 'bin.js')
                    and REVISION.fullmatch(relative.parts[0]), 'Launcher is not an immutable release')
    revision = relative.parts[0]
    exports.require(revision in [config['legacyRevision'], *config['capableRevisions']],
                    'Release has no approved workspace adoption assessment')
    return revision


def incus(config, arguments):
    scope = [] if arguments[0] == 'query' else ['--project', config['project']]
    result = subprocess.run([config['incus'], *scope, *arguments],
                            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=config['timeoutSeconds'], env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    exports.require(len(result.stdout) + len(result.stderr) <= config['maxOutputBytes'],
                    'Incus adoption response exceeds its byte bound')
    return result.stdout


def observe(config):
    return json.loads(incus(config, ['query', '/1.0/instances/' + config['instance'] + '?project=' + config['project']]))


def verify(config, instance):
    expected = config['identity']
    exports.require(all(instance.get(key) == value for key, value in expected.items() if key != 'config'),
                    'Workspace adoption instance identity changed')
    actual = instance.get('expanded_config', {})
    stable = {key: value for key, value in actual.items()
              if not key.startswith('volatile.') or key in ['volatile.base_image', 'volatile.uuid']}
    exports.require(stable == expected['config'], 'Workspace adoption resource or authority configuration changed')
    devices = instance.get('expanded_devices')
    before = config['devices']
    after = {**before, config['deviceName']: config['device']}
    exports.require(devices in [before, after] and instance.get('devices') == devices,
                    'Workspace adoption device configuration changed')
    return devices == after


def guest_catalogue(config):
    """Observe the exact guest mount without accepting another source or filesystem."""
    result = json.loads(incus(config, ['exec', config['instance'], '--', '/usr/bin/findmnt',
                                     '--json', '--list', '--output', 'TARGET,SOURCE,FSTYPE']))
    exports.require(isinstance(result, dict) and isinstance(result.get('filesystems'), list),
                    'Invalid guest mount inventory')
    mounts = result['filesystems']
    exports.require(all(isinstance(item, dict) and all(isinstance(item.get(key), str)
                        for key in ['target', 'source', 'fstype']) for item in mounts),
                    'Invalid guest mount inventory')
    matches = [item for item in mounts if item['target'] == config['device']['path']]
    exports.require(not matches or matches == [{'target': config['device']['path'],
                    'source': 'incus_' + config['deviceName'], 'fstype': 'virtiofs'}],
                    'Guest catalogue mount differs from the assessed device')
    return bool(matches)


def settle_guest_catalogue(config, present):
    """Mount or unmount only the assessed catalogue in an already-running VM."""
    if guest_catalogue(config) == present:
        return
    target = config['device']['path']
    if present:
        incus(config, ['exec', config['instance'], '--', '/bin/mkdir', '-p', '--', target])
        incus(config, ['exec', config['instance'], '--', '/bin/mount', '-t', 'virtiofs',
                       'incus_' + config['deviceName'], target])
    else:
        incus(config, ['exec', config['instance'], '--', '/bin/umount', '--', target])
    exports.require(guest_catalogue(config) == present, 'Guest catalogue mount did not settle')


def reconcile(config, owner, revision):
    """Change only the exact catalogue device and refuse destructive alias downgrades."""
    instance = observe(config)
    attached = verify(config, instance)
    exports.require(instance.get('status') in ['Running', 'Stopped'],
                    'Workspace adoption requires a running or stopped VM')
    running = instance['status'] == 'Running'
    legacy = revision == config['legacyRevision']
    if legacy:
        exports.require(not any(owner.names()), 'Retained workspace aliases require a capable runtime; downgrade refused')
        if running:
            settle_guest_catalogue(config, False)
        if attached:
            incus(config, ['config', 'device', 'remove', config['instance'], config['deviceName']])
    elif not attached:
        if running:
            guest_catalogue(config)
        device = config['device']
        incus(config, ['config', 'device', 'add', config['instance'], config['deviceName'], 'disk',
                       'source=' + device['source'], 'path=' + device['path']])
    exports.require(verify(config, observe(config)) == (not legacy), 'Workspace adoption did not settle')
    if not legacy and running:
        settle_guest_catalogue(config, True)
    return {'revision': revision, 'catalogueAttached': not legacy, 'sessionsUntouched': True}


def main():
    exports.require(os.geteuid() == 0 and os.environ.get('SUDO_UID', '0') == '0',
                    'Only the operator service prerequisite may adopt a catalogue')
    exports.require(not sys.argv[1:], 'Adoption accepts no caller arguments')
    exports.private_ancestors(CONFIG.parent)
    config = exports.read_record(CONFIG, 65536)
    exports.require(all(REVISION.fullmatch(value) for value in [config['legacyRevision'], *config['capableRevisions']])
                    and config['legacyRevision'] not in config['capableRevisions']
                    and config['capableRevisions'], 'Exact distinct release assessments are required')
    exports.require(config['incus'] == '/usr/bin/incus' and config['node'].startswith('/')
                    and re.fullmatch(r'[a-z0-9-]+', config['instance'])
                    and re.fullmatch(r'[a-z0-9-]+', config['project']), 'Fixed operator commands and instance are required')
    exports.private_ancestors(Path(config['deploymentDefinition']).parent)
    definition = exports.read_record(Path(config['deploymentDefinition']), 65536)
    exports.private_ancestors(exports.CONFIG.parent)
    owner = exports.Exports(exports.read_record(exports.CONFIG, 65536))
    owner.validate()
    exports.require(config['deviceName'] not in config['devices']
                    and config['device'] == {'type': 'disk', 'source': str(owner.portal), 'path': owner.config['guestPath']},
                    'Adoption must use the exact configured catalogue')
    with (owner.state / 'lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        owner.prepare()
        value = reconcile(config, owner, configured_revision(config, definition))
        exports.write_record(owner.state / 'adoption.json', value, 65536)
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    main()
