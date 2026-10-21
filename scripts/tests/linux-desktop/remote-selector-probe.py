"""Owned Native SSH directory selector: browse, cancel, reconnect; no project/task."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import tarfile
import time
import urllib.request
import uuid

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
Bridge = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge']
FirstRun = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))['FirstRunUi']
APP_SHA = '629fc093e5018cc50c120f0f046c3426d29c673388014ed8c32dab1d4358e7a1'
ASAR_SHA = '3658e4731d2f23977b0bf0ecdf0a7378fa05d0bab531b12100904353b850fd4e'
AGENT_SHA = 'cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac'


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def validate_assets(cdn):
    """Inspect real static assets before any native process is started."""
    cdn = cdn.resolve(strict=True)
    release = cdn / '3.16.0'
    manifest = json.loads((release / 'manifest-linux-arm64.json').read_text())
    assert manifest['appVersion'] == '3.16.0' and manifest['platformArch'] == 'linux-arm64'
    required = {'server-bundle', 'node-runtime', 'node-pty', 'glm', 'bfs', 'ripgrep', 'ugrep'}
    assert set(item['id'] for item in manifest['components']) == required
    receipts = []
    for component in manifest['components']:
        archive = (cdn / component['artifactPath']).resolve(strict=True)
        assert archive.is_relative_to(cdn) and sha(archive) == component['sha256']
        row = {'id': component['id'], 'archiveSha256': sha(archive), 'mount': component['mount']}
        with tarfile.open(archive, 'r:gz') as contents:
            members = contents.getmembers()
            assert all(not Path(item.name).is_absolute() and '..' not in Path(item.name).parts for item in members)
            if component['id'] == 'glm':
                agent = [item for item in members if item.isfile() and Path(item.name).name == 'zcode.cjs']
                assert len(agent) == 1
                row['agentSha256'] = hashlib.sha256(contents.extractfile(agent[0]).read()).hexdigest()
                assert row['agentSha256'] == AGENT_SHA
            if component['id'] == 'server-bundle':
                entry = [item for item in members if item.isfile() and Path(item.name).name == 'zcode-server.cjs']
                assert len(entry) == 1
                source = contents.extractfile(entry[0]).read()
                assert all(marker in source for marker in [b'zcode-hello', b'stdio mode ready', b'plugin-sync', b'__zcode_rpc_nested_uint8array_v1'])
                row['stdioSha256'] = hashlib.sha256(source).hexdigest()
        receipts.append(row)
    return receipts


def run(args):
    preparation = json.loads(args.preparation.read_text())
    assert preparation['status'] == 'prepared-not-run'
    profile = preparation['profile']
    assert profile.startswith('client-linux-remote-selector-') and profile.replace('-', '').isalnum()
    shared = Path(preparation['root'])
    assert shared.resolve() == REPO / 'data/sandbox-verification' / profile
    assert sha(shared / 'input/backend.mjs') == preparation['compiledFixtureSha256']
    receipts = validate_assets(args.cdn_dir) if args.cdn_dir else None
    if args.prepare_only:
        print(json.dumps({'status': 'prepared-not-run', 'profile': profile, 'assetsVerified': receipts is not None,
                          'boundary': preparation['scope']}))
        return True
    assert receipts is not None, 'All seven real CDN components are required before GUI'
    assert args.target_image and args.image, 'Explicit owned images required'
    evidence = REPO / 'evidence' / profile
    evidence.mkdir(mode=0o700)  # Fresh evidence, never overwrite prior failed runs.
    work = shared / 'work'
    work.mkdir(mode=0o700)
    owner = uuid.uuid4().hex
    network = 'uwork-' + profile
    gui_name, target_name = network + '-gui', network + '-ssh'
    containers = []
    created_network = False
    bridge = tunnel = None
    started = time.monotonic()
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'assets': receipts,
             'boundary': preparation['scope'], 'clientPublicFingerprint': preparation['clientPublicFingerprint']}
    cdp_port, control_port = port(), port()

    def docker(*argv, check=True, timeout=30):
        return subprocess.run(DOCKER + list(argv), capture_output=True, text=True, check=check, timeout=timeout)

    def budget():
        assert time.monotonic() - started < 300, 'Finite selector test budget exceeded'
        if tunnel:
            assert tunnel.poll() is None, 'Owned SSH tunnel exited before test completion'

    def control(path, post=False):
        req = urllib.request.Request(f'http://127.0.0.1:{control_port}' + path, method='POST' if post else 'GET')
        with urllib.request.urlopen(req, timeout=3) as response:
            return json.load(response)

    def until(expression, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            budget()
            last = bridge.evaluate(expression)
            if last.get('ok'):
                return last
            time.sleep(.2)
        facts['lastUi'] = last
        raise AssertionError('Original selector condition did not become true')

    def click_selector(selector):
        expression = '''(()=>{const e=document.querySelector(%s);if(!e)return{ok:false};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&!e.disabled&&e.contains(document.elementFromPoint(x,y)),x,y}})()''' % json.dumps(selector)
        position = until(expression)
        for _ in range(3):
            bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=position['x'], y=position['y'])
            current = until(expression)
            if abs(current['x'] - position['x']) < .5 and abs(current['y'] - position['y']) < .5:
                break
            position = current
        else:
            raise AssertionError('Control moved after hover')
        for kind in ['mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=current['x'], y=current['y'], button='left', clickCount=1)
        facts['actions'].append(selector)

    def click(test_id):
        click_selector('[data-testid=' + json.dumps(test_id) + ']')

    def text_button(text, scope='[data-testid="ssh-dialog"]'):
        # Return a selector from read-only observed DOM. Activation remains physical Input.
        state = until('''(()=>{const scope=document.querySelector(%s),buttons=[...(scope?.querySelectorAll('button')??[])].filter(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()===%s);return{ok:buttons.length===1,index:buttons.length===1?[...scope.querySelectorAll('button')].indexOf(buttons[0]):-1}})()''' % (json.dumps(scope), json.dumps(text)))
        index = state['index']
        # Use nth-of-type-independent DOM-generated unique path, no DOM mutation.
        path = bridge.evaluate('''(()=>{let e=document.querySelector(%s).querySelectorAll('button')[%d];const parts=[];while(e&&e!==document.body){const p=e.parentElement;parts.unshift(e.tagName.toLowerCase()+':nth-child('+([...p.children].indexOf(e)+1)+')');e=p}return{selector:'body>'+parts.join('>')}})()''' % (json.dumps(scope), index))['selector']
        click_selector(path)

    def fill(test_id, value):
        click(test_id)
        bridge.raw_cdp('Input.dispatchKeyEvent', type='keyDown', key='a', code='KeyA', modifiers=2,
                       windowsVirtualKeyCode=65, commands=['selectAll'])
        bridge.raw_cdp('Input.dispatchKeyEvent', type='keyUp', key='a', code='KeyA', modifiers=2, windowsVirtualKeyCode=65)
        bridge.raw_cdp('Input.insertText', text=value)
        until('''(()=>{const e=document.querySelector(%s);return{ok:e?.value===%s}})()''' %
              (json.dumps('[data-testid=' + json.dumps(test_id) + ']'), json.dumps(value)), 3)

    def stdio_pids():
        rows = docker('exec', containers[0], 'ps', '-eo', 'pid=,uid=,comm=,args=').stdout.splitlines()
        return [int(line.split()[0]) for line in rows if len(line.split()) >= 4 and line.split()[1:3] == ['1000', 'node']
                and 'zcode-server.cjs' in line and '--version' not in line]

    def wait_no_stdio():
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            budget()
            if not stdio_pids():
                return
            time.sleep(.2)
        raise AssertionError('Original Host shutdown left its cached remote stdio process alive')

    def snapshot_transport(label):
        row = {'label': label, 'atSeconds': round(time.monotonic() - started, 3),
               'tunnelPid': tunnel.pid if tunnel else None, 'tunnelReturnCode': tunnel.poll() if tunnel else None,
               'endpoints': {}}
        for kind, number, path in [('cdp', cdp_port, '/json/version'), ('control', control_port, '/proof')]:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{number}' + path, timeout=2) as response:
                    row['endpoints'][kind] = {'port': number, 'status': response.status}
            except Exception as error:
                row['endpoints'][kind] = {'port': number, 'errorType': type(error).__name__}
        if len(containers) == 2:
            row['processes'] = docker('exec', containers[1], 'ps', '-eo', 'pid=,ppid=,uid=,stat=,comm=,args=', check=False).stdout
        facts.setdefault('transportSnapshots', []).append(row)
        if bridge:
            log = bridge.root / 'tmp/bu.log'
            if log.exists():
                shutil.copyfile(log, evidence / (label + '-owned-harness.log'))

    def disposed_receipts():
        logs = docker('logs', gui_name, check=False)
        return [line for line in (logs.stdout + logs.stderr).splitlines()
                if 'window Host topology, reason=remote-session-disposed' in line
                and 'connections=1, logicalSessions=0' in line]

    def deployed_files():
        stage = json.loads((args.cdn_dir.resolve().parent / 'remote-asset-stage.json').read_text())['records']
        paths = {'server/zcode-server.cjs': 'zcode-server.cjs', 'node/linux-arm64/node': 'node',
                 'node-pty/linux-arm64/pty.node': 'build/Release/pty.node', 'glm/linux-arm64/zcode.cjs': 'agents/glm/zcode.cjs',
                 'tools/linux-arm64/bfs/bfs': 'tools/bfs/bfs', 'tools/linux-arm64/ripgrep/rg': 'tools/ripgrep/rg',
                 'tools/linux-arm64/ugrep/ugrep': 'tools/ugrep/ugrep'}
        rows = {}
        for source, target in paths.items():
            actual = docker('exec', '--user', '1000', containers[0], 'sha256sum', '/home/node/.zcode/server/' + target).stdout.split()[0]
            assert actual == stage[source]['sha256'], 'Original deploy must preserve real source bytes: ' + source
            rows[target] = actual
        return rows

    try:
        gui_image = docker('image', 'inspect', '--format', '{{.Id}}', args.image).stdout.strip()
        target_image = docker('image', 'inspect', '--format', '{{.Id}}', args.target_image).stdout.strip()
        facts.update(guiImageId=gui_image, targetImageId=target_image)
        # No container is started before the frozen AppImage is checked.
        actual = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                        '--entrypoint', 'sha256sum', gui_image, '/opt/artifacts/uwork-preview.AppImage').stdout.split()[0]
        assert actual == APP_SHA
        for name in [gui_name, target_name]:
            assert docker('container', 'inspect', name, check=False).returncode != 0
        assert docker('network', 'inspect', network, check=False).returncode != 0
        docker('network', 'create', '--internal', network)
        created_network = True
        target_id = docker('run', '-d', '--name', target_name, '--label', 'uwork-probe-owner=' + owner,
                           '--network', network, '--network-alias', 'owned-selector-ssh', '--read-only',
                           '--tmpfs', '/run:rw,nosuid,size=16m', '--tmpfs', '/tmp:rw,nosuid,size=64m',
                           '--tmpfs', '/home/node:rw,exec,nosuid,uid=1000,gid=1000,size=512m',
                           '--mount', f'type=bind,src={shared}/target/authorized_keys,dst=/owned-key.pub,readonly',
                           '--mount', f'type=bind,src={args.cdn_dir.resolve()},dst=/cdn,readonly', target_image).stdout.strip()
        containers.append(target_id)
        # The production deployer must be able to execute its owned runtime.
        # Check only an owned copy of /bin/true before any native UI startup.
        docker('exec', '--user', '1000', target_id, 'cp', '/bin/true', '/home/node/.owned-exec-preflight')
        docker('exec', '--user', '1000', target_id, '/home/node/.owned-exec-preflight')
        docker('exec', '--user', '1000', target_id, 'rm', '/home/node/.owned-exec-preflight')
        facts['ownedHomeExecutablePreflight'] = True
        docker('run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
               '--mount', f'type=bind,src={work},dst=/work', '--entrypoint', '/bin/chown', gui_image, '1000:1000', '/work')
        gui_id = docker('run', '-d', '--name', gui_name, '--label', 'uwork-probe-owner=' + owner,
                        '--init', '--network', network, '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
                        '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--shm-size', '256m',
                        '-e', 'UWORK_LINUX_TEST_APPIMAGE=/opt/artifacts/uwork-preview.AppImage',
                        '-e', 'UWORK_LINUX_TEST_WINDOW_MANAGER=1',
                        '-e', 'ZCODE_REMOTE_ASSET_CDN_BASE_URL=http://owned-selector-ssh:8080',
                        '--mount', f'type=bind,src={shared}/input,dst=/opt/backend/probe,readonly',
                        '--mount', f'type=bind,src={work},dst=/work',
                        '--entrypoint', '/bin/sh', gui_image, '/opt/backend/probe/entry.sh').stdout.strip()
        containers.append(gui_id)
        # Own short-lived private key copied into only the same test UID's private /work.
        subprocess.run(DOCKER + ['exec', '-i', '--user', '1000', gui_id, '/bin/sh', '-c',
                                'umask 077; cat > /work/remote-selector-key'],
                       input=(shared / 'id_rsa').read_bytes(), capture_output=True, check=True, timeout=10)
        ip = docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', gui_id).stdout.strip()
        socket.inet_aton(ip)
        ssh_config = shared / 'ssh-config'
        ssh_config.write_text(subprocess.run(['colima', 'ssh-config', '--profile', 'uwork-backend'], capture_output=True, text=True, check=True).stdout)
        ssh_config.chmod(0o600)
        with (evidence / 'tunnel.log').open('w') as log:
            tunnel = subprocess.Popen(['/usr/bin/ssh', '-F', str(ssh_config), '-S', 'none', '-N', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
                                       '-o', 'ExitOnForwardFailure=yes', '-L', f'127.0.0.1:{cdp_port}:{ip}:9333',
                                       '-L', f'127.0.0.1:{control_port}:{ip}:9334', 'colima-uwork-backend'],
                                      stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        facts['tunnelPid'] = tunnel.pid
        facts['ownedEndpointPorts'] = {'cdp': cdp_port, 'control': control_port}
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            assert tunnel.poll() is None
            assert json.loads(docker('inspect', gui_id).stdout)[0]['State']['Running'], 'Owned original fixture exited before renderer readiness'
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json/list', timeout=2) as response:
                    if any(row.get('url', '').startswith('file:///work/appimage-runtime/') for row in json.load(response)):
                        break
            except (OSError, ValueError):
                pass
            time.sleep(.2)
        else:
            facts['startupProcesses'] = docker('exec', gui_id, 'ps', '-eo', 'pid=,ppid=,uid=,stat=,comm=,args=', check=False).stdout
            exit_record = work / 'desktop-exit.json'
            if exit_record.exists():
                facts['earlyWrapperExit'] = json.loads(exit_record.read_text())
            raise AssertionError('Original AppImage renderer did not become ready')
        bridge = Bridge(cdp_port, renderer_prefix='file:///work/appimage-runtime/', evidence=evidence)
        facts['ownedHarnessRoot'] = str(bridge.root)
        pidfiles = list((bridge.root / 'runtime').glob('*.pid'))
        assert len(pidfiles) == 1
        facts['ownedHarnessInitialPid'] = int(pidfiles[0].read_text().strip())
        ready = json.loads((work / 'backend-ready.json').read_text())
        facts['runtimeRoot'] = ready['packagedRoot']
        actual_asar = docker('exec', gui_id, 'sha256sum', ready['packagedRoot'] + '/resources/app.asar').stdout.split()[0]
        actual_agent = docker('exec', gui_id, 'sha256sum', ready['packagedRoot'] + '/resources/glm/zcode.cjs').stdout.split()[0]
        assert actual_asar == ASAR_SHA and actual_agent == AGENT_SHA
        until('''(()=>({ok:!!document.querySelector('[data-testid="onboarding-page"]')&&!document.querySelector('[data-testid="root-startup-loading"]')?.getClientRects().length}))()''', 45)
        claimed = set()
        def claim(action, **kwargs):
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
            raise AssertionError('Original restored-identity onboarding was not ready')
        for action in ['select_developer', 'next_role', 'select_coding', 'next_mode', 'finish']:
            snapshot_transport('before-onboarding-' + action)
            phase = first.phase('observe')
            facts.setdefault('onboardingObservations', []).append({'action': action, 'state': phase})
            first.phase(action)
            facts['actions'].append(action)
            time.sleep(.25)
        until('''(()=>({ok:!!document.querySelector('[data-testid="enterprise-identity-name"]')}))()''')
        baseline = control('/proof')
        assert baseline['modelCalls'] == baseline['ledger']['count'] == baseline['rejectedSupplierRequests'] == 0
        facts['checks'].append('original-clock-appimage-and-real-identity-ready-zero-model-ledger')
        pids = []
        for cycle in [1, 2]:
            click('composer-workspace-trigger')
            click('composer-remote-connection')
            click('remote-kind-ssh')
            text_button('下一步')
            fill('ssh-host-input', 'owned-selector-ssh')
            fill('ssh-port-input', '2222')
            fill('ssh-username-input', 'node')
            click('ssh-auth-private-key')
            fill('ssh-private-key-input', '/work/remote-selector-key')
            text_button('开始连接')
            state = until('''(()=>{const d=document.querySelector('[data-testid="ssh-dialog"]'),input=d?.querySelector('form input');return{ok:!!input&&input.value==='/home/node'&&d.innerText.includes('selector-owned'),path:input?.value}})()''', 90)
            live = stdio_pids()
            assert len(live) == 1 and (not pids or live[0] == pids[0]), 'Original ready SSH connection is a window-scoped cache'
            pids.extend(live)
            current_files = deployed_files()
            if cycle == 1:
                facts['deployedFiles'] = current_files
            else:
                assert current_files == facts['deployedFiles']
            facts['checks'].append(f'cycle-{cycle}-original-ssh-auth-deploy-stdio-homedir-list')
            # Browse using an observed original folder button, never select current project.
            text_button('selector-owned')
            until('''(()=>{const d=document.querySelector('[data-testid="ssh-dialog"]'),input=d?.querySelector('form input');return{ok:input?.value==='/home/node/selector-owned'&&d.innerText.includes('child')&&!d.innerText.includes('.hidden-child')}})()''')
            text_button('显示隐藏目录')
            until('''(()=>{const d=document.querySelector('[data-testid="ssh-dialog"]');return{ok:d?.innerText.includes('.hidden-child')}})()''')
            receipt_count = len(disposed_receipts())
            # Escape triggers the original connected-session discard confirmation.
            for kind in ['keyDown', 'keyUp']:
                bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='Escape', code='Escape', windowsVirtualKeyCode=27)
            click('confirm-dialog-confirm')
            until('''(()=>({ok:!document.querySelector('[data-testid="ssh-dialog"]')?.getClientRects().length}))()''')
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if len(disposed_receipts()) > receipt_count:
                    break
                time.sleep(.2)
            else:
                raise AssertionError('Original Host must acknowledge logical-session retirement')
            assert stdio_pids() == live
            assert deployed_files() == facts['deployedFiles']
            assert control('/proof') == baseline
            facts['checks'].append(f'cycle-{cycle}-browse-hidden-toggle-cancel-retires-logical-session-and-retains-window-ssh-cache')
        facts['remoteStdioPids'] = pids
        facts['cancelTopologyReceipts'] = disposed_receipts()
        facts['status'] = 'passed'
    except Exception as error:
        facts['failure'] = {'type': type(error).__name__, 'message': str(error)[:1200]}
        snapshot_transport('first-failure')
        if bridge:
            try:
                facts['failureUi'] = bridge.evaluate('''(()=>({text:document.body.innerText.slice(0,2000)}))()''')
                (evidence / 'failure-ui.png').write_bytes(base64.b64decode(bridge.raw_cdp('Page.captureScreenshot', format='png')['data']))
            except Exception:
                pass
    finally:
        if len(containers) == 2:
            try:
                facts['beforeShutdown'] = control('/proof')
                facts['shutdownAcknowledged'] = control('/shutdown', True)['closing']
                facts['guiExitCode'] = int(docker('wait', containers[1], timeout=25).stdout.strip())
                wait_no_stdio()
                facts['stdioClosedAfterOriginalHostShutdown'] = True
            except Exception as error:
                facts['shutdownFailure'] = type(error).__name__
        if bridge:
            bridge.kill()
            cleanup = json.loads((evidence / 'harness-cleanup.json').read_text())
            facts['harnessClosed'] = cleanup.get('socketClosed') is True and cleanup.get('daemonAbsent') is True
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait(timeout=5)
        facts['tunnelClosed'] = tunnel is None or tunnel.poll() is not None
        for name in [gui_name, target_name]:
            inspected = docker('container', 'inspect', name, check=False)
            if inspected.returncode == 0:
                owned = json.loads(inspected.stdout)[0]
                assert owned['Config']['Labels'].get('uwork-probe-owner') == owner
                logs = docker('logs', name, check=False)
                (evidence / (name.rsplit('-', 1)[-1] + '.log')).write_text(logs.stdout + logs.stderr)
                docker('rm', '-f', name)
        facts['containersAbsent'] = all(docker('container', 'inspect', name, check=False).returncode != 0 for name in [gui_name, target_name])
        if created_network:
            docker('network', 'rm', network)
        facts['networkAbsent'] = docker('network', 'inspect', network, check=False).returncode != 0
        closed = []
        for number in [cdp_port, control_port]:
            with socket.socket() as connection:
                connection.settimeout(.5)
                closed.append(connection.connect_ex(('127.0.0.1', number)) != 0)
        facts['portsClosed'] = all(closed)
        for key_path in [shared / 'id_rsa', work / 'remote-selector-key']:
            key_path.unlink(missing_ok=True)
        facts['privateKeysRemoved'] = not (shared / 'id_rsa').exists() and not (work / 'remote-selector-key').exists()
        if (work / 'backend-final-proof.json').exists():
            final = json.loads((work / 'backend-final-proof.json').read_text())
            facts['finalProofMatches'] = final == facts.get('beforeShutdown')
            shutil.copyfile(work / 'backend-final-proof.json', evidence / 'backend-final-proof.json')
        if facts['status'] == 'passed' and not all([facts.get('harnessClosed'), facts['tunnelClosed'], facts['containersAbsent'], facts['networkAbsent'],
                                                 facts['portsClosed'], facts['privateKeysRemoved'], facts.get('stdioClosedAfterOriginalHostShutdown'),
                                                 facts.get('guiExitCode') == 0, facts.get('finalProofMatches')]):
            facts['status'] = 'failed'
        facts['seconds'] = round(time.monotonic() - started, 3)
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps({key: facts[key] for key in ['status', 'checks', 'failure', 'seconds'] if key in facts}))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', type=Path, required=True)
    parser.add_argument('--cdn-dir', type=Path)
    parser.add_argument('--image')
    parser.add_argument('--target-image')
    parser.add_argument('--prepare-only', action='store_true')
    raise SystemExit(0 if run(parser.parse_args()) else 1)
