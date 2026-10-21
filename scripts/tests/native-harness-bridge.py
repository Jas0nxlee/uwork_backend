"""Finite CDP calls through browser-harness, scoped to one owned Electron endpoint."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time

HARNESS = '/Users/ljp/.local/bin/browser-harness'


class HarnessBridge:
    def __init__(self, port, renderer_prefix=None, evidence=None):
        if type(port) is not int or not 0 < port < 65536:
            raise ValueError('Owned CDP port required')
        self.root = Path(tempfile.mkdtemp(prefix='uwbh-', dir='/tmp'))
        self.evidence = evidence
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(('BU_', 'BH_', 'BROWSER_', 'ZCODE_', 'UWORK_', 'ELECTRON_'))}
        self.env.update(BH_HOME=str(self.root), BH_RUNTIME_DIR=str(self.root / 'runtime'),
                        BH_CONFIG_DIR=str(self.root), BH_AGENT_WORKSPACE=str(self.root / 'workspace'),
                        BH_TMP_DIR=str(self.root / 'tmp'), BU_NAME='default',
                        BU_CDP_URL=f'http://127.0.0.1:{port}', BH_RECORD='0', BH_TELEMETRY='0')
        self.calls = 0
        self.session = None
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                targets = self.raw_cdp('Target.getTargets')['targetInfos']
                pages = [t for t in targets if t['type'] == 'page'
                         and (not renderer_prefix or t['url'].startswith(renderer_prefix))]
                if len(pages) == 1:
                    self.session = self.raw_cdp('Target.attachToTarget', targetId=pages[0]['targetId'], flatten=True)['sessionId']
                    self.target = pages[0]['url']
                    break
                time.sleep(.2)
            if not self.session:
                raise RuntimeError('One owned renderer required')
        except BaseException:
            self.kill()
            raise

    def raw_cdp(self, method, session_id=None, **params):
        self.calls += 1
        payload = {'method': method, 'session_id': session_id or self.session, **params}
        # 标准 CDP 原样由 browser-harness 发送，不导入产品模块或改写业务响应。
        code = ('import json\np=json.loads(' + repr(json.dumps(payload)) + ')\n'
                'print("UW_RESULT="+json.dumps(cdp(**p),ensure_ascii=False))\n')
        child = subprocess.run([HARNESS], input=code, text=True, capture_output=True,
                               cwd=self.root, env=self.env, timeout=35)
        rows = [line[10:] for line in child.stdout.splitlines() if line.startswith('UW_RESULT=')]
        if child.returncode or len(rows) != 1:
            raise RuntimeError('Owned harness CDP failed: ' + child.stderr[-400:])
        return json.loads(rows[0])

    def evaluate(self, expression, seconds=20):
        result = self.raw_cdp('Runtime.evaluate', expression=expression, returnByValue=True, awaitPromise=False)
        if 'exceptionDetails' in result:
            raise RuntimeError('Renderer projection failed')
        value = result.get('result', {}).get('value')
        if not isinstance(value, dict):
            raise RuntimeError('Expected bounded object projection')
        return value

    def kill(self):
        facts = {'root': str(self.root), 'calls': self.calls, 'retainedMode0700': True}
        for path in (self.root / 'runtime').glob('*.pid'):
            pid = int(path.read_text().strip())
            command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
            fds = subprocess.run(['lsof', '-nP', '-a', '-p', str(pid), '-U', '-Fn'], capture_output=True, text=True).stdout
            exact_socket = str((self.root / 'runtime/bu.sock').resolve())
            if 'browser_harness.daemon' in command and 'n' + exact_socket in fds.splitlines():
                os.kill(pid, signal.SIGTERM)
                facts['daemonPid'] = pid
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if not subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout.strip():
                        facts['daemonAbsent'] = True
                        break
                    time.sleep(.1)
        with socket.socket(socket.AF_UNIX) as probe:
            probe.settimeout(.5)
            facts['socketClosed'] = probe.connect_ex(str(self.root / 'runtime/bu.sock')) != 0
        if self.evidence:
            (self.evidence / 'harness-cleanup.json').write_text(json.dumps(facts, indent=2) + '\n')
