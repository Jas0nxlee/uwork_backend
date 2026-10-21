"""Finite x64 extension of the original seven UI checks; never runs without exact reviewed plan."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import re
import os

ROOT = Path(__file__).resolve().parents[2]
APP = Path('/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v9-x64-startup-log/mac/UWork Preview.app')


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
        value['projectionError'] = {'type': type(error).__name__}
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return value



def write_private_receipt(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(json.dumps(value, indent=2) + '\n')


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
    startup = runpy.run_path(str(ROOT / 'scripts/tests/macos-x64-startup-log.py'))
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
            facts['singleInstanceStartup'] = startup['read_owned_single_instance_phases'](ROOT, plan['profile'], events)
            write_private_receipt(evidence / 'single-instance-startup-phases.json', facts['singleInstanceStartup'])
        except Exception as error:
            facts['secondaryEvidenceError'] = {'type': type(error).__name__}
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
            command = command[:-1] + ['scripts/fixtures/macos-x64-startup-derived.mjs']
        return original_popen(command, *positional, **kwargs)
    native['Fixture'], old['verify_packaged_cli'], old['HARNESS'], subprocess.Popen = Fixture, verify_cli, guarded_harness, owned_popen
    try:
        accepted = clock['run'](plan['profile'], Path(plan['manifestPath']))
    finally:
        native['Fixture'], old['verify_packaged_cli'], old['HARNESS'], subprocess.Popen = original_fixture, original_verify, original_harness, original_popen
    return accepted


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparation', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--reviewed-plan-sha256')
    raise SystemExit(0 if run(parser.parse_args()) else 1)
