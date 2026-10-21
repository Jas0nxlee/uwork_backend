"""Real distribution package database, runtime bytes, and owned uninstall proof."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('kind', choices=['rpm', 'pacman'])
parser.add_argument('--uninstall', action='store_true')
args = parser.parse_args()
facts = {'status': 'failed', 'kind': args.kind, 'receipts': []}
root = Path('/opt/UWork Preview')


def execute(command, check=True):
    result = subprocess.run(command, text=True, capture_output=True, timeout=180)
    facts['receipts'].append({'command': command, 'returncode': result.returncode,
                             'stdout': result.stdout, 'stderr': result.stderr})
    if check:
        result.check_returncode()
    return result


try:
    expected = json.loads(Path('/input/expected.json').read_text())['runtimeFiles']
    query = ['rpm', '-q', '--qf', '%{NAME} %{VERSION} %{ARCH}', 'zcode-preview'] if args.kind == 'rpm' else ['pacman', '-Q', 'zcode-preview']
    actual = execute(query).stdout.strip()
    assert actual == ('zcode-preview 3.16.0 aarch64' if args.kind == 'rpm' else 'zcode-preview 3.16.0-1'), actual
    files = execute(['rpm', '-ql', 'zcode-preview'] if args.kind == 'rpm' else ['pacman', '-Qlq', 'zcode-preview']).stdout.splitlines()
    facts['installed'] = {'metadata': actual, 'manifest': files,
                          'launcherRealpath': os.path.realpath('/usr/bin/zcode-preview'),
                          'core': {}}
    assert facts['installed']['launcherRealpath'] == str(root / 'zcode-preview')
    facts['installed']['desktop'] = Path('/usr/share/applications/zcode-preview.desktop').read_text()
    assert 'x-scheme-handler/zcode' in facts['installed']['desktop']
    for relative, wanted in expected.items():
        path = root / relative
        with path.open('rb') as source:
            sha = hashlib.file_digest(source, 'sha256').hexdigest()
        actual = {'bytes': path.stat().st_size, 'sha256': sha}
        assert actual == wanted, relative
        assert path.stat().st_mode & 0o004, relative
        for parent in path.parents:
            if parent == Path('/opt'):
                break
            assert parent.stat().st_mode & 0o005 == 0o005, str(parent)
        if relative == 'zcode-preview':
            assert path.stat().st_mode & 0o001
        facts['installed']['core'][relative] = actual
    if args.uninstall:
        execute(['dnf', '-y', 'remove', 'zcode-preview'] if args.kind == 'rpm' else ['pacman', '-R', '--noconfirm', 'zcode-preview'])
        assert execute(query, check=False).returncode != 0
        remaining = [path for path in files if os.path.lexists(path) and
                     not Path(path).is_dir()]
        # Directories shared with unrelated packages are not stale app files.
        assert remaining == [], remaining
        watched = [str(root), '/usr/bin/zcode-preview', '/etc/alternatives/zcode-preview',
                   '/usr/share/applications/zcode-preview.desktop']
        facts['after'] = {path: os.path.lexists(path) for path in watched}
        facts['afterDetails'] = {}
        for value in watched:
            path = Path(value)
            if not os.path.lexists(path):
                continue
            info = path.lstat()
            facts['afterDetails'][value] = {'mode': oct(info.st_mode), 'bytes': info.st_size,
                                            'symlinkTarget': os.readlink(path) if path.is_symlink() else None,
                                            'children': sorted(child.name for child in path.iterdir()) if path.is_dir() else None}
        if root.is_dir():
            facts['remainingProgramTree'] = []
            for index, path in enumerate(root.rglob('*')):
                if index >= 1500:
                    facts['remainingProgramTreeTruncated'] = True
                    break
                facts['remainingProgramTree'].append({'path': str(path.relative_to(root)),
                                                       'directory': path.is_dir(), 'symlink': path.is_symlink()})
        user_desktop = Path('/work/share/applications/zcode.desktop')
        facts['retainedUserRegistration'] = {
            'path': str(user_desktop), 'exists': user_desktop.exists(),
            'content': user_desktop.read_text() if user_desktop.exists() else None,
            'defaultQuery': execute(['xdg-mime', 'query', 'default',
                                     'x-scheme-handler/zcode'], check=False).stdout.strip(),
        }
        assert not any(facts['after'].values()), facts['after']
    facts['status'] = 'passed'
except Exception as error:
    facts['failure'] = str(error)
    raise
finally:
    Path('/work/lifecycle-result.json').write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'kind': args.kind, 'uninstalled': args.uninstall}))
