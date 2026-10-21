"""Pure secondary diagnostic glue; no application, browser, inspector or HTTP."""
import runpy,unittest,time,subprocess,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-secondary-probe.py'))
class Contract(unittest.TestCase):
 def test_observer_failure_preserves_real_command_return_and_original_error(self):
  value=object();error=RuntimeError('original')
  def observe(_):raise OSError('observer')
  out=M['command_outcome'](lambda:value,observe,time.monotonic()+1)
  self.assertIs(out['result'],value);self.assertEqual(out['observerError']['type'],'OSError');self.assertTrue(out['threadClosed'])
  def send():raise error
  out=M['command_outcome'](send,observe,time.monotonic()+1)
  self.assertIs(out['_exception'],error);self.assertEqual(out['observerError']['type'],'OSError');self.assertTrue(out['threadClosed'])
 def test_actual_actor_subprocesses_clamp_to_shared_deadline_and_expired_rejects_without_query(self):
  with tempfile.TemporaryDirectory()as folder:
   exe=Path(folder)/'owned';exe.write_bytes(bytes.fromhex('cffaedfe07000001'))
   calls=[]
   def fake(args,**kwargs):
    calls.append(kwargs['timeout']);return SimpleNamespace(stdout='owned birth\n'if args[0]=='ps'else'n'+str(exe)+'\n')
   with patch('subprocess.run',fake):
    self.assertEqual(M['read_actor'](123,str(exe),time.monotonic()+.5)['birth'],'owned birth')
    self.assertEqual(len(calls),3);self.assertTrue(all(0<item<=.5 for item in calls))
    calls.clear()
    with self.assertRaises(AssertionError):M['read_actor'](123,str(exe),time.monotonic()-1)
    self.assertEqual(calls,[])
 def test_actual_common_derivation_original_secondary_and_only_private_primary_arg(self):
  code=r"""
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{deriveSecondaryFixture,validateSecondaryProfile}from'./scripts/fixtures/macos-x64-secondary-derived.mjs';
const old=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),source=deriveSecondaryFixture(old);
const body=s=>s.slice(s.indexOf('async function openWorkspace(workspacePath) {'),s.indexOf('async function stopNative() {'));assert.equal(body(old),body(source));
assert(!source.includes('--inspect-brk'));assert(!source.includes('owned-main-cpu-profiler'));assert(!source.includes('macos-x64-cpu-runtime'));
assert.equal((source.match(/--user-data-dir=/g)||[]).length,1);assert(source.includes('"--user-data-dir="+join(root,"userdata")'));
validateSecondaryProfile('client-native-packaged-macos-clock-x64-startup-v6-20261021');assert.throws(()=>validateSecondaryProfile('client-native-packaged-macos-clock-x64-startup-v5-20261021'));assert.throws(()=>deriveSecondaryFixture(old+old));
console.log('actual original1c/privateprimary/noCPU contract passed');
"""
  result=subprocess.run([M['NODE'],'--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
