"""Separate prepare, readonly preflight and reviewed GUI phases for one immutable Linux package."""
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
IMAGE = 'uwork-linux-desktop-appimage:20261020-wire-v1'
IMAGE_ID = 'sha256:d0d6b70a004d598320f1e8665814d8180f82113ba9a14570feafee4ad6a7f7d6'
APPIMAGE_SHA = '338a4f2894ce2a7f9b6d9d033592640a9d3947bc16ee757540d1f15d839a2906'
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
    assert re.fullmatch(r'client-linux-desktop-wire-appimage-v(?:[2-9]|[1-9][0-9]+)-20261020', name)
    assert not (REPO / 'data' / name).exists() and not (REPO / 'evidence' / name).exists()
    root = REPO / 'data/sandbox-verification' / (name + '-preparation')
    assert not root.exists()
    paths = ['scripts/tests/linux-wire-probe.py', 'scripts/tests/linux-wire-preflight.py',
             'scripts/tests/linux-wire-preflight.test.py', 'scripts/tests/linux-desktop/probe.py',
             'scripts/tests/linux-desktop/backend.mjs', 'scripts/tests/linux-desktop/protocol.py',
             'scripts/tests/linux-desktop/entry.sh', 'scripts/tests/native-harness-bridge.py',
             'scripts/fixtures/native-first-run-ui.py',
             'evidence/client-linux-wire-desktop-package-manifest-20261020.json']
    version = name.split('-appimage-')[1].split('-')[0]
    plan = {'status': 'prepared-not-run', 'name': name, 'image': IMAGE, 'imageId': image_id(),
            'appImageSha256': APPIMAGE_SHA, 'sources': {p: sha(REPO / p) for p in paths},
            'preflightContainer': 'uwork-wire-' + version + '-preflight',
            'runPreflightContainer': 'uwork-wire-' + version + '-runpreflight',
            'originalChecksUnchanged': 'File/reload/PTY/2 supplier calls and settled ledger44/revoke zero increment/25s protocol and thirdURI/cleanup',
            'gate': 'Prepare never runs containers; preflight exits without GUI; run requires exact Root-reviewed plan plus successful natural preflight receipt',
            'guiStarted': False}
    root.mkdir(mode=0o700)
    path = root / 'preparation.json'
    path.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'status': plan['status'], 'path': str(path), 'sha256': sha(path)}))


def load_plan(path):
    plan = json.loads(path.read_text())
    assert path.resolve() == REPO / 'data/sandbox-verification' / (plan['name'] + '-preparation') / 'preparation.json'
    assert plan['status'] == 'prepared-not-run' and plan['image'] == IMAGE
    assert plan['imageId'] == image_id() and plan['appImageSha256'] == APPIMAGE_SHA
    assert all(sha(REPO / p) == value for p, value in plan['sources'].items())
    manifest = json.loads((REPO / 'evidence/client-linux-wire-desktop-package-manifest-20261020.json').read_text())
    assert manifest['sourceCommit'] == '1bd1ec7b9949353ae11390e020a58b0fe7719c3e'
    assert manifest['runtimeFiles']['resources/app.asar']['sha256'] == 'b253482dd49894f956f19a62aceecc02406dc1c68391ac76e999cc02710a9a15'
    assert all(sha(REPO / 'clients/uwork' / p) == value for p, value in manifest['sourceSha256'].items())
    return plan, manifest


def gui_run(plan, manifest, preparation):
    name, evidence = plan['name'], REPO / 'evidence' / plan['name']
    assert not evidence.exists() and not (REPO / 'data/sandbox-verification' / name).exists()
    module = runpy.run_path(str(REPO / 'scripts/tests/linux-desktop/probe.py'))
    globals_ = module['run'].__globals__
    original_bridge, original_free = module['Bridge'], module['free_port']
    original_check, original_popen = subprocess.check_output, subprocess.Popen
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
            (evidence / 'owned-harness-binding.json').write_text(json.dumps({
                'root': str(self.root), 'cdpPort': args[0], 'target': self.target}) + '\n')
            try:
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
                recorder = threading.Thread(target=record_memory, daemon=True)
                recorder.start()
            except BaseException:
                self.kill()
                raise
    globals_['Bridge'], globals_['free_port'] = VerifiedBridge, free_port
    subprocess.check_output, subprocess.Popen = bounded_hash, owned_popen
    try:
        return module['run'](name, pty=True, ordinary_user=True, test_image=IMAGE, protocol=True,
                             appimage=True, window_manager=True, protocol_hold_seconds=25)
    finally:
        stop.set()
        if recorder: recorder.join(timeout=4)
        globals_['Bridge'], globals_['free_port'] = original_bridge, original_free
        subprocess.check_output, subprocess.Popen = original_check, original_popen


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
