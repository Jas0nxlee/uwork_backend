"""Original Native Read waits in the kernel, then consumes current filesystem policy."""
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
    assert args.name.startswith('client-linux-pending-read-') and args.name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / args.name
    evidence.mkdir(mode=0o700)
    prepared = subprocess.run([NODE, 'scripts/tests/linux-desktop/pending-read-prepare.mjs', args.name],
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
    work.chmod(0o777)  # Its parent is this fresh private 0700 profile; UID1000 creates its own 0700 data dirs.
    assert hashlib.sha256((source / 'backend.mjs').read_bytes()).hexdigest() == preparation['compiledFixtureSha256']
    name = 'uwork-' + args.name
    bridge = tunnel = None
    created_network = False
    container_id = None
    owner_nonce = uuid.uuid4().hex
    cdp_port, control_port = free_port(), free_port()
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'ports': [cdp_port, control_port],
             'boundary': 'Original Native Read kernel lease await, current filesystem policy publication, original Skills UI barrier and before_result permission check',
             'mode': 'kernel-lease-before-result'}
    started = time.monotonic()

    def docker(*commands, check=True, timeout=30):
        return subprocess.run(DOCKER + list(commands), capture_output=True, text=True, check=check, timeout=timeout)

    def budget():
        assert time.monotonic() - started < 220, 'Finite Native pending Read budget exceeded'

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
        raise AssertionError('Original Native pending Read condition did not become true')

    def click(test_id, selector=None):
        selector = selector or '[data-testid=' + json.dumps(test_id) + ']'
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
        container_id = docker('run', '-d', '--name', name, '--label', 'uwork-probe-owner=' + owner_nonce, '--init', '--network', name, '--read-only', '--user', '1000:1000',
                              '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '2g', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--shm-size', '256m',
                              '--tmpfs', '/work/project:rw,nosuid,uid=1000,gid=1000,mode=700,size=16m',
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
        until('''(()=>({ok:!!document.querySelector('[data-testid="enterprise-identity-name"]')&&document.querySelector('[data-testid="chat-model-select-trigger"]')?.innerText.includes('Linux 联动受控模型')}))()''')
        baseline = control('/pending-read-state')
        facts['baseline'] = baseline
        assert baseline['proof']['modelCalls'] == baseline['proof']['ledger']['count'] == 0
        facts['checks'].append('original-native-ready-full-tools-and-isolated-zero-accounting')

        def observe_cli(state):
            logs = docker('logs', container_id)
            preflights, starts = {}, []
            for line in (logs.stdout + logs.stderr).splitlines():
                for marker, is_start in [('UWork agent spawn preflight ', False), ('UWork agent process started ', True)]:
                    if marker not in line:
                        continue
                    raw = line.split(marker, 1)[1]
                    if not raw.startswith('{') or not raw.endswith('}'):
                        continue
                    value = json.loads(raw)
                    if is_start:
                        starts.append(value)
                    else:
                        preflights[value['workspaceKey']] = value['spawnPreflight']
            matched = []
            for started_cli in starts:
                preflight = preflights.get(started_cli['workspaceKey'])
                if not preflight or preflight['args'] != ['/opt/UWork Preview/resources/glm/zcode.cjs', 'app-server', '--stdio', '--surface', 'desktop']:
                    continue
                for live in state['cliWorkers']:
                    if live['pid'] == started_cli['pid'] and live['cwd'] == '/work/project' and live['executable'] == '/opt/UWork Preview/zcode-preview':
                        matched.append({**live, 'productionSpawnArgumentsMatch': True})
            assert len(matched) == 1, 'Exactly one original production CLI must own this workspace'
            return matched[0]

        def original_skills_scope_barrier(receipt):
            click('task-settings-button')
            click('settings-section-nav-skill')
            until('''(()=>{const page=document.querySelector('[data-testid="settings-page"]');return{ok:page?.getAttribute('data-active-section')==='skill',text:page?.innerText.slice(0,1000)}})()''', 5)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = control('/pending-read-state')
                accepted = [row for row in state['authorizations'] if row['atMs'] >= receipt['atMs'] and row['originalMemberSession'] and row['status'] == 200 and row['filesystem'] == receipt['allowFilesystem']]
                if accepted:
                    break
                time.sleep(.05)
            else:
                raise AssertionError('Original Skills UI did not consume the current backend filesystem policy')
            snapshot = bridge.evaluate('''(()=>{const e=document.querySelector('[data-testid="settings-page"]');return{section:e?.getAttribute('data-active-section'),text:e?.innerText.slice(0,1600)}})()''')
            if not receipt['allowFilesystem']:
                snapshot = until('''(()=>{const e=document.querySelector('[data-testid="settings-page"]'),text=e?.innerText??'';return{ok:text.includes('企业已限制文件访问，无法读取或修改技能。'),section:e?.getAttribute('data-active-section'),text:text.slice(0,1600)}})()''', 3)
            click('settings-back-button')
            until('''(()=>({ok:!!document.querySelector('[data-testid="v4-composer"] [contenteditable="true"]')}))()''', 5)
            return {'authorization': accepted[-1], 'ui': snapshot}

        for phase in ['deny', 'allow']:
            if phase == 'allow':
                restored = control('/pending-read-policy-allow', True)
                facts['allowPolicyBarrier'] = original_skills_scope_barrier(restored)
            armed = control('/pending-read-arm-' + phase, True)
            assert armed['acquired'] and armed['regularFile'] and armed['uid'] == armed['gid'] == 1000
            assert int(armed['capEff'], 16) == 0 and not armed['sigioTimesMs']
            facts[phase + 'LeaseArmed'] = armed
            click('composer-' + phase, '[data-testid="v4-composer"] [contenteditable="true"]')
            bridge.raw_cdp('Input.insertText', text='OWNED_PENDING_READ_' + phase.upper() + ' 请调用一次指定的 Read 工具，然后简短回复。')
            click('v4-composer-send')
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                held = control('/pending-read-state')
                stage = held['cases'][phase]
                holder = held['holders'][phase]
                if holder['sigioTimesMs']:
                    assert stage['issued'] and holder['sigioTimesMs'][0] >= stage['issuedAtMs'], 'An indexer broke the lease before the controlled actual Read'
                    cli = observe_cli(held)
                    blocked = [worker for worker in cli['workers'] if worker['wchan'] == '__break_lease']
                    if blocked:
                        assert cli['uid'].split() == ['1000'] * 4 and int(cli['capEff'], 16) == 0
                        assert not any(process['pid'] != cli['pid'] and any(worker['wchan'] == '__break_lease' for worker in process['workers']) for process in held['cliWorkers']), 'A different process also waits on the lease; do not attribute it to this Read'
                        assert not stage['completed'] and not holder['released']
                        assert not any(row['denyMarker'] or row['allowMarker'] for row in stage['requests'])
                        break
                time.sleep(.05)
            else:
                raise AssertionError('The original CLI Read worker did not visibly wait in __break_lease')
            facts[phase + 'ReadBlocked'] = {'holder': holder, 'cli': cli, 'stage': stage, 'proof': held['proof']}
            facts['checks'].append(phase + '-original-cli-regular-file-read-await-kernel-lease-proven')
            if phase == 'deny':
                revoked = control('/pending-read-policy-deny', True)
                facts['denyPublished'] = revoked
                facts['denyPolicyBarrier'] = original_skills_scope_barrier(revoked)
            released = control('/pending-read-unlock-' + phase, True)
            assert released['released'] and released['releaseReason'] == 'explicit-owned-command'
            assert released['releasedAtMs'] - holder['sigioTimesMs'][0] < 10000
            facts[phase + 'LeaseReleased'] = released
            terminal = until('''(()=>{const done=document.body.innerText.includes(%s),error=document.querySelector('[data-testid="chat-error-banner"]')?.innerText??'';return{ok:(done||!!error)&&!document.querySelector('[data-testid="v4-stop"]'),done,error:error.slice(0,400)}})()''' % json.dumps('PENDING_READ_' + phase.upper() + '_COMPLETE'), 45)
            assert terminal['done'] and not terminal['error'], 'Read may fail as a tool result, not as logout/cancel/process crash'
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                completed = control('/pending-read-state')
                if completed['cases'][phase]['completed'] and completed['proof']['ledger']['settled'] == completed['proof']['modelCalls']:
                    break
                time.sleep(.1)
            result = completed['cases'][phase]['result']
            assert result['callId'] == 'owned-pending-read-' + phase
            assert result['denied'] is (phase == 'deny')
            assert result['errorCode'] == ('enterprise_filesystem_denied' if phase == 'deny' else None)
            assert result['handlerCompletedResultWithheld'] is (phase == 'deny')
            assert result['ownMarkerPresent'] is (phase == 'allow')
            assert not result['denyMarkerPresent']
            assert not any(row['denyMarker'] for row in completed['cases']['deny']['requests'])
            assert completed['proof']['rejectedSupplierRequests'] == 0 and completed['proof']['ledger']['owned']
            assert completed['proof']['ledger']['count'] == completed['proof']['ledger']['settled'] == completed['proof']['modelCalls']
            assert completed['proof']['ledger']['amount'] == 22 * completed['proof']['modelCalls']
            facts[phase + 'Terminal'] = {'ui': terminal, 'stage': completed['cases'][phase], 'proof': completed['proof']}
            result_permissions = [row for row in completed['authorizations'] if released['releasedAtMs'] <= row['atMs'] <= result['atMs'] and row['status'] == 200 and row['filesystem'] is (phase == 'allow')]
            assert result_permissions, 'Original Host private permission read must fall between OS release and supplier tool-result delivery'
            facts[phase + 'AfterReadPermissionReceipts'] = result_permissions
            facts['checks'].append(phase + '-read-result-current-permission-and-exact-supplier-ledger-correspondence')
        final = control('/pending-read-state')
        assert final['proof']['modelCalls'] == final['proof']['ledger']['count'] == final['proof']['ledger']['settled'] == 5
        assert final['proof']['ledger']['amount'] == 110
        assert final['proof']['ledger']['inputTokens'] == 60 and final['proof']['ledger']['outputTokens'] == 50
        assert not any(row['denyMarker'] for row in final['cases']['allow']['requests'])
        facts['finalState'] = final
        facts['checks'].append('late-allow-does-not-republish-denied-bytes-five-owned-settlements-no-extra-dispatch')
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
        for file in ['backend-ready.json', 'backend-final-proof.json', 'pending-read-final-state.json', 'pending-read-control-error.json']:
            if (work / file).exists():
                shutil.copyfile(work / file, evidence / file)
        if container_id:
            final = work / 'backend-final-proof.json'
            try:
                facts['finalProofMatches'] = final.exists() and json.loads(final.read_text()) == facts.get('beforeShutdown')
            except (OSError, ValueError):
                facts['finalProofMatches'] = False
            holders_final = work / 'pending-read-final-state.json'
            facts['leaseHoldersClosed'] = holders_final.exists() and all(row.get('closed') and row.get('released') and row.get('exitCode') == 0 and not row.get('failure') and not row.get('safetyTimeout') for row in json.loads(holders_final.read_text())['holders'].values())
            desktop_exit = work / 'desktop-exit.json'
            facts['originalDesktopExit'] = json.loads(desktop_exit.read_text()) if desktop_exit.exists() else None
            cleanup_ok = facts.get('containerExitCode') == 0 and facts.get('containerAbsent') and facts.get('networkAbsent') and facts.get('finalProofMatches') and facts.get('harnessClosed') and facts.get('hostPortsClosed') and facts.get('leaseHoldersClosed') and facts.get('originalDesktopExit') == {'code': 0, 'signal': None}
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
    raise SystemExit(0 if run(parser.parse_args()) else 1)
