"""Failure-path tests use private roots and replace only host integration calls."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controller', Path(__file__).with_name('controller.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.home.mkdir()

    def test_history_allows_append_but_rejects_rewrite_and_truncation(self):
        path = self.home / 'sessions' / 'one' / 'session.v3.jsonl'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'old history\n')
        baseline = c.inventory(self.home)
        path.write_bytes(b'old history\nnew history\n')
        c.verify_prefixes(self.home, baseline)
        path.write_bytes(b'new history\n')
        with self.assertRaisesRegex(RuntimeError, 'history changed'):
            c.verify_prefixes(self.home, baseline)
        path.write_bytes(b'old')
        with self.assertRaisesRegex(RuntimeError, 'history changed'):
            c.verify_prefixes(self.home, baseline)

    def test_release_links_require_exact_candidate_dependency(self):
        releases = self.root / 'releases'
        candidate = releases / ('b' * 40)
        target = candidate / 'packages' / 'example'
        target.mkdir(parents=True)
        old = releases / ('a' * 40) / 'packages' / 'example'
        self.assertEqual(c.replacement(str(old), releases, candidate), str(target))
        self.assertIsNone(c.replacement('/external/alias', releases, candidate))
        with self.assertRaisesRegex(RuntimeError, 'missing linked dependency'):
            c.replacement(str(old / 'absent'), releases, candidate)
        with self.assertRaisesRegex(RuntimeError, 'Invalid release link'):
            c.replacement(str(releases / 'not-a-commit' / 'file'), releases, candidate)

    def test_atomic_replace_never_follows_destination_symlink(self):
        target = self.root / 'secret'
        target.write_bytes(b'preserved')
        path = self.root / 'receipt'
        path.symlink_to(target)
        c.atomic(path, b'new receipt')
        self.assertFalse(path.is_symlink())
        self.assertEqual(target.read_bytes(), b'preserved')
        self.assertEqual(path.read_bytes(), b'new receipt')

    def test_existing_lock_refuses_concurrent_operation(self):
        with c.locked(self.root / 'lock'):
            with self.assertRaises(BlockingIOError):
                with c.locked(self.root / 'lock'):
                    self.fail('second operation acquired lock')

    def test_lock_rejects_symlinks(self):
        target = self.root / 'target'
        target.write_text('untouched')
        path = self.root / 'lock'
        path.symlink_to(target)
        with self.assertRaises(OSError):
            with c.locked(path):
                self.fail('symlink lock admitted')
        self.assertEqual(target.read_text(), 'untouched')

    @unittest.skipUnless(os.geteuid() == 0, 'requires administrator identity on the deployment host')
    def test_account_cannot_write_root_files_and_restores_identity(self):
        groups = os.getgroups()
        with self.assertRaises(PermissionError):
            with c.account({'uid': 65534, 'gid': 65534}):
                self.assertEqual(os.geteuid(), 65534)
                (self.root / 'root-only').write_text('must not be written')
        self.assertEqual(os.geteuid(), 0)
        self.assertEqual(os.getgroups(), groups)
        self.assertFalse((self.root / 'root-only').exists())

    def test_running_release_is_never_rebuilt(self):
        config, directory, definition, plan = self.activation_fixture()
        with patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'running release'):
                c.prepare(config, directory, Path(plan['previous']).name)
            run.assert_not_called()

    def test_duplicate_activation_never_launches_again(self):
        directory = self.root / 'operation-123'
        directory.mkdir()
        c.json_write(directory / 'qualified.json', {'revision': 'a' * 40})
        c.status(directory, 'qualified')
        config = {'operations': str(self.root)}
        args = ['activate', directory.name, c.digest(directory / 'qualified.json')]
        with patch.object(c, 'load_config', return_value=config), patch.object(c, 'launch') as launch:
            c.main(args)
            with self.assertRaisesRegex(RuntimeError, 'not qualified'):
                c.main(args)
            self.assertEqual(launch.call_count, 1)

    def test_changed_approval_never_launches(self):
        directory = self.root / 'operation-123'
        directory.mkdir()
        c.json_write(directory / 'qualified.json', {'revision': 'a' * 40})
        c.status(directory, 'qualified')
        with patch.object(c, 'load_config', return_value={'operations': str(self.root)}), patch.object(c, 'launch') as launch:
            with self.assertRaisesRegex(RuntimeError, 'digest does not match'):
                c.main(['activate', directory.name, 'b' * 64])
            launch.assert_not_called()

    def test_qualification_failure_never_produces_approval(self):
        directory = self.root / 'operation-123'
        directory.mkdir()
        c.status(directory, 'preparation-requested')
        with patch.object(c, 'load_config', return_value={'operations': str(self.root)}), \
             patch.object(c, 'prepare', side_effect=RuntimeError('Qualification failed')):
            with self.assertRaisesRegex(RuntimeError, 'Qualification failed'):
                c.main(['_prepare', directory.name, 'a' * 40])
        self.assertEqual(json.loads((directory / 'status.json').read_text())['phase'], 'failed')
        self.assertFalse((directory / 'qualified.json').exists())

    def activation_fixture(self):
        import os
        directory = self.root / 'operation-123'
        directory.mkdir()
        state = self.root / 'state'
        state.mkdir()
        releases = self.root / 'releases'
        candidate = releases / ('b' * 40)
        candidate.mkdir(parents=True)
        (candidate / 'artifact').write_text('built')
        previous = releases / ('a' * 40)
        previous.mkdir()
        definition = self.root / 'config.json'
        definition.write_text('{}')
        config = {'releases': str(releases), 'home': str(self.home), 'state': str(state),
                  'activationLock': str(self.root / 'activate.lock'), 'syncLock': str(self.root / 'sync.lock'),
                  'idleCheck': ['idle-check'], 'dropin': str(self.root / 'service.conf'),
                  'service': 'dsh-web.service', 'buildTimeout': 20, 'healthTimeout': 20,
                  'environmentFiles': [], 'configurationRoots': [], 'companions': ['dsh-companion.service'], 'idleTimeout': 0, 'uid': os.getuid(), 'gid': os.getgid()}
        Path(config['dropin']).write_bytes(b'old service')
        args = ['/usr/bin/node', str(previous / 'apps/cli/lib/bin.js'), '--profile', 'web']
        plan = {'revision': candidate.name, 'previous': str(previous), 'argv': args,
                'files': {'artifact': c.digest(candidate / 'artifact')}, 'definition': c.digest(definition),
                'changes': [], 'configuration': {}}
        c.json_write(directory / 'qualified.json', plan)
        return config, directory, definition, plan

    def test_failed_activation_restores_code_without_restoring_history(self):
        config, directory, definition, plan = self.activation_fixture()
        history = self.home / 'sessions' / 'one' / 'session.v3.jsonl'
        history.parent.mkdir(parents=True)
        history.write_text('original\n')
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return ''
        def health(probe, timeout):
            if len([x for x in calls if x[:2] == ['systemctl', 'start']]) == 1:
                history.write_text('original\nnew data\n')
                raise RuntimeError('candidate failed')
            return {'authenticatedBoot': True}
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'retarget', return_value=[]), patch.object(c, 'run', side_effect=run), \
             patch.object(c, 'wait_health', side_effect=health), patch.object(c.subprocess, 'run'), \
             patch.object(c, 'as_user', side_effect=lambda config, args: args):
            with self.assertRaisesRegex(RuntimeError, 'candidate failed'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
        self.assertEqual(Path(config['dropin']).read_bytes(), b'old service')
        self.assertEqual(history.read_text(), 'original\nnew data\n')
        self.assertEqual(json.loads((directory / 'status.json').read_text())['phase'], 'recovered')
        self.assertFalse(any(args[0] == 'tar' and '-xf' in args for args in calls))

    def test_busy_host_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'retarget', return_value=[]), patch.object(c, 'run', side_effect=RuntimeError('busy')) as run:
            with self.assertRaisesRegex(RuntimeError, 'busy'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            run.assert_called_once_with(['idle-check'])
        self.assertEqual(Path(config['dropin']).read_bytes(), b'old service')

    def test_candidate_drift_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        (Path(config['releases']) / plan['revision'] / 'artifact').write_text('changed')
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
