"""Relocate tracked original builder configuration/helpers, never copy user env or credentials."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess

repo = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name', default='linux-native-packaging-20261020')
args = parser.parse_args()
assert re.fullmatch(r'linux-native-packaging(?:-[a-z0-9]+)*-20261020', args.name)
context = repo / 'data/sandbox-verification' / args.name
context.mkdir(mode=0o700)
project = context / 'project'
project.mkdir(mode=0o700)
paths = subprocess.check_output(['git', 'ls-files', '-z',
    'clients/uwork/scripts', 'clients/uwork/packages/desktop/scripts', 'clients/uwork/packages/desktop/build',
    'clients/uwork/packages/provider/src', 'clients/uwork/packages/provider-node/src',
    'clients/uwork/packages/shared/src', 'clients/uwork/packages/model-option-map/src'], cwd=repo).decode().split('\0')
allowed = {'.mjs', '.ts', '.tsx', '.json', '.png', '.ico', '.icns', '.svg', '.plist', '.nsh', '.sh', '.tpl', '.txt', '.md'}
paths = [p for p in paths if p and Path(p).suffix in allowed]
paths += ['clients/uwork/package.json', 'clients/uwork/packages/desktop/package.json',
    'clients/uwork/packages/desktop/electron-builder.config.js', 'clients/uwork/config/default.json',
    'clients/uwork/config/provider/zcode-builtin.json', 'clients/uwork/THIRD-PARTY-NOTICES.md',
    'clients/uwork/packages/desktop/out/metadata/build-meta.json']
paths += ['clients/uwork/packages/' + name + '/package.json' for name in ['provider', 'provider-node', 'shared', 'model-option-map']]
manifest = {}
for relative in sorted(set(paths)):
    source = repo / relative
    if not source.is_file():
        continue
    target = project / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == hashlib.sha256(target.read_bytes()).hexdigest()
    manifest[relative] = digest
shutil.copyfile(Path(__file__).with_name('native-packaging.Dockerfile'), context / 'Dockerfile')
manifest_name = 'client-linux-native-packaging-source-manifest-20261020.json' if args.name == 'linux-native-packaging-20261020' else 'client-' + args.name + '-source-manifest.json'
(repo / 'evidence' / manifest_name).write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'copiedTrackedConfigAndAssets': len(manifest), 'context': str(context)}))
