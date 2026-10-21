import copy,json,runpy,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
SOURCE=Path(__file__).with_name('mac-arm64-cold-consistency-probe.py');M=runpy.run_path(str(SOURCE));BASE=SOURCE.with_name('macos-clock-probe.py').read_text()
class ColdContract(unittest.TestCase):
 def test_actual_original_control_compiles_with_all_original_checks_and_only_added_cold_slice(self):
  derived=M['derive_clock'](BASE);compile(derived,str(SOURCE),'exec')
  import re
  for marker in re.findall(r"checks.append\('([^']+)'\)",BASE):self.assertEqual(derived.count("checks.append('"+marker+"')"),1)
  self.assertIn('not in consistency_previous_mains',derived);self.assertNotIn("row.get('pid') != launched['pid']",derived)
  self.assertIn('wait_renderer(launched,meta,evidence)',derived)
  self.assertNotIn('resumeTask(',M['COLD_SLICE']);self.assertNotIn('Input.insertText',M['COLD_SLICE'])
 def test_missing_or_duplicate_original_anchor_is_rejected_before_run(self):
  with self.assertRaises(AssertionError):M['derive_clock'](BASE+"\n        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n")
 def test_actual_fd_binding_requires_project_cli_and_stable_birth(self):
  root=Path('/owned/case');workspace=root/'packaged-workspace';args=[]
  def invoke(command,**kwargs):
   args.append(command)
   return SimpleNamespace(stdout='n/owned/case/data/.zcode/cli/db/db.sqlite\n' if command[0]=='lsof' else 'same birth\n')
  with patch('subprocess.run',invoke):
   path,binding=M['mapped_database']([{'pid':100,'workingDirectory':str(workspace)}],root,workspace)
  self.assertEqual(path,'/owned/case/data/.zcode/cli/db/db.sqlite');self.assertEqual(binding[0]['pid'],100);self.assertEqual(len(args),3)
  sequence=iter(['before','n/owned/case/data/.zcode/cli/db/db.sqlite\n','reused'])
  with patch('subprocess.run',lambda *a,**k:SimpleNamespace(stdout=next(sequence))),self.assertRaises(AssertionError):M['mapped_database']([{'pid':100,'workingDirectory':str(workspace)}],root,workspace)
 def test_local_settlement_refreshes_dom_title_and_requires_same_ui_and_db_twice(self):
  views=iter([{'ok':True,'title':'old'},{'ok':True,'title':'final'},{'ok':True,'title':'final'}])
  bridge=SimpleNamespace(evaluate=lambda _:next(views));seen=[]
  def read(root,workspace,dom,path):
   seen.append(dom['title'])
   if dom['title']=='old':raise AssertionError('Index already advanced')
   return {'semanticSha256':'stable','semantic':{}}
  globals_=M['stable_local'].__globals__
  with patch.dict(globals_,{'read_local':read}),patch('time.sleep',lambda _:None):value,dom=M['stable_local']('/owned','/workspace',bridge,'/db','sess_owned')
  self.assertEqual(seen,['old','final','final']);self.assertEqual(dom['title'],'final')
 def test_ui_projection_is_specific_interactive_same_task_and_label_not_absolute_path(self):
  expression=M['ui_expression']('sess_owned');self.assertIn('data-root-workspace-surface="interactive"',expression);self.assertIn('workspaceLabel',expression);self.assertNotIn('workspacePath:',expression)
  for forbidden in ['setState','localStorage','fetch(','resume','dispatchEvent']:self.assertNotIn(forbidden,expression)
if __name__=='__main__':unittest.main()
