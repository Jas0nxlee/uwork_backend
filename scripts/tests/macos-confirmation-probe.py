"""Finite owned macOS second-instance/NSAlert check; default is prepare-only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import socket
import subprocess
import threading
import time
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[2]
NODE = '/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
NATIVE = runpy.run_path(str(REPO / 'scripts/tests/native-g04k-cdp-probe.py'))
OLD = runpy.run_path(str(REPO / 'scripts/tests/native-packaged-runtime-probe.py'))


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def collect_native_confirmation_candidates(ax, refs, collections):
    candidates, projection = [], []
    collected, seen_roots, seen_candidates = {}, set(), set()
    def collect(element):
        if element not in collected:
            nodes = ax['collect'](element, max_depth=12, max_nodes=400)
            collections.append(nodes)
            collected[element] = nodes
        return collected[element]
    for element in refs:
        if element in seen_roots:
            continue
        seen_roots.add(element)
        container = ax['describe'](element)
        nodes = collect(element)
        projection.append({'container': container, 'nodes': [info for _, info in nodes]})
        for child, info in nodes:
            if info.get('role') != 'AXSheet' and info.get('subrole') not in ('AXDialog', 'AXSystemDialog'):
                continue
            if child not in seen_candidates:
                seen_candidates.add(child)
                candidates.append((child, collect(child)))
    return candidates, projection


def classify_executable_census(rows, executable, main_pid):
    classified = []
    for row in rows:
        mapped = 'n' + executable in row['mappedTxt'].splitlines()
        reason = ('original-main' if row['pid'] == main_pid else 'unresolved-executable-mapping') if mapped else 'not-exact-executable-txt'
        classified.append({**row, 'mapsExactExecutableTxt': mapped, 'classification': reason})
    return classified


class Fixture(NATIVE['Fixture']):
    def __init__(self, plan, evidence):
        self.profile, self.events, self.lock = plan['profile'], [], threading.Lock()
        self.child = subprocess.Popen([NODE, '--import', 'tsx', plan['fixturePath']], cwd=REPO,
            env={'PATH': str(Path(NODE).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin',
                 'HOME': str(evidence / 'controller-home'), 'TMPDIR': str(evidence / 'controller-tmp'),
                 'UWORK_NATIVE_FIXTURE_NAME': self.profile, 'UWORK_NATIVE_CLIENT_EXPERIENCE': 'enabled',
                 'UWORK_NATIVE_CONFIGURATION_WITNESS': 'enabled',
                 'UWORK_NATIVE_PACKAGED_MANIFEST': plan['runtime']['manifestPath']},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert plan['status'] == 'prepared-not-run' and plan['profile'].startswith('client-native-macos-confirmation-')
    assert plan['profile'].replace('-', '').isalnum()
    assert Path(plan['preparationRoot']).resolve() == REPO / 'data/sandbox-verification' / plan['profile']
    assert Path(plan['fixturePath']).resolve() == Path(plan['preparationRoot']) / 'fixture.mjs'
    assert digest(plan['fixturePath']) == plan['compiledFixtureSha256']
    assert digest(plan['runtime']['manifestPath']) == plan['manifestSha256']
    for path, expected in plan['sources'].items():
        assert digest(REPO / path) == expected, 'Prepared source changed: ' + path
    if not args.run:
        print(json.dumps({'status': 'prepared-not-run', 'profile': plan['profile'], 'fixtureHashVerified': True}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation), 'Root must review this exact prepared plan before GUI'
    manifest = json.loads(Path(plan['runtime']['manifestPath']).read_text())
    app = Path(plan['runtime']['appPath'])
    assert app.resolve() == app and str(app).startswith('/Users/ljp/Library/Caches/uwork-backend/client-macos-package-')
    for path, expected in manifest['runtimeFiles'].items():
        assert digest(app / 'Contents/Resources' / path) == expected['sha256']
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
    evidence, root = REPO / 'evidence' / plan['profile'], REPO / 'data' / plan['profile']
    assert not evidence.exists() and not root.exists(), 'Fresh native profile required'
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(mode=0o700)
    facts = {'status': 'failed', 'checks': [], 'actions': [], 'preparationSha256': digest(args.preparation)}
    f = bridge = guard = None
    main_pid = None
    main_birth = None
    known = set()
    meta = {}
    errors = []
    started = time.monotonic()
    # The existing AX implementation is loaded only after explicit --run.
    ax = runpy.run_path(str(REPO / 'scripts/tests/macos-ax-driver.py'))

    def budget():
        assert time.monotonic() - started < 240, 'Finite macOS test budget exceeded'
        if f:
            assert f.child.poll() is None, 'Owned fixture exited early'

    def main_guard():
        budget()
        birth = subprocess.run(['ps', '-p', str(main_pid), '-o', 'lstart='], capture_output=True, text=True, check=True).stdout.strip()
        assert birth and birth == main_birth, 'Original Main generation changed'
        mapped = subprocess.run(['lsof', '-nP', '-a', '-p', str(main_pid), '-d', 'txt', '-Fn'], capture_output=True, text=True, check=True).stdout
        assert 'n' + plan['runtime']['executable'] in mapped.splitlines(), 'Dialog PID must map the exact owned executable'

    def main_census():
        main_guard()
        found = subprocess.run(['lsof', '-t', plan['runtime']['executable']], capture_output=True, text=True).stdout.split()
        rows = []
        for pid in sorted(set(map(int, found))):
            summary = subprocess.run(['ps', '-p', str(pid), '-o', 'ppid=,lstart=,command='], capture_output=True, text=True).stdout.strip()
            mapped = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-d', 'txt', '-Fn'], capture_output=True, text=True).stdout
            rows.append({'pid': pid, 'ppidBirthCommand': summary, 'mappedTxt': mapped})
        classified = classify_executable_census(rows, plan['runtime']['executable'], main_pid)
        snapshot = {'seconds': round(time.monotonic() - started, 3), 'mainPid': main_pid, 'candidates': classified}
        observations = facts.setdefault('executableCensusObservations', [])
        if len(observations) < 2:
            observations.append(snapshot)
        else:
            observations[-1] = snapshot
        (evidence / 'executable-census.json').write_text(json.dumps(observations, indent=2) + '\n')
        result = [row['pid'] for row in classified if row['mapsExactExecutableTxt']]
        assert sorted(result) == [main_pid], 'Only original owned Main may remain after secondary ACK'
        return result

    def until(expression, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            budget()
            value = bridge.evaluate(expression)
            if value.get('ok'):
                return value
            time.sleep(.15)
        facts['lastPublicProjection'] = value
        raise AssertionError('Original public UI did not reach the required state')

    def workspace(expected):
        basename = Path(expected).name
        view = bridge.evaluate('''(()=>{const d=document.querySelector('[data-testid="composer-workspace-trigger"]'),p=document.querySelector('[data-testid="workspace-path"]');return{draft:d?.innerText.trim()??null,path:p?.getAttribute('aria-label')??null}})()''')
        assert view['draft'] == basename or (view['path'] and expected in view['path']), 'Original workspace UI must select the owned directory'
        settings = json.loads((root / 'data/.uwork/v2/setting.json').read_text())
        tabs = settings.get('lastWorkspaceSession', [])
        index = settings.get('lastActiveTabIndex')
        assert isinstance(index, int) and 0 <= index < len(tabs) and tabs[index].get('workspacePath') == expected
        return {'ui': view, 'activeIndex': index, 'activeWorkspace': tabs[index]}

    def wait_workspace(expected):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            budget()
            try:
                return workspace(expected)
            except (AssertionError, FileNotFoundError, json.JSONDecodeError):
                time.sleep(.2)
        raise AssertionError('Original UI and persisted active workspace did not agree')

    def meter():
        result = f.command('packagedRuntimeProof')['facts']
        return {key: result[key] for key in ['modelCalls', 'own', 'other']}

    def launch(role):
        result = f.command('ownedUriLaunch', role=role)['launch']
        assert result['primaryPid'] == main_pid
        known.add(result['pid'])
        return result

    def exit_receipt(role):
        value = f.wait_event(lambda row: row.get('event') == 'owned-uri-exit' and row.get('role') == role, 12, 'natural URI ACK exit')
        assert value['closed'] and not value['timedOut'] and value['exitCode'] == 0 and value['signal'] is None
        assert value['primaryPid'] == main_pid and value['originalMainStillOwned']
        return value

    def native_dialog(target, press=None, expected_frame=None):
        main_guard()
        application = ax['element'](main_pid)
        arrays = []
        collections = []
        try:
            windows, code = ax['attribute_element'](application, ax['WINDOWS'])
            assert code == 0 and windows, 'Owned AX windows unavailable'
            arrays.append(windows)
            cf = ax['_CF']
            window_refs = [cf.CFArrayGetValueAtIndex(windows, i) for i in range(cf.CFArrayGetCount(windows))]
            sheet_refs = []
            for window in window_refs:
                sheets, _ = ax['attribute_element'](window, ax['SHEETS'])
                if sheets:
                    arrays.append(sheets)
                    sheet_refs.extend(cf.CFArrayGetValueAtIndex(sheets, i) for i in range(cf.CFArrayGetCount(sheets)))
            refs = window_refs + sheet_refs
            matches = []
            candidates, projection = collect_native_confirmation_candidates(ax, refs, collections)
            for element, nodes in candidates:
                texts = '\n'.join(str(info.get(key, '')) for _, info in nodes for key in ['title', 'value', 'description'])
                prompts = ['是否在 UWork 中打开此文件夹？', 'Open this folder in UWork?']
                if target not in texts or not any(prompt in texts for prompt in prompts):
                    continue
                labels = ['打开文件夹', '取消'] if prompts[0] in texts else ['Open folder', 'Cancel']
                buttons = {label: [(node, info) for node, info in nodes if info.get('role') == 'AXButton' and info.get('title') == label] for label in labels}
                if not all(len(hits) == 1 for hits in buttons.values()):
                    continue
                frame = ax['frame'](element)
                assert frame and frame['Width'] > 0 and frame['Height'] > 0
                matches.append((frame, buttons, labels))
            if len(matches) != 1:
                observations = facts.setdefault('unmatchedOwnedNativeDialogObservations', [])
                observation = {'seconds': round(time.monotonic() - started, 3),
                               'pid': main_pid, 'windows': len(window_refs),
                               'sheets': len(sheet_refs), 'projection': projection}
                if len(observations) < 2:
                    observations.append(observation)
                else:
                    observations[-1] = observation
                (evidence / 'unmatched-owned-native-dialog.json').write_text(json.dumps(observations, indent=2) + '\n')
                return None
            frame, buttons, labels = matches[0]
            result = {'pid': main_pid, 'frame': frame, 'target': target, 'labels': labels,
                      'buttons': {label: hits[0][1] for label, hits in buttons.items()}}
            if expected_frame:
                assert all(abs(frame[key] - expected_frame[key]) <= .5 for key in frame), 'Original native sheet frame changed'
            if press:
                label = labels[1] if press == 'cancel' else labels[0]
                node, info = buttons[label][0]
                assert info.get('enabled') is True and info.get('frame') and ax['PRESS'] in ax['action_names'](node)
                main_guard()
                assert ax['perform'](node, ax['PRESS']) == 0, 'Exact owned native AXPress failed'
                result['pressed'] = label
            return result
        finally:
            for nodes in collections:
                ax['release_all'](nodes)
            for value in arrays:
                ax['release'](value)
            ax['release'](application)

    try:
        assert ax['trusted'](), 'BLOCKED: existing Accessibility permission required; no consent flow is authorized'
        guard = OLD['OsGuard'](protocol_only=True)
        facts['osGuardBefore'] = guard.ready
        assert guard.ready['usesSystemClipboard'] is False
        known.add(guard.child.pid)
        f = Fixture(plan, evidence)
        known.add(f.child.pid)
        f.wait_event(lambda row: row.get('event') == 'ready', 120, 'fresh owned backend')
        meta = json.loads((evidence / 'desktop-state.json').read_text())
        assert not meta['copiedProductionMain'] and meta['packagedRuntime']['manifestPath'] == plan['runtime']['manifestPath']
        assert Path(meta['root']).resolve() == root and Path(meta['home']).resolve() == root / 'data'
        baseline_dir, target = root / 'project 基线', root / '确认 中文 空格'
        for path in [baseline_dir, target]:
            path.mkdir(mode=0o700)
            subprocess.run(['/usr/bin/git', 'init', '--quiet', str(path)], check=True, capture_output=True)
        f.send({'op': 'launch'})
        launched = f.wait_event(lambda row: row.get('event') == 'launched', 30, 'owned original Main')
        main_pid = launched['pid']
        known.add(main_pid)
        main_birth = subprocess.run(['ps', '-p', str(main_pid), '-o', 'lstart='], capture_output=True, text=True, check=True).stdout.strip()
        main_guard()
        bridge = OLD['HARNESS'](launched['cdpPort'], renderer_prefix='file://' + str(app).replace(' ', '%20') + '/Contents/Resources/app.asar/', evidence=evidence)
        f.command('openWorkspace', 20, workspacePath=str(baseline_dir))
        first = runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
        claimed = set()
        def claim(action, **kwargs):
            assert action not in claimed
            claimed.add(action)
            return True
        onboarding = first['FirstRunUi']('file-restored', bridge.evaluate, bridge.raw_cdp, lambda: 1, budget, claim, lambda: False, press_release_only=True)
        for step in first['ONBOARDING_STEPS']:
            expected = {'select_developer': 'role', 'next_role': 'role', 'select_coding': 'mode', 'next_mode': 'mode', 'finish': 'preferences'}[step]
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                state = onboarding.phase('observe')
                if state['step'] == expected and not state['startupLoadingVisible'] and not state['loginVisible']:
                    break
                time.sleep(.15)
            else:
                raise AssertionError('Original onboarding phase unavailable')
            onboarding.phase(step)
            facts['actions'].append(step)
        until('''(()=>({ok:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText==='企业用户甲'}))()''')
        facts['baselineWorkspace'] = wait_workspace(str(baseline_dir))
        baseline = meter()
        facts['baselineAccounting'] = baseline
        facts['checks'].append('original-v7-native-owned-main-and-real-baseline-project')
        launch('cancel')
        deadline = time.monotonic() + 10
        held = None
        while time.monotonic() < deadline:
            held = native_dialog(str(target))
            if held:
                break
            time.sleep(.15)
        assert held, 'Original native confirmation sheet did not appear'
        facts['cancelAck'] = exit_receipt('cancel')
        hold_start = time.monotonic()
        sent = False
        samples = []
        while time.monotonic() - hold_start < 25:
            budget()
            if not sent and time.monotonic() - hold_start >= 8:
                launch('parallel-unknown')
                facts['parallelAck'] = exit_receipt('parallel-unknown')
                sent = True
            current = native_dialog(str(target), expected_frame=held['frame'])
            assert current and workspace(str(baseline_dir))
            samples.append({'seconds': round(time.monotonic() - hold_start, 3), 'mainPids': main_census()})
            time.sleep(.5)
        assert sent
        facts['heldSeconds'] = round(time.monotonic() - hold_start, 3)
        facts['heldNativeDialog'] = held
        facts['holdSamples'] = samples
        assert meter() == baseline
        facts['checks'].append('native-sheet-held-25s-two-natural-ack-exits-original-main-generation-only')
        facts['cancelPress'] = native_dialog(str(target), press='cancel', expected_frame=held['frame'])
        assert facts['cancelPress']
        facts['afterCancel'] = wait_workspace(str(baseline_dir))
        assert meter() == baseline
        facts['checks'].append('exact-owned-native-ax-cancel-preserves-original-project-zero-accounting')
        launch('confirm')
        facts['confirmAck'] = exit_receipt('confirm')
        deadline = time.monotonic() + 10
        confirmation = None
        while time.monotonic() < deadline:
            confirmation = native_dialog(str(target))
            if confirmation:
                break
            time.sleep(.15)
        assert confirmation
        facts['confirmPress'] = native_dialog(str(target), press='confirm', expected_frame=confirmation['frame'])
        assert facts['confirmPress']
        facts['afterConfirm'] = wait_workspace(str(target))
        assert meter() == baseline and main_census() == [main_pid]
        facts['checks'].append('exact-owned-native-ax-confirm-opens-chinese-space-project-zero-accounting')
        facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = {'type': type(error).__name__, 'message': str(error)[:1000]}
    finally:
        if f:
            try:
                facts['finalAccounting'] = meter()
                facts['launchers'] = f.command('ownedUriStatus')['launches']
                for row in facts['launchers']:
                    if row.get('pid'):
                        known.add(row['pid'])
                for row in OLD['owned_processes'](main_pid, str(app / 'Contents/Resources/glm/zcode.cjs')) if main_pid else []:
                    known.add(row['pid'])
                f.command('stopNative', 25)
            except Exception as error:
                errors.append('owned-stop:' + type(error).__name__)
        if bridge:
            try:
                bridge.kill()
                cleanup = json.loads((evidence / 'harness-cleanup.json').read_text())
                facts['harnessClosed'] = cleanup.get('socketClosed') is True and cleanup.get('daemonAbsent') is True
                if not facts['harnessClosed']:
                    errors.append('owned-harness-not-closed')
            except Exception as error:
                errors.append('owned-harness:' + type(error).__name__)
        if f and f.child.poll() is None:
            try:
                f.send({'op': 'close'})
            except Exception as error:
                errors.append('fixture-close-command:' + type(error).__name__)
            try:
                f.child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                f.child.terminate()
                try:
                    f.child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    f.child.kill(); f.child.wait(timeout=5)
                errors.append('fixture-required-forced-close')
        if f:
            facts['fixtureExitCode'] = f.child.returncode
            if f.child.returncode != 0:
                errors.append('fixture-exit-not-zero')
            record = evidence / 'cleanup.json'
            facts['originalFixtureCleanup'] = json.loads(record.read_text()) if record.exists() else None
            if not facts['originalFixtureCleanup'] or facts['originalFixtureCleanup'].get('errors') or not facts['originalFixtureCleanup'].get('serversClosed'):
                errors.append('original-fixture-cleanup-not-confirmed')
        if guard:
            try:
                facts['osRestored'] = guard.close()
                if not facts['osRestored'].get('protocolRestored') or facts['osRestored'].get('usesSystemClipboard') is not False:
                    errors.append('original-protocol-state-not-restored')
            except Exception as error:
                errors.append('os-guard:' + type(error).__name__)
        alive = []
        for pid in known:
            if subprocess.run(['ps', '-p', str(pid), '-o', 'pid='], capture_output=True, text=True).stdout.strip():
                alive.append(pid)
        facts['ownedPidsStillAlive'] = alive
        if alive:
            errors.append('owned-pids-still-live')
        closed = {}
        ports = {meta.get('cdpPort'), *[urlparse(meta.get(key, '')).port for key in ['origin', 'backendOrigin', 'supplierOrigin']]} - {None}
        for number in ports:
            with socket.socket() as probe:
                probe.settimeout(.5)
                closed[str(number)] = probe.connect_ex(('127.0.0.1', number)) != 0
        facts['ownedPortsClosed'] = closed
        if not all(closed.values()):
            errors.append('owned-port-still-open')
        facts['cleanupErrors'] = errors
        if errors:
            facts['status'] = 'failed'
        facts['seconds'] = round(time.monotonic() - started, 3)
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps({key: facts[key] for key in ['status', 'checks', 'failure', 'cleanupErrors', 'seconds'] if key in facts}))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--reviewed-plan-sha256')
    raise SystemExit(0 if run(parser.parse_args()) else 1)
