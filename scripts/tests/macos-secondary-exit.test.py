"""Pure contracts for new sealed-candidate replay; no App, backend or sockets."""
import ast,json,pathlib,runpy,subprocess,unittest
R=pathlib.Path(__file__).resolve().parents[2]
P=runpy.run_path(str(R/'scripts/tests/macos-secondary-exit-probe.py'))
L=runpy.run_path(str(R/'scripts/tests/macos-secondary-exit-log.py'))
class Contracts(unittest.TestCase):
 def test_profile_uses_actual_clock_and_both_new_guards(self):
  for arch in ['x64','arm64']:
   good='client-native-packaged-macos-clock-'+arch+'-secondary-exit-v1-20261021'
   self.assertEqual(P['validate_secondary_exit_guards'](good,arch),good)
   for bad in [good.replace('-clock-','-'),good.replace('20261021','20261020'),good.replace(arch,'arm64' if arch=='x64' else 'x64')]:
    with self.assertRaises((AssertionError,subprocess.CalledProcessError)):P['validate_secondary_exit_guards'](bad,arch)
 def test_full_original_seven_probe_and_budget_are_retained(self):
  original=P['BASE'].read_text()
  for arch in ['x64','arm64']:
   source=P['deriveSecondaryExitProbe'](original,arch);compile(source,'derived-'+arch,'exec')
   self.assertIn('seconds=30',source);self.assertNotIn('seconds=60',source)
   self.assertIn("clock['run'](plan['profile']",source)
   self.assertIn('return super().command(op, *positional, **kwargs)',source)
   self.assertIn('except BaseException as observer_error:',source)
   self.assertNotIn('inspect-brk',source);self.assertNotIn('/usr/bin/sample',source)
   self.assertIn('darwin-'+arch+'/pty.node',source)
   self.assertIn(P['APPS'][arch],source)
 def test_profile_reader_has_only_the_finite_regex_delta(self):
  original=L['BASE'].read_text();derived=L['deriveSecondaryExitLog'](original)
  self.assertEqual(derived.replace(L['AFTER'],L['BEFORE']),original)
 def test_entry_two_anchor_delta_preserves_original_one_c_function(self):
  node=P['NODE'];code="""import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {deriveSecondaryExitEntry} from './scripts/fixtures/macos-secondary-exit-derived.mjs';const old=readFileSync('./scripts/fixtures/macos-x64-startup-derived.mjs','utf8');for(const arch of ['x64','arm64']){const s=deriveSecondaryExitEntry(old,arch);assert.equal(s.replace('owned arm64 loader import only;','owned x64 loader import only;').replace('/^client-native-packaged-macos-clock-'+arch+'-secondary-exit-v[0-9]+-20261021$/','/^client-native-packaged-macos-x64-startup-v[0-9]+-20261020$/').replace('./native-packaged-macos-'+arch+'-secondary-exit-runtime.mjs','./native-packaged-macos-x64-startup-runtime.mjs'),old);assert.ok(s.includes('1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6'));assert.ok(s.includes('secondaryOriginalBodyPreserved: true'));}assert.throws(()=>deriveSecondaryExitEntry(old,'win32'));"""
  subprocess.run([node,'--input-type=module','-e',code],cwd=R,check=True,capture_output=True,text=True,timeout=10)
 def test_actual_x64_harness_passes_exact_owned_actor_to_dismissal_before_attach(self):
  import types,time
  source=P['deriveSecondaryExitProbe'](P['BASE'].read_text(),'x64');tree=ast.parse(source)
  run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run')
  fn=next(n for n in run.body if isinstance(n,ast.FunctionDef)and n.name=='guarded_harness')
  calls=[];port=61376;app=pathlib.Path(P['APPS']['x64']);evidence=R/'evidence/owned-pure-case'
  class Harness:
   def __init__(self,*a,**k):calls.append(('attach',a,k))
  def dismiss(**kw):
   calls.append(('dismiss',kw));self.assertEqual((kw['pid'],kw['birth'],kw['executable']),(123,'owned-birth',str(app/'Contents/MacOS/UWork Preview')))
   self.assertTrue(kw['actor_guard']());self.assertTrue(0<kw['deadline']-time.monotonic()<=5)
   return {'status':'not-observed','pid':123}
  mapped_calls=[];query_calls=[];guards=[];slow_listener=[False]
  def mapped(*a):mapped_calls.append(a);return {'birth':'owned-birth'}
  def listener(*a,**k):
   query_calls.append(k)
   if slow_listener[0]:time.sleep(.02)
   return types.SimpleNamespace(returncode=0,stdout='n127.0.0.1:'+str(port)+'\n')
  def ready(*a,**k):guards.append(a[2]);self.assertTrue(a[2]());return {'id':'owned-target'}
  ns={'ROOT':R,'APP':app,'launch_bindings':{port:{'pid':123,'birth':'owned-birth'}},'evidence':evidence,'facts':{},'mapped':mapped,'subprocess':types.SimpleNamespace(run=listener),'save':lambda:None,'readiness':{'wait_owned_renderer':ready},'runpy':types.SimpleNamespace(run_path=lambda p:{'dismiss_owned_architecture_warning':dismiss}),'original_harness':Harness,'active_bridge':{'value':None}}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual-derived-harness','exec'),ns)
  value=ns['guarded_harness'](port,evidence=evidence)
  self.assertEqual([row[0]for row in calls],['dismiss','attach']);self.assertIs(ns['active_bridge']['value'],value)
  self.assertEqual(mapped_calls[0][2],None);self.assertNotIn('timeout',query_calls[0])
  self.assertEqual(mapped_calls[1][2],calls[0][1]['deadline']);self.assertTrue(0<query_calls[1]['timeout']<=.75)
  prior=(len(mapped_calls),len(query_calls))
  with self.assertRaises(TimeoutError):guards[0](time.monotonic()-1)
  self.assertEqual((len(mapped_calls),len(query_calls)),prior)
  slow_listener[0]=True
  with self.assertRaises(TimeoutError):guards[0](time.monotonic()+.005)
  self.assertEqual((len(mapped_calls),len(query_calls)),(prior[0]+1,prior[1]+1))
  slow_listener[0]=False
  calls.clear()
  def reject(**kw):raise RuntimeError('guard rejected')
  ns['runpy']=types.SimpleNamespace(run_path=lambda p:{'dismiss_owned_architecture_warning':reject})
  with self.assertRaisesRegex(RuntimeError,'guard rejected'):ns['guarded_harness'](port,evidence=evidence)
  self.assertEqual(calls,[])
 def test_actual_mapped_shared_diagnostic_deadline_clamps_all_three_queries(self):
  import types,time,io
  source=P['deriveSecondaryExitProbe'](P['BASE'].read_text(),'x64');tree=ast.parse(source)
  run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run');fn=next(n for n in run.body if isinstance(n,ast.FunctionDef)and n.name=='mapped')
  class FakePath:
   def __init__(self,s='/owned/app'):self.s=s
   def __truediv__(self,part):return FakePath(self.s+'/'+part)
   def __str__(self):return self.s
   def open(self,*a):return io.BytesIO(bytes.fromhex('cffaedfe07000001'))
  app=FakePath();queries=[];slow=[False]
  def query(args,**kw):
   queries.append((args,kw))
   if slow[0]:time.sleep(.02)
   return types.SimpleNamespace(stdout='owned-birth' if args[0]=='ps' else 'n'+str(app/'Contents/MacOS/UWork Preview')+'\n')
  ns={'APP':app,'Path':FakePath,'subprocess':types.SimpleNamespace(run=query)}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual-derived-mapped','exec'),ns)
  value=ns['mapped'](123,'diagnostic',time.monotonic()+.5);self.assertEqual(value['birth'],'owned-birth');self.assertEqual(len(queries),3)
  self.assertTrue(all(0<kw['timeout']<=1 for _,kw in queries))
  queries.clear();ns['mapped'](123,'normal');self.assertEqual(len(queries),3);self.assertTrue(all('timeout'not in kw for _,kw in queries))
  queries.clear()
  with self.assertRaises(TimeoutError):ns['mapped'](123,'expired',time.monotonic()-1)
  self.assertEqual(queries,[])
  slow[0]=True
  with self.assertRaises(TimeoutError):ns['mapped'](123,'overran',time.monotonic()+.005)
  self.assertEqual(len(queries),1)
if __name__=='__main__':unittest.main()
