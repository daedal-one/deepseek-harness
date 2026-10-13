"""Failure-path tests use private roots and replace only host integration calls."""
import importlib.util
import io
import json
import os
import subprocess
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
                  'environmentFiles': [], 'configurationRoots': [], 'companions': ['dsh-companion.service'], 'idleTimeout': 0, 'uid': os.getuid(), 'gid': os.getgid(),
                  'repository': str(self.root / 'repo'), 'compatibilityPaths': ['packages/session'],
                  'user': 'fixture', 'userHome': str(self.home), 'path': '/usr/bin:/bin',
                  'checks': [['build']], 'preservationChecks': [], 'minimumFreeBytes': 0}
        Path(config['dropin']).write_bytes(b'old service')
        args = ['/usr/bin/node', str(previous / 'apps/cli/lib/bin.js'), '--profile', 'web']
        plan = {'revision': candidate.name, 'previous': str(previous), 'argv': args,
                'files': {'artifact': c.digest(candidate / 'artifact')}, 'definition': c.digest(definition),
                'changes': [], 'configuration': {}, 'controller': c.digest(c.__file__), 'review': None}
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'run', return_value=''):
            plan['compatibility'] = c.compatibility_report(config, directory, candidate.name, args)
        c.json_write(directory / 'qualified.json', plan)
        return config, directory, definition, plan

    def test_failed_activation_restores_code_without_restoring_history(self):
        config, directory, definition, plan = self.activation_fixture()
        plan['compatibility']['changedFiles'] = ['packages/session/summary.py']
        c.json_write(directory / 'compatibility.json', plan['compatibility'])
        plan['review'] = {'decision': 'rollback-compatible', 'evidence': 'Readers and stored fields unchanged',
                          'reviewDigest': c.digest(directory / 'compatibility.json')}
        c.json_write(directory / 'compatibility-review.json', plan['review'])
        c.json_write(directory / 'qualified.json', plan)
        history = self.home / 'sessions' / 'one' / 'session.v3.jsonl'
        history.parent.mkdir(parents=True)
        history.write_text('original\n')
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return 'packages/session/summary.py\0' if 'diff' in args else ''
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

    def test_companion_startup_is_part_of_bounded_live_readiness(self):
        config = {'service': 'web', 'url': 'http://localhost', 'companions': ['companion']}
        states = iter(['activating', 'active'])
        def run(args, **kwargs):
            if args[:2] == ['systemctl', 'is-active']:
                state = next(states)
                if state != 'active':
                    raise subprocess.CalledProcessError(3, args, output=state)
                return state
            return ''
        with patch.object(c, 'run', side_effect=run), \
             patch.object(c, 'health', return_value={'authenticatedBoot': True}), \
             patch.object(c.time, 'monotonic', side_effect=[0, 0]), \
             patch.object(c.time, 'sleep') as sleep:
            self.assertEqual(c.wait_health(lambda: c.live_health(config), 20), {'authenticatedBoot': True})
            sleep.assert_called_once_with(1)
        with patch.object(c, 'run', side_effect=lambda args, **kw: 'inactive'), \
             patch.object(c, 'health', return_value={'authenticatedBoot': True}), \
             patch.object(c.time, 'monotonic', side_effect=[0, 20]), \
             patch.object(c.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'readiness timed out'):
                c.wait_health(lambda: c.live_health(config), 20)
            sleep.assert_not_called()

    def test_busy_host_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'retarget', return_value=[]), \
             patch.object(c, 'run', side_effect=lambda args, **kw: (_ for _ in ()).throw(RuntimeError('busy')) if args == ['idle-check'] else '') as run:
            with self.assertRaisesRegex(RuntimeError, 'busy'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            self.assertIn(unittest.mock.call(['idle-check']), run.call_args_list)
            self.assertFalse(any(call.args[0][0] == 'systemctl' for call in run.call_args_list))
        self.assertEqual(Path(config['dropin']).read_bytes(), b'old service')

    def test_candidate_drift_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        (Path(config['releases']) / plan['revision'] / 'artifact').write_text('changed')
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run', return_value='') as run:
            with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            self.assertFalse(any(call.args[0][0] == 'systemctl' for call in run.call_args_list))

    def review_fixture(self):
        config, directory, definition, plan = self.activation_fixture()
        (directory / 'qualified.json').unlink()
        config['operations'] = str(self.root)
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run', return_value='packages/session/summary.py\0'), \
             patch.object(c.subprocess, 'run') as build, patch.object(c, 'qualification') as qualification:
            c.prepare(config, directory, plan['revision'])
            build.assert_not_called()
            qualification.assert_not_called()
        report = json.loads((directory / 'compatibility.json').read_text())
        self.assertEqual(json.loads((directory / 'status.json').read_text())['phase'], 'compatibility-review-required')
        self.assertEqual(report['changedFiles'], ['packages/session/summary.py'])
        self.assertFalse((directory / 'qualified.json').exists())
        return config, directory, definition, plan, report

    def evidence(self, decision='rollback-compatible'):
        return io.StringIO(json.dumps({'decision': decision, 'evidence':
            'Reviewed diff changes only model routing. Stored fields and read/write paths are unchanged; '
            'existing data and candidate writes remain readable by both releases.'}))

    def test_review_records_evidence_and_resumes_exact_operation_without_policy_edits(self):
        config, directory, definition, plan, report = self.review_fixture()
        original = definition.read_bytes()
        approved = c.digest(directory / 'compatibility.json')
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'load_config', return_value=config), \
             patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run', return_value='packages/session/summary.py\0'), \
             patch.object(c.sys, 'stdin', self.evidence()), patch.object(c, 'launch') as launch:
            c.main(['review', directory.name, approved])
            launch.assert_called_once_with(directory, ['_resume', directory.name, approved], config)
            with self.assertRaisesRegex(RuntimeError, 'not awaiting'):
                c.review(config, directory, approved, self.evidence())
        self.assertEqual(definition.read_bytes(), original)
        decision = json.loads((directory / 'compatibility-review.json').read_text())
        self.assertEqual(decision['reviewDigest'], approved)
        self.assertEqual(decision['decision'], 'rollback-compatible')
        self.assertIn('evidence', decision)
        self.assertIn('actor', decision)

    def test_migration_decision_never_resumes_or_activates(self):
        config, directory, definition, plan, report = self.review_fixture()
        approved = c.digest(directory / 'compatibility.json')
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'load_config', return_value=config), \
             patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run', return_value='packages/session/summary.py\0'), patch.object(c, 'launch') as launch:
            c.review(config, directory, approved, self.evidence('migration-required'))
            with self.assertRaisesRegex(RuntimeError, 'not qualified'):
                c.main(['activate', directory.name, approved])
            with self.assertRaisesRegex(RuntimeError, 'not approved'):
                c.prepare(config, directory, plan['revision'], approved)
            launch.assert_not_called()

    def test_invalid_review_evidence_has_no_receipt_or_worker(self):
        config, directory, definition, plan, report = self.review_fixture()
        for value in ('[]', '{}', '{', 'x' * 16385,
                      '{"decision":"ignore","evidence":"test"}',
                      '{"decision":"rollback-compatible","evidence":" "}',
                      '{"decision":"rollback-compatible","evidence":false}',
                      '{"decision":"rollback-compatible","evidence":"test","command":"run"}'):
            with self.subTest(value=value[:50]), patch.object(c, 'launch') as launch:
                with self.assertRaises((RuntimeError, ValueError)):
                    c.review(config, directory, c.digest(directory / 'compatibility.json'), io.StringIO(value))
                launch.assert_not_called()
                self.assertFalse((directory / 'compatibility-review.json').exists())

    def test_wrong_digest_or_drift_refuses_review_before_receipt(self):
        config, directory, definition, plan, report = self.review_fixture()
        approved = c.digest(directory / 'compatibility.json')
        for mutation in ('digest', 'definition', 'controller', 'base', 'files', 'operation', 'revision', 'configuration'):
            with self.subTest(mutation=mutation):
                observed = dict(report)
                key = {'base': 'baseRevision', 'files': 'changedFiles'}.get(mutation, mutation)
                observed[key] = 'changed'
                with patch.object(c, 'compatibility_report', return_value=observed), \
                     patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'launch') as launch:
                    with self.assertRaisesRegex(RuntimeError, 'digest does not match|context changed'):
                        c.review(config, directory, 'f' * 64 if mutation == 'digest' else approved, self.evidence())
                    launch.assert_not_called()
                    self.assertFalse((directory / 'compatibility-review.json').exists())

    def test_interrupted_or_concurrent_review_cannot_launch_twice(self):
        config, directory, definition, plan, report = self.review_fixture()
        approved = c.digest(directory / 'compatibility.json')
        with c.locked(directory / 'review.lock'), patch.object(c, 'launch') as launch:
            with self.assertRaises(BlockingIOError):
                c.review(config, directory, approved, self.evidence())
            launch.assert_not_called()
        with patch.object(c, 'compatibility_report', return_value=report), \
             patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'launch', side_effect=RuntimeError('worker launch interrupted')) as launch:
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                c.review(config, directory, approved, self.evidence())
            with self.assertRaisesRegex(RuntimeError, 'not awaiting'):
                c.review(config, directory, approved, self.evidence())
            self.assertEqual(launch.call_count, 1)
        # A crash between durable receipt and status publication cannot admit a replay either.
        c.status(directory, 'compatibility-review-required')
        with patch.object(c, 'compatibility_report', return_value=report), \
             patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'launch') as launch:
            with self.assertRaises(FileExistsError):
                c.review(config, directory, approved, self.evidence())
            launch.assert_not_called()

    def test_resume_rechecks_review_before_build_and_binds_it_into_qualification(self):
        config, directory, definition, plan, report = self.review_fixture()
        approved = c.digest(directory / 'compatibility.json')
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'compatibility_report', return_value=report), \
             patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'launch'):
            c.review(config, directory, approved, self.evidence())
        def git(args, **kwargs):
            if args[-2:] == ['rev-parse', 'HEAD']:
                return plan['revision']
            if args[-1] == 'ls-files':
                return 'artifact'
            return ''
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'compatibility_report', return_value=report) as observe, \
             patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'run', side_effect=git), \
             patch.object(c, 'retarget', return_value=[]), \
             patch.object(c.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as build, \
             patch.object(c.os, 'fchown'), \
             patch.object(c, 'qualification', return_value={'authenticatedBoot': True}):
            c.prepare(config, directory, plan['revision'], approved)
            self.assertEqual(build.call_count, 1)
            qualified = json.loads((directory / 'qualified.json').read_text())
            self.assertEqual(qualified['compatibility'], report)
            self.assertEqual(qualified['review']['reviewDigest'], approved)
            self.assertEqual(json.loads((directory / 'status.json').read_text())['phase'], 'qualified')
            for mutation in ('baseRevision', 'revision', 'changedFiles', 'controller', 'definition', 'configuration'):
                with self.subTest(mutation=mutation):
                    observe.return_value = dict(report, **{mutation: 'changed'})
                    with self.assertRaisesRegex(RuntimeError, 'context changed'):
                        c.prepare(config, directory, plan['revision'], approved)
                    self.assertEqual(build.call_count, 1)

    def test_missing_or_changed_review_never_stops_service(self):
        config, directory, definition, plan, report = self.review_fixture()
        plan['compatibility'] = report
        approved = c.digest(directory / 'compatibility.json')
        decision = {'decision': 'rollback-compatible', 'reviewDigest': approved, 'evidence': 'Reviewed readers and writers'}
        for mutation in ('missing', 'migration', 'digest', 'edited', 'deleted', 'report'):
            with self.subTest(mutation=mutation):
                plan['review'] = None if mutation == 'missing' else decision
                saved = dict(decision)
                if mutation == 'migration':
                    saved['decision'] = 'migration-required'
                if mutation == 'digest':
                    saved['reviewDigest'] = 'f' * 64
                if mutation == 'edited':
                    saved['evidence'] = 'Different evidence'
                c.json_write(directory / 'compatibility-review.json', saved)
                c.json_write(directory / 'compatibility.json', report)
                if mutation == 'deleted':
                    (directory / 'compatibility-review.json').unlink()
                if mutation == 'report':
                    c.json_write(directory / 'compatibility.json', dict(report, operation='another-operation'))
                c.json_write(directory / 'qualified.json', plan)
                with patch.object(c, 'CONFIG', definition), patch.object(c, 'compatibility_report', return_value=report), \
                     patch.object(c, 'service_args', return_value=plan['argv']), patch.object(c, 'run') as run:
                    with self.assertRaises((RuntimeError, FileNotFoundError)):
                        c.activate(config, directory, c.digest(directory / 'qualified.json'))
                    run.assert_not_called()

    def test_changed_controller_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        plan['controller'] = 'f' * 64
        c.json_write(directory / 'qualified.json', plan)
        with patch.object(c, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'controller changed'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            run.assert_not_called()

    def test_configuration_change_during_idle_wait_never_stops_service(self):
        config, directory, definition, plan = self.activation_fixture()
        def run(args, **kwargs):
            if args == ['idle-check']:
                definition.write_text('{"changed":true}')
            return ''
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'retarget', return_value=[]), patch.object(c, 'run', side_effect=run) as execute:
            with self.assertRaisesRegex(RuntimeError, 'definition changed'):
                c.activate(config, directory, c.digest(directory / 'qualified.json'))
            self.assertFalse(any(call.args[0][0] == 'systemctl' for call in execute.call_args_list))

    def test_unchanged_compatibility_paths_qualify_without_review(self):
        config, directory, definition, plan = self.activation_fixture()
        def git(args, **kwargs):
            if args[-2:] == ['rev-parse', 'HEAD']:
                return plan['revision']
            if args[-1] == 'ls-files':
                return 'artifact'
            return ''
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'service_args', return_value=plan['argv']), \
             patch.object(c, 'run', side_effect=git), patch.object(c, 'retarget', return_value=[]), \
             patch.object(c.os, 'fchown'), patch.object(c.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(c, 'qualification', return_value={'authenticatedBoot': True}):
            c.prepare(config, directory, plan['revision'])
        qualified = json.loads((directory / 'qualified.json').read_text())
        self.assertEqual(qualified['compatibility']['changedFiles'], [])
        self.assertIsNone(qualified['review'])
        self.assertEqual(json.loads((directory / 'status.json').read_text())['phase'], 'qualified')

    def test_public_wrapper_rejects_internal_workers_and_wrong_arity(self):
        wrapper = str(Path(c.__file__).with_name('dsh-deploy'))
        for args in (['_resume', 'operation-123', 'f' * 64], ['review'], ['review', 'operation-123'],
                     ['review', 'operation-123', 'f' * 64, '/etc/secret']):
            with self.subTest(args=args):
                result = subprocess.run(['/bin/sh', wrapper, *args], capture_output=True, text=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)

    def test_real_git_report_includes_added_deleted_and_renamed_watched_files(self):
        config, directory, definition, plan = self.activation_fixture()
        repo = Path(config['repository'])
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
                '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', str(repo), *args], text=True).strip()
        git('init', '--quiet')
        watched = repo / 'packages/session'
        watched.mkdir(parents=True)
        (watched / 'old.py').write_text('old')
        (watched / 'deleted.py').write_text('deleted')
        git('add', '.')
        git('commit', '--quiet', '-m', 'base')
        base = git('rev-parse', 'HEAD')
        (watched / 'old.py').rename(watched / 'new\nname.py')
        (watched / 'deleted.py').unlink()
        (watched / 'added.py').write_text('new')
        (repo / 'unwatched').write_text('outside')
        git('add', '-A')
        git('commit', '--quiet', '-m', 'candidate')
        revision = git('rev-parse', 'HEAD')
        args = ['/usr/bin/node', str(Path(config['releases']) / base / 'apps/cli/lib/bin.js')]
        with patch.object(c, 'CONFIG', definition), patch.object(c, 'as_user', side_effect=lambda config, args: args):
            report = c.compatibility_report(config, directory, revision, args)
        self.assertEqual(report['baseRevision'], base)
        self.assertEqual(report['revision'], revision)
        self.assertEqual(report['changedFiles'], ['packages/session/added.py', 'packages/session/deleted.py',
                                               'packages/session/new\nname.py', 'packages/session/old.py'])


if __name__ == '__main__':
    unittest.main()
