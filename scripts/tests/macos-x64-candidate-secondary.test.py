"""Pure new-candidate contracts; no backend, inspector, UI or App launch."""
import hashlib,json,pathlib,runpy,subprocess,unittest
R=pathlib.Path(__file__).resolve().parents[2]
P=runpy.run_path(str(R/'scripts/tests/macos-x64-candidate-secondary-probe.py'))
class Contracts(unittest.TestCase):
 def test_only_three_old_probe_anchors_change_and_full_body_compiles(self):
  original=P['BASE'].read_text();derived=P['deriveCandidateSecondaryProbe'](original);compile(derived,'actual-new-secondary','exec')
  self.assertEqual(derived.replace(P['PROFILE'],P['OLD_PROFILE']).replace('scripts/fixtures/macos-x64-candidate-secondary-derived.mjs','scripts/fixtures/macos-x64-secondary-derived.mjs'),original)
  self.assertIn('started+120;work_deadline=deadline-20',derived)
  self.assertIn('ready_seconds=min(60,remaining(work_deadline,20))',derived)
  self.assertIn("f.command('openWorkspace',remaining(command_deadline)",derived)
  self.assertIn("remaining(work_deadline)>=20",derived)
  for word in ['inspect-brk','AXPress','HARNESS']:self.assertNotIn(word,derived)
 def test_actual_new_profile_guard_and_original_clock_guard(self):
  old=runpy.run_path(str(R/'scripts/tests/macos-x64-clock-startup-probe.py'));old['validate_original_clock_profile'](P['PROFILE'])
  code="import{validateSecondaryProfile}from'./scripts/fixtures/macos-x64-candidate-secondary-derived.mjs';validateSecondaryProfile(process.argv[1]);"
  subprocess.run([P['NODE'],'--input-type=module','-e',code,P['PROFILE']],cwd=R,check=True,capture_output=True,text=True,timeout=10)
  for bad in [P['OLD_PROFILE'],P['PROFILE'].replace('-clock-','-'),P['PROFILE'].replace('20261021','20261020')]:
   self.assertNotEqual(subprocess.run([P['NODE'],'--input-type=module','-e',code,bad],cwd=R,capture_output=True,text=True,timeout=10).returncode,0)
 def test_actual_common_only_changes_loader_and_preserves_original_1c(self):
  code="""import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{deriveSecondaryFixture as old}from'./scripts/fixtures/macos-x64-secondary-derived.mjs';import{deriveSecondaryFixture as candidate}from'./scripts/fixtures/macos-x64-candidate-secondary-derived.mjs';const source=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),a=old(source),b=candidate(source);assert.equal(b.replace('./native-packaged-macos-x64-secondary-exit-runtime.mjs','./native-packaged-macos-x64-startup-runtime.mjs'),a);const body=s=>s.slice(s.indexOf('async function openWorkspace(workspacePath) {'),s.indexOf('async function stopNative() {'));assert.equal(body(b),body(source));assert.equal(createHash('sha256').update(body(b)).digest('hex'),'1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6');assert.ok(b.includes('--user-data-dir='));assert.ok(!b.includes('--inspect-brk'));console.log(createHash('sha256').update(b).digest('hex'));"""
  result=subprocess.run([P['NODE'],'--input-type=module','-e',code],cwd=R,check=True,capture_output=True,text=True,timeout=10);self.assertRegex(result.stdout.strip(),r'^[0-9a-f]{64}$')
if __name__=='__main__':unittest.main()
