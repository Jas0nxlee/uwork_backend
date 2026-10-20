"""Run legacy UI contracts against an owned headless browser, never user Chrome."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]
NODE = Path.home() / '.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
CHROME = Path.home() / '.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7928.2/chrome-headless-shell-mac-arm64/chrome-headless-shell'
SUITES = ('enterpriseConsole', 'enterpriseIdentity', 'enterpriseIdentityOrganizations', 'clientPresentation')


def run(evidence, suites):
    evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
    # macOS 默认临时目录过长，会超过 browser-harness 的 Unix socket 路径上限。
    scratch = Path(tempfile.mkdtemp(prefix='uwbc-', dir='/tmp'))
    profile, bh = scratch / 'chrome', scratch / 'bh'
    profile.mkdir()
    bh.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith(('BU_', 'BH_', 'BROWSER_', 'ZCODE_', 'UWORK_', 'ELECTRON_'))}
    env['PATH'] = str(NODE.parent) + os.pathsep + env['PATH']
    env.update(BH_HOME=str(bh), BH_RUNTIME_DIR=str(bh / 'runtime'), BH_TMP_DIR=str(bh / 'tmp'),
               BH_CONFIG_DIR=str(bh), BH_AGENT_WORKSPACE=str(bh / 'workspace'), BU_NAME='default',
               BH_RECORD='0', BH_TELEMETRY='0', NO_PROXY='127.0.0.1,localhost')
    result = {'scratch': str(scratch), 'suites': [], 'externalIntegrations': False}
    chrome_log = (evidence / 'chrome.log').open('w')
    chrome = subprocess.Popen([str(CHROME), '--headless', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        '--user-data-dir=' + str(profile), 'about:blank'], stdout=chrome_log, stderr=subprocess.STDOUT, start_new_session=True)
    result['chromePid'] = chrome.pid
    try:
        deadline = time.monotonic() + 20
        while not (profile / 'DevToolsActivePort').exists():
            if chrome.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('Owned Chrome did not expose CDP')
            time.sleep(.1)
        port = int((profile / 'DevToolsActivePort').read_text().splitlines()[0])
        env['BU_CDP_URL'] = f'http://127.0.0.1:{port}'
        result['cdpPort'] = port
        for suite in suites:
            started = time.monotonic()
            with (evidence / (suite + '.log')).open('w') as log:
                child = subprocess.Popen([str(NODE), f'packages/ui/test/{suite}.e2e.mjs'],
                    cwd=REPO / 'clients/uwork', env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    code = child.wait(timeout=180)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=10)
                    code = 'timeout'
            row = {'suite': suite, 'exitCode': code, 'seconds': round(time.monotonic() - started, 3)}
            result['suites'].append(row)
            print(json.dumps(row), flush=True)
    finally:
        # Only terminate the daemon identified by this run's private PID file.
        for path in (bh / 'runtime').glob('*.pid'):
            pid = int(path.read_text().strip())
            command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
            sockets = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-U', '-Fn'], capture_output=True, text=True).stdout
            # daemon 的命令行不含 BH_HOME；以私有 PID 文件和实际 socket 属主双重验证。
            socket_owned = any(line.startswith('n/') and Path(line[1:]).resolve() == (bh / 'runtime/bu.sock').resolve() for line in sockets.splitlines())
            if 'browser_harness.daemon' in command and socket_owned:
                os.kill(pid, signal.SIGTERM)
                result['daemonPid'] = pid
        if chrome.poll() is None:
            os.killpg(chrome.pid, signal.SIGTERM)
            chrome.wait(timeout=15)
        chrome_log.close()
        result['chromeExitCode'] = chrome.returncode
        deadline = time.monotonic() + 5
        daemon_pid = result.get('daemonPid')
        while daemon_pid and time.monotonic() < deadline:
            alive = subprocess.run(['ps', '-p', str(daemon_pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
            if not alive:
                break
            time.sleep(.1)
        daemon_absent = not daemon_pid or not subprocess.run(['ps', '-p', str(daemon_pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(.5)
            socket_closed = probe.connect_ex(str(bh / 'runtime/bu.sock')) != 0
        with socket.socket() as probe:
            probe.settimeout(.5)
            port_closed = 'cdpPort' not in result or probe.connect_ex(('127.0.0.1', result['cdpPort'])) != 0
        result['cleanup'] = {'daemonAbsent': daemon_absent, 'socketClosed': socket_closed, 'cdpClosed': port_closed, 'scratchRetained': True}
        result['passed'] = (len(result['suites']) == len(suites) and all(row['exitCode'] == 0 for row in result['suites'])
                            and daemon_absent and socket_closed and port_closed)
        (evidence / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    return result['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--suite', action='append', choices=SUITES)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.evidence.resolve(), args.suite or SUITES) else 1)
