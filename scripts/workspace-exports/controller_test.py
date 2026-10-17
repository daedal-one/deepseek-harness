"""Portable record/protocol tests; real mount and privilege evidence requires Incus qualification."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controller', Path(__file__).with_name('controller.py'))
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


class ExportRecords(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-export-records-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.portal = self.root/'portal'; self.state = self.root/'state'; self.eligible = self.root/'eligible'
        for path in [self.portal, self.state, self.state/'records', self.eligible]: path.mkdir(mode=0o700)
        self.config = {'environmentId': 'test', 'uid': 1000, 'portal': str(self.portal), 'state': str(self.state),
            'roots': [str(self.eligible)], 'reservedSources': [str(self.eligible/'reserved')],
            'guestPath': '/workspace/projects', 'maxRecordBytes': 8192, 'maxRequestBytes': 8192,
            'maxResponseBytes': 8192, 'pageSize': 3,
            'processFile': '/var/lib/incus/devices/instance/virtio-fs.repository-0.pid',
            'sharePath': '/var/lib/incus/devices/instance/disk.repository--0.workspace-projects',
            'virtiofsd': '/usr/libexec/virtiofsd'}
        self.owner = controller.Exports(self.config)

    def record(self, index):
        source = str(self.eligible/('project-'+str(index)))
        name = hashlib.sha256(source.encode()).hexdigest()
        value = {'version': 1, 'environmentId': 'test', 'source': source,
                 'identity': {'device': 1, 'inode': index+1}, 'phase': 'pending'}
        controller.write_record(self.owner.records/(name+'.json'), value, 8192)
        return name, value

    def test_records_have_no_shared_manifest_size_limit_and_retain_pending_identity(self):
        for index in range(50):
            name, value = self.record(index)
            self.assertEqual(self.owner.record(name), value)
        self.assertEqual(len(list(self.owner.names())), 50)
        with self.assertRaisesRegex(RuntimeError, 'byte bound'):
            controller.write_record(self.owner.records/'oversized.json', {'source': 'x'*8192}, 8192)
        self.assertFalse((self.owner.records/'oversized.json').exists())

    def test_record_hash_environment_phase_and_private_ownership_are_validated(self):
        name, value = self.record(1)
        path = self.owner.records/(name+'.json')
        for replacement in [{'environmentId':'other'}, {'phase':'unknown'}, {'source':'/other'}, {'identity': []}]:
            controller.write_record(path, {**value, **replacement}, 8192)
            with self.assertRaises(RuntimeError): self.owner.record(name)
        controller.write_record(path, value, 8192); path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'private'): self.owner.record(name)

    def test_pages_are_bounded_and_restore_every_record_once(self):
        expected = [self.record(index)[0] for index in range(12)]
        with patch.object(self.owner, 'ready_portal'), patch.object(self.owner, 'recover', side_effect=lambda name: {'source':name,'path':'/workspace/projects/'+name}):
            after = ''; observed = []
            while True:
                page = self.owner.page(after)
                self.assertLessEqual(len(page['mounts']), 3)
                observed.extend(mount['source'] for mount in page['mounts'])
                if page['next'] is None: break
                self.assertGreater(page['next'], after); after=page['next']
            self.assertEqual(observed, sorted(expected))
            self.config['maxResponseBytes']=300
            self.assertEqual(len(self.owner.page('')['mounts']), 1)
            self.config['maxResponseBytes']=10
            with self.assertRaisesRegex(RuntimeError, 'response bounds'): self.owner.page('')

    def test_unknown_state_files_and_noncanonical_requests_fail_closed(self):
        (self.owner.records/'unknown').write_text('unexpected')
        with self.assertRaisesRegex(RuntimeError, 'Unknown export record'): list(self.owner.names())
        with patch.object(self.owner, 'validate'):
            for value in [[], {'environmentId':'other'}, {'environmentId':'test','operation':'delete'},
                          {'environmentId':'test','operation':'select','source':'/etc','extra':True}]:
                with self.assertRaises(RuntimeError): self.owner.request(value)

    def test_sources_reject_roots_reserved_mounts_symlinks_and_tmpfs(self):
        real = self.eligible/'real'; real.mkdir()
        (self.eligible/'alias').symlink_to(real, target_is_directory=True)
        reserved = self.eligible/'reserved'; reserved.mkdir()
        for source in [str(self.eligible), '/etc', str(reserved), str(reserved/'child')]:
            with self.assertRaises(RuntimeError):
                with self.owner.source(source): pass
        with self.assertRaises(OSError):
            with self.owner.source(str(self.eligible/'alias')): pass
        with patch.object(controller, 'filesystem', return_value='tmpfs'):
            with self.assertRaisesRegex(RuntimeError, 'disk-backed'):
                with self.owner.source(str(real)): pass
        with patch.object(controller, 'filesystem', return_value='ext4'):
            with self.owner.source(str(real)) as fd: self.assertGreater(controller.identity(fd)['inode'], 0)

    def test_private_state_cannot_be_inside_another_native_source(self):
        self.config['reservedSources'] = [str(self.root)]
        with patch.object(controller, 'private_ancestors'), patch.object(controller, 'filesystem', return_value='ext4'):
            with self.assertRaisesRegex(RuntimeError, 'other native sources'): self.owner.validate()


if __name__ == '__main__': unittest.main()
