"""Pure secondary receipt/finally contracts, never creates a fixture or native UI."""
import ast
import copy
import json
from pathlib import Path
import runpy
import tempfile
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).with_name('macos-x64-probe.py')
PROBE = runpy.run_path(str(SOURCE))


def command_class(capture, observer_facts=None, observer_save=lambda:None, observer_stderr=None):
    tree = ast.parse(SOURCE.read_text())
    run = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run')
    original = next(node for node in run.body if isinstance(node, ast.ClassDef) and node.name == 'Fixture')
    methods = [copy.deepcopy(node) for node in original.body if isinstance(node, ast.FunctionDef) and node.name == 'command']
    class Base:
        def command(self, op, *args, **kwargs):
            self.observed = (op, args, kwargs)
            if self.error is not None: raise self.error
            return self.result
    node = ast.ClassDef(name='Fixture', bases=[ast.Name(id='Base', ctx=ast.Load())], keywords=[], body=methods or [ast.Pass()], decorator_list=[])
    scope = {'Base': Base, 'capture_secondary': capture, 'facts': observer_facts if observer_facts is not None else {},
             'save': observer_save, 'sys': SimpleNamespace(stderr=observer_stderr)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), 'exec'), scope)
    value = scope['Fixture']();value.error=None;value.result=object()
    return value


class SecondaryEvidence(unittest.TestCase):
    def test_original_error_is_preserved_and_finally_records_open_workspace(self):
        captured=[];value=command_class(lambda fixture:captured.append(fixture));failure=RuntimeError('original secondary rejected')
        value.error=failure
        with self.assertRaises(RuntimeError) as error:value.command('openWorkspace',60,workspacePath='/owned/project')
        self.assertIs(error.exception,failure);self.assertEqual(captured,[value]);self.assertEqual(value.observed,('openWorkspace',(60,),{'workspacePath':'/owned/project'}))
    def test_success_result_identity_and_business_arguments_are_preserved(self):
        captured=[];value=command_class(lambda fixture:captured.append(fixture));result=value.command('openWorkspace',60,workspacePath='/owned/project')
        self.assertIs(result,value.result);self.assertEqual(captured,[value])
    def observer_failure_case(self, original_error):
        for save_fails, stderr_fails in [(False,False),(True,False),(True,True)]:
            with self.subTest(save_fails=save_fails,stderr_fails=stderr_fails):
                writes=[];facts={}
                class Stderr:
                    def write(self,text):
                        writes.append(text)
                        if stderr_fails:raise OSError('stderr unavailable')
                def capture(_):raise OSError('observer unavailable; do not print private detail')
                def save():
                    if save_fails:raise OSError('disk unavailable')
                value=command_class(capture,facts,save,Stderr());value.error=original_error
                if original_error:
                    with self.assertRaises(RuntimeError) as error:value.command('openWorkspace',60,workspacePath='/owned/project')
                    self.assertIs(error.exception,original_error)
                else:self.assertIs(value.command('openWorkspace',60,workspacePath='/owned/project'),value.result)
                self.assertEqual(facts.get('secondaryObserverError'),{'type':'OSError'})
                if save_fails:
                    self.assertEqual(len(writes),1);self.assertLessEqual(len(writes[0]),128)
                    self.assertNotIn('private detail',writes[0])
                else:self.assertEqual(writes,[])
    def test_observer_failure_cannot_replace_original_success_object(self):
        self.observer_failure_case(None)
    def test_observer_failure_cannot_replace_original_error_object(self):
        self.observer_failure_case(RuntimeError('original product error'))
    def test_other_commands_do_not_create_secondary_diagnostics(self):
        captured=[];value=command_class(lambda fixture:captured.append(fixture));self.assertIs(value.command('memberSeat',value=False),value.result);self.assertEqual(captured,[])
    def test_exact_original_event_rows_are_saved_before_projection(self):
        events=[{'event':'ready','secret':'not copied'},{'event':'workspace-secondary-started','primaryPid':10,'secondaryPid':20},
                {'event':'workspace-secondary-exit','primaryPid':10,'secondaryPid':20,'exit':{'code':None,'signal':'SIGKILL'},'timedOut':True,'primaryStillExists':True,'workspacePath':'/owned/中文 空格'}]
        original=copy.deepcopy(events)
        with tempfile.TemporaryDirectory(prefix='uwork-x64-receipt-test-') as directory:
            file=Path(directory)/'workspace-secondary-events.json'
            def project():
                self.assertEqual(json.loads(file.read_text())['events'],events[1:]);return {'readyState':'loading','startupLoadingVisible':True}
            value=PROBE['persist_secondary_evidence'](events,Path(directory),project)
            self.assertEqual(value['events'],events[1:]);self.assertEqual(value['startupProjection']['readyState'],'loading');self.assertEqual(events,original)
    def test_missing_receipt_does_not_invent_timeout_or_success(self):
        with tempfile.TemporaryDirectory(prefix='uwork-x64-receipt-test-') as directory:
            value=PROBE['persist_secondary_evidence']([],Path(directory),lambda:{'readyState':'interactive'})
            self.assertEqual(value['events'],[]);self.assertNotIn('timedOut',value)
    def test_projection_failure_retains_original_events_with_explicit_error(self):
        rows=[{'event':'workspace-secondary-started','secondaryPid':20}]
        with tempfile.TemporaryDirectory(prefix='uwork-x64-receipt-test-') as directory:
            def project():raise RuntimeError('original CDP unavailable')
            value=PROBE['persist_secondary_evidence'](rows,Path(directory),project)
            self.assertEqual(value['events'],rows);self.assertEqual(value['projectionError']['type'],'RuntimeError');self.assertIsNone(value['startupProjection'])
    def test_startup_projection_is_one_original_readonly_cdp_with_eval_budget(self):
        calls=[]
        class Bridge:
            def raw_cdp(self,*args,**kwargs):calls.append((args,kwargs));return {'result':{'value':{'readyState':'loading'}}}
        value=PROBE['read_startup_projection'](Bridge());self.assertEqual(value,{'readyState':'loading'});self.assertEqual(len(calls),1)
        args,kwargs=calls[0];self.assertEqual(args,('Runtime.evaluate',));self.assertEqual(kwargs['timeout'],1000);self.assertIs(kwargs['awaitPromise'],False);self.assertIs(kwargs['returnByValue'],True)
        for forbidden in ['Input.','.click(','.focus(','dispatchEvent','localStorage','fetch(']:self.assertNotIn(forbidden,kwargs['expression'])

class LifecycleSummary(unittest.TestCase):
    def put(self, root, name, text):
        path=Path(root)/name;path.write_text(text);path.chmod(0o600);return path
    def test_only_lifecycle_categories_and_typed_error_codes_are_projected(self):
        with tempfile.TemporaryDirectory(prefix='uwork-x64-lifecycle-') as directory:
            self.put(directory,'workspace-secondary.stdout.log','[2026-10-20 22:00:00.000] [pid:20] [main] [app-quit] waiting for host process cleanup token=DO_NOT_EXPOSE hosts=0\nPRIVATE_DATA_MUST_NOT_COPY\n')
            self.put(directory,'workspace-secondary.stderr.log','TypeError: PERSONAL_DETAIL_MUST_NOT_COPY\nError [ERR_DLOPEN_FAILED]: PRIVATE_DETAIL\n')
            self.put(directory,'workspace-secondary-timing.json',json.dumps({'clock':'controller performance.now monotonic','marks':[{'phase':'command','atMs':10,'env':'SECRET_MUST_NOT_COPY'}],'envRecorded':False,'closeErrors':[],'env':{'TOKEN':'SECRET_MUST_NOT_COPY'}}))
            value=PROBE['read_secondary_lifecycle'](Path(directory));raw=json.dumps(value)
            self.assertNotIn('DO_NOT_EXPOSE',raw);self.assertNotIn('PRIVATE_',raw);self.assertNotIn('PERSONAL_',raw);self.assertNotIn('SECRET_',raw)
            self.assertEqual(value['streams'][0]['selected'][0]['numericFields'],{'hosts':0})
            self.assertEqual(value['streams'][1]['selected'][0]['errorType'],'TypeError')
            self.assertEqual(value['streams'][1]['selected'][1]['errorCode'],'ERR_DLOPEN_FAILED')
    def test_missing_child_logs_do_not_invent_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix='uwork-x64-lifecycle-') as directory:
            value=PROBE['read_secondary_lifecycle'](Path(directory));self.assertFalse(value['timing']['available']);self.assertTrue(all(not row['available'] for row in value['streams']))
    def test_large_log_is_bounded_and_wrong_permission_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='uwork-x64-lifecycle-') as directory:
            path=self.put(directory,'workspace-secondary.stdout.log','x'*100000+'\n[app-quit] exiting prepared app windows=0\n')
            value=PROBE['read_secondary_lifecycle'](Path(directory));row=value['streams'][0];self.assertTrue(row['truncated']);self.assertLessEqual(row['readBytes'],65536);self.assertEqual(row['selected'][-1]['phase'],'exiting prepared app')
            path.chmod(0o644)
            with self.assertRaises(AssertionError):PROBE['read_secondary_lifecycle'](Path(directory))

class SampleSummary(unittest.TestCase):
    def put(self,root,name,value):
        path=Path(root)/name;path.write_text(value);path.chmod(0o600);return path
    def test_real_stack_categories_are_bounded_without_paths_or_environment(self):
        with tempfile.TemporaryDirectory(prefix='uwork-sample-summary-') as directory:
            self.put(directory,'workspace-secondary-sample.json',json.dumps({'envRecorded':False,'childPid':20,'samplerPid':30,'samplerClosed':True,'status':'captured-exact-owned-stack','before':{'pid':20,'birth':'own','executable':'PRIVATE_PATH'},'after':{'pid':20,'birth':'own','executable':'PRIVATE_PATH'},'secret':'PRIVATE_SECRET'}))
            self.put(directory,'workspace-secondary.sample.txt','PRIVATE_PATH\nCall graph:\n    + 77 NotifyOtherProcessWithTimeout (in Electron Framework)\n    + 22 __psynch_cvwait (in libsystem_kernel)\nPRIVATE_ENV=SECRET\n')
            value=PROBE['read_secondary_sample'](Path(directory));raw=json.dumps(value)
            self.assertTrue(value['samplerClosed']);self.assertEqual(value['stack']['categories'],['NotifyOtherProcessWithTimeout','__psynch_cvwait'])
            self.assertNotIn('PRIVATE',raw);self.assertNotIn('SECRET',raw);self.assertTrue(value['identityStable'])
    def test_missing_observer_is_unavailable_not_an_accepted_stack(self):
        with tempfile.TemporaryDirectory(prefix='uwork-sample-summary-') as directory:
            self.assertEqual(PROBE['read_secondary_sample'](Path(directory)),{'available':False})
    def test_unreaped_sampler_is_explicit_and_stack_file_requires_private_regular_output(self):
        with tempfile.TemporaryDirectory(prefix='uwork-sample-summary-') as directory:
            self.put(directory,'workspace-secondary-sample.json',json.dumps({'envRecorded':False,'samplerClosed':False,'status':'owned-sampler-cleanup-failed'}))
            value=PROBE['read_secondary_sample'](Path(directory));self.assertFalse(value['samplerClosed']);self.assertEqual(value['status'],'owned-sampler-cleanup-failed')
            path=self.put(directory,'workspace-secondary.sample.txt','stack');path.chmod(0o644)
            with self.assertRaises(AssertionError):PROBE['read_secondary_sample'](Path(directory))

if __name__=='__main__':unittest.main()
