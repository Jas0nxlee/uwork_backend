"""Run a staged release in a disposable networkless Linux container on the UWork-only VM."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[2]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
IMAGE = 'sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8'


def main(name, archive):
    assert name.startswith('client-linux-release-') and name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / name
    evidence.mkdir(mode=0o700)
    shared = REPO / 'data/sandbox-verification' / name
    source = shared / 'input'
    work = shared / 'work'
    source.mkdir(mode=0o700, parents=True)
    work.mkdir(mode=0o700)
    packaged = source / 'release.tar.gz'
    shutil.copyfile(archive, packaged)
    digest = hashlib.sha256(packaged.read_bytes()).hexdigest()
    assert digest == hashlib.sha256(archive.read_bytes()).hexdigest()
    shutil.copyfile(REPO / 'evidence/client-linux-release-probe-20261020/driver.mjs', source / 'driver.mjs')
    volume = 'uwork-' + name
    container = volume + '-run'
    facts = {'status': 'failed', 'archiveSha256': digest, 'image': IMAGE,
             'network': 'none', 'releaseMountReadOnly': True}
    inspect = subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True)
    assert inspect.returncode != 0, 'Never reuse an existing volume'
    subprocess.run(DOCKER + ['volume', 'create', volume], check=True, capture_output=True)
    try:
        with (evidence / 'extract.log').open('w') as log:
            subprocess.run(DOCKER + ['run', '--rm', '--network', 'none', '--read-only',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--mount', f'type=bind,src={source},dst=/input,readonly',
                '--mount', f'type=volume,src={volume},dst=/release',
                '--entrypoint', '/bin/tar', IMAGE,
                '-xzf', '/input/release.tar.gz', '-C', '/release', '--strip-components=1',
                '--no-same-owner'], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
        with (evidence / 'run.log').open('w') as log:
            run = subprocess.run(DOCKER + ['run', '--name', container, '--rm', '--init',
                '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,size=128m',
                '--mount', f'type=volume,src={volume},dst=/release,readonly',
                '--mount', f'type=bind,src={source},dst=/probe,readonly',
                '--mount', f'type=bind,src={work},dst=/work',
                '--entrypoint', '/release/runtime/node', IMAGE, '/probe/driver.mjs'],
                stdout=log, stderr=subprocess.STDOUT, timeout=150)
        facts['containerExitCode'] = run.returncode
        if (work / 'result.json').exists():
            shutil.copyfile(work / 'result.json', evidence / 'result.json')
            result = json.loads((evidence / 'result.json').read_text())
            facts['businessStatus'] = result['status']
            if run.returncode == 0 and result['status'] == 'passed':
                facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
    finally:
        if subprocess.run(DOCKER + ['container', 'inspect', container], capture_output=True).returncode == 0:
            subprocess.run(DOCKER + ['rm', '-f', container], check=True, capture_output=True)
        subprocess.run(DOCKER + ['volume', 'rm', volume], check=True, capture_output=True)
        facts['containerAbsent'] = subprocess.run(DOCKER + ['container', 'inspect', container], capture_output=True).returncode != 0
        facts['volumeAbsent'] = subprocess.run(DOCKER + ['volume', 'inspect', volume], capture_output=True).returncode != 0
        assert facts['containerAbsent'] and facts['volumeAbsent']
        (evidence / 'controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if main(args.name, args.archive) else 1)
