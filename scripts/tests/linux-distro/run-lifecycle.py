"""Uninstall a real consumer-image clone; preserve the preceding GUI's owned profile."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('distro', choices=['fedora', 'arch'])
parser.add_argument('--name', required=True)
parser.add_argument('--gui-case')
parser.add_argument('--verify-install-only', action='store_true')
parser.add_argument('--image', required=True)
args = parser.parse_args()
assert args.name.startswith('client-linux-distro-' + args.distro + '-')
assert args.name.replace('-', '').isalnum()
if not args.verify_install_only:
    assert args.gui_case and args.gui_case.startswith('client-linux-desktop-' + args.distro + '-')
    assert args.gui_case.replace('-', '').isalnum()
assert args.image.startswith('uwork-linux-desktop-' + args.distro + ':')
container = 'uwork-' + args.name
shared = REPO / 'data/sandbox-verification' / args.name
input_dir = shared / 'input'
input_dir.mkdir(parents=True, mode=0o700)
evidence = REPO / 'evidence' / args.name
evidence.mkdir(mode=0o700)
if args.verify_install_only:
    work = shared / 'work'
    work.mkdir(mode=0o700)
else:
    work = REPO / 'data/sandbox-verification' / args.gui_case / 'work'
    assert work.is_dir()
expected = REPO / 'data/sandbox-verification/linux-native-packaging-v10-20261020/input/expected.json'
shutil.copy2(expected, input_dir / 'expected.json')
shutil.copy2(Path(__file__).with_name('lifecycle.py'), input_dir / 'lifecycle.py')
creation_attempted = False
facts = {'status': 'failed', 'container': container, 'guiCase': args.gui_case,
         'image': args.image, 'verifyInstallOnly': args.verify_install_only, 'transaction': 'separate writable clone of the same installed image; original GUI profile mounted',
         'receipts': [], 'cleanup': {}}


def docker(*command, check=True, timeout=240):
    result = subprocess.run(DOCKER + list(command), text=True, capture_output=True, timeout=timeout)
    facts['receipts'].append({'args': list(command), 'exitCode': result.returncode,
                              'stdout': result.stdout, 'stderr': result.stderr})
    if check:
        result.check_returncode()
    return result


try:
    assert docker('inspect', container, check=False).returncode != 0
    inspect = json.loads(docker('image', 'inspect', args.image).stdout)[0]
    facts['imageId'] = inspect['Id']
    if not args.verify_install_only:
        gui_result = json.loads((REPO / 'evidence' / args.gui_case / 'result.json').read_text())
        # GUI 失败也不阻止独立卸载取证，但只能在该轮进程/网络/隧道确已关闭后进行。
        facts['guiAcceptanceStatus'] = gui_result['status']
        assert all(gui_result.get(key) is True for key in ['containerAbsent', 'networkAbsent', 'tunnelExited'])
        assert gui_result['imageId'] == inspect['Id'], 'Uninstall must use exactly the real GUI installed image'
    command = ['run', '--name', container, '--network', 'none', '--memory', '768m', '--cpus', '1',
               '--security-opt', 'no-new-privileges',
               '--mount', f'type=bind,src={input_dir},dst=/input,readonly',
               '--mount', f'type=bind,src={work},dst=/work',
               '--entrypoint', 'python3', args.image, '/input/lifecycle.py',
               'rpm' if args.distro == 'fedora' else 'pacman']
    if args.verify_install_only:
        command.insert(1, '--read-only')
    else:
        command.append('--uninstall')
    creation_attempted = True
    result = docker(*command, check=False)
    actual = json.loads((work / 'lifecycle-result.json').read_text())
    shutil.copy2(work / 'lifecycle-result.json', evidence / 'lifecycle-result.json')
    assert result.returncode == 0 and actual['status'] == 'passed', actual.get('failure') or 'Original lifecycle failed'
    facts['status'] = 'passed'
except Exception as error:
    facts['failure'] = str(error)
finally:
    found = docker('inspect', container, check=False)
    if creation_attempted and found.returncode == 0:
        docker('rm', '-f', container)
    facts['cleanup']['containerAbsent'] = docker('inspect', container, check=False).returncode != 0
    if not facts['cleanup']['containerAbsent']:
        facts['status'] = 'failed'
    (evidence / 'controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'failure': facts.get('failure')}))
raise SystemExit(0 if facts['status'] == 'passed' else 1)
