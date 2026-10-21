"""Thin pure contracts for owned original installer and same-call-id consumption case."""
import copy,runpy,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/mac-plugin-skill-probe.py'))
class Contract(unittest.TestCase):
 def test_actual_original_clock_core_and_cleanup_preserved_without_warm_replay(self):
  source=M['BASE'].read_text();derived=M['derivePluginProbe'](source);compile(derived,str(M['BASE']),'exec')
  self.assertEqual(source[source.index('    except BaseException as error:'):],derived[derived.index('    except BaseException as error:'):])
  self.assertIn("f.command('openWorkspace', 60, workspacePath=str(workspace))",derived)
  self.assertNotIn('MACOS_CLOCK_LINK_20261020',derived)
  self.assertNotIn('memberSeat',derived)
  self.assertEqual(derived.count("'original-skill-send-once'"),1)
  self.assertNotIn('NATIVE_PLUGIN_SKILL_BODY',M['PROMPT'])
  with self.assertRaises(AssertionError):M['derivePluginProbe'](source.replace('        def open_file(label):','        def missing_open_file(label):'))
 def test_seed_is_other_two_calls_not_current_or_global_zero(self):
  current={k:[]for k in ['ledger','traces','gatewayCalls']};other={'ledger':[{'status':'settled','amount':22}for _ in range(2)],'traces':[{'status':'succeeded'}for _ in range(2)],'gatewayCalls':[{'has_result':True}for _ in range(2)]}
  value={'counters':{'supplierCalls':2,'modelRequests':2,'rawInferencePosts':2},'snapshot':{'actors':{'current':{'accounting':current},'other':{'accounting':other}}}}
  M['assert_seed'](value)
  bad=copy.deepcopy(value);bad['counters']['rawInferencePosts']=3
  with self.assertRaises(AssertionError):M['assert_seed'](bad)
  bad=copy.deepcopy(value);bad['snapshot']['actors']['other']['accounting']['traces'][0]['status']='pending'
  with self.assertRaises(AssertionError):M['assert_seed'](bad)
 def test_actual_fixture_has_original_body_and_package_before_inference_and_original_publish(self):
  import subprocess
  js=r"""
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{derivePluginFixture}from'./scripts/fixtures/mac-plugin-skill-derived.mjs';
const original=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),source=derivePluginFixture(original);
assert(source.indexOf('if(serveMacPluginSkillPackage(req,res,')<source.indexOf('  modelCalls++;'));
assert(source.includes('try {fileReply=await pluginOracle.reply(body);} catch {res.writeHead(400,'));
const line=source.split('\n').find(row=>row.includes('try {fileReply=await pluginOracle.reply(body);}'));assert.ok(line);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const observed={};const response={writeHead(status){observed.status=status;return this;},end(payload){observed.payload=payload;}};
await new AsyncFunction('res','pluginOracle','const body={};const fileContext=false;let fileReply;'+line)(response,{reply:async()=>{throw Error('controlled-oracle-failure');}});
assert.equal(observed.status,400);assert.deepEqual(JSON.parse(observed.payload),{error:'OWNED_PLUGIN_SKILL_REPLY_REJECTED'});

assert(source.includes("await configure('security',{allowFilesystem:true,dangerousSkills:true});"));assert(source.includes("await configure('personal',{skills:true});"));
assert(source.includes('native-packaged-macos-arm64-consistency-runtime.mjs'));assert(!source.includes('writeInstalledPluginRecord('));
assert.throws(()=>derivePluginFixture(original.replace('const upstream = httpServer(async (req, res) => {','const notUpstream = httpServer(async (req, res) => {')));
console.log('actual original-body/hash/serve/publish derivation passed');
"""
  result=subprocess.run(['/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node','--input-type=module','-e',js],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
