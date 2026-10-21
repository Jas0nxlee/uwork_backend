"""Pure diagnostic contracts; never launches Electron or contacts an inspector."""
import copy,runpy,unittest,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-cpu-probe.py'))
class Contract(unittest.TestCase):
 def test_real_case_budget_cannot_be_negative_and_zero_delta_is_not_cached_post(self):
  import time
  self.assertGreater(M['remaining'](time.monotonic()+1),0)
  self.assertGreaterEqual(M['main_cpu_work_budget'](time.monotonic()+36.1),35000)
  with self.assertRaises(AssertionError):M['main_cpu_work_budget'](time.monotonic()+35.5)
  with self.assertRaises(AssertionError):M['remaining'](time.monotonic()-1)
  before={'modelCalls':2,'rawInferencePosts':2,'supplierRequestDigests':['a','b'],'snapshot':{'actors':{key:{'accounting':{'ledger':[key]}}for key in ['current','other']}}}
  M['zero_delta'](before,copy.deepcopy(before));after=copy.deepcopy(before);after['rawInferencePosts']=3
  with self.assertRaises(AssertionError):M['zero_delta'](before,after)
  after=copy.deepcopy(before);after['snapshot']['actors']['other']['accounting']['ledger'].append('changed')
  with self.assertRaises(AssertionError):M['zero_delta'](before,after)
 def test_actual_derived_primary_only_flags_absolute_output_original_secondary_and_no_business(self):
  code=r"""
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{deriveMainCpuFixture,validateMainCpuProfile,createMainCpuActorGuard}from'./scripts/fixtures/macos-x64-cpu-derived.mjs';
const source=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),derived=deriveMainCpuFixture(source);
const body=s=>s.slice(s.indexOf('async function openWorkspace(workspacePath) {'),s.indexOf('async function stopNative() {'));assert.equal(body(source),body(derived));
assert.equal((derived.match(/--inspect-brk=127\.0\.0\.1:/g)||[]).length,1);assert.equal((derived.match(/--user-data-dir=/g)||[]).length,1);
assert(derived.includes('"--user-data-dir="+join(root,"userdata")'));assert(derived.includes("outputFile:join(process.cwd(),evidence,'main-cpu-profile.json')"));assert(derived.includes('import {runOwnedMainCpuDiagnostic} from \"./macos-x64-cpu-runtime.mjs\";'));assert(!derived.includes('import {runOwnedMainCpuDiagnostic} from \"./macos-x64-cpu-derived.mjs\";'));
validateMainCpuProfile('client-native-packaged-macos-clock-x64-startup-v5-20261021');assert.throws(()=>validateMainCpuProfile('client-native-packaged-macos-x64-startup-v2-20261021'));
assert.throws(()=>deriveMainCpuFixture(source+source));console.log('actual primary flags/absolute output/1c/profile derivation passed');
"""
  result=subprocess.run([M['NODE'],'--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
 def test_actual_actor_guard_rechecks_after_async_identity_and_rejects_reuse_exit_port_or_arch(self):
  code=r"""
import assert from'node:assert/strict';import{createMainCpuActorGuard}from'./scripts/fixtures/macos-x64-cpu-derived.mjs';
const child={exitCode:null,signalCode:null};let current=true,time=0,calls=0;
const good={birth:'owned',mappedX64:true,listenerOwned:true};
const make=inspect=>createMainCpuActorGuard({child,isCurrent:()=>current,expectedBirth:'owned',inspect,now:()=>time,deadline:100});
assert.equal(await make(async()=>good)(),true);
for(const changed of [{birth:'reused'},{mappedX64:false},{listenerOwned:false}])assert.equal(await make(async()=>({...good,...changed}))(),false);
assert.equal(await make(async()=>{current=false;return good;})(),false);current=true;
assert.equal(await make(async()=>{child.exitCode=0;return good;})(),false);child.exitCode=null;
time=100;assert.equal(await make(async()=>{calls++;return good;})(),false);assert.equal(calls,0);
console.log('actual guard postawait lifetime/birth/map/port/deadline passed');
"""
  result=subprocess.run([M['NODE'],'--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
