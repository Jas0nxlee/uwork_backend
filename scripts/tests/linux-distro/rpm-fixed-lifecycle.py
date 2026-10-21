"""Inside an owned Fedora clone: original same-NEVRA reinstall, verify installed hook, then original removal."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

facts = {'status': 'failed', 'scope': 'same-version new-build dnf reinstall then default dnf remove; not a fresh installation or GUI run', 'commands': []}


def command(args, timeout=240):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    facts['commands'].append({'args': args, 'exitCode': result.returncode,
                              'stdout': result.stdout, 'stderr': result.stderr})
    result.check_returncode()
    return result.stdout


try:
    candidate = '/input/candidate.rpm'
    expected_postun = command(['rpm', '-qp', '--qf', '%{POSTUN}', candidate])
    requires = command(['rpm', '-qp', '--requires', candidate]).splitlines()
    assert 'findutils' in requires, 'Native RPM header must declare its cleanup tool dependency'
    facts['candidateRequires'] = requires
    facts['candidatePostunSha256'] = hashlib.sha256(expected_postun.encode()).hexdigest()
    command(['dnf', '-y', 'reinstall', candidate])
    installed_postun = command(['rpm', '-q', '--qf', '%{POSTUN}', 'zcode-preview'])
    assert installed_postun == expected_postun, 'DNF must actually install the new same-NEVRA hook, not retain the old package'
    assert 'findutils' in command(['rpm', '-q', '--requires', 'zcode-preview']).splitlines()
    facts['installedPostunSha256'] = hashlib.sha256(installed_postun.encode()).hexdigest()
    facts['actualNewBuildInstalled'] = True
    # Reuse the unchanged assertions of the package lifecycle probe: all five
    # runtime hashes/permissions, manifest, database, aliases and empty root.
    result = subprocess.run([sys.executable, '/input/lifecycle.py', 'rpm', '--uninstall'],
                            capture_output=True, text=True, timeout=240)
    facts['commands'].append({'args': ['original lifecycle.py', 'rpm', '--uninstall'],
                              'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    facts['lifecycle'] = json.loads(Path('/work/lifecycle-result.json').read_text())
    assert result.returncode == 0 and facts['lifecycle']['status'] == 'passed', facts['lifecycle'].get('failure')
    facts['status'] = 'passed'
except Exception as error:
    facts['failure'] = str(error)
finally:
    Path('/work/fixed-rpm-result.json').write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'failure': facts.get('failure')}))
raise SystemExit(0 if facts['status'] == 'passed' else 1)
