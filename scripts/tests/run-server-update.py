"""Exercise original Linux Server CLI update in one isolated networkless container."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[2]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
IMAGE = 'sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(name, rollback=False, components=False):
    assert name.startswith('client-server-update-') and name.replace('-', '').isalnum()
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
    runtime_manifests = {}
    for key, original in archives.items():
        dest = source / (key + '.tar.gz')
        shutil.copyfile(original, dest)
        assert digest(dest) == digest(original)
        with tarfile.open(dest) as archive:
            manifest = json.load(archive.extractfile('zcode-server-linux-arm64/manifest.json'))
        runtime_manifests[key] = manifest
        metadata[key] = {'source': str(original), 'sha256': digest(dest), 'size': dest.stat().st_size,
                         'appVersion': manifest['appVersion'], 'target': manifest['target']}
    if rollback:
        metadata['rollback'] = True
    if components:
        assert not rollback, 'Use separate evidence profiles for component and rollback scenarios'
        metadata['componentMode'] = True
        old_components = {row['id']: row for row in runtime_manifests['old']['components']}
        component_files = []
        stage = archives['new'].parent
        with tarfile.open(source / 'new.tar.gz') as archive:
            manifest_bytes = archive.extractfile('zcode-server-linux-arm64/manifest.json').read()
        (source / 'runtime-manifest.json').write_bytes(manifest_bytes)
        for row in runtime_manifests['new']['components']:
            original = stage / row['archivePath']
            previous = old_components.get(row['id'])
            changed = previous is None or previous['sha256'] != row['sha256'] or previous['paths'] != row['paths']
            component_files.append({**row, 'archiveSha256': digest(original), 'archiveSizeBytes': original.stat().st_size,
                                    'changedFromOld': changed})
            if changed:
                shutil.copyfile(original, source / (row['id'] + '.tar.gz'))
                assert digest(source / (row['id'] + '.tar.gz')) == digest(original)
        metadata['componentFiles'] = component_files
    (source / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    shutil.copyfile(REPO / 'scripts/tests/server-update-probe.mjs', source / 'driver.mjs')
    with (evidence / 'contract-build.log').open('w') as log:
        subprocess.run([str(REPO / 'clients/uwork/node_modules/.bin/esbuild'),
            str(REPO / 'clients/uwork/packages/zcode-server-cli/test/extractionOwnership.linux.mjs'),
            '--bundle', '--platform=node', '--format=cjs', '--external:yauzl',
            '--outfile=' + str(source / 'ownership.cjs')], check=True,
            stdout=log, stderr=subprocess.STDOUT, timeout=30)
    volume = 'uwork-' + name
    container = volume + '-run'
    extract_container = volume + '-extract'
    contract_container = volume + '-ownership'
    facts = {'status': 'failed', 'image': IMAGE, 'network': 'none', 'archives': metadata}
    assert subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True).returncode != 0
    subprocess.run(DOCKER + ['volume', 'create', volume], check=True, capture_output=True)
    try:
        with (evidence / 'extract.log').open('w') as log:
            subprocess.run(DOCKER + ['run', '--name', extract_container, '--rm', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--mount', f'type=volume,src={volume},dst=/bootstrap',
                '--entrypoint', '/bin/tar', IMAGE, '-xzf', '/input/new.tar.gz',
                '-C', '/bootstrap', '--strip-components=1', '--no-same-owner'],
                stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
        with (evidence / 'ownership-contract.log').open('w') as log:
            contract = subprocess.run(DOCKER + ['run', '--name', contract_container, '--rm', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--tmpfs', '/tmp:rw,nosuid,size=16m',
                '--mount', f'type=volume,src={volume},dst=/bootstrap,readonly',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--env', 'NODE_PATH=/bootstrap/runtime/node_modules',
                '--entrypoint', '/bootstrap/runtime/node', IMAGE, '--test', '/input/ownership.cjs'],
                stdout=log, stderr=subprocess.STDOUT, timeout=30)
            facts['ownershipContractExitCode'] = contract.returncode
            assert contract.returncode == 0
        with (evidence / 'run.log').open('w') as log:
            result = subprocess.run(DOCKER + ['run', '--name', container, '--rm', '--init',
                '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--memory', '1g',
                '--tmpfs', '/tmp:rw,nosuid,size=256m',
                '--mount', f'type=volume,src={volume},dst=/bootstrap,readonly',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--mount', f'type=bind,src={work},dst=/work',
                '--entrypoint', '/bootstrap/runtime/node', IMAGE, '/input/driver.mjs'],
                stdout=log, stderr=subprocess.STDOUT, timeout=200)
        facts['containerExitCode'] = result.returncode
        if (work / 'result.json').exists():
            shutil.copyfile(work / 'result.json', evidence / 'result.json')
            business = json.loads((work / 'result.json').read_text())
            facts['businessStatus'] = business['status']
            if business['status'] == 'passed' and result.returncode == 0:
                facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
    finally:
        for owned in [container, extract_container, contract_container]:
            if subprocess.run(DOCKER + ['container', 'inspect', owned], capture_output=True).returncode == 0:
                subprocess.run(DOCKER + ['rm', '-f', owned], check=True, capture_output=True)
        subprocess.run(DOCKER + ['volume', 'rm', volume], check=True, capture_output=True)
        facts['containerAbsent'] = subprocess.run(DOCKER + ['container', 'inspect', container], capture_output=True).returncode != 0
        facts['volumeAbsent'] = subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True).returncode != 0
        if not facts['containerAbsent'] or not facts['volumeAbsent']:
            facts['status'] = 'failed'
        (evidence / 'controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--rollback', action='store_true', help='Inject an owned Node preload failure only for the new candidate Core')
    parser.add_argument('--components', action='store_true', help='Serve original runtime manifest and changed component archives for real incremental update and fallback')
    args = parser.parse_args()
    raise SystemExit(0 if main(args.name, args.rollback, args.components) else 1)
