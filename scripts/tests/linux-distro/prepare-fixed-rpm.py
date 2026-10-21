"""Prepare an original prepackaged RPM producer with only the reviewed hook/config source changed."""
from pathlib import Path
import argparse
import re
import hashlib
import json
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--revision', default='v1')
revision = parser.parse_args().revision
assert re.fullmatch(r'v[1-9][0-9]*', revision)
CONTEXT = REPO / ('data/sandbox-verification/linux-native-rpm-remove-' + revision + '-20261020')
EVIDENCE = REPO / ('evidence/client-linux-rpm-remove-producer-' + revision + '-20261020')
DOCKER = ['docker', '--context', 'colima-uwork-backend']
BASE = 'uwork-linux-native-packager:20261020-v10'
IMAGE = 'uwork-linux-native-packager:20261020-rpmremove-' + revision
ORIGINAL = REPO / 'data/sandbox-verification/linux-native-packaging-v10-20261020/input'
CONTEXT.mkdir(mode=0o700)
EVIDENCE.mkdir(mode=0o700)
(CONTEXT / 'input').mkdir(mode=0o700)
(CONTEXT / 'output').mkdir(mode=0o700)
files = ['clients/uwork/packages/desktop/electron-builder.config.js',
         'clients/uwork/packages/desktop/scripts/linux-rpm-after-remove.tpl']
facts = {'status': 'prepared-not-produced', 'sourceFiles': {}, 'payloadFiles': {},
         'baseImage': BASE, 'image': IMAGE, 'payloadBoundary': 'original 1db59c77 cdf/3658; packaging hook/config only'}
for relative in files:
    target = CONTEXT / 'project' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO / relative, target)
    facts['sourceFiles'][relative] = hashlib.sha256(target.read_bytes()).hexdigest()
for filename in ['desktop.tar.gz', 'expected.json', 'native-package.sh']:
    source = ORIGINAL / filename
    target = CONTEXT / 'input' / filename
    shutil.copyfile(source, target)
    facts['payloadFiles'][filename] = hashlib.sha256(target.read_bytes()).hexdigest()
    assert facts['payloadFiles'][filename] == hashlib.sha256(source.read_bytes()).hexdigest()
(CONTEXT / 'Dockerfile').write_text('FROM ' + BASE + '\nCOPY project/ /workspace/\n')
image = json.loads(subprocess.check_output(DOCKER + ['image', 'inspect', BASE], text=True))[0]
facts['baseImageId'] = image['Id']
(EVIDENCE / 'preparation.json').write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'context': str(CONTEXT)}))
