"""Consume the original fixed RPM with real DNF in one private clone; retain all receipts and remove the clone."""
import argparse
import hashlib
import re
import json
from pathlib import Path
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name', default='client-linux-rpm-fixed-transaction-v1-20261020')
parser.add_argument('--producer-result', default=str(REPO / 'evidence/client-linux-rpm-remove-producer-v4-20261020/production-result.json'))
args = parser.parse_args()
assert re.fullmatch(r'client-linux-rpm-fixed-transaction-[a-z0-9-]+', args.name)
NAME = 'uwork-' + args.name
IMAGE = 'uwork-linux-desktop-fedora:20261020-clock-v1'
EVIDENCE = REPO / 'evidence' / args.name
WORK = REPO / 'data/sandbox-verification' / args.name
PRODUCER = Path(args.producer_result).resolve()
EVIDENCE.mkdir(mode=0o700)
(WORK / 'input').mkdir(mode=0o700, parents=True)
(WORK / 'work').mkdir(mode=0o700)
metadata = json.loads(PRODUCER.read_text())
assert metadata['status'] == 'produced-not-consumed'
artifact = Path(metadata['artifact']['path'])
assert hashlib.sha256(artifact.read_bytes()).hexdigest() == metadata['artifact']['sha256']
shutil.copyfile(artifact, WORK / 'input/candidate.rpm')
for name in ['lifecycle.py', 'rpm-fixed-lifecycle.py']:
    shutil.copyfile(Path(__file__).with_name(name), WORK / 'input' / name)
shutil.copyfile(REPO / 'data/sandbox-verification/linux-native-packaging-v10-20261020/input/expected.json', WORK / 'input/expected.json')
facts = {'status': 'failed', 'producer': metadata, 'container': NAME,
         'scope': 'independent PM clone; original older GUI image/core evidence is not renamed as new-RPM GUI acceptance'}
creation_attempted = False
try:
    assert subprocess.run(DOCKER + ['inspect', NAME], capture_output=True).returncode != 0
    facts['baseImageId'] = json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', IMAGE], text=True))[0]['Id']
    command = DOCKER + ['run', '--name', NAME, '--init', '--memory', '1024m', '--cpus', '1',
                        '--network', 'bridge', '--security-opt', 'no-new-privileges',
                        '--mount', f'type=bind,src={WORK / "input"},dst=/input,readonly',
                        '--mount', f'type=bind,src={WORK / "work"},dst=/work',
                        '--entrypoint', 'python3', facts['baseImageId'], '/input/rpm-fixed-lifecycle.py']
    creation_attempted = True
    facts['command'] = command
    with (EVIDENCE / 'transaction.log').open('w') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=600)
    facts['exitCode'] = result.returncode
    for name in ['fixed-rpm-result.json', 'lifecycle-result.json']:
        if (WORK / 'work' / name).is_file():
            shutil.copyfile(WORK / 'work' / name, EVIDENCE / name)
    actual = json.loads((WORK / 'work/fixed-rpm-result.json').read_text())
    assert result.returncode == 0 and actual['status'] == 'passed', actual.get('failure')
    facts['status'] = 'passed'
except Exception as error:
    facts['failure'] = str(error)
finally:
    observed = subprocess.run(DOCKER + ['inspect', NAME], capture_output=True, text=True)
    if creation_attempted and observed.returncode == 0:
        facts['containerState'] = json.loads(observed.stdout)[0]['State']
        subprocess.run(DOCKER + ['rm', '-f', NAME], check=True, stdout=subprocess.DEVNULL)
    facts['containerAbsent'] = subprocess.run(DOCKER + ['inspect', NAME], capture_output=True).returncode != 0
    if not facts['containerAbsent']:
        facts['status'] = 'failed'
    (EVIDENCE / 'controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'failure': facts.get('failure')}))
raise SystemExit(0 if facts['status'] == 'passed' else 1)
