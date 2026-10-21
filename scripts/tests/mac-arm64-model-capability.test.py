import ast,copy,runpy,re,unittest,json,tempfile
from pathlib import Path
M=runpy.run_path(str(Path(__file__).with_name('mac-arm64-model-capability-probe.py')))
BASE=Path(__file__).with_name('macos-clock-probe.py').read_text()
class CapabilityContract(unittest.TestCase):
 def test_actual_control_derivation_compiles_and_keeps_all_original_seven_checks(self):
  derived=M['derive_clock'](BASE);compile(derived,'actual-capability-derived','exec')
  for name in re.findall(r"checks.append\('([^']+)'\)",BASE):self.assertEqual(derived.count("checks.append('"+name+"')"),1)
  self.assertIn('delivered=updated',derived);self.assertIn("own']['count']==6",derived)
  self.assertNotIn('loggedInCold',derived);self.assertIn('wait_renderer(launched,meta,evidence)',derived)
 def test_duplicate_original_anchor_is_rejected(self):
  with self.assertRaises(AssertionError):M['derive_clock'](BASE+"\n        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n")
 def test_ui_projection_requires_interactive_draft_and_fresh_session_without_state_mutation(self):
  expression=M['cap_ui']('OWNED_MARKER',['sess_old'],True);self.assertIn('data-root-workspace-surface="interactive"',expression);self.assertIn("id==='draft'",expression);self.assertIn('sess_old',expression);self.assertIn('OWNED_MARKER',expression)
  for bad in ['setState','localStorage','fetch(','dispatchEvent','resumeTask']:self.assertNotIn(bad,expression)
 def test_provider_projection_exposes_only_target_bool_and_completion_time_not_key(self):
  with tempfile.TemporaryDirectory() as base:
   directory=Path(base)/'data/.uwork/v2';directory.mkdir(parents=True)
   (directory/'provider_config.json').write_text(json.dumps({'config':{'modelConfigRules':{'providerModelRules':[{'providerId':'ucas','modelId':'owned','config':{'properties':{'supportsToolCall':False}}}]}}}))
   (directory/'ucas-gateway.json').write_text(json.dumps({'key':'PRIVATE_KEY','lastSyncedAt':10}))
   self.assertEqual(M['provider_sync'](Path(base),'owned'),{'supportsTools':False,'lastSyncedAt':10})
 def test_host_manual_completion_uses_single_compact_main_projection_not_double_host_lines(self):
  with tempfile.TemporaryDirectory() as base:
   Path(base,'electron.log').write_text('UCAS gateway provisioning synced {"reason":"manual"}\n[main] [host-log] UCAS gateway provisioning synced {"reason":"manual"}\n[main] [host-log] UCAS gateway provisioning synced {"reason":"startup"}\n')
   self.assertEqual(M['manual_completions'](Path(base)),1)
 def test_selected_model_and_current_workspace_are_waited_in_original_dom_not_asserted_after_first_draft(self):
  expression=M['cap_ui']('OWNED',['sess_old'],True,'expected-model')
  self.assertIn('expected-model',expression);self.assertIn("getAttribute('data-thought')==='none'",expression);self.assertIn("innerText.trim()==='packaged-workspace'",expression)
  self.assertIn("cap_ui(marker,prior_ids,True,meta['modelId'])",M['CAP_SLICE']);self.assertIn('chat-model-select-group-registry-provider:ucas',M['CAP_SLICE']);self.assertIn('chat-model-select-item-custom:ucas:',M['CAP_SLICE'])
if __name__=='__main__':unittest.main()
