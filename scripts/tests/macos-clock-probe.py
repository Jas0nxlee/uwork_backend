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


def run(profile, manifest):
    assert profile.startswith('client-native-packaged-macos-clock-')
    assert profile.replace('-', '').isalnum()
    evidence, root = REPO / 'evidence' / profile, REPO / 'data' / profile
    assert not evidence.exists() and not root.exists()
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(mode=0o700)
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'observations': {}}
    checks, actions, observations = facts['checks'], facts['actions'], facts['observations']
    f = bridge = guard = None
    known = set()
    meta = {}
    errors = []

    def until(expression, label, seconds=45):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = bridge.evaluate(expression)
            if value.get('ok'):
                return value
            time.sleep(.2)
        observations['failedProjection'] = value
        observations['failedPublicUi'] = bridge.evaluate('''(()=>{const text=id=>document.querySelector('[data-testid="'+id+'"]')?.innerText?.slice(0,200)??null;return{ok:true,readyState:document.readyState,identity:text('enterprise-identity-name'),workspace:text('composer-workspace-trigger'),workspacePath:document.querySelector('[data-testid="workspace-path"]')?.getAttribute('aria-label')??null,login:!!document.querySelector('[data-testid="enterprise-login-page"]'),loading:!!document.querySelector('[data-testid="root-startup-loading"]'),tabs:[...document.querySelectorAll('[role="tab"]')].slice(0,20).map(e=>({text:e.innerText.slice(0,120),selected:e.getAttribute('aria-selected')})),body:document.body.innerText.slice(0,900)}})()''')
        settings = root / 'data/.uwork/v2/setting.json'
        if settings.exists():
            current_settings = json.loads(settings.read_text())
            observations['failedWorkspacePersistence'] = {key: current_settings.get(key) for key in ['recentProjects', 'lastWorkspaceSession', 'lastActiveTabIndex']}
        raise AssertionError(label)

    def click(selector, label):
        expression = '''(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length);if(es.length!==1)return{ok:false,count:es.length};const e=es[0];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:!!r.width&&!!r.height&&e.contains(document.elementFromPoint(x,y))&&!e.disabled,x,y}})()''' % json.dumps(selector)
        point = until(expression, label)
        for attempt in range(3):
            bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
            current = until(expression, label)
            if abs(point['x'] - current['x']) < .5 and abs(point['y'] - current['y']) < .5:
                point = current
                break
            observations.setdefault('pointerRelocations', []).append({'action': label, 'before': point, 'after': current})
            point = current
        else:
            raise AssertionError('Original target did not stabilize: ' + label)
        for kind in ['mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
        actions.append(label)

    def proof():
        result = f.command('packagedRuntimeProof')['facts']
        result.pop('shareUrl', None)
        return result

    def attach(launched):
        known.add(launched['pid'])
        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)
        url = urlparse(value.target)
        prefix = meta['packagedRuntime']['appPath'] + '/Contents/Resources/app.asar/'
        assert url.scheme == 'file' and unquote(url.path).startswith(prefix)
        return value

    try:
        guard = OLD['OsGuard'](protocol_only=True)
        known.add(guard.child.pid)
        assert guard.ready['usesSystemClipboard'] is False
        observations['osGuard'] = guard.ready
        original_popen = subprocess.Popen
        derived_launches = []

        def owned_fixture_popen(command, *positional, **kwargs):
            if isinstance(command, list) and command[-1:] == ['scripts/fixtures/client-native-enterprise.mjs']:
                assert command[:3] == [NATIVE['NODE24'], '--import', 'tsx']
                assert kwargs.get('cwd') == REPO
                command = command[:-1] + ['scripts/fixtures/macos-clock-derived.mjs']
                derived_launches.append(command)
            return original_popen(command, *positional, **kwargs)

        subprocess.Popen = owned_fixture_popen
        try:
            f = NATIVE['Fixture'](profile, evidence / 'controller-home', evidence / 'controller-tmp',
                                   mode='experience', packaged_manifest=manifest)
        finally:
            subprocess.Popen = original_popen
        assert len(derived_launches) == 1
        observations['derivedFixtureLaunch'] = derived_launches[0]
        known.add(f.child.pid)
        f.wait_event(lambda row: row.get('event') == 'ready', 180, 'fresh backend ready')
        meta = json.loads((evidence / 'desktop-state.json').read_text())
        assert not meta['copiedProductionMain']
        baseline = proof()
        assert baseline['modelCalls'] == 2 and baseline['own']['count'] == 0
        observations['baseline'] = baseline
        f.send({'op': 'launch'})
        launched = f.wait_event(lambda row: row.get('event') == 'launched', 120, 'original signed app launch')
        bridge = attach(launched)
        checks.append('latest-original-signed-package-renderer')
        workspace = root / 'packaged-workspace'
        workspace.mkdir(mode=0o700)
        subprocess.run(['git', 'init', '--quiet', str(workspace)], check=True)
        (workspace / 'sentinel.txt').write_text('MACOS_CLOCK_FILE_SENTINEL\n')
        f.command('openWorkspace', 60, workspacePath=str(workspace))
        first = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
        guards = NATIVE['Guards'](evidence)
        onboarding = first['FirstRunUi']('file-restored', bridge.evaluate, bridge.raw_cdp,
                                         guards.guard, guards.budget, guards.claim,
                                         guards.auth_started, press_release_only=True)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            view = onboarding.phase('observe')
            if view['step'] == 'role' and not view['loginVisible'] and not view['startupLoadingVisible']:
                break
            time.sleep(.2)
        else:
            raise AssertionError('Original restored identity onboarding not ready')
        for step in first['ONBOARDING_STEPS']:
            onboarding.phase(step)
        current = until('''(()=>{const n=document.querySelector('[data-testid="enterprise-identity-name"]'),m=document.querySelector('[data-testid="v4-model-config"][data-source="composer"]'),w=document.querySelector('[data-testid="composer-workspace-trigger"]');return{ok:n?.innerText==='企业用户甲'&&m?.getAttribute('data-model')===%s&&w?.innerText.trim()==='packaged-workspace',identity:n?.innerText,modelId:m?.getAttribute('data-model'),modelLabel:m?.innerText,workspace:w?.innerText}})()''' % json.dumps(meta['modelId']), 'Original identity/model/explicit workspace')
        observations['identityConfiguration'] = current
        checks.append('original-onboarding-identity-model-and-explicit-workspace')

        def open_file(label):
            selector = '[data-testid=' + json.dumps('workspace-item-' + str(workspace)) + ']'
            point = until('''(()=>{const e=document.querySelector(%s);if(!e)return{ok:false};const r=e.getBoundingClientRect();return{ok:!!r.width&&!!r.height,x:r.x+r.width/2,y:r.y+r.height/2}})()''' % json.dumps(selector), 'Owned workspace row')
            bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
            click('[data-testid=' + json.dumps('workspace-file-tree-button-' + str(workspace)) + ']', label + '-tree')
            click('[data-testid=' + json.dumps('workspace-file-tree-row-' + str(workspace / 'sentinel.txt')) + ']', label + '-file')
            return until('''(()=>{const p=document.querySelector('[data-testid="preview-pane"]');let n=0,found=false;function scan(root){for(const e of root.querySelectorAll('*')){if(++n>2000)throw Error('Preview bound');if(e.shadowRoot){if(e.getClientRects().length&&e.shadowRoot.textContent.includes('MACOS_CLOCK_FILE_SENTINEL'))found=true;scan(e.shadowRoot)}}}if(p)scan(p);return{ok:found,nodes:n}})()''', 'Original file preview content')

        observations['filePreview'] = open_file('first')
        settings = json.loads((root / 'data/.uwork/v2/setting.json').read_text())
        observations['beforeReloadWorkspacePersistence'] = {key: settings.get(key) for key in ['recentProjects', 'lastWorkspaceSession', 'lastActiveTabIndex']}
        bridge.raw_cdp('Page.reload')
        until('''(()=>({ok:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText==='企业用户甲'&&document.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()==='packaged-workspace'}))()''', 'Renderer reload restores identity/workspace')
        observations['reloadedFilePreview'] = open_file('reloaded')
        checks.append('original-file-tree-preview-and-renderer-reload')
        # 原文件树会把任务列表整屏滑出，身份按钮仍在 DOM 却处于负坐标。
        # 沿原“返回任务”入口恢复任务侧栏，再测试终端和后续账号菜单。
        click('[data-testid="workspace-file-tree-panel"] > div:first-child > button',
              'original-file-tree-back-to-tasks')
        marker = workspace / 'terminal-proof.txt'
        assert not marker.exists()
        click('[data-testid="terminal-toggle"]', 'original-terminal-open')
        observations['afterTerminalToggle'] = bridge.evaluate('''(()=>{const b=document.querySelector('[data-testid="terminal-toggle"]'),p=document.querySelector('[data-panel][id="terminal"]');return{ok:true,buttonClass:b?.className??null,buttonLabel:b?.getAttribute('aria-label')??null,panelCount:document.querySelectorAll('[data-panel][id="terminal"]').length,panelHeight:p?.getBoundingClientRect().height??null,terminalSections:document.querySelectorAll('[data-testid="terminal"]').length,xtermScreens:document.querySelectorAll('.xterm-screen').length}})()''')
        click('[data-testid="terminal"] .xterm-screen', 'original-xterm-focus')
        command = "printf 'MACOS_CLOCK_PTY_OK\\n' > " + shlex.quote(str(marker)) + '; pwd >> ' + shlex.quote(str(marker)) + '; tty >> ' + shlex.quote(str(marker)) + '; printf \'%s\\n\' "$$" >> ' + shlex.quote(str(marker))
        bridge.raw_cdp('Input.insertText', text=command)
        for kind in ['keyDown', 'keyUp']:
            bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='Enter', code='Enter', windowsVirtualKeyCode=13, nativeVirtualKeyCode=36)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            lines = marker.read_text().splitlines() if marker.exists() else []
            if len(lines) == 4:
                break
            time.sleep(.2)
        assert len(lines) == 4 and lines[0] == 'MACOS_CLOCK_PTY_OK'
        shell_pid = int(lines[3])
        known.add(shell_pid)
        tty = subprocess.run(['lsof', '-nP', '-a', '-p', str(shell_pid), '-d', '0', '-Fn'], capture_output=True, text=True, check=True).stdout
        cwd = subprocess.run(['lsof', '-nP', '-a', '-p', str(shell_pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True, check=True).stdout
        assert lines[1] == str(workspace) and lines[2].startswith('/dev/ttys')
        assert 'n' + lines[2] in tty.splitlines() and 'n' + str(workspace) in cwd.splitlines()
        observations['pty'] = {'shellPid': shell_pid, 'cwd': lines[1], 'tty': lines[2], 'liveKernelDescriptorsMatch': True}
        click('[data-testid="terminal-close-button"]', 'original-terminal-hide')
        click('[data-testid="terminal-toggle"]', 'original-terminal-reopen')
        assert marker.read_text().splitlines() == lines
        assert subprocess.run(['kill', '-0', str(shell_pid)]).returncode == 0
        click('[data-testid="terminal-close-button"]', 'original-terminal-hide-again')
        checks.append('original-xterm-real-shell-file-cwd-tty-and-panel-retention')
        editor = '[data-testid="v4-composer"] [contenteditable="true"]'
        click(editor, 'original-composer-focus')
        bridge.raw_cdp('Input.insertText', text='MACOS_CLOCK_LINK_20261020 请简短回复，不调用工具。')
        click('[data-testid="v4-composer-send"]', 'original-send-once')
        until('''(()=>({ok:document.body.innerText.includes('原生企业资产联动完成。')&&!document.querySelector('[data-testid="v4-stop"]')}))()''', 'Original model answer terminal', 75)
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            delivered = proof()
            assert delivered['modelCalls'] <= 4
            if delivered['own']['settled'] == 2:
                break
            time.sleep(.2)
        assert delivered['own'] == {'count': 2, 'settled': 2, 'amount': 44, 'inputTokens': 24, 'outputTokens': 20}
        assert delivered['other'] == baseline['other'] and delivered['modelCalls'] == 4
        assert delivered['modelWorkingDirectories'] == [str(workspace)]
        observations['afterSend'] = delivered
        rows = OLD['owned_processes'](launched['pid'], meta['packagedRuntime']['appPath'] + '/Contents/Resources/glm/zcode.cjs')
        known.update(row['pid'] for row in rows)
        observations['packagedCli'] = OLD['verify_packaged_cli'](evidence, meta['packagedRuntime']['appPath'], root, rows)
        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')
        f.command('memberSeat', value=False)
        click(editor, 'revoked-seat-composer-focus')
        bridge.raw_cdp('Input.insertText', text='MACOS_CLOCK_REVOKED_SEAT 不得新增调用或费用。')
        click('[data-testid="v4-composer-send"]', 'revoked-seat-original-send')
        observations['seatDenial'] = until('''(()=>{const e=document.querySelector('[data-testid="chat-error-banner"]'),s=e?.innerText??'';return{ok:!!e&&e.getClientRects().length>0&&['登录','席位','权限'].every(v=>s.includes(v))&&!document.querySelector('[data-testid="v4-stop"]'),message:s.slice(0,300)}})()''', 'Original revoked seat refusal')
        assert proof() == delivered
        checks.append('revoked-seat-original-send-zero-calls-and-ledger-delta')
        click('[data-testid="enterprise-identity-name"]', 'original-identity-menu')
        point = until('''(()=>{const es=[...document.querySelectorAll('[role="menuitem"]')].filter(e=>e.getClientRects().length&&e.innerText.trim()==='退出登录');if(es.length!==1)return{ok:false};const r=es[0].getBoundingClientRect();return{ok:true,x:r.x+r.width/2,y:r.y+r.height/2}})()''', 'Original logout item')
        for kind in ['mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
        actions.append('original-logout')
        signed_out = '''(()=>{const n=document.querySelector('[data-testid="enterprise-identity-name"]'),m=document.querySelector('[data-testid="v4-model-config"][data-source="composer"]'),entry=document.querySelector('[data-testid="enterprise-identity-entry"]');return{ok:!n&&!!entry&&m?.getAttribute('data-model')!==%s,identityVisible:!!n,entryVisible:!!entry,currentModelId:m?.getAttribute('data-model')??null}})()''' % json.dumps(meta['modelId'])
        observations['signedOut'] = until(signed_out, 'Original logout removes active identity/candidate')
        assert proof() == delivered
        f.command('stopNative', 25)
        bridge.kill()
        observations['firstHarnessCleanup'] = json.loads((evidence / 'harness-cleanup.json').read_text())
        assert observations['firstHarnessCleanup']['daemonAbsent'] and observations['firstHarnessCleanup']['socketClosed']
        bridge = None
        f.send({'op': 'launch'})
        cold = f.wait_event(lambda row: row.get('event') == 'launched' and row.get('pid') != launched['pid'], 120, 'same-profile cold launch without bootstrap')
        bridge = attach(cold)
        observations['coldSignedOut'] = until(signed_out, 'Cold launch must not resurrect enterprise identity/candidate', 60)
        assert proof() == delivered
        cold_rows = OLD['owned_processes'](cold['pid'], meta['packagedRuntime']['appPath'] + '/Contents/Resources/glm/zcode.cjs')
        known.update(row['pid'] for row in cold_rows)
        observations['coldOwnedProcesses'] = cold_rows
        observations['coldRestore'] = {'controllerPidUnchanged': f.child.pid, 'firstPid': launched['pid'], 'coldPid': cold['pid'], 'profileUnchanged': str(root), 'bootstrapOnlyAtControllerStartup': True, 'zeroAdditionalAccounting': True}
        checks.append('original-logout-same-controller-profile-cold-start-no-enterprise-resurrection')
        screenshot = bridge.raw_cdp('Page.captureScreenshot', format='png')
        (evidence / 'cold-ui.png').write_bytes(base64.b64decode(screenshot['data']))
        facts['status'] = 'passed'
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.profile, args.manifest.resolve()) else 1)
