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
        self.instance = {**self.config['identity'], 'expanded_config': self.config['identity']['config'],
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


if __name__ == '__main__': unittest.main()
