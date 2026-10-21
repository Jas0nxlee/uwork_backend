"""Original Server update with real SDK-seeded state; one networkless Node container."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[2]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
IMAGE = 'sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8'
NODE = '/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(name, clock_rollback=False):
    assert name.startswith('client-server-update-stateful-') and name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / name
    evidence.mkdir(mode=0o700)
    shared = REPO / 'data/sandbox-verification' / name
    source, work = shared / 'input', shared / 'work'
    source.mkdir(mode=0o700, parents=True)
    work.mkdir(mode=0o700)
    archives = {
        'old': REPO / 'data/sandbox-verification/client-linux-release-red-20261020/input/release.tar.gz',
        'new': REPO / 'clients/uwork/packages/zcode-server-cli/dist-release/zcode-server-linux-arm64.tar.gz',
    }
    metadata = {}
    for key, original in archives.items():
        target = source / (key + '.tar.gz')
        shutil.copyfile(original, target)
        assert digest(target) == digest(original)
        with tarfile.open(target) as archive:
            manifest = json.load(archive.extractfile('zcode-server-linux-arm64/manifest.json'))
            agent_sha256 = hashlib.sha256(archive.extractfile('zcode-server-linux-arm64/runtime/zcode.cjs').read()).hexdigest()
        metadata[key] = {'source': str(original), 'sha256': digest(target), 'size': target.stat().st_size,
                         'appVersion': manifest['appVersion'], 'target': manifest['target'], 'agentSha256': agent_sha256}
    if clock_rollback:
        assert metadata['new']['agentSha256'] != metadata['old']['agentSha256']
        metadata['clockRollback'] = {'targetEntry': '/work/server/releases/' + metadata['new']['appVersion'] + '-' + metadata['new']['target'] + '-' + metadata['new']['sha256'][:12] + '/runtime/zcode.cjs'}
        shutil.copyfile(REPO / 'scripts/fixtures/agent-startup-clock-preload.mjs', source / 'clock-preload.mjs')
    (source / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    build_env = {k: os.environ[k] for k in ['HOME', 'TMPDIR', 'LANG'] if k in os.environ}
    build_env['PATH'] = str(Path(NODE).parent) + ':/opt/homebrew/bin:/usr/bin:/bin'
    with (evidence / 'bundle.log').open('w') as log:
        subprocess.run([str(REPO / 'clients/uwork/node_modules/.bin/esbuild'),
            str(REPO / 'scripts/tests/server-update-stateful-probe.mjs'), '--bundle', '--platform=node',
            '--format=esm', '--target=node22',
            '--banner:js=import {createRequire as _statefulRequire} from "node:module"; const require=_statefulRequire(import.meta.url);',
            '--outfile=' + str(source / 'driver.mjs')], env=build_env, check=True,
            stdout=log, stderr=subprocess.STDOUT, timeout=40)
    volume = 'uwork-' + name
    container, extract_container = volume + '-run', volume + '-extract'
    facts = {'status': 'failed', 'archives': metadata, 'network': 'none', 'image': IMAGE,
             'driverSha256': digest(source / 'driver.mjs'), 'publicSdkSource': 'packages/client/src/websocket.ts',
             'fixtureSourceSha256': digest(REPO / 'scripts/tests/server-update-stateful-probe.mjs')}
    assert subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True).returncode != 0
    subprocess.run(DOCKER + ['volume', 'create', volume], check=True, capture_output=True)
    try:
        with (evidence / 'extract.log').open('w') as log:
            subprocess.run(DOCKER + ['run', '--name', extract_container, '--rm', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--mount', f'type=volume,src={volume},dst=/bootstrap', '--entrypoint', '/bin/tar', IMAGE,
                '-xzf', '/input/new.tar.gz', '-C', '/bootstrap', '--strip-components=1', '--no-same-owner'],
                stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
        with (evidence / 'run.log').open('w') as log:
            result = subprocess.run(DOCKER + ['run', '--name', container, '--rm', '--init', '--network', 'none',
                '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g',
                '--tmpfs', '/tmp:rw,nosuid,size=128m', '--mount', f'type=volume,src={volume},dst=/bootstrap,readonly',
                '--mount', f'type=bind,src={source},dst=/input,readonly', '--mount', f'type=bind,src={work},dst=/work',
                '--entrypoint', '/bootstrap/runtime/node', IMAGE, '/input/driver.mjs'],
                stdout=log, stderr=subprocess.STDOUT, timeout=250)
        facts['containerExitCode'] = result.returncode
        if (work / 'result.json').exists():
            shutil.copyfile(work / 'result.json', evidence / 'result.json')
            business = json.loads((work / 'result.json').read_text())
            facts['businessStatus'] = business['status']
            if result.returncode == 0 and business['status'] == 'passed':
                facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
    finally:
        for owned in [container, extract_container]:
            if subprocess.run(DOCKER + ['container', 'inspect', owned], capture_output=True).returncode == 0:
                subprocess.run(DOCKER + ['rm', '-f', owned], check=True, capture_output=True)
        subprocess.run(DOCKER + ['volume', 'rm', volume], check=True, capture_output=True)
        facts['containerAbsent'] = subprocess.run(DOCKER + ['container', 'inspect', container], capture_output=True).returncode != 0
        facts['extractContainerAbsent'] = subprocess.run(DOCKER + ['container', 'inspect', extract_container], capture_output=True).returncode != 0
        facts['volumeAbsent'] = subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True).returncode != 0
        if not all(facts[key] for key in ['containerAbsent', 'extractContainerAbsent', 'volumeAbsent']):
            facts['status'] = 'failed'
        (evidence / 'controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--clock-rollback', action='store_true')
    args = parser.parse_args()
    raise SystemExit(0 if main(args.name, args.clock_rollback) else 1)
