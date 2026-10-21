"""Pure source/readonly/zero-replay contracts; no App, sockets, backend or real profile."""
import pathlib,runpy,unittest
R=pathlib.Path(__file__).resolve().parents[2]
M=runpy.run_path(str(R/'scripts/tests/mac-native-share-artifact-probe.py'))
class Contracts(unittest.TestCase):
 def test_original_profile_guard_and_exact_new_scope(self):
  self.assertEqual(M['validate_original_profile'](M['PROFILE']),M['PROFILE'])
  for bad in [M['PROFILE'].replace('-clock-','-'),M['PROFILE'].replace('v1','v2')]:
   with self.assertRaises(AssertionError):M['validate_original_profile'](bad)
 def test_actual_clock_derives_only_finite_pdf_and_share_slice_with_original_cleanup(self):
  original=M['BASE'].read_text();derived=M['deriveShareArtifactProbe'](original);compile(derived,'actual-native-pdf-share','exec')
  self.assertEqual(derived.count('checks.append('),7)
  self.assertNotIn('original-file-tree-preview-and-renderer-reload',derived)
  self.assertNotIn("f.command('memberSeat'",derived)
  self.assertIn("f.command('stopNative', 25)",derived);self.assertIn('first[\'FirstRunUi\']',derived)
  self.assertIn('/usr/bin/base64 -D',derived);self.assertIn('Input.insertText',derived)
  for s in ['conversation-share-trigger','conversation-share-next','conversation-share-disclosure-checkbox','conversation-share-confirm','conversation-share-success-dock']:self.assertIn(s,derived)
  self.assertNotIn('dispatchEvent(',derived);self.assertNotIn('Page.reload',derived)
 def test_zero_oracle_rejects_cached_post_replay_and_full_row_changes(self):
  import copy
  b={'modelCalls':4,'rawInferencePosts':4,'supplierRequestDigests':['a','b','c','d'],'bootstrapActor':{'userId':'owned'},'snapshot':{'actors':{a:{'accounting':{'ledger':[{'amount':44}],'traces':[{'status':'succeeded'}],'gatewayCalls':[{'has_result':True}]}}for a in ['current','other']}}};M['assert_share_zero'](b,copy.deepcopy(b))
  for key in ['rawInferencePosts','modelCalls']:
   a=copy.deepcopy(b);a[key]+=1
   with self.assertRaises(AssertionError):M['assert_share_zero'](b,a)
  a=copy.deepcopy(b);a['snapshot']['actors']['other']['accounting']['ledger'][0]['amount']=45
  with self.assertRaises(AssertionError):M['assert_share_zero'](b,a)
if __name__=='__main__':unittest.main()
