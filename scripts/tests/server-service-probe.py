"""Original macOS server CLI registration in a fresh root; never target an existing install."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parents[2]
NODE = Path('/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node')
ENTRY = REPO / 'clients/uwork/packages/zcode-server-cli/dist/server-cli.js'


def path_id(value):
    result = 2166136261
    for char in value:
        result = ((result ^ ord(char)) * 16777619) & 0xffffffff
    return f'{result:08x}'


def run(name):
    evidence = REPO / 'evidence' / name
    evidence.mkdir(mode=0o700)
    scratch = Path(tempfile.mkdtemp(prefix='uwsvc-', dir='/tmp')).resolve()
    root = scratch / 'server'
    root.mkdir(mode=0o700)
    home = scratch / 'home'
    home.mkdir(mode=0o700)
    tmp = scratch / 'tmp'
    tmp.mkdir(mode=0o700)
    label = 'com.zhipu.zcode.server.' + path_id(str(root))
    domain = f'gui/{os.getuid()}/{label}'
    descriptor = root / 'service' / (label + '.plist')
    env = {'PATH': str(NODE.parent) + ':/usr/bin:/bin:/usr/sbin:/sbin',
           'HOME': str(home), 'TMPDIR': str(tmp), 'NODE_ENV': 'production',
           'ZCODE_DATA_BASE_DIR': str(root), 'ZCODE_SERVER_ROOT': str(root),
           'LC_ALL': 'C'}
    facts = {'status': 'failed', 'root': str(root), 'label': label,
             'entrySha256': hashlib.sha256(ENTRY.read_bytes()).hexdigest(),
             'commands': [], 'checks': []}
    pids, ports = set(), set()

    def job():
        return subprocess.run(['launchctl', 'print', domain], capture_output=True, text=True, timeout=5)

    def cli(*args, timeout=40):
        result = subprocess.run([str(NODE), str(ENTRY), *args, '--server-root', str(root), '--json'],
                                env=env, cwd=root, capture_output=True, text=True, timeout=timeout)
        rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        value = rows[-1] if rows else None
        facts['commands'].append({'args': list(args), 'exitCode': result.returncode, 'result': value,
                                  'stderr': result.stderr[-1500:]})
        if isinstance(value, dict) and value.get('pid'):
            pids.add(value['pid'])
        if isinstance(value, dict) and value.get('port'):
            ports.add(value['port'])
        assert result.returncode == 0 and isinstance(value, dict), f'CLI {args[0]} failed'
        return value

    def owned_descriptor():
        value = plistlib.loads(descriptor.read_bytes())
        assert value['Label'] == label
        assert value['ProgramArguments'] == [str(root / 'bin/zcode'), 'serve', '--supervisor',
                                            '--service-entry', '--server-root', str(root)]
        return value

    try:
        before = job()
        assert before.returncode != 0 and 'Could not find service' in before.stderr, 'Unique label must be absent'
        facts['checks'].append('unique-label-absent-before')
        ready = cli('serve', '--daemon')
        assert ready['state'] == 'ready' and ready['serviceRegistered']
        owned_descriptor()
        registered = job()
        assert registered.returncode == 0 and str(root / 'bin/zcode') in registered.stdout
        supervisor = next(int(line.split('=')[1]) for line in registered.stdout.splitlines()
                          if line.strip().startswith('pid ='))
        pids.add(supervisor)
        facts['supervisorPid'] = supervisor
        facts['checks'].append('original-daemon-registered-ready')
        with urllib.request.urlopen(f"http://127.0.0.1:{ready['port']}/api/server-info", timeout=5) as response:
            facts['httpStatus'] = response.status
            info = json.load(response)
            assert info['capabilities']['websocketRpc'] and info['authRequired'] is False
        again = cli('serve', '--daemon')
        assert again['pid'] == ready['pid'] and again['generation'] == ready['generation']
        facts['checks'].append('repeated-daemon-idempotent')
        requested = cli('restart')
        assert requested == {'restarting': True}
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            restarted = cli('status')
            if restarted['state'] == 'ready' and restarted['pid'] != ready['pid']:
                break
            time.sleep(.2)
        assert restarted['state'] == 'ready' and restarted['pid'] != ready['pid']
        facts['checks'].append('original-restart-new-core')
        cli('stop')
        # 主动 stop 后观察 12 秒，确认本轮窗口内没有被 launchd 再次拉起。
        time.sleep(12)
        stopped = cli('status')
        assert stopped['state'] == 'stopped' and stopped['pid'] is None
        facts['checks'].append('stop-remains-stopped')
        # 每次看到原确认提示后才输入一次 DELETE，仅操作本轮新建根。
        child = subprocess.Popen([str(NODE), str(ENTRY), 'uninstall', '--server-root', str(root), '--json'],
                                 env=env, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        import select
        output = ''
        deadline = time.monotonic() + 20
        confirmations = 0
        while child.poll() is None and time.monotonic() < deadline:
            if select.select([child.stdout], [], [], .1)[0]:
                output += os.read(child.stdout.fileno(), 4096).decode()
                prompts = output.count('Type DELETE')
                if prompts > confirmations:
                    assert prompts == confirmations + 1 and prompts <= 2
                    child.stdin.write('DELETE\n')
                    child.stdin.flush()
                    confirmations += 1
        if child.poll() is None:
            child.kill()
        rest, error = child.communicate(timeout=5)
        output += rest
        facts['uninstall'] = {'exitCode': child.returncode, 'confirmations': confirmations,
                              'stderr': error[-1500:]}
        assert child.returncode == 0 and confirmations == 2 and '"uninstalled":true' in output
        facts['checks'].append('original-uninstall-double-confirmation')
        assert job().returncode != 0 and not descriptor.exists()
        facts['status'] = 'passed'
    except BaseException as error:
        facts['failure'] = f'{type(error).__name__}: {error}'
    finally:
        cleanup = {}
        observed = job()
        if observed.returncode == 0:
            owned_descriptor()
            assert str(root / 'bin/zcode') in observed.stdout
            for line in observed.stdout.splitlines():
                if line.strip().startswith('pid ='):
                    pids.add(int(line.split('=')[1]))
            status_file = root / 'run/status.json'
            if status_file.exists():
                status = json.loads(status_file.read_text())
                if status.get('pid'):
                    pids.add(status['pid'])
                if status.get('port'):
                    ports.add(status['port'])
            try:
                cli('stop', timeout=20)
            except (AssertionError, subprocess.TimeoutExpired):
                pass
            removed = subprocess.run(['launchctl', 'unload', '-w', str(descriptor)],
                                     capture_output=True, text=True, timeout=10)
            cleanup['unloadExitCode'] = removed.returncode
        after = job()
        cleanup['jobAbsent'] = after.returncode != 0 and 'Could not find service' in after.stderr
        cleanup['pidsAbsent'] = {str(pid): subprocess.run(['ps', '-p', str(pid), '-o', 'pid='],
                                                        capture_output=True).returncode == 1 for pid in pids}
        cleanup['portsClosed'] = {}
        for port in ports:
            with socket.socket() as connection:
                connection.settimeout(.5)
                cleanup['portsClosed'][str(port)] = connection.connect_ex(('127.0.0.1', port)) != 0
        facts['cleanup'] = cleanup
        if not cleanup['jobAbsent'] or not all(cleanup['pidsAbsent'].values()) or not all(cleanup['portsClosed'].values()):
            facts['status'] = 'failed'
        (evidence / 'result.json').write_text(json.dumps(facts, indent=2) + '\n')
    print(json.dumps(facts))
    return facts['status'] == 'passed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    args = parser.parse_args()
    assert args.name.startswith('client-server-service-') and '/' not in args.name
    raise SystemExit(0 if run(args.name) else 1)
