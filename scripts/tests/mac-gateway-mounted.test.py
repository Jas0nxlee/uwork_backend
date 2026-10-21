"""Pure guards for a finite original Mac mounted Gateway transport case; no GUI/network."""
import copy,json,runpy,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/mac-gateway-mounted-probe.py'))
class Contract(unittest.TestCase):
 def test_new_scope_only_removes_default_witness_and_adds_hold(self):
  original={'UWORK_NATIVE_FIXTURE_NAME':'client-native-gateway-usage-macos-mounted-v1-20261021','UWORK_NATIVE_PACKAGED_MANIFEST':'manifest','UWORK_NATIVE_CONFIGURATION_WITNESS':'enabled','HOME':'owned'}
  before=copy.deepcopy(original);actual=M['fixture_environment'](original,original['UWORK_NATIVE_FIXTURE_NAME'],'manifest')
  self.assertEqual(original,before);self.assertNotIn('UWORK_NATIVE_CONFIGURATION_WITNESS',actual);self.assertEqual(actual['UWORK_NATIVE_GATEWAY_USAGE_HOLD'],'controlled');self.assertEqual(actual['HOME'],'owned')
  with self.assertRaises(AssertionError):M['fixture_environment'](original,'foreign','manifest')
 def test_old200_requires_real_delivery_and_original_twenty_seconds(self):
  hold={'response200':True,'deliveryStarted':True,'downstreamFinished':True,'upstreamAborted':False,'duplicateResponse':False,'transportError':False,'matchedResponses':1,'oneShotCount':1,'requestStartedAtMs':1000}
  M['assert_delivered'](hold,2000,1)
  for key,value in [('downstreamFinished',False),('deliveryStarted',False),('upstreamAborted',True),('duplicateResponse',True),('matchedResponses',2)]:
   with self.subTest(key=key),self.assertRaises(AssertionError):M['assert_delivered']({**hold,key:value},2000,1)
  with self.assertRaises(AssertionError):M['assert_delivered'](hold,21000,1)
  with self.assertRaises(AssertionError):M['assert_delivered'](hold,2000,20)
 def test_zero_oracle_cannot_accept_cached_post_or_mutated_supplier_or_other_ledger(self):
  before={'modelCalls':2,'rawInference':2,'supplierRequestDigests':['a','b'],'snapshot':{'actors':{key:{'accounting':{'ledger':[key]}} for key in ['current','other']}}}
  M['assert_unchanged'](before,copy.deepcopy(before))
  for key in ['rawInference','modelCalls']:
   after=copy.deepcopy(before);after[key]+=1
   with self.assertRaises(AssertionError):M['assert_unchanged'](before,after)
  after=copy.deepcopy(before);after['supplierRequestDigests'][0]='changed'
  with self.assertRaises(AssertionError):M['assert_unchanged'](before,after)
  after=copy.deepcopy(before);after['snapshot']['actors']['other']['accounting']['ledger'].append('new')
  with self.assertRaises(AssertionError):M['assert_unchanged'](before,after)
 def test_baseline_keeps_real_two_other_seed_calls_not_zero(self):
  current={key:[] for key in ['ledger','traces','gatewayCalls']};other={'ledger':[{'status':'settled','amount':22} for _ in range(2)],'traces':[{'status':'succeeded'} for _ in range(2)],'gatewayCalls':[{'has_result':True} for _ in range(2)]}
  value={'modelCalls':2,'rawInference':2,'supplierRequestDigests':['a','b'],'snapshot':{'actors':{'current':{'accounting':current},'other':{'accounting':other}}}}
  M['assert_baseline'](value)
  value['modelCalls']=0
  with self.assertRaises(AssertionError):M['assert_baseline'](value)
 def test_actual_derived_reply_observer_never_breaks_original_delivery(self):
  import subprocess
  js=r"""
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import{deriveMountedFixture}from './scripts/fixtures/mac-gateway-mounted-derived.mjs';
const original=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),source=deriveMountedFixture(original);
assert.throws(()=>deriveMountedFixture(original.replace('const proxy = httpsServer(', 'const missingProxy = httpsServer(')));
const start=source.indexOf("        try { if(req.method==='GET'"),end=source.indexOf('        const deliver = () => {',start);assert(start>0&&end>start);
const observe=new Function('req','reply','limit', 'const mountedResponses=Array.from({length:limit});let mountedRevoked=false,mountedObservationFailed=false;const assertMounted=v=>{if(!v)throw Error(\'bound\')};'+source.slice(start,end)+';return {delivered:true,mountedObservationFailed,rows:mountedResponses};');
const success=observe({method:'GET',url:'/api/client/entitlement'},{statusCode:401},0);assert.equal(success.rows[0].status,401);assert.equal(success.mountedObservationFailed,false);
for(const req of [{get method(){throw Error('observer');}},{method:'GET',url:'/api/client/usage'}]){const value=observe(req,{statusCode:200},64);assert.equal(value.delivered,true);assert.equal(value.mountedObservationFailed,true);}
console.log('actual derive and transparent observer contracts passed');
"""
  result=subprocess.run([M['NATIVE']['NODE24'],'--input-type=module','-e',js],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
