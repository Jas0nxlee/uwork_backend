"""Separate prepare, readonly preflight and reviewed GUI phases for the sealed1a8 matched Linux package plus original UI fit and raw-wire URI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import threading
import time
from urllib.parse import unquote, urlparse

REPO = Path(__file__).resolve().parents[2]
IMAGE = 'uwork-linux-desktop-appimage:20261020-pty-wire-v1'
IMAGE_ID = 'sha256:5e0f9b9876f145b764ba851704802aebad407e643f9a18a51d270d81fb5fb0be'
APPIMAGE_SHA = '6db2908c285012dfb37dce3336d09df1d28e73f1a06629c85d8100f58389d78a'
DOCKER = ['docker', '--context', 'colima-uwork-backend']
PREFLIGHT = runpy.run_path(str(Path(__file__).with_name('linux-wire-preflight.py')))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def image_id():
    value = subprocess.run(DOCKER + ['image', 'inspect', '--format', '{{.Id}}', IMAGE],
                           capture_output=True, text=True, check=True, timeout=10)
    assert value.stdout.strip() == IMAGE_ID
    return value.stdout.strip()


def prepare(name):
    assert re.fullmatch(r'client-linux-desktop-pty-wire-appimage-v[1-9][0-9]*-20261020', name)
    assert not (REPO / 'data' / name).exists() and not (REPO / 'evidence' / name).exists()
    root = REPO / 'data/sandbox-verification' / (name + '-preparation')
    assert not root.exists()
    paths = ['scripts/tests/linux-pty-wire-probe.py', 'scripts/tests/linux-wire-preflight.py',
             'scripts/tests/linux-terminal-fit.py', 'scripts/tests/linux-terminal-fit.test.py',
             'scripts/tests/linux-terminal-fit-ready.test.py',
             'scripts/tests/linux-wire-protocol-derive.py',
             'scripts/tests/linux-native-error-diagnostic.py',
             'scripts/tests/linux-native-error-diagnostic.test.py',
             'scripts/tests/linux-pty-wire-preflight.test.py', 'scripts/tests/linux-desktop/probe.py',
             'scripts/tests/linux-desktop/backend.mjs', 'scripts/tests/linux-desktop/protocol.py',
             'scripts/tests/linux-desktop/entry.sh', 'scripts/tests/native-harness-bridge.py',
             'scripts/fixtures/native-first-run-ui.py',
             'evidence/client-linux-pty-wire-desktop-package-manifest-20261020.json']
    version = name.split('-appimage-')[1].split('-')[0]
    plan = {'status': 'prepared-not-run', 'name': name, 'image': IMAGE, 'imageId': image_id(),
            'appImageSha256': APPIMAGE_SHA, 'sources': {p: sha(REPO / p) for p in paths},
            'preflightContainer': 'uwork-wire-pty-' + version + '-preflight',
            'runPreflightContainer': 'uwork-wire-pty-' + version + '-runpreflight',
            'originalChecksUnchanged': 'File/reload/PTY/2 supplier calls and settled ledger44/revoke zero increment/25s protocol and thirdURI/cleanup',
            'gate': 'Prepare never runs containers; preflight exits without GUI; run requires exact Root-reviewed plan plus successful natural preflight receipt',
            'guiStarted': False}
    root.mkdir(mode=0o700)
    derivative = root / 'protocol-wire.py'
    derive = runpy.run_path(str(REPO / 'scripts/tests/linux-wire-protocol-derive.py'))
    plan['protocolDerivation'] = {**derive['derive_protocol'](REPO / 'scripts/tests/linux-desktop/protocol.py', derivative), 'path': str(derivative)}
    plan['additionalUiFit'] = 'After original File/reload validation, close only its original preview through unique hit-tested side-pane-toggle/collapse aria label and genuine CDP mouse input; already-collapsed must show unique hit-tested expand aria label and exact unique side-frame aria-hidden=true (retained preview DOM width is not visibility). Refocus original xterm by UI. Then actual same-shell stty before/after/restore via exact owned native X window;35s total and8s each phase. Continuous stable public DOM/font/DPR/container plus two matching unique-file stty measurements before locking each phase; full viewport signature/shell proof/native geometry must restore exactly; actual C192 mapped in Main descendant.'
    plan['passiveFailureDiagnostic'] = 'Only first original CDP failure after original Page.reload: exact initial Main PID/exe/starttime and unique same-PID Error MODAL/DIALOG XID, before/after geometry and ownership; actual scrot help-verified rectangle screenshot. No click/dismiss/keypress/gdb/AT-SPI/CDP substitute. Original outcome identity preserved even if observer fails. Separate12s observer budget; original business assertions/timers unchanged.'
    path = root / 'preparation.json'
    path.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'status': plan['status'], 'path': str(path), 'sha256': sha(path)}))


def load_plan(path):
    plan = json.loads(path.read_text())
    assert path.resolve() == REPO / 'data/sandbox-verification' / (plan['name'] + '-preparation') / 'preparation.json'
    assert plan['status'] == 'prepared-not-run' and plan['image'] == IMAGE
    assert plan['imageId'] == image_id() and plan['appImageSha256'] == APPIMAGE_SHA
    assert all(sha(REPO / p) == value for p, value in plan['sources'].items())
    manifest = json.loads((REPO / 'evidence/client-linux-pty-wire-desktop-package-manifest-20261020.json').read_text())
    assert manifest['sourceCommit'] == '1a8f24cb0421a253b4ce720f059c9e800cf6d68d'
    assert manifest['runtimeFiles']['resources/app.asar']['sha256'] == 'eced6754bd2f7f03e6e34ab0be45ff75ee413fa12bbb087af922aa6adf7eb2d6'
    snapshot = Path(manifest['producerInputSnapshot'])
    assert snapshot.resolve() == REPO / 'evidence/client-linux-pty-wire-host-package-20261020/source-inputs'
    assert all(sha(snapshot / p) == value for p, value in manifest['sourceSha256'].items())
    assert manifest['packagedNodePtyJs']['version'] == '1.1.0' and manifest['packagedNodePtyJs']['resizeNativeArgumentCount'] == 3
    assert manifest['runtimeFiles']['resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node']['sha256'] == 'c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b'
    assert sha(plan['protocolDerivation']['path']) == plan['protocolDerivation']['derivedSha256']
    return plan, manifest


def gui_run(plan, manifest, preparation):
    name, evidence = plan['name'], REPO / 'evidence' / plan['name']
    assert not evidence.exists() and not (REPO / 'data/sandbox-verification' / name).exists()
    module = runpy.run_path(str(REPO / 'scripts/tests/linux-desktop/probe.py'))
    globals_ = module['run'].__globals__
    original_bridge, original_free = module['Bridge'], module['free_port']
    original_check, original_popen = subprocess.check_output, subprocess.Popen
    original_run_path = runpy.run_path
    fit = original_run_path(str(REPO / 'scripts/tests/linux-terminal-fit.py'))
    diagnostic = original_run_path(str(REPO / 'scripts/tests/linux-native-error-diagnostic.py'))
    fit_results = []
    protocol_used = []
    def protocol_path(path, *args, **kwargs):
        if Path(path).resolve() != REPO / 'scripts/tests/linux-desktop/protocol.py':
            return original_run_path(path, *args, **kwargs)
        assert not protocol_used
        protocol_used.append(True)
        namespace = original_run_path(plan['protocolDerivation']['path'], *args, **kwargs)
        original_protocol = namespace['run_protocol']
        def run_protocol(*positional, **keywords):
            positional[5]['protocolWireFixture'] = plan['protocolDerivation']
            return original_protocol(*positional, **keywords)
        namespace['run_protocol'] = run_protocol
        return namespace
    def docker(*args, check=True, timeout=8):
        return subprocess.run(DOCKER + list(args), capture_output=True, text=True, check=check, timeout=timeout)
    legacy_hash_argv = DOCKER + ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop',
                                'ALL', '--entrypoint', 'sha256sum', IMAGE, '/opt/artifacts/uwork-preview.AppImage']
    ports, samples = [], []
    hash_used = False
    stop = threading.Event()
    recorder = None
    def free_port():
        port = original_free()
        ports.append(port)
        (evidence / 'allocated-host-ports.json').write_text(json.dumps(ports) + '\n')
        return port
    def bounded_hash(command, *args, **kwargs):
        nonlocal hash_used
        if command == legacy_hash_argv:
            assert not hash_used and not args and kwargs == {'text': True}
            hash_used = True
            return PREFLIGHT['run_preflight'](DOCKER, IMAGE, plan['runPreflightContainer'],
                                              APPIMAGE_SHA, preparation.parent / 'run-preflight.json')
        return original_check(command, *args, **kwargs)
    def owned_popen(command, *args, **kwargs):
        child = original_popen(command, *args, **kwargs)
        config = str(REPO / 'data/sandbox-verification' / name / 'ssh-config')
        if isinstance(command, list) and command[:3] == ['/usr/bin/ssh', '-F', config]:
            (evidence / 'owned-tunnel-binding.json').write_text(json.dumps({'pid': child.pid, 'argv': command}) + '\n')
        return child
    def record_memory():
        while not stop.is_set():
            try:
                result = subprocess.run(DOCKER + ['exec', 'uwork-' + name, 'sh', '-c',
                    'cat /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.current'],
                    capture_output=True, text=True, timeout=3)
                if result.returncode == 0:
                    value = {'monotonicSeconds': time.monotonic(), 'projection': result.stdout}
                    if len(samples) < 2: samples.append(value)
                    else: samples[-1] = value
                    (evidence / 'cgroup-memory-first-latest.json').write_text(json.dumps(samples, indent=2) + '\n')
            except (OSError, subprocess.TimeoutExpired):
                pass
            stop.wait(5)
    class VerifiedBridge(original_bridge):
        def __init__(self, *args, **kwargs):
            nonlocal recorder
            super().__init__(*args, **kwargs)
            try:
                (evidence / 'owned-harness-binding.json').write_text(json.dumps({
                    'root': str(self.root), 'cdpPort': args[0], 'target': self.target}) + '\n')
                app = unquote(urlparse(self.target).path).split('/resources/app.asar/')[0]
                assert app.startswith('/work/appimage-runtime/') and '/..' not in app
                files = {}
                for relative, expected in manifest['runtimeFiles'].items():
                    value = subprocess.check_output(DOCKER + ['exec', 'uwork-' + name,
                        'sha256sum', app + '/' + relative], text=True, timeout=10).split()[0]
                    assert value == expected['sha256']
                    files[relative] = value
                (evidence / 'live-extracted-core-files.json').write_text(json.dumps({
                    'appImageSha256': APPIMAGE_SHA, 'packagedRoot': app,
                    'actualFiles': files, 'allFiveActualHashesMatch': True}, indent=2) + '\n')
                self._owned_main_binding = None
                try:
                    ready = json.loads((REPO / 'data/sandbox-verification' / name / 'work/backend-ready.json').read_text())
                    self._owned_main_binding = diagnostic['read_main_binding'](docker, 'uwork-' + name, ready['electronPid'], app)
                    (evidence / 'owned-native-diagnostic-binding.json').write_text(json.dumps(self._owned_main_binding) + '\n')
                except BaseException:
                    pass
                recorder = threading.Thread(target=record_memory, daemon=True)
                recorder.start()
            except BaseException:
                try: self.kill()
                except BaseException: pass
                raise
        def raw_cdp(self, method, session_id=None, **params):
            if method == 'Page.reload': self._owned_reload_seen = True
            def observe_original_failure():
                if (getattr(self, '_owned_reload_seen', False)
                    and not getattr(self, '_owned_error_observed', False)
                    and getattr(self, '_owned_main_binding', None)):
                    self._owned_error_observed = True
                    diagnostic['capture_owned_error'](docker, 'uwork-' + name, self._owned_main_binding,
                        REPO / 'data/sandbox-verification' / name / 'work', evidence)
            value = diagnostic['observe_failure'](
                lambda: super(VerifiedBridge, self).raw_cdp(method, session_id=session_id, **params),
                observe_original_failure)
            if method == 'Input.insertText' and params.get('text', '').startswith("printf 'LINUX_PTY_WRITE_OK") and '/work/project/terminal-proof.txt' in params['text']:
                assert not getattr(self, '_fit_started', False)
                self._fit_armed = True
            if method == 'Input.dispatchKeyEvent' and params.get('type') == 'keyUp' and params.get('key') == 'Enter' and getattr(self, '_fit_armed', False):
                self._fit_armed = False
                self._fit_started = True
                work = REPO / 'data/sandbox-verification' / name / 'work'
                ready = json.loads((work / 'backend-ready.json').read_text())
                fit_results.append(fit['run_terminal_fit'](docker, 'uwork-' + name, super().raw_cdp, ready['electronPid'], ready['packagedRoot'], evidence))
            return value
    globals_['Bridge'], globals_['free_port'] = VerifiedBridge, free_port
    subprocess.check_output, subprocess.Popen = bounded_hash, owned_popen
    runpy.run_path = protocol_path
    original_passed = False
    try:
        original_passed = module['run'](name, pty=True, ordinary_user=True, test_image=IMAGE, protocol=True,
                                       appimage=True, window_manager=True, protocol_hold_seconds=25)
        return original_passed and len(fit_results) == 1 and fit_results[0]['status'] == 'passed-original-UI-fit-and-same-shell-stty' and protocol_used == [True]
    finally:
        stop.set()
        if recorder: recorder.join(timeout=4)
        globals_['Bridge'], globals_['free_port'] = original_bridge, original_free
        subprocess.check_output, subprocess.Popen = original_check, original_popen
        runpy.run_path = original_run_path
        if evidence.exists():
            (evidence / 'extended-result.json').write_text(json.dumps({'status': 'passed' if original_passed and len(fit_results) == 1 and fit_results[0]['status'] == 'passed-original-UI-fit-and-same-shell-stty' and protocol_used == [True] else 'failed', 'originalProbePassed': original_passed, 'fitObserved': len(fit_results) == 1, 'rawWireProtocolUsed': protocol_used == [True], 'sourceProvenance': manifest['sourceCommit']}, indent=2) + '\n')


def main(args):
    if args.prepare:
        prepare(args.prepare)
        return True
    assert args.preparation, 'Preparation path required; no implicit execution'
    plan, manifest = load_plan(args.preparation)
    if args.preflight:
        assert args.reviewed_plan_sha256 == sha(args.preparation), 'Exact Root-reviewed preflight plan required'
        PREFLIGHT['run_preflight'](DOCKER, IMAGE, plan['preflightContainer'], APPIMAGE_SHA,
                                  args.preparation.parent / 'preflight.json')
        print(json.dumps({'status': 'passed-readonly-preflight-only', 'guiStarted': False}))
        return True
    if not args.run:
        print(json.dumps({'status': 'prepared-not-run', 'name': plan['name']}))
        return True
    assert args.reviewed_plan_sha256 == sha(args.preparation), 'Exact Root-reviewed plan required'
    receipt = json.loads((args.preparation.parent / 'preflight.json').read_text())
    assert receipt['status'] == 'passed-readonly-preflight-only' and receipt['ownedContainerAbsent']
    assert receipt['stdout'].split()[0] == APPIMAGE_SHA
    (args.preparation.parent / 'controller-run-receipt.json').write_text(json.dumps({
        'pid': os.getpid(), 'planSha256': sha(args.preparation), 'preflightSha256': sha(args.preparation.parent / 'preflight.json')}) + '\n')
    return gui_run(plan, manifest, args.preparation)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    phase = parser.add_mutually_exclusive_group()
    phase.add_argument('--prepare')
    phase.add_argument('--preflight', action='store_true')
    phase.add_argument('--run', action='store_true')
    parser.add_argument('--preparation', type=Path)
    parser.add_argument('--reviewed-plan-sha256')
    raise SystemExit(0 if main(parser.parse_args()) else 1)
