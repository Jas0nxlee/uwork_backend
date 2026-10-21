"""Fresh owned Linux Native Gateway: server rejection while one real HTTP200 waits."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import time
import urllib.request
import urllib.parse
import uuid

REPO = Path(__file__).resolve().parents[3]
NODE = '/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
DOCKER = ['docker', '--context', 'colima-uwork-backend']
Bridge = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge']
FirstRun = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))['FirstRunUi']


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def run(args):
    assert args.name.startswith('client-linux-gateway-mounted-') and args.name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / args.name
    evidence.mkdir(mode=0o700)
    mode = 'natural-expiry' if args.natural_expiry else 'server-rejection'
    prepared = subprocess.run([NODE, 'scripts/tests/linux-desktop/gateway-mounted-prepare.mjs', args.name, mode],
                              cwd=REPO, capture_output=True, text=True, check=True, timeout=30)
    preparation = json.loads(prepared.stdout)
    (evidence / 'preparation.json').write_text(json.dumps(preparation, indent=2) + '\n')
    if args.prepare_only:
        print(json.dumps({'status': 'prepared-not-run', 'evidence': str(evidence)}))
        return True
    assert args.image and args.image.startswith('uwork-linux-desktop-')
    assert args.expected_asar_sha256 and len(args.expected_asar_sha256) == 64
    assert all(c in '0123456789abcdef' for c in args.expected_asar_sha256)
    shared = Path(preparation['root'])
    source, work = shared / 'input', shared / 'work'
    work.mkdir(mode=0o700)
    assert hashlib.sha256((source / 'backend.mjs').read_bytes()).hexdigest() == preparation['compiledFixtureSha256']
    name = 'uwork-' + args.name
    bridge = tunnel = None
    created_network = False
    container_id = None
    owner_nonce = uuid.uuid4().hex
    cdp_port, control_port = free_port(), free_port()
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'ports': [cdp_port, control_port],
             'boundary': 'Original Identity owner natural expiry and real HTTP abort/drop' if args.natural_expiry else 'Real Native same-mounted Gateway; backend session revoked, not local Identity owner changed',
             'mode': mode}
    started = time.monotonic()

    def docker(*commands, check=True, timeout=30):
        return subprocess.run(DOCKER + list(commands), capture_output=True, text=True, check=check, timeout=timeout)

    def budget():
        assert time.monotonic() - started < 220, 'Finite Native Gateway test budget exceeded'

    def control(path, post=False):
        req = urllib.request.Request(f'http://127.0.0.1:{control_port}' + path, method='POST' if post else 'GET')
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    def until(expression, timeout=30):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            budget()
            last = bridge.evaluate(expression)
            if last.get('ok'):
                return last
            time.sleep(.15)
        facts['lastProjection'] = last
        raise AssertionError('Original Native Gateway condition did not become true')

    def click(test_id):
        selector = '[data-testid=' + json.dumps(test_id) + ']'
        expression = '''(()=>{const e=document.querySelector(%s);if(!e)return{ok:false};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&!e.disabled&&e.contains(document.elementFromPoint(x,y)),x,y}})()''' % json.dumps(selector)
        target = until(expression)
        for _ in range(3):
            bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=target['x'], y=target['y'])
            current = until(expression)
            if abs(current['x'] - target['x']) < .5 and abs(current['y'] - target['y']) < .5:
                target = current
                break
            target = current
        else:
            raise AssertionError('Original control did not stabilize after hover')
        for kind in ['mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=target['x'], y=target['y'], button='left', clickCount=1)
        facts['actions'].append(test_id)

    def panel_identity():
        document = bridge.raw_cdp('DOM.getDocument', depth=1, pierce=False)
        selected = bridge.raw_cdp('DOM.querySelector', nodeId=document['root']['nodeId'], selector='[data-testid="ucas-gateway-panel"]')
        assert selected['nodeId'], 'Original Gateway panel must still exist'
        return bridge.raw_cdp('DOM.describeNode', nodeId=selected['nodeId'], depth=0)['node']['backendNodeId']

    ready_panel = '''(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]');const text=e?.innerText??'';return{ok:!!e&&e.getClientRects().length>0&&text.includes('Linux 测试成员')&&!!document.querySelector('[data-testid="ucas-gateway-refresh-usage"]')&&!document.querySelector('[data-testid="ucas-gateway-refresh-usage"]').disabled,text:text.slice(0,1600)}})()'''
    retired_panel = '''(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]');const text=e?.innerText??'';const alert=e?.querySelector('[role="alert"]'),refresh=e?.querySelector('[data-testid="ucas-gateway-refresh-usage"]');return{ok:!!e&&e.getClientRects().length>0&&!text.includes('Linux 测试成员')&&!text.includes('127.0.0.1')&&text.includes('该区间暂无用量记录。')&&!e.querySelector('[data-testid="enterprise-effective-allowance"]')&&!e.querySelector('[data-testid="ucas-gateway-refresh-models"]')&&!!refresh&&!refresh.disabled&&!!alert&&alert.getClientRects().length>0,text:text.slice(0,1600)}})()'''
    expired_projection = '''(()=>{const e=document.querySelector('[data-testid="ucas-gateway-panel"]'),name=document.querySelector('[data-testid="enterprise-identity-name"]'),entry=document.querySelector('[data-testid="enterprise-identity-entry"]'),login=document.querySelector('[data-testid="enterprise-login-page"]');const text=e?.innerText??'';const loginVisible=!!login&&login.getClientRects().length>0;return{ok:!name&&(!!entry||loginVisible)&&(!e||(!text.includes('Linux 测试成员')&&!text.includes('127.0.0.1')&&!e.querySelector('[data-testid="enterprise-effective-allowance"]')&&!e.querySelector('[data-testid="ucas-gateway-refresh-models"]')&&text.includes('未登录企业账号'))),identityNamePresent:!!name,signedOutEntryPresent:!!entry,loginVisible,gatewayPresent:!!e,gatewayVisible:!!e&&e.getClientRects().length>0,text:text.slice(0,1600)}})()'''
    try:
        image_id = docker('image', 'inspect', '--format', '{{.Id}}', args.image).stdout.strip()
        facts['imageId'] = image_id
        actual = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--entrypoint', 'sha256sum', image_id,
                        '/opt/UWork Preview/resources/app.asar').stdout.split()[0]
        assert actual == args.expected_asar_sha256, 'Use the explicitly accepted package, never a stale image tag'
        facts['appAsarSha256'] = actual
        assert docker('container', 'inspect', name, check=False).returncode != 0
        assert docker('network', 'inspect', name, check=False).returncode != 0
        docker('network', 'create', '--internal', name)
        created_network = True
        docker('run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
               '--mount', f'type=bind,src={work},dst=/work', '--entrypoint', '/bin/chown', image_id, '1000:1000', '/work')
        container_id = docker('run', '-d', '--name', name, '--label', 'uwork-probe-owner=' + owner_nonce, '--init', '--network', name, '--read-only', '--user', '1000:1000',
                              '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--shm-size', '256m',
                              '-e', 'UWORK_LINUX_TEST_APP_ROOT=/opt/UWork Preview',
                              '--mount', f'type=bind,src={source},dst=/opt/backend/probe,readonly', '--mount', f'type=bind,src={work},dst=/work',
                              '--entrypoint', '/bin/sh', image_id, '/opt/backend/probe/entry.sh').stdout.strip()
        facts['containerId'] = container_id
        assert json.loads(docker('network', 'inspect', name).stdout)[0]['Internal']
        ip = docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', container_id).stdout.strip()
        socket.inet_aton(ip)
        ssh_config = shared / 'ssh-config'
        ssh_config.write_text(subprocess.run(['colima', 'ssh-config', '--profile', 'uwork-backend'], capture_output=True, text=True, check=True).stdout)
        ssh_config.chmod(0o600)
        with (evidence / 'tunnel.log').open('w') as log:
            tunnel = subprocess.Popen(['/usr/bin/ssh', '-F', str(ssh_config), '-S', 'none', '-N', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
                                       '-o', 'ExitOnForwardFailure=yes', '-L', f'127.0.0.1:{cdp_port}:{ip}:9333', '-L', f'127.0.0.1:{control_port}:{ip}:9334',
                                       'colima-uwork-backend'], stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        facts['tunnelPid'] = tunnel.pid
        deadline = time.monotonic() + 60
        prefix = 'file:///opt/UWork%20Preview/resources/app.asar/'
        while time.monotonic() < deadline:
            assert tunnel.poll() is None
            assert json.loads(docker('inspect', container_id).stdout)[0]['State']['Running']
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json/list', timeout=2) as response:
                    targets = json.load(response)
                if any(target.get('url', '').startswith(prefix) for target in targets):
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.2)
        else:
            raise AssertionError('Owned installed package did not expose its original renderer')
        bridge = Bridge(cdp_port, renderer_prefix=prefix, evidence=evidence)
        original_session = bridge.session
        until('''(()=>{const e=document.querySelector('[data-testid="onboarding-page"]'),loading=document.querySelector('[data-testid="root-startup-loading"]');return{ok:!!e&&e.getClientRects().length>0&&(!loading||!loading.getClientRects().length)}})()''', 45)
        claimed = set()
        def claim(action, **_kwargs):
            assert action not in claimed
            claimed.add(action)
            return True
        first = FirstRun('file-restored', bridge.evaluate, bridge.raw_cdp, lambda: 1, budget, claim, lambda: False, press_release_only=True)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            state = first.phase('observe')
            if state['step'] == 'role' and not state['startupLoadingVisible'] and not state['loginVisible']:
                break
            time.sleep(.2)
        else:
            raise AssertionError('Original restored-identity role onboarding unavailable')
        for action in ['select_developer', 'next_role', 'select_coding', 'next_mode', 'finish']:
            first.phase(action)
            facts['actions'].append(action)
            time.sleep(.25)
        until('''(()=>({ok:!!document.querySelector('[data-testid="enterprise-identity-name"]')}))()''')
        click('enterprise-identity-name')
        click('enterprise-identity-open-gateway')
        facts['baselineUi'] = until(ready_panel)
        panel = panel_identity()
        facts['panelBackendNodeId'] = panel
        baseline = control('/gateway-state')
        facts['baseline'] = baseline
        assert baseline['proof']['modelCalls'] == baseline['proof']['ledger']['count'] == baseline['traceCount'] == 0
        facts['checks'].append('original-native-gateway-ready-with-zero-accounting')
        if args.natural_expiry:
            assert baseline['mode'] == 'natural-expiry' and 8000 < baseline['sessionRemainingMs'] <= 60000
            identity_record = control('/gateway-identity-record')
            assert identity_record['sessionPresent'] and identity_record['expiresAtMatchesIssuer']
            facts['baselineIdentityRecord'] = identity_record
            while True:
                budget()
                expiry_state = control('/gateway-state')
                assert expiry_state['sessionRemainingMs'] > 1200, 'Original issuer TTL elapsed before its real request could be held'
                if expiry_state['sessionRemainingMs'] <= 6000:
                    break
                time.sleep(min(.5, (expiry_state['sessionRemainingMs'] - 6000) / 1000))
            facts['beforeExpiryRequest'] = expiry_state
        assert control('/gateway-arm', True)['armed']
        click('ucas-gateway-refresh-usage')
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            held = control('/gateway-state')
            if held['hold']['held']:
                break
            time.sleep(.1)
        else:
            raise AssertionError('One original real usage200 did not enter the hold')
        assert held['hold']['response200'] and held['hold']['matchedResponses'] == 1
        facts['held'] = held
        assert panel_identity() == panel
        facts['checks'].append('same-native-panel-original-real-http200-held-once')
        if args.natural_expiry:
            facts['expiredUi'] = until(expired_projection, 12)
            expired = control('/gateway-state')
            assert expired['sessionRemainingMs'] <= 0 and not expired['serverSessionRevoked'] and expired['serverLogoutStatus'] is None
            facts['expired'] = expired
            facts['panelBackendNodeIdAtExpiry'] = panel_identity() if facts['expiredUi']['gatewayPresent'] else None
            assert bridge.session == original_session
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                expired_record = control('/gateway-identity-record')
                if not expired_record['sessionPresent']:
                    break
                time.sleep(.1)
            else:
                raise AssertionError('Original owner must persist its expired-session tombstone')
            assert expired_record['revision'] > identity_record['revision']
            facts['expiredIdentityRecord'] = expired_record
            facts['checks'].append('real-issuer-ttl-and-original-identity-timer-retire-the-authenticated-ui')
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                aborted = control('/gateway-state')
                if aborted['hold']['downstreamClosed']:
                    break
                time.sleep(.1)
            else:
                raise AssertionError('Natural identity expiry must close its held request')
            assert not aborted['hold']['deliveryStarted'] and not aborted['hold']['downstreamFinished']
            control('/gateway-release', True)
            released = control('/gateway-state')
            assert released['hold']['releaseRequested'] and not released['hold']['deliveryStarted'] and not released['hold']['downstreamFinished']
            facts['released'] = released
            facts['checks'].append('natural-identity-owner-expiry-aborts-and-drops-the-real-held200-without-replay')
        else:
            assert control('/gateway-revoke-session', True) == {'revoked': True, 'status': 204}
            click('ucas-gateway-period-7d')
            facts['retiredUi'] = until(retired_panel, 8)
            rejected = control('/gateway-state')
            assert any(row['afterServerLogout'] and row['path'] == '/api/client/entitlement' and row['status'] == 401 for row in rejected['responses'])
            assert panel_identity() == panel and bridge.session == original_session
            facts['rejected'] = rejected
            facts['checks'].append('original-seven-day-input-gets-server401-and-retires-the-same-panel-projection')
            control('/gateway-release', True)
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                released = control('/gateway-state')
                if released['hold']['downstreamFinished']:
                    break
                time.sleep(.1)
            else:
                raise AssertionError('Old real200 must actually finish downstream; abort is a different result')
            assert released['hold']['deliveryStarted'] and not released['hold']['upstreamAborted']
            facts['released'] = released
            facts['checks'].append('original-old-http200-delivered-after-new-authorization-rejection')
        samples = []
        for _ in range(6):
            samples.append(until(expired_projection if args.natural_expiry else retired_panel, 3))
            if not args.natural_expiry:
                assert panel_identity() == panel
            time.sleep(.3)
        facts['postReleaseUiSamples'] = samples
        after = control('/gateway-state')
        assert after['proof'] == baseline['proof'] and after['traceCount'] == 0
        assert after['hold']['matchedResponses'] == 1 and not after['hold']['duplicateResponse']
        facts['checks'].append('no-old-identity-gateway-projection-or-new-model-ledger-trace-after-expiry' if args.natural_expiry else 'same-panel-no-old-identity-usage-or-new-model-ledger-trace-after-late-success')
        facts['panelBackendNodeIdAfter'] = panel_identity() if not args.natural_expiry or samples[-1]['gatewayPresent'] else None
        if args.natural_expiry:
            screenshot = bridge.raw_cdp('Page.captureScreenshot', format='png')
            (evidence / 'expired-gateway-ui.png').write_bytes(base64.b64decode(screenshot['data']))
            back = bridge.evaluate('''(()=>{const e=document.querySelector('[data-testid="settings-back-button"]');return{ok:!!e&&e.getClientRects().length>0}})()''')
            if back['ok']:
                click('settings-back-button')
            click('chat-model-select-trigger')
            catalog = until('''(()=>{const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"],[inert]');const footer=[...document.querySelectorAll('[data-model-footer-action="manage-models"]')].filter(visible);const groups=[...document.querySelectorAll('[data-model-provider-key="registry-provider:ucas"]')].filter(visible);const items=[...document.querySelectorAll('[data-testid^="chat-model-select-item-custom:ucas:"]')].filter(visible);return{ok:footer.length===1,ucasProviderGroups:groups.length,ucasModelItems:items.length}})()''')
            assert catalog['ucasProviderGroups'] == catalog['ucasModelItems'] == 0
            facts['expiredOriginalModelMenu'] = catalog
            assert control('/gateway-state')['proof'] == baseline['proof']
            facts['checks'].append('original-model-menu-has-no-revoked-ucas-catalog-after-real-expiry')
        screenshot = bridge.raw_cdp('Page.captureScreenshot', format='png')
        (evidence / 'final-ui.png').write_bytes(base64.b64decode(screenshot['data']))
        facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
        if bridge:
            try:
                facts['failureUi'] = bridge.evaluate('''(()=>({text:document.body.innerText.slice(0,2200)}))()''')
                (evidence / 'failure-ui.png').write_bytes(base64.b64decode(bridge.raw_cdp('Page.captureScreenshot', format='png')['data']))
            except Exception as diagnostic:
                facts['diagnosticFailure'] = type(diagnostic).__name__
    finally:
        if container_id is None:
            inspected = docker('container', 'inspect', name, check=False)
            if inspected.returncode == 0:
                owned = json.loads(inspected.stdout)[0]
                if owned['Config']['Labels'].get('uwork-probe-owner') == owner_nonce:
                    container_id = owned['Id']
        if container_id:
            try:
                facts['beforeShutdown'] = control('/proof')
                facts['shutdownAcknowledged'] = control('/shutdown', True)['closing']
            except Exception as error:
                facts['shutdownObservationFailure'] = type(error).__name__
        if bridge:
            bridge.kill()
            harness_cleanup = json.loads((evidence / 'harness-cleanup.json').read_text())
            facts['harnessClosed'] = harness_cleanup.get('socketClosed') is True and harness_cleanup.get('daemonAbsent') is True
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait(timeout=5)
        if tunnel:
            facts['tunnelExited'] = tunnel.poll() is not None
            closed = []
            for port in [cdp_port, control_port]:
                with socket.socket() as connection:
                    connection.settimeout(.5)
                    closed.append(connection.connect_ex(('127.0.0.1', port)) != 0)
            facts['hostPortsClosed'] = all(closed)
        if container_id:
            try:
                facts['containerExitCode'] = int(docker('wait', container_id, timeout=25).stdout.strip())
            except subprocess.TimeoutExpired:
                facts['cleanupTimeout'] = True
            logs = docker('logs', container_id, check=False)
            (evidence / 'container.log').write_text(logs.stdout + logs.stderr)
            docker('rm', '-f', container_id)
            facts['containerAbsent'] = docker('container', 'inspect', container_id, check=False).returncode != 0
        if created_network:
            docker('network', 'rm', name)
            facts['networkAbsent'] = docker('network', 'inspect', name, check=False).returncode != 0
        for file in ['backend-ready.json', 'backend-final-proof.json', 'gateway-final-state.json', 'gateway-control-error.json']:
            if (work / file).exists():
                shutil.copyfile(work / file, evidence / file)
        if container_id:
            final = work / 'backend-final-proof.json'
            try:
                facts['finalProofMatches'] = final.exists() and json.loads(final.read_text()) == facts.get('beforeShutdown')
            except (OSError, ValueError):
                facts['finalProofMatches'] = False
            cleanup_ok = facts.get('containerExitCode') == 0 and facts.get('containerAbsent') and facts.get('networkAbsent') and facts.get('finalProofMatches') and facts.get('harnessClosed') and facts.get('hostPortsClosed')
            if not cleanup_ok:
                facts['status'] = 'failed'
        facts['seconds'] = round(time.monotonic() - started, 3)
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps({key: facts[key] for key in ['status', 'checks', 'failure', 'seconds'] if key in facts}))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--image')
    parser.add_argument('--expected-asar-sha256')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--natural-expiry', action='store_true')
    raise SystemExit(0 if run(parser.parse_args()) else 1)
