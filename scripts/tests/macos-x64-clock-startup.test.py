"""Actual original profile guards and literal-only variants. No GUI/backend/application."""
import runpy,unittest,subprocess,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-probe.py'))
P=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-log.py'))
PROFILE='client-native-packaged-macos-clock-x64-startup-v2-20261021'
BAD='client-native-packaged-macos-x64-startup-v1-20261020'
class Contract(unittest.TestCase):
 def test_actual_clock_and_new_parser_and_module_guards_accept_same_correct_profile(self):
  self.assertEqual(M['validate_variant_guards'](PROFILE),PROFILE)
  with self.assertRaises(AssertionError):M['validate_original_clock_profile'](BAD)
  with self.assertRaises(AssertionError):P['validate_clock_startup_profile'](BAD)
 def test_probe_only_two_import_paths_change_not_business_or_timeout_or_sampler(self):
  source=M['BASE'].read_text();actual=M['deriveClockStartupProbe'](source);compile(actual,str(M['BASE']),'exec')
  restored=actual.replace("'scripts/tests/macos-x64-clock-startup-log.py'","'scripts/tests/macos-x64-startup-log.py'").replace("['scripts/fixtures/macos-x64-clock-startup-derived.mjs']","['scripts/fixtures/macos-x64-startup-derived.mjs']")
  self.assertEqual(restored,source)
  with self.assertRaises(AssertionError):M['deriveClockStartupProbe'](source+source)
 def test_parser_only_profile_changes_original_reader_body_same(self):
  source=P['BASE'].read_text();actual=P['deriveClockStartupLog'](source)
  self.assertEqual(actual.replace(P['AFTER'],P['BEFORE']),source)
  self.assertEqual(source[source.index('def read_owned_single_instance_phases'):],actual[actual.index('def read_owned_single_instance_phases'):])
 def test_fixture_pure_guard_and_exact_one_literal_change(self):
  code=r"""
import{readFileSync}from'node:fs';import assert from'node:assert/strict';import{validateClockStartupProfile,deriveClockStartupFixture}from'./scripts/fixtures/macos-x64-clock-startup-derived.mjs';
const old=readFileSync('scripts/fixtures/macos-x64-startup-derived.mjs','utf8');const value=deriveClockStartupFixture(old);
assert.equal(value.replace('/^client-native-packaged-macos-clock-x64-startup-v[0-9]+-20261021$/','/^client-native-packaged-macos-x64-startup-v[0-9]+-20261020$/'),old);
validateClockStartupProfile('client-native-packaged-macos-clock-x64-startup-v2-20261021');
for(const p of ['client-native-packaged-macos-x64-startup-v1-20261020','client-native-packaged-macos-clock-x64-startup-v2-20261020'])assert.throws(()=>validateClockStartupProfile(p));
assert.throws(()=>deriveClockStartupFixture(old+old));console.log('guard/whole-old-entry-exact-restoration passed');
"""
  result=subprocess.run([M['NODE'],'--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
