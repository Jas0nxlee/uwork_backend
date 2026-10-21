"""Finite named readonly hash preflight. Completion never enters a GUI phase."""
import json
import subprocess


def preflight_command(docker, image, name):
    assert name.startswith('uwork-wire-') and name.replace('-', '').isalnum()
    assert image in ['uwork-linux-desktop-appimage:20261020-wire-v1',
                     'uwork-linux-desktop-appimage:20261020-pty-wire-v1']
    return docker + ['run', '--rm', '--name', name, '--network', 'none', '--read-only',
                     '--cap-drop', 'ALL', '--entrypoint', 'sha256sum', image,
                     '/opt/artifacts/uwork-preview.AppImage']


def inspect_container(docker, name):
    result = subprocess.run(docker + ['inspect', name], capture_output=True, text=True, timeout=10)
    if result.returncode == 0:
        return json.loads(result.stdout)[0]
    prefix, separator, missing_name = result.stderr.strip().rpartition(': ')
    absent = ['error: no such object', 'error: no such container',
              'error response from daemon: no such container',
              'error response from daemon: no such object']
    if separator and missing_name == name and prefix.casefold() in absent:
        return None
    raise RuntimeError('Docker inspect failed; exact owned container absence is unknown (exit ' + str(result.returncode) + ')')


def run_preflight(docker, image, name, expected, receipt_path):
    argv = preflight_command(docker, image, name)
    facts = {'status': 'failed', 'command': argv, 'guiStarted': False, 'ownedContainerAbsent': False}
    launched = False
    try:
        assert inspect_container(docker, name) is None, 'Fresh owned preflight name required'
        launched = True
        result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        facts.update(exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr)
        assert result.returncode == 0 and result.stdout.split()[0] == expected
        assert inspect_container(docker, name) is None, 'Natural --rm completion required'
        facts['status'] = 'passed-readonly-preflight-only'
    except BaseException as error:
        facts['failure'] = {'type': type(error).__name__, 'message': str(error)[:500]}
    finally:
        try:
            remaining = inspect_container(docker, name)
            if remaining and launched:
                assert remaining['Config']['Image'] == image
                assert remaining['Config']['Entrypoint'] == ['sha256sum']
                assert remaining['Config']['Cmd'] == ['/opt/artifacts/uwork-preview.AppImage']
                removed = subprocess.run(docker + ['rm', '-f', name], capture_output=True, text=True, timeout=15)
                facts['ownedPreflightRemoval'] = {'exitCode': removed.returncode}
                facts['status'] = 'failed'
            facts['ownedContainerAbsent'] = inspect_container(docker, name) is None
        except BaseException as error:
            facts['status'] = 'failed'
            facts['cleanupFailure'] = {'type': type(error).__name__, 'message': str(error)[:500]}
        finally:
            receipt_path.write_text(json.dumps(facts, indent=2) + '\n')
    assert facts['status'] == 'passed-readonly-preflight-only' and facts['ownedContainerAbsent'], 'Preflight failed; GUI phase forbidden'
    return facts['stdout']
