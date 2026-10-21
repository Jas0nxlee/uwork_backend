"""Check self-close receipts in an isolated instance of the installed Chrome before OS launch."""
import json
import argparse
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import time
from owned_external_page import OwnedExternalPage
from owned_chrome_tab_witness import inspect_owned_tab

REPO = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name', default='client-external-page-preflight-20261020')
args = parser.parse_args()
assert args.name.startswith('client-external-page-') and '/' not in args.name
evidence = REPO / 'evidence' / args.name
evidence.mkdir(mode=0o700)
scratch = Path(tempfile.mkdtemp(prefix='uwxp-', dir='/tmp'))
profile = scratch / 'chrome'
chrome_path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
log = (evidence / 'chrome.log').open('w')
chrome = subprocess.Popen([chrome_path, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--disable-extensions', '--no-proxy-server',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + str(profile), 'about:blank'],
    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
bridge = page = None
proof = {'status': 'failed', 'usesPersonalProfile': False, 'chromePid': chrome.pid, 'scratch': str(scratch)}
try:
    deadline = time.monotonic() + 20
    while not (profile / 'DevToolsActivePort').exists():
        assert chrome.poll() is None and time.monotonic() < deadline
        time.sleep(.1)
    port = int((profile / 'DevToolsActivePort').read_text().splitlines()[0])
    bridge = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))['HarnessBridge'](port, evidence=evidence)
    version = bridge.raw_cdp('Browser.getVersion')
    chrome_major = int(version['product'].split('/')[1].split('.')[0])
    page = OwnedExternalPage(evidence)
    page.arm_external(require_embedded=False)
    # 直接创建带初始 URL 的新标签；new_tab 的 blank→navigate 两步会留下额外历史项。
    code = 'cdp("Target.createTarget",url=' + repr(page.url) + ')\n'
    child = subprocess.run(['/Users/ljp/.local/bin/browser-harness'], input=code, text=True,
                           capture_output=True, cwd=bridge.root, env=bridge.env, timeout=15)
    assert child.returncode == 0, 'Owned Chrome new tab failed'
    page.wait('external', 'ready')
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        before = inspect_owned_tab(chrome.pid, page.title)
        if before['complete'] and before['tabMatches']:
            break
        time.sleep(.1)
    proof['tabBeforeClose'] = before
    assert before['complete'] and before['tabMatches'], 'Owned native Chrome tab must be observable'
    proof.update(page.verify_external(chrome_major))
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        after = inspect_owned_tab(chrome.pid, page.title)
        if after['complete'] and not after['tabMatches'] and not after['windowMatches']:
            break
        time.sleep(.1)
    proof['tabAfterClose'] = after
    assert after['complete'] and not after['tabMatches'] and not after['windowMatches']
    proof['status'] = 'passed'
finally:
    if page:
        page.close()
    if bridge:
        bridge.kill()
    if chrome.poll() is None:
        chrome.terminate(); chrome.wait(timeout=15)
    log.close()
    proof['chromeExited'] = chrome.poll() is not None
    (evidence / 'preflight-result.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
