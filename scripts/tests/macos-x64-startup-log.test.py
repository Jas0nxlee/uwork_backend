"""Pure owned Main file-log parser contracts; never launches a process or UI."""
import json
from pathlib import Path
import runpy
import tempfile
import unittest
PARSER=runpy.run_path(str(Path(__file__).with_name('macos-x64-startup-log.py')))
PROFILE='client-native-packaged-macos-x64-startup-v1-20261020'
class Parser(unittest.TestCase):
    def setup_root(self,base):
        root=Path(base)/'data'/PROFILE;root.mkdir(parents=True,mode=0o700)
        for suffix in ['data','data/.uwork','data/.uwork/v2','data/.uwork/v2/logs']:(root/suffix).mkdir(mode=0o700)
        return root
    def events(self):return [{'event':'workspace-secondary-started','primaryPid':10,'secondaryPid':20},{'event':'workspace-secondary-exit','primaryPid':10,'secondaryPid':20,'timedOut':True}]
    def line(self,pid,fields):return '[2026-10-20 23:00:00.123] [info] [pid:'+str(pid)+'] [main] [single-instance-startup] '+json.dumps(fields)+'\n'
    def put(self,root,text):
        p=root/'data/.uwork/v2/logs/2026-10-20.log';p.write_text(text);p.chmod(0o644);return p
    def row(self,phase,**fields):return {'event':'desktop_single_instance_startup','phase':phase,**fields}
    def test_only_original_started_pid_pair_fixed_fields_and_matching_exit_are_projected(self):
        with tempfile.TemporaryDirectory() as base:
            root=self.setup_root(base)
            text='PRIVATE_DATA_MUST_NOT_COPY\n'+self.line(999,{'secret':'PRIVATE_SECRET'})
            text+=self.line(10,self.row('lock-request-return',acquired=True,elapsedMs=2.25))
            text+=self.line(20,self.row('lock-request-start'))+self.line(20,self.row('lock-request-return',acquired=False,elapsedMs=4))
            self.put(root,text);value=PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events());raw=json.dumps(value)
            self.assertNotIn('PRIVATE',raw);self.assertEqual(len(value['rows']),3);self.assertEqual(value['rows'][0]['role'],'primary');self.assertEqual(value['rows'][1]['role'],'secondary');self.assertTrue(value['exitObserved']);self.assertEqual(value['files'][0]['mode'],'0644')
    def test_no_started_event_does_not_invent_process_or_read_foreign_log(self):
        with tempfile.TemporaryDirectory() as base:
            value=PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,[]);self.assertFalse(value['available']);self.assertEqual(value['rows'],[])
    def test_missing_return_is_reported_as_missing_not_exit_or_ack(self):
        with tempfile.TemporaryDirectory() as base:
            root=self.setup_root(base);self.put(root,self.line(20,self.row('lock-request-start')))
            value=PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events());self.assertEqual(value['rows'][0]['phase'],'lock-request-start');self.assertNotIn('rootCause',value);self.assertNotIn('ack',value)
    def test_invalid_payload_unknown_phase_bad_bool_or_elapsed_is_rejected(self):
        invalid=[self.row('lock-request-start',argv='PRIVATE'),self.row('unknown'),self.row('lock-request-return',acquired=1),self.row('secondary-quit-return',elapsedMs=float('nan')),self.row('secondary-quit-return',elapsedMs=-1)]
        with tempfile.TemporaryDirectory() as base:
            root=self.setup_root(base)
            for fields in invalid:
                self.put(root,self.line(20,fields))
                with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events())
    def test_root_and_file_symlinks_wrong_private_root_and_mismatched_exit_are_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root=self.setup_root(base);p=self.put(root,self.line(20,self.row('lock-request-start')));p.unlink();p.symlink_to('/dev/null')
            with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events())
            p.unlink();self.put(root,'');root.chmod(0o755)
            with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events())
            root.chmod(0o700);rows=self.events();rows[1]['secondaryPid']=999
            with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,rows)
    def test_duplicate_phase_or_oversize_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root=self.setup_root(base);line=self.line(20,self.row('lock-request-start'));p=self.put(root,line+line)
            with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events())
            with p.open('wb') as stream:stream.truncate(4*1024*1024+1)
            with self.assertRaises(AssertionError):PARSER['read_owned_single_instance_phases'](Path(base),PROFILE,self.events())
if __name__=='__main__':unittest.main()
