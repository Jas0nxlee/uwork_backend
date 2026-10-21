"""Build one consumer only in the coordinator's explicit Linux resource window."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
BASES = REPO / 'data/sandbox-verification/linux-distro-bases-20261020'
CONTEXTS = REPO / 'data/sandbox-verification/linux-distro-consumers-clock-v1-20261020'
EVIDENCE = REPO / 'evidence/client-linux-distro-native-clock-v1-20261020'
parser = argparse.ArgumentParser()
parser.add_argument('distro', choices=['fedora', 'arch'])
args = parser.parse_args()
facts = {'status': 'failed', 'distro': args.distro, 'commands': []}


def digest(path):
    with path.open('rb') as source:
        sha = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'bytes': path.stat().st_size, 'sha256': sha}


def run(command, label, timeout=1200):
    with (EVIDENCE / (args.distro + '-' + label + '.log')).open('w') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    facts['commands'].append({'command': command, 'exitCode': result.returncode,
                              'log': args.distro + '-' + label + '.log'})
    result.check_returncode()


try:
    trust = json.loads((REPO / 'evidence/client-linux-distro-bases-20261020/archives-result.json').read_text())
    assert trust['status'] == 'archives-verified'
    base = 'uwork-distro-base-' + args.distro + ':20261020-verified'
    image = 'uwork-linux-desktop-' + args.distro + ':20261020-clock-v1'
    facts.update(baseImage=base, image=image)
    if args.distro == 'fedora':
        filename = 'Fedora-Container-Base-Generic-44-1.7.aarch64.oci.tar.xz'
        archive = BASES / filename
        assert digest(archive) == trust['archives'][filename]
        # This imports only the authenticated OS base, never an unpacked UWork
        # payload. The OCI image has one layer, with its whole digest chain checked.
        with tarfile.open(archive) as source:
            index = json.load(source.extractfile('index.json'))
            assert len(index['manifests']) == 1
            manifest_sha = index['manifests'][0]['digest'].removeprefix('sha256:')
            raw = source.extractfile('blobs/sha256/' + manifest_sha).read()
            assert hashlib.sha256(raw).hexdigest() == manifest_sha
            manifest = json.loads(raw)
            assert len(manifest['layers']) == 1
            config_sha = manifest['config']['digest'].removeprefix('sha256:')
            raw = source.extractfile('blobs/sha256/' + config_sha).read()
            assert hashlib.sha256(raw).hexdigest() == config_sha
            config = json.loads(raw)
            assert config['architecture'] == 'arm64' and config['os'] == 'linux'
            layer_sha = manifest['layers'][0]['digest'].removeprefix('sha256:')
            rootfs = BASES / 'fedora-original-layer.tar.gz'
            with source.extractfile('blobs/sha256/' + layer_sha) as input_file, rootfs.open('wb') as output:
                shutil.copyfileobj(input_file, output)
            assert digest(rootfs)['sha256'] == layer_sha
            facts['officialOci'] = {'manifestSha256': manifest_sha, 'configSha256': config_sha,
                                     'layerSha256': layer_sha, 'config': config}
    else:
        filename = 'ArchLinuxARM-aarch64-latest.tar.gz'
        rootfs = BASES / filename
        assert digest(rootfs) == trust['archives'][filename]
    facts['baseFilesystem'] = {'path': str(rootfs), **digest(rootfs)}
    run(DOCKER + ['image', 'import', '--platform=linux/arm64',
                  '--change', 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                  '--change', 'CMD ["/bin/bash"]', str(rootfs), base], 'base-import')
    context = CONTEXTS / args.distro
    context.mkdir(parents=True, exist_ok=True, mode=0o700)
    dockerfile = REPO / ('scripts/tests/linux-distro/' + ('Fedora' if args.distro == 'fedora' else 'Arch') + '.Dockerfile')
    shutil.copyfile(dockerfile, context / 'Dockerfile')
    wanted = json.loads((EVIDENCE / 'post-prune-preservation.json').read_text())['artifacts']
    name = 'UWork Preview-3.16.0-linux-aarch64.' + ('rpm' if args.distro == 'fedora' else 'pkg.tar.zst')
    local = context / ('uwork-preview.rpm' if args.distro == 'fedora' else 'uwork-preview.pkg.tar.zst')
    assert digest(local) == wanted[name]
    facts['package'] = {'path': str(local), **digest(local)}
    facts['dockerfile'] = {'path': str(dockerfile), **digest(dockerfile)}
    run(DOCKER + ['build', '--network=default', '--build-arg', 'DISTRO_BASE=' + base,
                  '-t', image, str(context)], 'consumer-build')
    inspect = subprocess.run(DOCKER + ['image', 'inspect', image], capture_output=True,
                              text=True, check=True)
    actual = json.loads(inspect.stdout)[0]
    assert actual['Architecture'] == 'arm64' and actual['Os'] == 'linux'
    facts['actualImage'] = {'id': actual['Id'], 'architecture': actual['Architecture'],
                            'os': actual['Os']}
    facts['status'] = 'passed'
except Exception as error:
    facts['failure'] = str(error)
    raise
finally:
    (EVIDENCE / (args.distro + '-consumer-result.json')).write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'image': facts.get('image')}))
