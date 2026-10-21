"""Original signed Preview package -> real backend/Host/CLI -> share/OS clipboard."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import select
import socket
import subprocess
import time
from urllib.parse import unquote, urlparse
from native_workspace_evidence import validate_explicit_workspace

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / 'evidence/client-macos-package-v3-manifest-20261020.json'
MODULE = runpy.run_path(str(REPO / 'scripts/tests/native-g04k-cdp-probe.py'))
HARNESS = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge']


class OsGuard:
    def __init__(self, protocol_only=False):
        self.child = subprocess.Popen([str(REPO / 'data/native-os-state-guard-20261020/guard'), *(['--protocol-only'] if protocol_only else [])],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.ready = self.read()
            assert self.ready['hasProtocolHandler'], 'Existing protocol handler required for restoration'
        except BaseException:
            self.child.stdin.close()
            try:
                self.child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.child.terminate(); self.child.wait(timeout=5)
            raise

    def read(self):
        assert select.select([self.child.stdout], [], [], 10)[0], 'OS state guard timed out'
        return json.loads(self.child.stdout.readline())

    def command(self, op, **values):
        self.child.stdin.write(json.dumps({'op': op, **values}) + '\n')
        self.child.stdin.flush()
        return self.read()

    def close(self):
        result = self.command('restore')
        self.child.stdin.close()
        self.child.wait(timeout=10)
        return result


def owned_processes(main_pid, expected_cli):
    pending, visited, rows = [main_pid], set(), []
    while pending:
        pid = pending.pop()
        if pid in visited:
            continue
        visited.add(pid)
        assert len(visited) <= 64, 'Owned process tree exceeded bound'
        command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
        if command:
            rows.append({'pid': pid, 'packagedCli': expected_cli in command, 'commandBytes': len(command),
                         'packagedExecutable': '/UWork Preview.app/Contents/' in command})
            children = subprocess.run(['pgrep', '-P', str(pid)], capture_output=True, text=True).stdout.split()
            pending.extend(map(int, children))
    return rows


def verify_packaged_cli(evidence, app_path, root, rows):
    """Bind production spawn facts to a live owned PID and its mapped executable."""
    preflights, starts = {}, []
    for line in (evidence / 'electron.log').read_text().splitlines():
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
    for started in starts:
        preflight = preflights.get(started['workspaceKey'])
        if not preflight:
            continue
        expected_cli = app_path + '/Contents/Resources/glm/zcode.cjs'
        if preflight['args'] != [expected_cli, 'app-server', '--stdio', '--surface', 'desktop']:
            continue
        pid = started['pid']
        if pid not in {row['pid'] for row in rows}:
            continue
        mapped = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-d', 'txt', '-Fn'], capture_output=True, text=True)
        cwd = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True)
        facts = {'pid': pid, 'spawnArgumentsMatchPackagedCli': True,
                 'mappedPackagedExecutable': any(line.startswith('n' + app_path + '/Contents/') for line in mapped.stdout.splitlines()),
                 'cwdInsideOwnedProfile': any(line.startswith('n' + str(root) + '/') for line in cwd.stdout.splitlines()),
                 'workingDirectory': next((line[1:] for line in cwd.stdout.splitlines() if line.startswith('n' + str(root) + '/')), None)}
        if all(facts[key] for key in ['mappedPackagedExecutable', 'cwdInsideOwnedProfile']):
            candidates.append(facts)
    assert candidates, 'Package CLI launch must bind to a live owned process, executable mapping and cwd'
    return candidates


def run(profile, manifest=MANIFEST, workspace_only=False, external_browser=False):
    assert not (workspace_only and external_browser)
    assert profile.startswith('client-native-packaged-') and all(c.islower() or c.isdigit() or c == '-' for c in profile)
    evidence, root = REPO / 'evidence' / profile, REPO / 'data' / profile
    assert not evidence.exists() and not root.exists(), 'Fresh profile required'
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(mode=0o700)
    f = bridge = guard = None
    checks, actions, observations, cleanup_errors = [], [], {}, []
    meta, known_pids = {}, set()
    result = {'status': 'failed', 'profile': profile}
    try:
        guard = OsGuard(protocol_only=workspace_only or external_browser)
        observations['osGuard'] = guard.ready
        f = MODULE['Fixture'](profile, evidence / 'controller-home', evidence / 'controller-tmp',
                              mode='experience', packaged_manifest=manifest)
        known_pids.add(f.child.pid)
        f.wait_event(lambda e: e.get('event') == 'ready', 180, 'backend ready')
        meta = json.loads((evidence / 'desktop-state.json').read_text())
        assert not meta['copiedProductionMain'] and meta['packagedRuntime']['manifestPath'] == str(manifest)
        baseline = f.command('packagedRuntimeProof')['facts']
        assert baseline['modelCalls'] == 2 and baseline['own']['count'] == 0
        observations['baseline'] = {k: v for k, v in baseline.items() if k != 'shareUrl'}
        f.send({'op': 'launch'})
        launched = f.wait_event(lambda e: e.get('event') == 'launched', 120, 'packaged launch')
        known_pids.add(launched['pid'])
        bridge = HARNESS(launched['cdpPort'], evidence=evidence)
        url = urlparse(bridge.target)
        expected_root = meta['packagedRuntime']['appPath'] + '/Contents/Resources/app.asar/'
        assert url.scheme == 'file' and unquote(url.path).startswith(expected_root), 'Renderer must be loaded from the signed package'
        checks.append('signed-package-renderer-from-app-asar')

        def until(expression, label, seconds=45):
            deadline = time.monotonic() + seconds
            last = None
            while time.monotonic() < deadline:
                last = bridge.evaluate(expression)
                if last.get('ok'):
                    return last
                time.sleep(.2)
            observations['failedProjection'] = last
            raise AssertionError(label)

        def click(selector, label):
            point = bridge.evaluate('''(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length);if(es.length!==1)return{count:es.length};const e=es[0];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{count:1,x,y,hit:e.contains(document.elementFromPoint(x,y)),disabled:e.disabled||e.getAttribute('aria-disabled')==='true'}})()''' % json.dumps(selector))
            assert point.get('count') == 1 and point.get('hit') and not point.get('disabled'), label
            for kind in ('mousePressed', 'mouseReleased'):
                bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
            actions.append(label)

        workspace = root / 'packaged-workspace'
        workspace.mkdir(mode=0o700)
        subprocess.run(['git', 'init', '--quiet', str(workspace)], check=True)
        f.command('openWorkspace', 60, workspacePath=str(workspace))
        first = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
        guards = MODULE['Guards'](evidence)
        onboarding = first['FirstRunUi']('file-restored', bridge.evaluate, bridge.raw_cdp,
                                        guards.guard, guards.budget, guards.claim, guards.auth_started,
                                        press_release_only=True)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            view = onboarding.phase('observe')
            if view['step'] == 'role' and not view['loginVisible'] and not view['startupLoadingVisible']:
                break
            time.sleep(.2)
        else:
            observations['firstRun'] = view
            raise AssertionError('Packaged identity restore and onboarding not ready')
        for step in first['ONBOARDING_STEPS']:
            onboarding.phase(step)
        until('''(()=>{const n=document.querySelector('[data-testid="enterprise-identity-name"]'),m=document.querySelector('[data-testid="v4-model-config"][data-source="composer"]');return {ok:n?.innerText==='企业用户甲'&&m?.getAttribute('data-model')===%s,identityMatches:n?.innerText==='企业用户甲',modelMatches:m?.getAttribute('data-model')===%s,loginVisible:!!document.querySelector('[data-testid="enterprise-login-page"]')}})()''' % (json.dumps(meta['modelId']), json.dumps(meta['modelId'])), 'Packaged identity/model not ready')
        checks.append('original-first-run-and-restored-enterprise-identity-model')
        editor = '[data-testid="v4-composer"] [contenteditable="true"]'
        empty = bridge.evaluate('''(()=>({empty:!document.querySelector(%s)?.innerText.trim()}))()''' % json.dumps(editor))
        assert empty['empty']
        click(editor, 'focus-original-composer')
        prompt = 'PACKAGED-RUNTIME-20261020：请简短回复，不调用工具。'
        bridge.raw_cdp('Input.insertText', text=prompt)
        until('''(()=>{const b=document.querySelector('[data-testid="v4-composer-send"]');return{ok:!!b&&!b.disabled}})()''', 'Packaged Send not enabled')
        click('[data-testid="v4-composer-send"]', 'send-once')
        terminal = until('''(()=>{const t=document.body.innerText;return{ok:t.includes('原生企业资产联动完成。')&&!document.querySelector('[data-testid="v4-stop"]'),answerVisible:t.includes('原生企业资产联动完成。'),stopVisible:!!document.querySelector('[data-testid="v4-stop"]')}})()''', 'Packaged answer never completed', 75)
        checks.append('original-packaged-answer-visible-and-terminal')
        observations['terminal'] = terminal
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            delivered = f.command('packagedRuntimeProof')['facts']
            assert delivered['modelCalls'] <= 4, 'Packaged main/title request budget exceeded'
            if delivered['own']['settled'] == 2:
                break
            time.sleep(.3)
        assert delivered['own'] == {'count': 2, 'settled': 2, 'amount': 44, 'inputTokens': 24, 'outputTokens': 20}
        assert delivered['other'] == baseline['other']
        observations['afterSend'] = {k: v for k, v in delivered.items() if k != 'shareUrl'}
        cli = meta['packagedRuntime']['appPath'] + '/Contents/Resources/glm/zcode.cjs'
        rows = owned_processes(launched['pid'], cli)
        known_pids.update(row['pid'] for row in rows)
        observations['ownedProcesses'] = rows
        observations['packagedCliProof'] = verify_packaged_cli(evidence, meta['packagedRuntime']['appPath'], root, rows)
        checks.append('actual-packaged-cli-and-current-member-accounting')

        if workspace_only:
            observations['explicitWorkspace'] = {'requested': str(workspace),
                'modelWorkingDirectories': delivered['modelWorkingDirectories'],
                'processWorkingDirectories': [row['workingDirectory'] for row in observations['packagedCliProof']]}
            observations['workspaceVerdict'] = validate_explicit_workspace(
                str(workspace), delivered['modelWorkingDirectories'],
                [row['workingDirectory'] for row in observations['packagedCliProof']])
            checks.append('explicit-startup-workspace-retained-in-model-and-CLI-cwd')

        if not workspace_only:
            click('[data-testid="conversation-share-trigger"]', 'share-original-conversation')
            until('''(()=>{const b=document.querySelector('[data-testid="conversation-share-next"]');return{ok:!!b&&!b.disabled}})()''', 'Share selection not ready')
            click('[data-testid="conversation-share-next"]', 'share-next')
            until('''(()=>({ok:!!document.querySelector('[data-testid="conversation-share-disclosure-checkbox"]')}))()''', 'Share confirmation not ready')
            click('[data-testid="conversation-share-disclosure-checkbox"]', 'share-disclosure')
            until('''(()=>{const b=document.querySelector('[data-testid="conversation-share-confirm"]');return{ok:!!b&&!b.disabled}})()''', 'Share publish not enabled')
            click('[data-testid="conversation-share-confirm"]', 'publish-once')
            until('''(()=>({ok:!!document.querySelector('[data-testid="conversation-share-success-dock"]')}))()''', 'Share did not publish', 60)
            shared = f.command('packagedRuntimeProof')['facts']
            assert shared['shares'] == [{'status': 'confirmed', 'ownedByCurrentMember': True, 'artifacts': 0}]
            assert shared['own'] == delivered['own'] and shared['modelCalls'] == 4
            share_url = shared.pop('shareUrl')
            assert share_url.startswith(meta['origin'] + '/share/')
            observations['afterShare'] = shared
            checks.append('original-packaged-share-published-without-extra-models')
            if external_browser:
                from native_external_browser_ui import run_external_browser
                observations['externalBrowser'] = run_external_browser(bridge, click, until, evidence)
                after_external = f.command('packagedRuntimeProof')['facts']
                assert after_external['modelCalls'] == delivered['modelCalls'] and after_external['own'] == delivered['own']
                checks.append('original-default-browser-menu-delivered-and-owned-tab-closed')
            else:
                # 原 FirstRun 中文文案已验证当前界面语言；产品服务按语言返回 /cn/share/。
                localized_url = share_url.replace(meta['origin'] + '/share/', meta['origin'] + '/cn/share/', 1)
                assert guard.command('arm-copy', text=localized_url, canonical=share_url)['ok'], 'Clipboard could not be safely preserved'
                click('[data-testid="conversation-share-copy-link"]', 'copy-original-share-link')
                deadline = time.monotonic() + 3
                while True:
                    copied = guard.command('expect-copy', text=localized_url)
                    if copied['clipboardMatches'] or time.monotonic() >= deadline:
                        break
                    time.sleep(.05)
                assert copied['clipboardMatches'], 'OS clipboard does not match the confirmed share'
                observations['clipboard'] = {'matches': True, 'localizedPath': '/cn/share/<owned-code>', 'ownedUrlSha256': hashlib.sha256(localized_url.encode()).hexdigest()}
                checks.append('original-copy-button-writes-confirmed-url-to-OS-clipboard')
        result['status'] = 'passed'
    except Exception as error:
        result['failure'] = type(error).__name__ + ': ' + str(error)[:220]
    finally:
        if f:
            try:
                f.command('stopNative', 25)
            except Exception:
                cleanup_errors.append('stopNative-command-failed')
        if bridge:
            bridge.kill()
            harness_cleanup = json.loads((evidence / 'harness-cleanup.json').read_text())
            observations['harnessCleanup'] = harness_cleanup
            if not harness_cleanup.get('daemonAbsent') or not harness_cleanup.get('socketClosed'):
                cleanup_errors.append('browser-harness-not-closed')
        if f and f.child.poll() is None:
            f.child.terminate()
            try:
                f.child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                f.child.kill(); f.child.wait(timeout=5)
                cleanup_errors.append('fixture-required-kill')
        if f:
            result['fixtureExitCode'] = f.child.returncode
            if f.child.returncode != 0:
                cleanup_errors.append('fixture-exit-not-zero')
        if guard:
            try:
                restored = guard.close()
                observations['osRestore'] = restored
                if not restored['protocolRestored'] or restored['clipboard'] == 'restore-failed':
                    cleanup_errors.append('OS-restore-failed')
            except Exception:
                cleanup_errors.append('OS-guard-close-failed')
        remaining = subprocess.run(['ps', '-p', ','.join(map(str, sorted(known_pids))), '-o', 'pid='], capture_output=True, text=True).stdout.strip() if known_pids else ''
        if remaining:
            cleanup_errors.append('known-process-still-alive')
        closed = {}
        for port in {meta.get('cdpPort'), *[urlparse(meta.get(key, '')).port for key in ['origin', 'backendOrigin', 'supplierOrigin']]} - {None}:
            with socket.socket() as probe:
                probe.settimeout(.5)
                closed[str(port)] = probe.connect_ex(('127.0.0.1', port)) != 0
        if not all(closed.values()):
            cleanup_errors.append('owned-port-still-open')
        if cleanup_errors:
            result['businessPassed'] = result['status'] == 'passed'
            result['status'] = 'failed'
        result.update(checks=checks, actions=actions, observations=observations,
                      cleanup={'errors': cleanup_errors, 'knownPids': sorted(known_pids), 'knownPidsAbsent': not remaining, 'portsClosed': closed})
        (evidence / 'probe-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'observations'}, ensure_ascii=False))
    return result['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--manifest', type=Path, default=MANIFEST)
    parser.add_argument('--workspace-only', action='store_true')
    parser.add_argument('--external-browser', action='store_true')
    args = parser.parse_args()
    raise SystemExit(0 if run(args.profile, args.manifest.resolve(), args.workspace_only, args.external_browser) else 1)
