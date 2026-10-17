"""Exact-device adoption and data-preserving downgrade tests."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('adoption', Path(__file__).with_name('adoption.py'))
adoption = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adoption)


class Adoption(unittest.TestCase):
    def setUp(self):
        self.legacy = 'a' * 40; self.candidate = 'b' * 40
        self.before = {'root': {'type': 'disk', 'path': '/', 'pool': 'test'},
                       'repository-0': {'type': 'disk', 'source': '/selected', 'path': '/workspace/old'}}
        self.device = {'type': 'disk', 'source': '/var/lib/exports/portal', 'path': '/workspace/projects'}
        self.config = {'legacyRevision': self.legacy, 'capableRevisions': [self.candidate],
                       'node': '/usr/local/bin/node', 'devices': self.before, 'device': self.device,
                       'deviceName': 'repository-1', 'instance': 'test',
                       'identity': {'name': 'test', 'type': 'virtual-machine', 'profiles': [],
                                    'config': {'user.dsh.owner': 'owner', 'volatile.uuid': 'incarnation'}}}
        self.instance = {**self.config['identity'], 'status': 'Stopped', 'expanded_config': self.config['identity']['config'],
                         'expanded_devices': self.before, 'devices': self.before}
        self.after = {**self.before, 'repository-1': self.device}
        self.owner = Mock(); self.owner.names.return_value = iter([])

    def observed(self, after):
        return {**self.instance, 'expanded_devices': self.after if after else self.before,
                'devices': self.after if after else self.before}

    def test_adopts_only_one_device_and_preserves_all_existing_devices(self):
        with patch.object(adoption, 'observe', side_effect=[self.observed(False), self.observed(True)]), \
             patch.object(adoption, 'incus') as execute:
            value = adoption.reconcile(self.config, self.owner, self.candidate)
        self.assertTrue(value['catalogueAttached'])
        execute.assert_called_once_with(self.config, ['config', 'device', 'add', 'test', 'repository-1', 'disk',
            'source=/var/lib/exports/portal', 'path=/workspace/projects'])

    def test_capable_restart_reuses_catalogue_without_mutation(self):
        with patch.object(adoption, 'observe', return_value=self.observed(True)), patch.object(adoption, 'incus') as execute:
            adoption.reconcile(self.config, self.owner, self.candidate)
        execute.assert_not_called()

    def test_empty_catalogue_can_back_out_but_retained_aliases_refuse_downgrade(self):
        with patch.object(adoption, 'observe', side_effect=[self.observed(True), self.observed(False)]), \
             patch.object(adoption, 'incus') as execute:
            adoption.reconcile(self.config, self.owner, self.legacy)
        execute.assert_called_once_with(self.config, ['config', 'device', 'remove', 'test', 'repository-1'])
        self.owner.names.return_value = iter(['retained'])
        with patch.object(adoption, 'observe', return_value=self.observed(True)), patch.object(adoption, 'incus') as execute:
            with self.assertRaisesRegex(RuntimeError, 'downgrade refused'):
                adoption.reconcile(self.config, self.owner, self.legacy)
        execute.assert_not_called()

    def test_identity_resource_and_unknown_device_drift_refuse_mutation(self):
        for replace in [{'profiles': ['unreviewed']}, {'name': 'other'},
                        {'expanded_config': {'user.dsh.owner': 'other'}},
                        {'expanded_devices': {**self.before, 'unexpected': self.device}},
                        {'devices': {}}]:
            with patch.object(adoption, 'observe', return_value={**self.instance, **replace}), \
                 patch.object(adoption, 'incus') as execute:
                with self.assertRaises(RuntimeError): adoption.reconcile(self.config, self.owner, self.candidate)
            execute.assert_not_called()
        observed = copy.deepcopy(self.instance)
        observed['expanded_config']['volatile.last_state.power'] = 'RUNNING'
        self.assertFalse(adoption.verify(self.config, observed))

    def test_launcher_requires_an_explicit_release_assessment_and_fixed_entrypoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            override = Path(temporary) / 'override'; definition = {'dropin': str(override), 'releases': '/releases'}
            def write(revision, entrypoint='apps/cli/lib/bin.js'):
                override.write_text('[Service]\nExecStart=\nExecStart="/usr/local/bin/node" '
                                    f'"/releases/{revision}/{entrypoint}" "--profile" "web"\n')
            with patch.object(adoption.exports, 'private_ancestors'), patch.object(adoption.os, 'fstat') as info:
                info.return_value = Mock(st_uid=0, st_mode=0o600)
                write(self.candidate)
                self.assertEqual(adoption.configured_revision(self.config, definition), self.candidate)
                write('c' * 40)
                with self.assertRaisesRegex(RuntimeError, 'no approved'): adoption.configured_revision(self.config, definition)
                write(self.candidate, 'apps/cli/lib/other.js')
                with self.assertRaisesRegex(RuntimeError, 'immutable release'): adoption.configured_revision(self.config, definition)

    def test_raw_query_scopes_its_url_while_device_commands_use_the_project_flag(self):
        self.config.update(incus='/usr/bin/incus', project='test-project', timeoutSeconds=30, maxOutputBytes=8192)
        with patch.object(adoption.subprocess, 'run', return_value=Mock(stdout=json.dumps(self.instance).encode(), stderr=b'')) as run:
            self.assertEqual(adoption.observe(self.config), self.instance)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/incus', 'query', '/1.0/instances/test?project=test-project'])
            adoption.incus(self.config, ['config', 'device', 'remove', 'test', 'repository-1'])
            self.assertEqual(run.call_args.args[0], ['/usr/bin/incus', '--project', 'test-project', 'config', 'device',
                                                   'remove', 'test', 'repository-1'])

    def test_running_adoption_mounts_before_readiness_and_empty_backout_unmounts_first(self):
        self.instance['status'] = 'Running'
        state = {'attached': False, 'mounted': False}; actions = []
        def execute(_config, arguments):
            actions.append(arguments)
            if arguments[:3] == ['config', 'device', 'add']: state['attached'] = True
            elif arguments[:3] == ['config', 'device', 'remove']:
                self.assertFalse(state['mounted']); state['attached'] = False
            elif arguments[3] == '/usr/bin/findmnt':
                return json.dumps({'filesystems': [{'target': self.device['path'], 'source': 'incus_repository-1',
                                    'fstype': 'virtiofs'}] if state['mounted'] else []}).encode()
            elif arguments[3] == '/bin/mount':
                self.assertTrue(state['attached']); state['mounted'] = True
            elif arguments[3] == '/bin/umount': state['mounted'] = False
            return b''
        with patch.object(adoption, 'observe', side_effect=lambda _: self.observed(state['attached'])), \
             patch.object(adoption, 'incus', side_effect=execute):
            adoption.reconcile(self.config, self.owner, self.candidate)
            self.assertEqual(state, {'attached': True, 'mounted': True})
            first = list(actions); actions.clear()
            adoption.reconcile(self.config, self.owner, self.candidate)
            self.assertEqual(len(actions), 1); self.assertEqual(actions[0][3], '/usr/bin/findmnt')
            adoption.reconcile(self.config, self.owner, self.legacy)
            self.assertEqual(state, {'attached': False, 'mounted': False})
        self.assertIn(['exec', 'test', '--', '/bin/mount', '-t', 'virtiofs', 'incus_repository-1',
                       '/workspace/projects'], first)

    def test_running_restart_repairs_an_attached_but_unmounted_catalogue(self):
        self.instance['status'] = 'Running'
        with patch.object(adoption, 'observe', return_value=self.observed(True)), \
             patch.object(adoption, 'settle_guest_catalogue') as settle:
            adoption.reconcile(self.config, self.owner, self.candidate)
        settle.assert_called_once_with(self.config, True)

    def test_unexpected_guest_mounts_and_invalid_inventory_refuse_mutation(self):
        expected = {'target': self.device['path'], 'source': 'incus_repository-1', 'fstype': 'virtiofs'}
        for value in [None, {'filesystems': {}}, {'filesystems': [None]}, {'filesystems': [{}]},
                      {'filesystems': [expected, expected]},
                      {'filesystems': [{**expected, 'source': 'another-device'}]},
                      {'filesystems': [{**expected, 'fstype': 'ext4'}]}]:
            with self.subTest(value=value), patch.object(adoption, 'incus', return_value=json.dumps(value).encode()) as execute:
                with self.assertRaises(RuntimeError): adoption.settle_guest_catalogue(self.config, True)
                self.assertEqual(execute.call_count, 1)

    def test_mount_failure_and_unsettled_mounts_prevent_readiness(self):
        absent = json.dumps({'filesystems': []}).encode()
        with patch.object(adoption, 'incus', side_effect=[absent, b'', RuntimeError('mount failed')]):
            with self.assertRaisesRegex(RuntimeError, 'mount failed'):
                adoption.settle_guest_catalogue(self.config, True)
        with patch.object(adoption, 'incus', side_effect=[absent, b'', b'', absent]):
            with self.assertRaisesRegex(RuntimeError, 'did not settle'):
                adoption.settle_guest_catalogue(self.config, True)

    def test_unexpected_mount_blocks_device_attachment(self):
        self.instance['status'] = 'Running'
        inventory = {'filesystems': [{'target': self.device['path'], 'source': 'another-device', 'fstype': 'virtiofs'}]}
        with patch.object(adoption, 'observe', return_value=self.observed(False)), \
             patch.object(adoption, 'incus', return_value=json.dumps(inventory).encode()) as execute:
            with self.assertRaisesRegex(RuntimeError, 'differs from the assessed'):
                adoption.reconcile(self.config, self.owner, self.candidate)
            self.assertEqual(execute.call_count, 1)
            self.assertEqual(execute.call_args.args[1][3], '/usr/bin/findmnt')

    def test_retained_aliases_and_unstable_vm_states_refuse_guest_mutation(self):
        self.instance['status'] = 'Running'; self.owner.names.return_value = iter(['retained'])
        with patch.object(adoption, 'observe', return_value=self.observed(True)), \
             patch.object(adoption, 'incus') as execute:
            with self.assertRaisesRegex(RuntimeError, 'downgrade refused'):
                adoption.reconcile(self.config, self.owner, self.legacy)
            execute.assert_not_called()
        for status in ['Frozen', 'Starting', None]:
            with patch.object(adoption, 'observe', return_value={**self.observed(False), 'status': status}), \
                 patch.object(adoption, 'incus') as execute:
                with self.assertRaisesRegex(RuntimeError, 'running or stopped'):
                    adoption.reconcile(self.config, self.owner, self.candidate)
                execute.assert_not_called()


if __name__ == '__main__': unittest.main()
