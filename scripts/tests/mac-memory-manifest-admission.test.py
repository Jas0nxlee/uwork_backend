"""Actual new variant compilation and namespace; reuse proven actual Input and safe-finally contracts."""
import ast, json, pathlib, runpy, subprocess, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
class Contract(unittest.TestCase):
 def module(self):return runpy.run_path(str(ROOT/'scripts/tests/mac-memory-manifest-admission-probe.py'))
 def test_actual_both_variants_namespace_budget_and_preserved_seed_cleanup(self):
  m=self.module()
  for mode,profile in m['PROFILES'].items():
   runpy.run_path(str(ROOT/'scripts/tests/macos-clock-profile.test.py'))['check'](profile)
   s=m['deriveAdmissionProbe'](m['BASE'].read_text(),mode);ns=m['create_admission_namespace'](s,m['N']['MemoryCaseBudget']());m['N']['verify_globals'](ns)
   self.assertIs(ns['run'].__globals__,ns);self.assertIn('safe_native_cleanup(f=f,bridge=bridge,guard=guard',s);self.assertIn('text=manifest_seed_command(root,memory_file)',s)
   self.assertEqual(ns['DENIED_LABEL'],m['N']['MANIFEST_PROMPT']);self.assertIn("updated['modelCalls']=="+('7'if mode=='allow'else'6'),s)
   compiled=compile(s,'actual-admission','exec');self.assertTrue(compiled)
 def test_actual_fixture_env_and_derived_common_preserve_original_supplier(self):
  code="""import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{deriveAdmissionFixture,validateAdmissionProfile,PROFILES}from'./scripts/fixtures/mac-memory-manifest-admission-derived.mjs';const env={UWORK_NATIVE_CLIENT_EXPERIENCE:'enabled',UWORK_NATIVE_CONFIGURATION_WITNESS:'enabled',UWORK_NATIVE_PACKAGED_MANIFEST:'/private/real-future-manifest'};const original=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8');for(const mode of['deny','allow']){assert.equal(validateAdmissionProfile(PROFILES[mode],env),mode);assert.throws(()=>validateAdmissionProfile(PROFILES[mode],{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));const derived=deriveAdmissionFixture(original,{mode});assert(derived.includes('manifestFilesystemAllowed='+String(mode==='allow')));assert(derived.includes('native-packaged-macos-arm64-memory-manifest-runtime.mjs'));assert(derived.includes('contextWindow: 500000'));assert(derived.includes('expectedMainReply:'));assert(derived.includes('manifestResponses.filter'));console.log(JSON.stringify({mode,source:derived}));}"""
  r=subprocess.run([NODE,'--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True,timeout=10);self.assertEqual(r.returncode,0,r.stderr)
  for line in r.stdout.splitlines():
   source=json.loads(line)['source'];c=subprocess.run([NODE,'--check','--input-type=module'],input=source,capture_output=True,text=True,timeout=10);self.assertEqual(c.returncode,0,c.stderr)
 def test_existing_actual_terminal_seed_and_finally_contracts_are_still_executed(self):
  cls=runpy.run_path(str(ROOT/'scripts/tests/mac-memory-manifest-filesystem-denied.test.py'))['Contract']
  for name in ['test_actual_terminal_insert_and_file_validation_use_single_line_transport','test_actual_manifest_finally_original180_escapes_new160_and180_persist']:
   test=cls(name);getattr(test,name)()
if __name__=='__main__':unittest.main()
