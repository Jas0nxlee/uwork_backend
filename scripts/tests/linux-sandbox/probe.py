"""Bounded ordinary-UID original Electron sandbox proof in one owned Docker container."""
import argparse
import json
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import time
import urllib.request

REPO = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
DOCKER = ['docker', '--context', 'colima-uwork-backend']
IMAGE = 'uwork-linux-desktop-appimage:20261020-v6-capture'
Bridge = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge']


class ExpectedRejectionComplete(Exception):
    pass


def main(name, default_seccomp=False):
    assert name.startswith('client-linux-sandbox-') and name.replace('-', '').isalnum()
    evidence = REPO / 'evidence' / name
    evidence.mkdir(mode=0o700)
    work = REPO / 'data/sandbox-verification' / name
    work.mkdir(mode=0o700)
    inputs = work / 'input'
    inputs.mkdir(mode=0o755)
    for file in ['entry.sh', 'processes.mjs']:
        shutil.copyfile(HERE / file, inputs / file)
    inputs.chmod(0o755)
    container = network = 'uwork-' + name
    facts = {'status': 'failed', 'image': IMAGE, 'ordinaryUid': 1000,
             'productSandboxDisablingFlags': [], 'externalServices': False,
             'defaultOuterSeccomp': default_seccomp}
    tunnel = bridge = None
    created_network = created_container = False
    hash_container = container + '-sha'
    hash_started = False

    def docker(*args, check=True, timeout=30):
        return subprocess.run(DOCKER + list(args), capture_output=True, text=True, check=check, timeout=timeout)

    try:
        facts['imageId'] = docker('image', 'inspect', '--format', '{{.Id}}', IMAGE).stdout.strip()
        assert docker('container', 'inspect', hash_container, check=False).returncode != 0
        hash_started = True
        facts['artifactSha256'] = docker('run', '--rm', '--name', hash_container, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--entrypoint', 'sha256sum', IMAGE, '/opt/artifacts/uwork-preview.AppImage', timeout=90).stdout.split()[0]
        for relaxed in [False, True]:
            result = docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                '--user', '1000:1000', '--security-opt', 'no-new-privileges',
                *(['--security-opt', 'seccomp=unconfined'] if relaxed else []), '--entrypoint', '/bin/sh', IMAGE,
                '-c', 'unshare -Ur /bin/sh -c "id; cat /proc/self/uid_map; sed -n /NoNewPrivs/p /proc/self/status; sed -n /Seccomp/p /proc/self/status"', check=False)
            facts['unconfined' if relaxed else 'defaultSeccomp'] = {'exitCode': result.returncode,
                'stdout': result.stdout, 'stderr': result.stderr}
        assert facts['defaultSeccomp']['exitCode'] != 0
        assert facts['unconfined']['exitCode'] == 0
        assert docker('network', 'inspect', network, check=False).returncode != 0
        assert docker('container', 'inspect', container, check=False).returncode != 0
        docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
               '--mount', f'type=bind,src={work},dst=/work', '--entrypoint', 'chown', IMAGE, '1000:1000', '/work')
        docker('network', 'create', '--internal', network)
        created_network = True
        docker('run', '-d', '--name', container, '--init', '--network', network, '--read-only', '--cap-drop', 'ALL',
               '--user', '1000:1000', '--security-opt', 'no-new-privileges',
               *([] if default_seccomp else ['--security-opt', 'seccomp=unconfined']),
               '--tmpfs', '/tmp:rw,nosuid,exec,size=128m', '--shm-size', '256m',
               '--mount', f'type=bind,src={work},dst=/work',
               '--mount', f'type=bind,src={inputs},dst=/probe,readonly', '--entrypoint', '/bin/sh', IMAGE, '/probe/entry.sh')
        created_container = True
        config = json.loads(docker('inspect', container).stdout)[0]
        facts['outerContainer'] = {'user': config['Config']['User'], 'capDrop': config['HostConfig']['CapDrop'],
            'securityOpt': config['HostConfig']['SecurityOpt'], 'readonlyRootfs': config['HostConfig']['ReadonlyRootfs'],
            'privileged': config['HostConfig']['Privileged'], 'pidMode': config['HostConfig']['PidMode'],
            'internalNetwork': json.loads(docker('network', 'inspect', network).stdout)[0]['Internal']}
        if default_seccomp:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                state = json.loads(docker('inspect', container).stdout)[0]['State']
                if not state['Running']:
                    facts['containerExitCode'] = state['ExitCode']
                    break
                time.sleep(.2)
            else:
                raise AssertionError('Default outer seccomp did not produce bounded startup rejection')
            log = (work / 'desktop.log').read_text()
            facts['namespaceRejection'] = 'Failed to move to new namespace' in log and 'Operation not permitted' in log
            facts['suidHelperFallbackRejection'] = ('The SUID sandbox helper binary was found, but is not configured correctly' in log
                and 'Rather than run without sandboxing' in log and 'aborting now' in log)
            assert facts['containerExitCode'] != 0 and (facts['namespaceRejection'] or facts['suidHelperFallbackRejection'])
            facts['status'] = 'passed-expected-rejection'
            raise ExpectedRejectionComplete()
        ip = next(iter(config['NetworkSettings']['Networks'].values()))['IPAddress']
        socket.inet_aton(ip)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        ssh_config = work / 'ssh-config'
        ssh_config.write_text(subprocess.check_output(['colima', 'ssh-config', '--profile', 'uwork-backend'], text=True))
        ssh_config.chmod(0o600)
        with (evidence / 'tunnel.log').open('w') as log:
            tunnel = subprocess.Popen(['/usr/bin/ssh', '-F', str(ssh_config), '-S', 'none', '-N',
                '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes',
                '-L', f'127.0.0.1:{port}:{ip}:9333', 'colima-uwork-backend'], stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        facts['tunnelPid'] = tunnel.pid
        deadline = time.monotonic() + 70
        while time.monotonic() < deadline:
            assert tunnel.poll() is None
            state = json.loads(docker('inspect', container).stdout)[0]['State']
            if not state['Running']:
                facts['containerExit'] = state
                raise AssertionError('Original Electron exited before owned CDP ready')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2) as response:
                    targets = json.load(response)
                facts['targets'] = [{'type': row['type'], 'url': row.get('url', '')[:500]} for row in targets]
                if any(row.get('url', '').startswith('file:///work/extract/') for row in targets):
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.3)
        else:
            raise AssertionError('Original Electron CDP unavailable')
        bridge = Bridge(port, renderer_prefix='file:///work/extract/', evidence=evidence)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            facts['projection'] = bridge.evaluate('''(()=>({readyState:document.readyState,origin:location.protocol,
                onboarding:!!document.querySelector('[data-testid="onboarding-page"]'),
                login:!!document.querySelector('[data-testid="enterprise-login-page"]'),
                rootChildren:document.getElementById('root')?.childElementCount??0}))()''')
            if facts['projection']['onboarding'] or facts['projection']['login']:
                break
            time.sleep(.2)
        assert facts['projection']['readyState'] == 'complete'
        assert facts['projection']['onboarding'] or facts['projection']['login']
        facts['processes'] = json.loads(docker('exec', container, 'node', '/probe/processes.mjs').stdout)
        browser_session = bridge.raw_cdp('Target.attachToBrowserTarget')['sessionId']
        facts['cdpProcessInfo'] = bridge.raw_cdp('SystemInfo.getProcessInfo', session_id=browser_session)['processInfo']
        renderer_ids = {row['id'] for row in facts['cdpProcessInfo'] if row['type'] == 'renderer'}
        renderers = [row for row in facts['processes'] if row['pid'] in renderer_ids]
        assert renderers, 'No original renderer process captured'
        assert all(row['fields']['NoNewPrivs'] == '1' and row['fields']['Seccomp'] == '2' for row in renderers)
        assert all('1000' == row['fields']['Uid'].split()[0] for row in renderers)
        assert all(len(row['fields']['NSpid'].split()) > 1 for row in renderers), 'Renderer PID namespace absent'
        browser_ids = {row['id'] for row in facts['cdpProcessInfo'] if row['type'] == 'browser'}
        browser = [row for row in facts['processes'] if row['pid'] in browser_ids]
        assert len(browser) == 1 and browser[0]['fields']['Seccomp'] == '0'
        for row in renderers:
            for kind in ['pid', 'user', 'net']:
                assert isinstance(row['namespaces'][kind], str)
                assert row['namespaces'][kind] != browser[0]['namespaces'][kind]
        assert all('--no-sandbox' not in row['args'] and '--disable-setuid-sandbox' not in row['args'] for row in facts['processes'])
        facts['status'] = 'passed'
    except ExpectedRejectionComplete:
        pass
    except BaseException as error:
        facts['error'] = type(error).__name__ + ': ' + str(error)[:800]
        if isinstance(error, subprocess.CalledProcessError):
            facts['commandStderr'] = error.stderr[-2000:] if error.stderr else ''
            facts['commandStdout'] = error.stdout[-2000:] if error.stdout else ''
    finally:
        if hash_started:
            state = docker('container', 'inspect', hash_container, check=False)
            if state.returncode == 0:
                config = json.loads(state.stdout)[0]
                assert config['Config']['Image'] == IMAGE
                assert config['Config']['Entrypoint'] == ['sha256sum']
                assert config['Config']['Cmd'] == ['/opt/artifacts/uwork-preview.AppImage']
                docker('rm', '-f', hash_container)
            facts['hashContainerAbsent'] = docker('container', 'inspect', hash_container, check=False).returncode != 0
        if created_container:
            result = docker('exec', container, 'node', '/probe/processes.mjs', check=False)
            if result.returncode == 0:
                facts.setdefault('processes', json.loads(result.stdout))
            if (work / 'desktop.log').exists():
                (evidence / 'desktop.log').write_text((work / 'desktop.log').read_text())
        if bridge:
            bridge.kill()
        if tunnel:
            tunnel.terminate()
            try: tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait(timeout=5)
            facts['tunnelClosed'] = tunnel.poll() is not None
        if created_container:
            docker('rm', '-f', container)
            facts['containerAbsent'] = docker('container', 'inspect', container, check=False).returncode != 0
        if created_network:
            docker('network', 'rm', network)
            facts['networkAbsent'] = docker('network', 'inspect', network, check=False).returncode != 0
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps({'status': facts['status'], 'evidence': str(evidence), 'error': facts.get('error')}))
    return 0 if facts['status'] in ['passed', 'passed-expected-rejection'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('name')
    parser.add_argument('--default-seccomp', action='store_true')
    args = parser.parse_args()
    raise SystemExit(main(args.name, args.default_seccomp))
