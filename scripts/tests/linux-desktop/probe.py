"""Original Linux packaged renderer, isolated real backend, and bounded browser-harness actions."""
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

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
IMAGE = 'uwork-linux-desktop-test:20261020-v2'
Bridge = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge']
FirstRun = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))['FirstRunUi']


class StartupProbeComplete(Exception):
    pass


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def run(name, pty=False, installed=False, startup_only=False, ordinary_user=False, test_image=None, protocol=False, appimage=False, protocol_only=False, trace_lifetime=False, window_manager=False, protocol_hold_seconds=0, native_diagnostics=False):
    assert name.startswith('client-linux-desktop-') and name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / name
    evidence.mkdir(mode=0o700)
    shared = REPO / 'data/sandbox-verification' / name
    shared.mkdir(mode=0o700)
    work, source = shared / 'work', shared / 'input'
    work.mkdir(mode=0o700)
    source.mkdir(mode=0o700)
    inputs = REPO / 'data/sandbox-verification/linux-desktop-20261020'
    for file in ([] if appimage else ['backend.mjs']) + ([] if appimage or installed else ['desktop.tar.gz']):
        shutil.copyfile(inputs / file, source / file)
    if appimage or ordinary_user or protocol or protocol_only:
        node = '/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
        build = '''import {build} from 'esbuild';import {readFileSync} from 'node:fs';
const deps=Object.keys(JSON.parse(readFileSync('package.json','utf8')).dependencies);
await build({entryPoints:['scripts/tests/linux-desktop/backend.mjs'],outfile:process.argv[1],bundle:true,platform:'node',format:'esm',target:'node24',external:deps,banner:{js:'import {createRequire as _probeRequire} from "node:module"; const require=_probeRequire(import.meta.url);'}});'''
        subprocess.run([node, '--input-type=module', '-e', build, str(source / 'backend.mjs')], cwd=REPO, check=True, capture_output=True, text=True)
    shutil.copyfile(Path(__file__).with_name('entry.sh'), source / 'entry.sh')
    network = volume = container = 'uwork-' + name
    image = 'uwork-linux-desktop-installed:20261020-v1' if installed else IMAGE
    if test_image:
        assert test_image.startswith('uwork-linux-desktop-') and all(c.isalnum() or c in '-:.' for c in test_image)
        image = test_image
    app_root = '/opt/UWork Preview' if installed else '/app'
    renderer_prefix = 'file:///work/appimage-runtime/' if appimage else 'file://' + urllib.parse.quote(app_root, safe='/') + '/resources/app.asar/'
    cdp_port, control_port = free_port(), free_port()
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'ports': [cdp_port, control_port]}
    if not installed and not appimage:
        facts['archiveSha256'] = hashlib.sha256((source / 'desktop.tar.gz').read_bytes()).hexdigest()
    if appimage:
        value = subprocess.check_output(DOCKER + ['run', '--rm', '--network', 'none', '--read-only',
            '--cap-drop', 'ALL', '--entrypoint', 'sha256sum', image, '/opt/artifacts/uwork-preview.AppImage'], text=True).split()[0]
        assert len(value) == 64 and all(c in '0123456789abcdef' for c in value)
        facts['actualAppImageSha256'] = value
    facts['installedPackage'] = installed
    facts['ordinaryUser'] = ordinary_user
    facts['appImageExtractAndRun'] = appimage
    facts['imageId'] = subprocess.check_output(DOCKER + ['image', 'inspect', '--format', '{{.Id}}', image], text=True).strip()
    created_volume = created_network = False
    bridge = None
    tunnel = None
    started = time.monotonic()

    def docker(*args, check=True, timeout=30):
        return subprocess.run(DOCKER + list(args), capture_output=True, text=True, check=check, timeout=timeout)

    def budget():
        assert time.monotonic() - started < 260, 'Total UI budget exceeded'

    def until(expression, timeout=40):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            budget()
            last = bridge.evaluate(expression)
            if last.get('ok'):
                return last
            time.sleep(.2)
        facts['failedProjection'] = last
        raise AssertionError('Original UI condition did not become true')

    def click(test_id, selector=None):
        selector = selector or '[data-testid=' + json.dumps(test_id) + ']'
        expression = '''(()=>{const e=document.querySelector(%s);if(!e)return{ok:false};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&e.contains(document.elementFromPoint(x,y))&&!e.disabled,x,y}})()''' % json.dumps(selector)
        state = until(expression)
        for attempt in range(3):
            bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=state['x'], y=state['y'])
            current = until(expression)
            if abs(current['x'] - state['x']) < .5 and abs(current['y'] - state['y']) < .5:
                state = current
                break
            facts.setdefault('pointerRelocations', []).append({'control': test_id, 'before': state, 'after': current})
            state = current
        else:
            raise AssertionError('Original target layout did not stabilize before click')
        for kind in ['mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=state['x'], y=state['y'],
                           **({} if kind == 'mouseMoved' else {'button': 'left', 'clickCount': 1}))
        facts['actions'].append(test_id)

    def control(path, post=False):
        request = urllib.request.Request(f'http://127.0.0.1:{control_port}' + path, method='POST' if post else 'GET')
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    # 原代码预览使用 Shadow DOM；body.innerText 不包含其中已绘出的文件正文。
    preview = '''(()=>{const pane=document.querySelector('[data-testid="preview-pane"]');let count=0,roots=0,found=false;const scan=root=>{for(const e of root.querySelectorAll('*')){if(++count>2000)throw Error('Owned preview DOM bound exceeded');if(e.shadowRoot){roots++;if(e.getClientRects().length&&e.shadowRoot.textContent.includes('LINUX_DESKTOP_FILE_SENTINEL'))found=true;scan(e.shadowRoot);}}};if(pane)scan(pane);return{ok:found,shadowRoots:roots,nodes:count}})()'''

    try:
        assert docker('volume', 'inspect', volume, check=False).returncode != 0
        assert docker('network', 'inspect', network, check=False).returncode != 0
        if not installed and not appimage:
            docker('volume', 'create', volume)
            created_volume = True
        docker('network', 'create', '--internal', network)
        created_network = True
        assert json.loads(docker('network', 'inspect', network).stdout)[0]['Internal']
        if not installed and not appimage:
            docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                   '--mount', f'type=bind,src={source},dst=/input,readonly',
                   '--mount', f'type=volume,src={volume},dst=/app', '--entrypoint', '/bin/tar',
                   image, '-xzf', '/input/desktop.tar.gz', '-C', '/app', '--no-same-owner', timeout=90)
        if ordinary_user:
            docker('run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
                   '--mount', f'type=bind,src={work},dst=/work', '--entrypoint', '/bin/chown',
                   image, '1000:1000', '/work')
        docker('run', '-d', '--name', container, '--init', '--network', network, '--read-only',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               *(['--cap-add', 'SYS_PTRACE', '--cap-add', 'DAC_READ_SEARCH'] if native_diagnostics else []),
               *(['--user', '1000:1000'] if ordinary_user else []),
               '--tmpfs', '/tmp:rw,nosuid,size=256m', '--shm-size', '256m',
               *(['--tmpfs', '/work/appimage-runtime:rw,nosuid,exec,uid=1000,gid=1000,mode=700,size=2g'] if appimage else []),
               *([] if installed or appimage else ['--mount', f'type=volume,src={volume},dst=/app,readonly']),
               '-e', 'UWORK_LINUX_TEST_APP_ROOT=' + app_root,
               *(['-e', 'UWORK_LINUX_TEST_APPIMAGE=/opt/artifacts/uwork-preview.AppImage'] if appimage else []),
               *(['-e', 'UWORK_LINUX_TEST_TRACE_LIFETIME=1'] if trace_lifetime else []),
               *(['-e', 'UWORK_LINUX_TEST_WINDOW_MANAGER=1'] if window_manager else []),
               '--mount', f'type=bind,src={source},dst=/opt/backend/probe,readonly',
               '--mount', f'type=bind,src={work},dst=/work',
               '--entrypoint', '/bin/sh', image, '/opt/backend/probe/entry.sh')
        if installed:
            facts['installedPackageStatus'] = docker('exec', container, 'dpkg-query', '-W', '-f=${Package} ${Version} ${Architecture} ${db:Status-Status}', 'zcode-preview').stdout
            assert facts['installedPackageStatus'] == 'zcode-preview 3.16.0 arm64 installed'
        # Docker internal 网络不发布外部端口；经专用 Colima VM 的自有 SSH 会话转发到容器。
        ip = docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', container).stdout.strip()
        socket.inet_aton(ip)
        config = shared / 'ssh-config'
        config.write_text(subprocess.run(['colima', 'ssh-config', '--profile', 'uwork-backend'],
                                        capture_output=True, text=True, check=True).stdout)
        config.chmod(0o600)
        with (evidence / 'tunnel.log').open('w') as log:
            tunnel = subprocess.Popen(['/usr/bin/ssh', '-F', str(config), '-S', 'none', '-N',
                '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes',
                '-L', f'127.0.0.1:{cdp_port}:{ip}:9333',
                '-L', f'127.0.0.1:{control_port}:{ip}:9334', 'colima-uwork-backend'],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        facts['tunnelPid'] = tunnel.pid
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            assert tunnel.poll() is None, 'Owned Colima tunnel exited'
            assert json.loads(docker('inspect', container).stdout)[0]['State']['Running'], 'Container exited before ready'
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json/list', timeout=2) as response:
                    targets = json.load(response)
                facts['cdpTargets'] = [{'type': t.get('type'), 'url': t.get('url', '')[:300]} for t in targets[:8]]
                if any(t.get('url', '').startswith(renderer_prefix) for t in targets):
                    break
            except (OSError, ValueError) as error:
                facts['cdpConnectionError'] = str(error)[:300]
            time.sleep(.3)
        else:
            raise AssertionError('Owned packaged CDP unavailable')
        bridge = Bridge(cdp_port, renderer_prefix=renderer_prefix, evidence=evidence)
        if appimage:
            app_root = urllib.parse.unquote(urllib.parse.urlparse(bridge.target).path).split('/resources/app.asar/')[0]
            ready = json.loads((work / 'backend-ready.json').read_text())
            assert app_root == ready['packagedRoot'] and app_root.startswith('/work/appimage-runtime/')
            facts['actualAppImageRoot'] = app_root
        facts['cdpAttachedSeconds'] = round(time.monotonic() - started, 3)
        facts['checks'].append('original-linux-app-asar-renderer')
        until('''(()=>{const page=document.querySelector('[data-testid="onboarding-page"]'),loading=document.querySelector('[data-testid="root-startup-loading"]');return{ok:!!page&&page.getClientRects().length>0&&(!loading||!loading.getClientRects().length)}})()''', 45)
        claims = set()
        def claim(action, **kwargs):
            assert action not in claims
            claims.add(action)
            return True
        first = FirstRun('file-restored', bridge.evaluate, bridge.raw_cdp, lambda: 1,
                         budget, claim, lambda: False, press_release_only=True)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            state = first.phase('observe')
            if state['step'] == 'role' and not state['startupLoadingVisible'] and not state['loginVisible']:
                break
            time.sleep(.2)
        else:
            facts['firstRun'] = state
            raise AssertionError('Restored identity onboarding unavailable')
        facts['firstRunReadySeconds'] = round(time.monotonic() - started, 3)
        if startup_only:
            samples = []
            for index in range(5):
                before = time.monotonic()
                snapshot = bridge.evaluate('''(()=>{const page=document.querySelector('[data-testid="onboarding-page"]'),loading=document.querySelector('[data-testid="root-startup-loading"]');return{ok:document.readyState==='complete'&&!!page&&page.getClientRects().length>0&&(!loading||!loading.getClientRects().length),readyState:document.readyState,visible:document.visibilityState,focused:document.hasFocus()}})()''')
                assert snapshot['ok']
                samples.append({'index': index, 'latencySeconds': round(time.monotonic() - before, 3), **snapshot})
                time.sleep(.5)
            facts['startupSamples'] = samples
            empty = control('/proof')
            assert empty['modelCalls'] == empty['ledger']['count'] == 0
            facts['startupProof'] = empty
            facts['checks'].append('cold-start-original-role-page-responsive-five-samples-zero-models')
            raise StartupProbeComplete()
        for action in ['select_developer', 'next_role', 'select_coding', 'next_mode', 'finish']:
            first.phase(action)
            facts['actions'].append(action)
            time.sleep(.3)
        until('''(()=>({ok:!!document.querySelector('[data-testid="enterprise-identity-name"]')&&document.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()==='project'}))()''')
        facts['checks'].append('original-onboarding-restored-identity-and-workspace')
        if protocol_only:
            runpy.run_path(str(Path(__file__).with_name('protocol.py')))['run_protocol'](
                docker, container, bridge, control, until, facts, work, protocol_hold_seconds)
            raise StartupProbeComplete()
        # 原工作区行只在 hover/focus 后挂载文件树按钮，先执行真实指针移动。
        point = until('''(()=>{const e=document.querySelector('[data-testid="workspace-item-/work/project"]');if(!e)return{ok:false};const r=e.getBoundingClientRect();return{ok:!!r.width&&!!r.height,x:r.x+r.width/2,y:r.y+r.height/2}})()''')
        bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
        facts['actions'].append('hover-original-workspace-row')
        click('workspace-file-tree-button-/work/project')
        click('workspace-file-tree-row-/work/project/sentinel.txt')
        facts['filePreview'] = until(preview)
        facts['checks'].append('original-renderer-host-file-preview')
        # 预览 tab 由模块内 Map 记忆，不跨 document；重载恢复身份/工作区后沿原入口重新读文件。
        bridge.raw_cdp('Page.reload')
        until('''(()=>({ok:!!document.querySelector('[data-testid="enterprise-identity-name"]')&&document.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()==='project'}))()''')
        point = until('''(()=>{const e=document.querySelector('[data-testid="workspace-item-/work/project"]');if(!e)return{ok:false};const r=e.getBoundingClientRect();return{ok:!!r.width&&!!r.height,x:r.x+r.width/2,y:r.y+r.height/2}})()''')
        bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
        facts['actions'].append('hover-restored-workspace-row')
        click('workspace-file-tree-button-/work/project')
        click('workspace-file-tree-row-/work/project/sentinel.txt')
        facts['restoredFilePreview'] = until(preview)
        facts['checks'].append('renderer-reload-restores-identity-workspace-and-file-entry')
        if pty:
            assert control('/terminal-proof')['exists'] is False
            click('terminal-toggle')
            click('original-terminal-screen', '[data-testid="terminal"] .xterm-screen')
            until("""(()=>({ok:document.activeElement?.matches('textarea.xterm-helper-textarea')}))()""")
            command = r"""printf 'LINUX_PTY_WRITE_OK\n' > /work/project/terminal-proof.txt; pwd >> /work/project/terminal-proof.txt; tty >> /work/project/terminal-proof.txt; printf '%s\n' "$$" >> /work/project/terminal-proof.txt"""
            bridge.raw_cdp('Input.insertText', text=command)
            bridge.raw_cdp('Input.dispatchKeyEvent', type='keyDown', key='Enter', code='Enter', windowsVirtualKeyCode=13, text='\r')
            bridge.raw_cdp('Input.dispatchKeyEvent', type='keyUp', key='Enter', code='Enter', windowsVirtualKeyCode=13)
            facts['actions'].append('type-owned-terminal-command-and-enter-once')
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                terminal_proof = control('/terminal-proof')
                if terminal_proof.get('markerMatches') and terminal_proof.get('liveTtyMatches'):
                    break
                time.sleep(.2)
            facts['terminalProof'] = terminal_proof
            assert terminal_proof.get('markerMatches') and terminal_proof.get('liveTtyMatches')
            assert terminal_proof['cwd'] == terminal_proof['shellCwd'] == '/work/project'
            assert terminal_proof['tty'].startswith('/dev/pts/')
            facts['checks'].append('original-terminal-ui-pty-input-and-owned-file-side-effect')
            click('terminal-close-button')
            facts['terminalHidden'] = until("""(()=>{const panels=[...document.querySelectorAll('[data-panel][id="terminal"]')].filter(e=>e.querySelector('.xterm-helper-textarea')),e=panels.length===1?panels[0]:null,height=e?.getBoundingClientRect().height??-1;return{ok:!!e&&height<1,panelCount:panels.length,panelHeight:height,documentVisible:document.visibilityState,focused:document.hasFocus()}})()""")
            assert control('/terminal-proof') == terminal_proof
            click('terminal-toggle')
            facts['terminalReopened'] = until("""(()=>{const panels=[...document.querySelectorAll('[data-panel][id="terminal"]')].filter(e=>e.querySelector('.xterm-helper-textarea')),e=panels.length===1?panels[0]:null,height=e?.getBoundingClientRect().height??-1;return{ok:!!e&&height>=140,panelCount:panels.length,panelHeight:height,documentVisible:document.visibilityState,focused:document.hasFocus()}})()""")
            assert control('/terminal-proof') == terminal_proof
            facts['checks'].append('terminal-panel-hide-reopen-retains-same-live-pty')
            click('terminal-close-button')
        until('''(()=>({ok:document.querySelector('[data-testid="chat-model-select-trigger"]')?.innerText.includes('Linux 联动受控模型')}))()''')
        baseline = control('/proof')
        assert baseline['modelCalls'] == 0 and baseline['ledger']['count'] == 0
        facts['baseline'] = baseline
        click('original-composer', '[data-testid="v4-composer"] [contenteditable="true"]')
        bridge.raw_cdp('Input.insertText', text='请简短回复，确认 Linux 客户端真实联动，不使用工具。')
        click('v4-composer-send')
        terminal = until('''(()=>{const reply=document.body.innerText.includes('LINUX_DESKTOP_LINK_OK'),error=document.querySelector('[data-testid="chat-error-banner"]')?.innerText??'';return{ok:(reply||!!error)&&!document.querySelector('[data-testid="v4-stop"]'),reply,error:error.slice(0,300)}})()''', 60)
        facts['terminal'] = terminal
        facts['requestSizes'] = control('/request-sizes')
        assert terminal['reply'], 'Original allowed send ended with an error'
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            result = control('/proof')
            if result['modelCalls'] == 2 and result['ledger']['settled'] == 2:
                break
            time.sleep(.2)
        assert result['modelCalls'] == result['ledger']['count'] == result['ledger']['settled'] == 2
        assert result['ledger']['owned'] and result['ledger']['amount'] == 44
        assert result['rejectedSupplierRequests'] == 0 and result['workingDirectories'] == ['/work/project']
        facts['modelProof'] = result
        facts['checks'].append('original-packaged-send-backend-supplier-and-ledger')
        runtime = control('/runtime')
        facts['runtimeProof'] = runtime
        # CLI 改写 process.title 后 argv 会丢失脚本路径；绑定原生产 spawn preflight/started 到活 PID。
        logged = docker('logs', container)
        preflights, starts = {}, []
        for line in (logged.stdout + logged.stderr).splitlines():
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
        candidates = []
        for started_cli in starts:
            preflight = preflights.get(started_cli['workspaceKey'])
            if not preflight or preflight['args'] != [app_root + '/resources/glm/zcode.cjs', 'app-server', '--stdio', '--surface', 'desktop']:
                continue
            for live in runtime['processes']:
                if live['pid'] == started_cli['pid'] and live['cwd'] == '/work/project' and live['executable'] == app_root + '/zcode-preview':
                    candidates.append({**live, 'productionSpawnArgumentsMatch': True})
        facts['verifiedCliProcesses'] = candidates
        assert candidates, 'Original packaged CLI spawn must bind to live executable and cwd'
        facts['checks'].append('live-packaged-cli-process-and-workspace')
        if ordinary_user:
            ready = json.loads((work / 'backend-ready.json').read_text())
            pids = {ready['backendPid'], ready['desktopPid'], *(row['pid'] for row in runtime['processes'])}
            if pty:
                pids.add(facts['terminalProof']['shellPid'])
            identities = []
            for pid in sorted(pids):
                status = docker('exec', container, 'cat', f'/proc/{pid}/status').stdout
                fields = {line.split(':', 1)[0]: line.split(':', 1)[1].split()
                          for line in status.splitlines() if line.startswith(('Uid:', 'Gid:'))}
                assert fields['Uid'] == fields['Gid'] == ['1000'] * 4
                identities.append({'pid': pid, 'uids': fields['Uid'], 'gids': fields['Gid']})
            facts['ordinaryProcessIdentities'] = identities
            facts['checks'].append('backend-desktop-host-agent-and-pty-real-uid-gid-1000')
        assert control('/revoke-seat', post=True)['revoked']
        click('original-composer-after-seat-revocation', '[data-testid="v4-composer"] [contenteditable="true"]')
        bridge.raw_cdp('Input.insertText', text='LINUX_REVOKED_SEAT 请再次简短回复。')
        click('v4-composer-send')
        facts['seatDenial'] = until('''(()=>{const e=document.querySelector('[data-testid="chat-error-banner"]'),text=e?.innerText??'';return{ok:!!e&&e.getClientRects().length>0&&['登录','席位','权限'].every(word=>text.includes(word))&&!document.querySelector('[data-testid="v4-stop"]'),message:text.slice(0,300)}})()''', 45)
        after_denial = control('/proof')
        assert after_denial == result, 'Revoked seat must not dispatch or add accounting'
        facts['afterSeatDenial'] = after_denial
        facts['checks'].append('original-send-after-seat-revocation-no-model-or-ledger-delta')
        if protocol:
            runpy.run_path(str(Path(__file__).with_name('protocol.py')))['run_protocol'](
                docker, container, bridge, control, until, facts, work, protocol_hold_seconds)
        shot = bridge.raw_cdp('Page.captureScreenshot', format='png')
        (evidence / 'final-ui.png').write_bytes(base64.b64decode(shot['data']))
        facts['status'] = 'passed'
    except StartupProbeComplete:
        facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
        if docker('container', 'inspect', container, check=False).returncode == 0:
            facts['ownedProcessStates'] = docker('exec', container, 'ps', '-eo', 'pid,ppid,stat,pcpu,comm', check=False, timeout=5).stdout[-5000:]
            response = docker('exec', container, 'curl', '-fsS', '--max-time', '3', 'http://127.0.0.1:9222/json/version', check=False, timeout=5)
            facts['directCdpHttp'] = {'exitCode': response.returncode, 'response': response.stdout[:1500], 'stderr': response.stderr[:300]}
            if appimage:
                if native_diagnostics:
                    capture = docker('exec', container, 'scrot', '-o', '/work/failure-native.png', check=False, timeout=5)
                    facts['nativeCaptureExitCode'] = capture.returncode
                    if (work / 'failure-native.png').exists():
                        shutil.copyfile(work / 'failure-native.png', evidence / 'failure-native.png')
                    ready_path = work / 'backend-ready.json'
                    if ready_path.exists() and ready_path.stat().st_size:
                        pid = json.loads(ready_path.read_text()).get('electronPid')
                        if isinstance(pid, int):
                            stack = docker('exec', '--user', '0', container, 'gdb', '--batch', '-nx',
                                '-iex', 'set auto-load safe-path /no-owned-debug-scripts', '-iex', 'set debuginfod enabled off',
                                '-ex', 'set print frame-arguments none', '-ex', 'thread apply all bt 12', '-p', str(pid),
                                check=False, timeout=15)
                            (evidence / 'owned-native-stack.log').write_text(stack.stdout + stack.stderr)
                            facts['nativeStackExitCode'] = stack.returncode
                windows = docker('exec', container, 'xdotool', 'search', '--onlyvisible', '--name', '.', check=False, timeout=5).stdout.split()[:8]
                facts['failureNativeWindows'] = [{'id': window,
                    'title': docker('exec', container, 'xdotool', 'getwindowname', window, check=False, timeout=5).stdout.strip(),
                    'properties': docker('exec', container, 'xprop', '-id', window, '_NET_WM_WINDOW_TYPE', '_NET_WM_STATE', 'WM_TRANSIENT_FOR', check=False, timeout=5).stdout[:500]} for window in windows]
        if bridge:
            try:
                facts['failureUi'] = bridge.evaluate('''(()=>({text:document.body.innerText.slice(0,4000),controls:[...document.querySelectorAll('[data-testid]')].filter(e=>e.getClientRects().length).map(e=>e.dataset.testid).slice(0,100)}))()''')
                shot = bridge.raw_cdp('Page.captureScreenshot', format='png')
                (evidence / 'failure-ui.png').write_bytes(base64.b64decode(shot['data']))
            except Exception as diagnostic_error:
                facts['diagnosticFailure'] = str(diagnostic_error)[:200]
    finally:
        if tunnel and tunnel.poll() is None:
            try:
                facts['beforeShutdown'] = control('/proof')
                facts['finalRequestSizes'] = control('/request-sizes')
                facts['shutdownAcknowledged'] = control('/shutdown', post=True).get('closing') is True
            except Exception as shutdown_error:
                facts['shutdownFailure'] = str(shutdown_error)[:200]
        if bridge:
            bridge.kill()
        if tunnel:
            if tunnel.poll() is None:
                tunnel.terminate()
                try:
                    tunnel.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    tunnel.kill()
                    tunnel.wait(timeout=5)
            facts['tunnelExited'] = tunnel.returncode is not None
        if docker('container', 'inspect', container, check=False).returncode == 0:
            ready = work / 'backend-ready.json'
            try:
                # 子进程启动失败可能留下已创建但未写完的文件，不能因此跳过后续日志和资源清理。
                ready_state = json.loads(ready.read_text())
            except (OSError, ValueError):
                ready_state = None
            if ready_state:
                pid = ready_state['backendPid']
                if not facts.get('shutdownAcknowledged'):
                    docker('exec', container, 'kill', '-TERM', str(pid), check=False)
                try:
                    facts['containerExitCode'] = int(docker('wait', container, timeout=25).stdout.strip())
                except subprocess.TimeoutExpired:
                    facts['cleanupTimeout'] = True
            else:
                state = json.loads(docker('inspect', container).stdout)[0]['State']
                if not state['Running']:
                    facts['containerExitCode'] = state['ExitCode']
            (evidence / 'container.log').write_text(docker('logs', container, check=False).stdout + docker('logs', container, check=False).stderr)
            docker('rm', '-f', container)
        if created_volume:
            docker('volume', 'rm', volume)
        if created_network:
            docker('network', 'rm', network)
        facts['containerAbsent'] = docker('container', 'inspect', container, check=False).returncode != 0
        facts['volumeAbsent'] = docker('volume', 'inspect', volume, check=False).returncode != 0
        facts['networkAbsent'] = docker('network', 'inspect', network, check=False).returncode != 0
        if facts.get('containerExitCode') != 0 or facts.get('cleanupTimeout'):
            facts['status'] = 'failed'
        for file in ['backend-ready.json', 'backend-final-proof.json']:
            if (work / file).exists():
                shutil.copyfile(work / file, evidence / file)
        try:
            final_proof = json.loads((work / 'backend-final-proof.json').read_text())
            facts['finalProofMatches'] = final_proof == facts.get('beforeShutdown')
        except (OSError, ValueError):
            facts['finalProofMatches'] = False
        if not facts['finalProofMatches']:
            facts['status'] = 'failed'
        facts['totalSeconds'] = round(time.monotonic() - started, 3)
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--pty', action='store_true')
    parser.add_argument('--installed', action='store_true')
    parser.add_argument('--startup-only', action='store_true')
    parser.add_argument('--ordinary-user', action='store_true')
    parser.add_argument('--image')
    parser.add_argument('--protocol', action='store_true')
    parser.add_argument('--appimage', action='store_true')
    parser.add_argument('--protocol-only', action='store_true')
    parser.add_argument('--trace-lifetime', action='store_true')
    parser.add_argument('--window-manager', action='store_true')
    parser.add_argument('--protocol-hold-seconds', type=int, default=0)
    parser.add_argument('--native-diagnostics', action='store_true')
    args = parser.parse_args()
    raise SystemExit(0 if run(args.name, args.pty, args.installed, args.startup_only, args.ordinary_user, args.image, args.protocol, args.appimage, args.protocol_only, args.trace_lifetime, args.window_manager, args.protocol_hold_seconds, args.native_diagnostics) else 1)
