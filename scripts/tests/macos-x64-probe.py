"""Finite x64 extension of the original seven UI checks; never runs without exact reviewed plan."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import re
import stat

ROOT = Path(__file__).resolve().parents[2]
APP = Path('/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v8-x64/mac/UWork Preview.app')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()



def read_startup_projection(bridge):
    expression = """(()=>{const get=id=>document.querySelector('[data-testid="'+id+'"]'),visible=e=>!!e&&e.getClientRects().length>0,text=e=>(e?.innerText??'').trim().slice(0,180);return{readyState:document.readyState,visibilityState:document.visibilityState,startupLoadingVisible:visible(get('root-startup-loading')),onboardingVisible:visible(get('onboarding-page')),loginVisible:visible(get('enterprise-login-page')),workspaceHeaderVisible:visible(get('workspace-mode-header')),identityVisible:visible(get('enterprise-identity-name')),workspace:text(get('composer-workspace-trigger')),workspacePath:(get('workspace-path')?.getAttribute('aria-label')??'').slice(0,220)}})()"""
    result = bridge.raw_cdp('Runtime.evaluate', expression=expression, returnByValue=True,
                            awaitPromise=False, timeout=1000)
    if 'exceptionDetails' in result:
        raise RuntimeError('Original renderer startup projection failed')
    value = result.get('result', {}).get('value')
    assert isinstance(value, dict), 'Bounded startup object projection required'
    return value


def persist_secondary_evidence(events, evidence, project):
    rows = [row for row in events if row.get('event') in ('workspace-secondary-started', 'workspace-secondary-exit')]
    assert len(rows) <= 8, 'Finite original secondary event bound exceeded'
    value = {'events': rows, 'startupProjection': None, 'projectionError': None,
             'scope': 'Original event rows, no timeout/exit inference; readonly UI after original command'}
    path = evidence / 'workspace-secondary-events.json'
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    try:
        value['startupProjection'] = project()
    except Exception as error:
        value['projectionError'] = {'type': type(error).__name__, 'message': str(error)[:240]}
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return value



def read_secondary_lifecycle(evidence):
    result = {'streams': [], 'timing': {'available': False},
              'scope': 'Only child-owned file logs; bounded lifecycle categories and typed errors, no raw messages or environment'}
    for suffix in ('stdout', 'stderr'):
        path = evidence / ('workspace-secondary.' + suffix + '.log')
        try:
            info = path.lstat()
        except FileNotFoundError:
            result['streams'].append({'stream': suffix, 'available': False})
            continue
        assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
        with path.open('rb') as stream:
            head = stream.read(32768)
            tail = b''
            if info.st_size > len(head):
                stream.seek(max(len(head), info.st_size - 32768))
                tail = stream.read(32768)
        selected = []
        for segment, raw in [('head', head), ('tail', tail)]:
            for number, line in enumerate(raw.decode('utf8', 'replace').splitlines(), 1):
                item = {'segment': segment, 'lineWithinSegment': number}
                tag = re.search(r'\[(app-quit|single-instance|primary-window|startup-workspace)\]', line)
                typed = re.search(r'\b((?:[A-Za-z][A-Za-z0-9]*)?(?:Error|Exception))(?=[: \[])', line)
                code = re.search(r'\b(ERR_[A-Z_]+)\b', line)
                native = re.search(r'(ERROR|FATAL):[^:]*process_singleton[^:]*:', line)
                if tag:
                    item['lifecycleTag'] = tag.group(1)
                    phases = ['forceQuit enabled', 'waiting for host process cleanup', 'host process cleanup completed',
                              'preparation finished', 'exiting prepared app', 'all windows closed', 'creating main window']
                    item['phase'] = next((phase for phase in phases if phase in line), 'other-lifecycle')
                    item['numericFields'] = {key: int(value) for key, value in re.findall(r'\b(hosts|windows|forceKillDelayMs|waitTimeoutMs|exitCode)=([0-9]+)', line)}
                    stamp = re.match(r'\[([0-9]{4}-[0-9:. -]+)\] \[pid:([0-9]+)\]', line)
                    if stamp: item.update(wallTime=stamp.group(1), pid=int(stamp.group(2)))
                elif 'dom-ready fired' in line:
                    item['lifecycleTag'] = 'dom-ready'
                elif not typed and not code and not native:
                    continue
                if typed: item['errorType'] = typed.group(1)[:80]
                if code: item['errorCode'] = code.group(1)[:80]
                if native: item['nativeSingletonSeverity'] = native.group(1)
                selected.append(item)
                if len(selected) >= 32: break
            if len(selected) >= 32: break
        result['streams'].append({'stream': suffix, 'available': True, 'bytes': info.st_size,
                                  'readBytes': len(head) + len(tail), 'truncated': info.st_size > len(head) + len(tail), 'selected': selected})
    path = evidence / 'workspace-secondary-timing.json'
    try:
        info = path.lstat()
    except FileNotFoundError:
        return result
    assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 32768
    timing = json.loads(path.read_text())
    assert timing['envRecorded'] is False and timing['clock'] == 'controller performance.now monotonic'
    allowed = ('phase', 'atMs', 'pid', 'exit', 'timedOut', 'type')
    result['timing'] = {'available': True, 'clock': timing['clock'], 'envRecorded': False,
                        'timeOriginEpochMs': timing.get('timeOriginEpochMs'),
                        'marks': [{key: row[key] for key in allowed if key in row} for row in timing['marks']],
                        'closeErrors': timing['closeErrors']}
    return result


def read_secondary_sample(evidence):
    path = evidence / 'workspace-secondary-sample.json'
    if not path.exists(): return {'available': False}
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 32768
    receipt = json.loads(path.read_text())
    assert receipt['envRecorded'] is False
    allowed = ('childPid', 'samplerPid', 'status', 'samplerClosed', 'spawnAtMs', 'scheduledAtMs',
               'startedAtMs', 'finishedAtMs', 'samplerExit', 'observerTimedOut', 'samplerReapExpired',
               'errorType', 'initialIdentityError', 'cleanupErrorType', 'closeErrors')
    value = {'available': True, **{key: receipt[key] for key in allowed if key in receipt}}
    before, after = receipt.get('before'), receipt.get('after')
    value['identityStable'] = bool(before and after and before == after)
    stack = evidence / 'workspace-secondary.sample.txt'
    if stack.exists():
        info = stack.lstat()
        assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
        with stack.open('rb') as stream: raw = stream.read(262144)
        # Only known stack symbol categories; no sample header, paths, arguments or environment.
        symbols = ('NotifyOtherProcessWithTimeout', 'ProcessSingleton', 'SendMessage', 'WaitForSingleObject',
                   '__psynch_cvwait', '__psynch_mutexwait', 'mach_msg', 'kevent', 'poll', 'select',
                   'CFRunLoopRun', 'uv_run', 'RequestSingleInstanceLock', 'BeforeQuit', 'Quit')
        categories = []
        for line in raw.decode('utf8', 'replace').splitlines():
            if not re.match(r'^\s*[+|!:0-9 ]+', line): continue
            for symbol in symbols:
                if re.search(r'(?<![A-Za-z0-9_])' + re.escape(symbol) + r'(?![A-Za-z0-9_])', line) and symbol not in categories:
                    categories.append(symbol)
        value['stack'] = {'bytes': info.st_size, 'readBytes': len(raw), 'truncated': info.st_size > len(raw),
                          'categories': categories, 'scope': 'Observed symbol categories only; no causal inference'}
    return value


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert args.preparation.resolve() == ROOT / 'data/sandbox-verification' / plan['profile'] / 'preparation.json'
    assert plan['status'] == 'prepared-not-run' and plan['target'] == 'darwin-x64'
    for path, expected in plan['sources'].items():
        assert digest(ROOT / path) == expected, 'Frozen fixture source changed: ' + path
    assert digest(plan['manifestPath']) == plan['manifestSha256']
    if not args.run:
        print(json.dumps({'status': 'prepared-not-run', 'profile': plan['profile']}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation), 'Exact Root-reviewed fresh x64 plan required'
    evidence = ROOT / 'evidence' / plan['profile']
    assert not evidence.exists() and not (ROOT / 'data' / plan['profile']).exists()
    clock = runpy.run_path(str(ROOT / 'scripts/tests/macos-clock-probe.py'))
    native, old = clock['NATIVE'], clock['OLD']
    readiness = runpy.run_path(str(ROOT / 'scripts/tests/macos-x64-readiness.py'))
    launch_bindings = {}
    active_bridge = {'value': None}
    facts = {'scope': 'Rosetta on Apple silicon; physical Intel not accepted', 'main': [], 'cli': [], 'mappedAddon': []}
    def save():
        (evidence / 'x64-runtime-facts.json').write_text(json.dumps(facts, indent=2) + '\n')
    def mapped(pid, role):
        birth = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True, check=True).stdout.strip()
        txt = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-d', 'txt', '-Fn'], capture_output=True, text=True, check=True).stdout.splitlines()
        paths = [APP / 'Contents/MacOS/UWork Preview', APP / 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework']
        hits = [str(path) for path in paths if 'n' + str(path) in txt]
        assert hits, 'Live owned PID must map this actual frozen x64 runtime'
        for path in hits:
            with Path(path).open('rb') as stream:
                header = stream.read(8)
            assert header == bytes.fromhex('cffaedfe07000001'), 'Mapped runtime must be x86_64 Mach-O'
        assert birth and birth == subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True, check=True).stdout.strip()
        return {'pid': pid, 'role': role, 'birth': birth, 'mappedX64Files': hits}
    def capture_secondary(fixture):
        with fixture.lock:
            events = list(fixture.events)
        def project():
            binding = facts['main'][-1]
            assert mapped(binding['pid'], 'startup projection')['birth'] == binding['birth']
            assert active_bridge['value'] is not None, 'Original owned bridge unavailable'
            return read_startup_projection(active_bridge['value'])
        try:
            facts['secondaryEvidence'] = persist_secondary_evidence(events, evidence, project)
            facts['secondaryLifecycle'] = read_secondary_lifecycle(evidence)
            facts['secondarySample'] = read_secondary_sample(evidence)
            (evidence / 'workspace-secondary-lifecycle-summary.json').write_text(json.dumps(facts['secondaryLifecycle'], indent=2) + '\n')
        except Exception as error:
            facts['secondaryEvidenceError'] = {'type': type(error).__name__, 'message': str(error)[:240]}
        save()
    original_fixture = native['Fixture']
    class Fixture(original_fixture):
        def command(self, op, *positional, **kwargs):
            try:
                return super().command(op, *positional, **kwargs)
            finally:
                if op == 'openWorkspace':
                    # 诊断只能补证据，观察器、落盘和告警失败都不得替换原 command 结果。
                    try:
                        capture_secondary(self)
                    except BaseException as observer_error:
                        kind = type(observer_error).__name__[:80]
                        try:
                            facts['secondaryObserverError'] = {'type': kind}
                            save()
                        except BaseException:
                            try:
                                sys.stderr.write('x64 secondary observer error: ' + kind + '\n')
                            except BaseException:
                                pass
        def wait_event(self, predicate, *positional, **kwargs):
            value = super().wait_event(predicate, *positional, **kwargs)
            if value.get('event') == 'launched':
                record = mapped(value['pid'], 'original Main launch')
                record['cdpPort'] = value['cdpPort']
                launch_bindings[value['cdpPort']] = record
                facts['main'].append(record); save()
            return value
    original_verify = old['verify_packaged_cli']
    def verify_cli(evidence_path, app_path, profile_root, rows):
        assert Path(app_path) == APP
        result = original_verify(evidence_path, app_path, profile_root, rows)
        facts['cli'] = [mapped(row['pid'], 'production spawn-facts-bound CLI') for row in result]
        addon = str(APP / 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/pty.node')
        for row in rows:
            txt = subprocess.run(['lsof', '-nP', '-a', '-p', str(row['pid']), '-d', 'txt', '-Fn'], capture_output=True, text=True).stdout.splitlines()
            if 'n' + addon in txt:
                facts['mappedAddon'].append({'pid': row['pid'], 'exactMappedAddon': addon})
        assert facts['mappedAddon'], 'Actual owned terminal process must load the frozen x64 NAPI addon'
        save()
        return result
    original_harness = old['HARNESS']
    def guarded_harness(port, **kwargs):
        binding = launch_bindings[port]
        assert kwargs.get('evidence') == evidence
        prefix = (APP / 'Contents/Resources/app.asar').as_uri() + '/'
        def guard():
            current = mapped(binding['pid'], 'renderer readiness guard')
            assert current['birth'] == binding['birth'], 'Original Main generation changed'
            listener = subprocess.run(['lsof', '-nP', '-a', '-p', str(binding['pid']), '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True)
            return listener.returncode == 0 and 'n127.0.0.1:' + str(port) in listener.stdout.splitlines()
        number = len(facts.setdefault('rendererReadiness', []))
        def persist(receipt):
            facts['rendererReadiness'][number] = {'mainPid': binding['pid'], 'birth': binding['birth'], **receipt}
            save()
        facts['rendererReadiness'].append({})
        target = readiness['wait_owned_renderer'](port, prefix, guard, persist, seconds=30)
        class BoundHarness(original_harness):
            def raw_cdp(self, method, session_id=None, **params):
                if method == 'Target.attachToTarget':
                    assert params['targetId'] == target['id'], 'Only the original ready renderer may attach'
                    assert guard(), 'Original Main listener changed before attachment'
                return super().raw_cdp(method, session_id=session_id, **params)
        bridge = BoundHarness(port, renderer_prefix=prefix, **kwargs)
        active_bridge['value'] = bridge
        return bridge
    original_popen = subprocess.Popen
    def owned_popen(command, *positional, **kwargs):
        if isinstance(command, list) and command[-1:] == ['scripts/fixtures/macos-clock-derived.mjs']:
            assert kwargs.get('cwd') == ROOT
            assert kwargs['env']['UWORK_NATIVE_FIXTURE_NAME'] == plan['profile']
            command = command[:-1] + ['scripts/fixtures/macos-x64-derived.mjs']
        return original_popen(command, *positional, **kwargs)
    native['Fixture'], old['verify_packaged_cli'], old['HARNESS'], subprocess.Popen = Fixture, verify_cli, guarded_harness, owned_popen
    try:
        accepted = clock['run'](plan['profile'], Path(plan['manifestPath']))
    finally:
        native['Fixture'], old['verify_packaged_cli'], old['HARNESS'], subprocess.Popen = original_fixture, original_verify, original_harness, original_popen
        if evidence.exists():
            try:
                facts['secondarySampleFinal'] = read_secondary_sample(evidence)
                if facts['secondarySampleFinal'].get('samplerClosed') is False:
                    facts['ownedSamplerCleanupFailure'] = True
            except Exception as error:
                facts['sampleFinalObserverError'] = {'type': type(error).__name__}
            save()
    return accepted and not facts.get('ownedSamplerCleanupFailure', False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--reviewed-plan-sha256')
    raise SystemExit(0 if run(parser.parse_args()) else 1)
