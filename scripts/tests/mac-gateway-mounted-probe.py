"""Latest original macOS package -> original UI/Host/Agent/owned real backend."""
import argparse
import base64
import json
import os
from pathlib import Path
import runpy
import shlex
import socket
import subprocess
import time
from urllib.parse import unquote, urlparse

REPO = Path(__file__).resolve().parents[2]
OLD = runpy.run_path(str(REPO / 'scripts/tests/native-packaged-runtime-probe.py'))
NATIVE = OLD['MODULE']


def fixture_environment(environment,profile,manifest):
    environment=dict(environment);assert environment['UWORK_NATIVE_FIXTURE_NAME']==profile and environment['UWORK_NATIVE_PACKAGED_MANIFEST']==manifest
    assert environment.pop('UWORK_NATIVE_CONFIGURATION_WITNESS')=='enabled'
    assert 'UWORK_NATIVE_GATEWAY_USAGE_HOLD' not in environment
    environment['UWORK_NATIVE_GATEWAY_USAGE_HOLD']='controlled'
    return environment

def ready_panel():return """(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]'),t=e?.innerText??'',r=e?.querySelector('[data-testid="ucas-gateway-refresh-usage"]');return{ok:!!e&&e.getClientRects().length>0&&t.includes('企业用户甲')&&!!r&&!r.disabled,text:t.slice(0,1800)}})()"""
def retired_panel():return """(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]'),t=e?.innerText??'',a=e?.querySelector('[role="alert"]'),r=e?.querySelector('[data-testid="ucas-gateway-refresh-usage"]');return{ok:!!e&&e.getClientRects().length>0&&!t.includes('企业用户甲')&&!t.includes('127.0.0.1')&&t.includes('该区间暂无用量记录。')&&a?.innerText.includes('企业会话已过期，请重新登录。')&&!e.querySelector('[data-testid="enterprise-effective-allowance"]')&&!e.querySelector('[data-testid="ucas-gateway-refresh-models"]')&&!!r&&!r.disabled,text:t.slice(0,1800),identityBadge:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null}})()"""
def assert_baseline(value):
    assert value['modelCalls']==value['rawInference']==len(value['supplierRequestDigests'])==2
    current=value['snapshot']['actors']['current']['accounting'];other=value['snapshot']['actors']['other']['accounting']
    assert all(len(current[key])==0 for key in ['ledger','traces','gatewayCalls'])
    assert all(len(other[key])==2 for key in ['ledger','traces','gatewayCalls'])
    assert sum(row['amount'] for row in other['ledger'])==44 and all(row['status']=='settled' for row in other['ledger'])
    assert all(row['status']=='succeeded' for row in other['traces']) and all(row['has_result'] for row in other['gatewayCalls'])
def assert_unchanged(before,after):
    for key in ['modelCalls','rawInference','supplierRequestDigests']:assert before[key]==after[key],key
    for actor in ['current','other']:assert before['snapshot']['actors'][actor]['accounting']==after['snapshot']['actors'][actor]['accounting'],actor

def assert_delivered(hold,observed,elapsed):
    assert hold['response200'] and hold['deliveryStarted'] and hold['downstreamFinished']
    assert not hold['upstreamAborted'] and not hold['duplicateResponse'] and not hold['transportError']
    assert hold['matchedResponses']==hold['oneShotCount']==1
    assert 0<observed-hold['requestStartedAtMs']<20000 and 0<elapsed<20

# Reuse only the already frozen ownership/readiness guard, not its original run.
wait_renderer=runpy.run_path(str(REPO/'scripts/tests/mac-arm64-model-capability-probe.py'))['wait_renderer']

def run_case(profile, manifest):
    assert __import__('re').fullmatch(r'client-native-gateway-usage-macos-mounted-v[0-9]+-20261021',profile)
    evidence,root=REPO/'evidence'/profile,REPO/'data'/profile
    assert not evidence.exists() and not root.exists()
    (evidence/'controller-home').mkdir(parents=True,mode=0o700)
    (evidence/'controller-tmp').mkdir(mode=0o700)
    facts={'status':'failed','checks':[],'actions':[],'observations':{}}
    checks,actions,observations=facts['checks'],facts['actions'],facts['observations']
    f=bridge=guard=None;known=set();meta={};errors=[]
    def until(expression,label,seconds=30):
        deadline=time.monotonic()+seconds;last=None
        while time.monotonic()<deadline:
            last=bridge.evaluate(expression)
            if last.get('ok'):return last
            time.sleep(.12)
        observations['failedProjection']=last
        raise AssertionError(label)
    def click(test_id):
        selector='[data-testid='+json.dumps(test_id)+']'
        expression="""(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length);if(es.length!==1)return{ok:false};const e=es[0];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&!e.disabled&&e.contains(document.elementFromPoint(x,y)),x,y}})()"""%json.dumps(selector)
        point=until(expression,test_id)
        for _ in range(3):
            bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=point['x'],y=point['y'])
            current=until(expression,test_id)
            if abs(point['x']-current['x'])<.5 and abs(point['y']-current['y'])<.5:break
            point=current
        else:raise AssertionError('Unstable original control')
        for kind in ['mousePressed','mouseReleased']:bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=current['x'],y=current['y'],button='left',clickCount=1)
        actions.append(test_id)
    def panel_identity():
        document=bridge.raw_cdp('DOM.getDocument',depth=1,pierce=False)
        nodes=bridge.raw_cdp('DOM.querySelectorAll',nodeId=document['root']['nodeId'],selector='[data-testid="ucas-gateway-panel"]')['nodeIds']
        assert len(nodes)==1
        return bridge.raw_cdp('DOM.describeNode',nodeId=nodes[0],depth=0)['node']['backendNodeId']
    def snapshot():return f.command('mountedSnapshot',10)['facts']
    def hold_command(op):
        with f.lock:cursor=len(f.events)
        f.send({'op':op})
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            with f.lock:rows=list(f.events[cursor:])
            for row in rows:
                assert row.get('status')!='fixture-command-failed',row.get('message')
                if row.get('schema')=='native-gateway-usage-hold-v1':return row
            time.sleep(.02)
        raise AssertionError('Fresh original hold status missing')
    try:
        guard=OLD['OsGuard'](protocol_only=True);known.add(guard.child.pid)
        assert guard.ready['usesSystemClipboard'] is False;observations['osGuard']=guard.ready
        original=subprocess.Popen;launches=[]
        def popen(command,*args,**kwargs):
            if isinstance(command,list) and command[-1:]==['scripts/fixtures/client-native-enterprise.mjs']:
                assert kwargs['cwd']==REPO
                kwargs['env']=fixture_environment(kwargs['env'],profile,str(manifest))
                command=command[:-1]+['scripts/fixtures/mac-gateway-mounted-derived.mjs'];launches.append(command)
            return original(command,*args,**kwargs)
        subprocess.Popen=popen
        try:f=NATIVE['Fixture'](profile,evidence/'controller-home',evidence/'controller-tmp',mode='experience',packaged_manifest=manifest)
        finally:subprocess.Popen=original
        assert len(launches)==1;known.add(f.child.pid)
        f.wait_event(lambda row:row.get('event')=='ready',180,'real backend ready')
        meta=json.loads((evidence/'desktop-state.json').read_text());assert not meta['copiedProductionMain']
        baseline_proof=f.command('packagedRuntimeProof')['facts'];baseline_proof.pop('shareUrl',None)
        assert baseline_proof['modelCalls']==2 and baseline_proof['own']['count']==0
        assert baseline_proof['other']=={'count':2,'settled':2,'amount':44,'inputTokens':24,'outputTokens':20}
        observations['baselineProof']=baseline_proof
        f.send({'op':'launch'});launched=f.wait_event(lambda row:row.get('event')=='launched',120,'signed original Main')
        known.add(launched['pid']);wait_renderer(launched,meta,evidence)
        prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/'
        bridge=OLD['HARNESS'](launched['cdpPort'],evidence=evidence,renderer_prefix=prefix)
        assert urlparse(bridge.target).scheme=='file' and unquote(urlparse(bridge.target).path).startswith(meta['packagedRuntime']['appPath']+'/Contents/Resources/app.asar/')
        original_session=bridge.session
        first=runpy.run_path(str(REPO/'scripts/fixtures/native-first-run-ui.py'));guards=NATIVE['Guards'](evidence)
        onboarding=first['FirstRunUi']('file-restored',bridge.evaluate,bridge.raw_cdp,guards.guard,guards.budget,guards.claim,guards.auth_started,press_release_only=True)
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            view=onboarding.phase('observe')
            if view['step']=='role' and not view['loginVisible'] and not view['startupLoadingVisible']:break
            time.sleep(.2)
        else:raise AssertionError('Original restored onboarding not ready')
        for step in first['ONBOARDING_STEPS']:onboarding.phase(step)
        until("(()=>({ok:document.querySelector('[data-testid=enterprise-identity-name]')?.innerText==='企业用户甲'}))()",'Original identity')
        click('enterprise-identity-name');click('enterprise-identity-open-gateway')
        observations['readyPanel']=until(ready_panel(),'Original Gateway ready')
        panel=panel_identity();observations['panelBackendNodeId']=panel
        before=snapshot();assert_baseline(before);observations['before']=before
        checks.append('original-signed-mac-gateway-seeded-accounting-baseline')
        assert hold_command('armGatewayUsageHold')['armed']
        action_start=time.monotonic();click('ucas-gateway-refresh-usage')
        deadline=time.monotonic()+6
        while time.monotonic()<deadline:
            held=snapshot()
            if held['hold']['held']:break
            time.sleep(.08)
        else:raise AssertionError('Real original month200 not held')
        assert held['hold']['response200'] and held['hold']['matchedResponses']==1
        observations['held']=held;assert panel_identity()==panel and bridge.session==original_session
        checks.append('same-mounted-panel-original-month-http200-held-once')
        f.command('revokeIdentity',10)
        click('ucas-gateway-period-7d')
        observations['retiredPanel']=until(retired_panel(),'Original 7d rejects and retires',6)
        rejected=snapshot();assert rejected['serverSessionRevoked']
        assert any(row['afterServerLogout'] and row['path']=='/api/client/entitlement' and row['status']==401 for row in rejected['responses'])
        assert panel_identity()==panel and bridge.session==original_session
        observations['rejected']=rejected;checks.append('same-panel-new-seven-day401-retires-projection')
        hold_command('releaseGatewayUsageHold')
        deadline=min(time.monotonic()+5,action_start+19.5)
        while time.monotonic()<deadline:
            released=snapshot()
            if released['hold']['downstreamFinished']:break
            time.sleep(.06)
        else:raise AssertionError('Old real200 did not finish within unchanged20s request budget')
        assert_delivered(released['hold'],released['observedAtMs'],time.monotonic()-action_start)
        observations['released']=released;checks.append('old-real200-successfully-delivered-after401-before20s')
        samples=[]
        for _ in range(6):
            samples.append({'ui':bridge.evaluate(retired_panel()),'backendNodeId':panel_identity()})
            assert samples[-1]['ui'].get('ok'), 'Retired projection resurrected at a direct observation'
            assert samples[-1]['backendNodeId']==panel and bridge.session==original_session
            time.sleep(.3)
        after=snapshot();assert_unchanged(before,after)
        assert after['hold']['matchedResponses']==1 and not after['hold']['duplicateResponse']
        observations['samples']=samples;observations['after']=after
        observations['sameMainAndBridge']={'mainPid':launched['pid'],'bridgeSession':original_session,'panelBackendNodeId':panel}
        assert subprocess.run(['kill','-0',str(launched['pid'])],capture_output=True).returncode==0
        checks.append('six-same-node-observations-no-resurrection-or-model-accounting-delta')
        (evidence/'final-ui.png').write_bytes(base64.b64decode(bridge.raw_cdp('Page.captureScreenshot',format='png')['data']))
        facts['status']='passed'
    except BaseException as error:
        facts['failure'] = type(error).__name__ + ': ' + str(error)
    finally:
        if f:
            try:
                with f.lock:
                    mains = {row['pid'] for row in f.events if row.get('event') == 'launched'}
                    known.update(row['secondaryPid'] for row in f.events if row.get('event') == 'workspace-secondary-started')
                live_rows = []
                for main_pid in mains:
                    live_rows.extend(OLD['owned_processes'](main_pid, meta.get('packagedRuntime', {}).get('appPath', '') + '/Contents/Resources/glm/zcode.cjs'))
                known.update(row['pid'] for row in live_rows)
                observations['shutdownOwnedProcesses'] = live_rows
            except Exception as error:
                errors.append('owned-process-census: ' + str(error))
            try:
                f.command('stopNative', 25)
            except Exception as error:
                errors.append('stopNative: ' + str(error))
        if bridge:
            try:
                bridge.kill()
                cleanup = json.loads((evidence / 'harness-cleanup.json').read_text())
                if not cleanup.get('daemonAbsent') or not cleanup.get('socketClosed'):
                    errors.append('harness-not-closed')
            except Exception as error:
                errors.append('harness: ' + str(error))
        if f and f.child.poll() is None:
            f.child.terminate()
            try:
                f.child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                f.child.kill(); f.child.wait(timeout=5)
                errors.append('fixture-required-kill')
        if f:
            facts['fixtureExitCode'] = f.child.returncode
            if f.child.returncode != 0:
                errors.append('fixture-exit-not-zero')
        if guard:
            try:
                observations['osRestore'] = guard.close()
                if not observations['osRestore']['protocolRestored'] or observations['osRestore']['usesSystemClipboard']:
                    errors.append('OS-protocol-not-restored')
            except Exception as error:
                errors.append('OS-guard: ' + str(error))
        remaining = subprocess.run(['ps', '-p', ','.join(map(str, sorted(known))), '-o', 'pid='], capture_output=True, text=True).stdout.strip() if known else ''
        if remaining:
            errors.append('known-process-still-alive')
        closed = {}
        for port in {meta.get('cdpPort'), *[urlparse(meta.get(key, '')).port for key in ['origin', 'backendOrigin', 'supplierOrigin']]} - {None}:
            with socket.socket() as probe:
                probe.settimeout(.5)
                closed[str(port)] = probe.connect_ex(('127.0.0.1', port)) != 0
        if not all(closed.values()):
            errors.append('owned-port-still-open')
        facts['cleanup'] = {'errors': errors, 'knownPids': sorted(known), 'knownPidsAbsent': not remaining, 'portsClosed': closed}
        if errors:
            facts['businessPassed'] = facts['status'] == 'passed'
            facts['status'] = 'failed'
        (evidence / 'result.json').write_text(json.dumps(facts, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': facts['status'], 'checks': len(checks), 'failure': facts.get('failure'), 'cleanup': facts.get('cleanup')}, ensure_ascii=False))
    return facts['status'] == 'passed'



def run(args):
    import hashlib,re
    path=args.preparation.resolve();plan=json.loads(path.read_text());profile=plan['profile']
    assert re.fullmatch(r'client-native-gateway-usage-macos-mounted-v[0-9]+-20261021',profile)
    assert path==REPO/'data/sandbox-verification'/profile/'preparation.json'
    sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    for source,expected in plan['sources'].items():assert sha(REPO/source)==expected,source
    assert sha(plan['manifestPath'])==plan['manifestSha256']
    assert sha(__file__)==plan['driverSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':profile}));return True
    assert args.reviewed_plan_sha256==sha(path)
    return run_case(profile,Path(plan['manifestPath']))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args()) else 1)
