"""One real 60s issuer expiry: original Identity timer retires UI/store and aborts its held HTTP200."""
import argparse,hashlib,json,runpy,time
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
BASE=REPO/'scripts/tests/mac-gateway-mounted-probe.py'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def expired_projection():return """(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]'),t=e?.innerText??'',n=document.querySelector('[data-testid="enterprise-identity-name"]'),entry=document.querySelector('[data-testid="enterprise-identity-entry"]'),login=document.querySelector('[data-testid="enterprise-login-page"]');return{ok:!n&&(!!entry||!!login&&login.getClientRects().length>0)&&(!e||!t.includes('企业用户甲')&&!t.includes('127.0.0.1')&&!e.querySelector('[data-testid="enterprise-effective-allowance"]')&&!e.querySelector('[data-testid="ucas-gateway-refresh-models"]')&&t.includes('未登录企业账号')),identityNamePresent:!!n,entryPresent:!!entry,loginVisible:!!login&&login.getClientRects().length>0,gatewayPresent:!!e,gatewayVisible:!!e&&e.getClientRects().length>0,text:t.slice(0,1800)}})()"""
def assert_expiry_ready(value):
    assert value['identityRecord']['sessionPresent'] and value['identityRecord']['expiresAt']==value['sessionExpiresAt']
    assert 8000<value['sessionRemainingMs']<=60000 and not value['serverSessionRevoked']
def assert_expired_drop(value,before_record,elapsed):
    record=value['identityRecord'];hold=value['hold']
    assert value['sessionRemainingMs']<=0 and not value['serverSessionRevoked']
    assert not record['sessionPresent'] and record['expiresAt'] is None and record['revision']>before_record['revision']
    assert hold['phase']=='aborted' and hold['response200'] and hold['downstreamClosed'] and not hold['deliveryStarted'] and not hold['downstreamFinished']
    assert hold['matchedResponses']==hold['oneShotCount']==1 and not hold['duplicateResponse'] and not hold['transportError']
    assert hold['closedAtMs']>=value['sessionExpiresAt'] and 0<hold['closedAtMs']-hold['requestStartedAtMs']<20000
    assert 0<elapsed<20
EXPIRY_SLICE='''        assert_expiry_ready(before)
        initial_identity=before['identityRecord']
        observations['initialIdentity']=initial_identity
        waiting_deadline=time.monotonic()+65
        while time.monotonic()<waiting_deadline:
            waiting=snapshot()
            assert waiting['sessionRemainingMs']>1200 and waiting['identityRecord']['sessionPresent']
            if waiting['sessionRemainingMs']<=6000:break
            time.sleep(min(.4,(waiting['sessionRemainingMs']-6000)/1000))
        else:raise AssertionError('Finite real issuer-expiry wait exceeded65s; no reissue')
        observations['beforeExpiryRequest']=waiting
        assert hold_command('armGatewayUsageHold')['armed']
        armed=snapshot();assert 1200<armed['sessionRemainingMs']<=6000 and armed['identityRecord']['sessionPresent']
        observations['armedBeforeOriginalRefresh']=armed
        action_start=time.monotonic();click('ucas-gateway-refresh-usage')
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            held=snapshot()
            if held['hold']['held']:break
            assert held['sessionRemainingMs']>0,'Real issuer expired before original request held'
            time.sleep(.08)
        else:raise AssertionError('Original real200 did not enter hold before expiry')
        assert held['hold']['response200'] and held['hold']['matchedResponses']==1 and held['sessionRemainingMs']>0
        assert held['hold']['requestStartedAtMs']<held['sessionExpiresAt']
        observations['held']=held;assert panel_identity()==panel and bridge.session==original_session
        checks.append('original-month200-held-before-real-issuer-expiry')
        observations['expiredUi']=until(expired_projection(),'Original IdentityTimer expires and retires UI',10)
        deadline=min(time.monotonic()+4,action_start+19.5)
        while time.monotonic()<deadline:
            expired=snapshot()
            if not expired['identityRecord']['sessionPresent'] and expired['hold']['downstreamClosed']:break
            time.sleep(.08)
        else:raise AssertionError('Original timer did not persist tombstone and abort held request')
        expiry_elapsed=time.monotonic()-action_start
        assert_expired_drop(expired,initial_identity,expiry_elapsed)
        observations['expired']=expired
        observations['expiryMonotonicElapsedSeconds']=expiry_elapsed
        checks.append('real-expiry-original-owner-signedout-tombstone-and-request-abort')
        hold_command('releaseGatewayUsageHold')
        released=snapshot();assert released['hold']['releaseRequested']
        assert_expired_drop(released,initial_identity,time.monotonic()-action_start)
        observations['released']=released
        checks.append('release-after-real-abort-drops-old200-without-delivery')
        samples=[]
        for _ in range(6):
            sample=bridge.evaluate(expired_projection());assert sample.get('ok'),'Expired identity projection resurrected'
            assert bridge.session==original_session
            samples.append(sample);time.sleep(.3)
        observations['samples']=samples
        after=snapshot();assert_unchanged(before,after)
        assert not after['serverSessionRevoked'] and not after['hold']['deliveryStarted'] and not after['hold']['downstreamFinished']
        observations['after']=after
        checks.append('six-signedout-samples-and-model-ledger-trace-zero-delta')
        # Only after the six untouched expiry observations, inspect the original model menu when reachable.
        def visible_control(test_id):
            return bridge.evaluate("""(()=>{const e=document.querySelector('[data-testid="'+%s+'"]');if(!e||!e.getClientRects().length||e.closest('[inert],[aria-hidden="true"]'))return{ok:false};const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&!e.disabled&&e.contains(document.elementFromPoint(x,y))}})()"""%json.dumps(test_id))
        if visible_control('settings-back-button').get('ok'):click('settings-back-button')
        accessible=visible_control('chat-model-select-trigger')
        if accessible.get('ok'):
            click('chat-model-select-trigger')
            catalog=until("""(()=>{const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"],[inert]');const footer=[...document.querySelectorAll('[data-model-footer-action="manage-models"]')].filter(visible),groups=[...document.querySelectorAll('[data-model-provider-key="registry-provider:ucas"]')].filter(visible),items=[...document.querySelectorAll('[data-testid^="chat-model-select-item-custom:ucas:"]')].filter(visible);return{ok:footer.length===1,ucasProviderGroups:groups.length,ucasModelItems:items.length}})()""",'Original expired model directory',15)
            assert catalog['ucasProviderGroups']==catalog['ucasModelItems']==0
            observations['expiredOriginalModelMenu']=catalog
            observations['expiredOriginalModelMenu']['observable']=True
            checks.append('original-model-directory-has-no-expired-enterprise-catalog')
        else:
            observations['expiredOriginalModelMenu']={'observable':False,'reason':'Original model picker unavailable after expiry; no navigation bypass','identityProjection':bridge.evaluate(expired_projection())}
        final=snapshot();assert_unchanged(before,final)
        assert not final['hold']['deliveryStarted'] and not final['hold']['downstreamFinished']
        observations['afterCatalog']=final
'''
def deriveExpiryProbe(source):
    assert source.count("'scripts/fixtures/mac-gateway-mounted-derived.mjs'")==1
    source=source.replace("'scripts/fixtures/mac-gateway-mounted-derived.mjs'","'scripts/fixtures/mac-gateway-expiry-derived.mjs'")
    start="        assert hold_command('armGatewayUsageHold')['armed']\n"
    end="        (evidence/'final-ui.png').write_bytes"
    assert source.count(start)==source.count(end)==1
    left,right=source.index(start),source.index(end)
    return source[:left]+EXPIRY_SLICE+source[right:]
def run(args):
    plan=json.loads(args.preparation.read_text());profile=plan['profile'];path=args.preparation.resolve()
    assert path==REPO/'data/sandbox-verification'/profile/'preparation.json'
    assert profile=='client-native-gateway-usage-macos-mounted-v2-20261021'
    for source,expected in plan['sources'].items():assert digest(REPO/source)==expected,source
    assert digest(plan['manifestPath'])==plan['manifestSha256'] and digest(__file__)==plan['driverSha256']
    derived=deriveExpiryProbe(BASE.read_text());compile(derived,str(BASE),'exec')
    assert hashlib.sha256(derived.encode()).hexdigest()==plan['derivedProbeSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':profile}));return True
    assert args.reviewed_plan_sha256==digest(path)
    namespace={'__file__':str(BASE),'__name__':'reviewed_mac_gateway_expiry','expired_projection':expired_projection,'assert_expiry_ready':assert_expiry_ready,'assert_expired_drop':assert_expired_drop}
    exec(compile(derived,str(BASE),'exec'),namespace)
    return namespace['run_case'](profile,Path(plan['manifestPath']))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args()) else 1)
