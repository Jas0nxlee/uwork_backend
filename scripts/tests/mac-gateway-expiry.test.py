"""Pure original-timer acceptance boundaries, no clocks mocked and no GUI/network."""
import copy,hashlib,runpy,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/mac-gateway-expiry-probe.py'))
class Contract(unittest.TestCase):
 def test_actual_B_core_derives_compiles_without_revoke_or_delivery_substitute(self):
  original=M['BASE'].read_text();derived=M['deriveExpiryProbe'](original);compile(derived,str(M['BASE']),'exec')
  self.assertNotIn("f.command('revokeIdentity'",derived)
  self.assertNotIn("click('ucas-gateway-period-7d')",derived)
  self.assertIn("phase']=='aborted'",Path(M['__file__']).read_text())
  self.assertIn("armed=snapshot();assert 1200<armed['sessionRemainingMs']<=6000",derived)
  self.assertEqual(original[original.index('    except BaseException as error:'):],derived[derived.index('    except BaseException as error:'):])
  with self.assertRaises(AssertionError):M['deriveExpiryProbe'](original.replace("        assert hold_command('armGatewayUsageHold')['armed']\n",''))
 def test_real_ready_window_is_finite_and_does_not_renew(self):
  value={'identityRecord':{'sessionPresent':True,'expiresAt':70000},'sessionExpiresAt':70000,'sessionRemainingMs':50000,'serverSessionRevoked':False}
  M['assert_expiry_ready'](value)
  for key,item in [('sessionRemainingMs',8000),('sessionRemainingMs',60001),('serverSessionRevoked',True)]:
   with self.subTest(key=key,item=item),self.assertRaises(AssertionError):M['assert_expiry_ready']({**value,key:item})
  value['identityRecord']['expiresAt']=71000
  with self.assertRaises(AssertionError):M['assert_expiry_ready'](value)
 def value(self):return {'sessionRemainingMs':-10,'sessionExpiresAt':70000,'serverSessionRevoked':False,'identityRecord':{'revision':2,'sessionPresent':False,'expiresAt':None},'hold':{'phase':'aborted','response200':True,'downstreamClosed':True,'deliveryStarted':False,'downstreamFinished':False,'matchedResponses':1,'oneShotCount':1,'duplicateResponse':False,'transportError':False,'requestStartedAtMs':65000,'closedAtMs':70001}}
 def test_only_original_tombstone_abort_accepts_no_late200_delivery(self):
  value=self.value();old={'revision':1};M['assert_expired_drop'](value,old,5.1)
  for key,item in [('deliveryStarted',True),('downstreamFinished',True),('downstreamClosed',False),('phase','finished'),('closedAtMs',69999),('closedAtMs',85000)]:
   changed=copy.deepcopy(value);changed['hold'][key]=item
   with self.subTest(key=key,item=item),self.assertRaises(AssertionError):M['assert_expired_drop'](changed,old,5.1)
  for key,item in [('serverSessionRevoked',True),('sessionRemainingMs',1)]:
   with self.assertRaises(AssertionError):M['assert_expired_drop']({**value,key:item},old,5.1)
  changed=copy.deepcopy(value);changed['identityRecord']['revision']=1
  with self.assertRaises(AssertionError):M['assert_expired_drop'](changed,old,5.1)
  with self.assertRaises(AssertionError):M['assert_expired_drop'](value,old,20)
 def test_actual_composed_fixture_is_pure_and_preserves_original_owner_store(self):
  import subprocess
  js=r"""
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import{deriveExpiryFixture}from './scripts/fixtures/mac-gateway-expiry-derived.mjs';
const source=deriveExpiryFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'));
assert.equal((source.match(/issueOwnedMacExpirySession\(app.services.db, member.id, owner.tenantId, "session", \["execute"\], 60000\)/g)||[]).length,1);
assert.ok(source.includes('me = await api("/api/auth/me", "GET", undefined, identity);'));
assert.ok(source.includes('expiresAt: me.expiresAt,'));assert.ok(source.includes('ownedMacExpiryStore = store;'));
assert.ok(source.includes('identityRecord:await readMacGatewayExpiryIdentity(ownedMacExpiryStore,ownedMacExpiryIssuedExpiresAt)'));
assert.ok(!source.includes('UPDATE sessions'));assert.ok(!source.includes('Date.now ='));
console.log('actual composed issuer/me/original store snapshot passed');
"""
  node='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
  result=subprocess.run([node,'--input-type=module','-e',js],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
