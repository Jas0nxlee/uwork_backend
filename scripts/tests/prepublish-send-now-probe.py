"""One new original UI consumer: queue send-now preemption and remaining FIFO."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(ROOT/'scripts/tests/native-g04k-cdp-probe.py'))
HARNESS = runpy.run_path(str(ROOT/'scripts/tests/native-harness-bridge.py'))
FIRST = runpy.run_path(str(ROOT/'scripts/fixtures/native-first-run-ui.py'))
NODE = BASE['NODE24']
profile = sys.argv[1]
assert re.fullmatch(r'client-native-prepublish-v\d+-20261021', profile)
evidence = ROOT/'evidence'/profile
evidence.mkdir(mode=0o700)
for name in ['home', 'tmp']:
    (evidence/name).mkdir(mode=0o700)


class Fixture(BASE['Fixture']):
    def __init__(self):
        self.profile, self.events, self.lock = profile, [], threading.Lock()
        self.child = subprocess.Popen([NODE, '--import', 'tsx', 'scripts/fixtures/prepublish-queue-fixture.mjs'],
            cwd=ROOT, env=dict(PATH=str(Path(NODE).parent)+':/usr/bin:/bin:/usr/sbin:/sbin',
                HOME=str(evidence/'home'), TMPDIR=str(evidence/'tmp'), UWORK_NATIVE_FIXTURE_NAME=profile,
                UWORK_NATIVE_CLIENT_EXPERIENCE='enabled'),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()


class Bridge(HARNESS['HarnessBridge']):
    def raw_cdp(self, method, session_id=None, **params):
        params['_response_timeout'] = 15
        return super().raw_cdp(method, session_id=session_id, **params)


f = b = meta = None
result = dict(status='failed', checks=[], actions=[])
deadline = time.monotonic()+240


def budget():
    assert time.monotonic()<deadline, 'case deadline'


def until(expression, label, seconds=20):
    end = min(deadline, time.monotonic()+seconds)
    last = None
    while time.monotonic()<end:
        last = b.evaluate(expression)
        if last.get('ok'):
            return last
        time.sleep(.15)
    raise AssertionError(label+': '+json.dumps(last, ensure_ascii=False)[:1200])


def click(selector, label):
    p = until('''(()=>{const a=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length&&!e.closest('[inert],[aria-hidden=true]')),e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&!e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r?.x+r.width/2,y:r?.y+r.height/2}})()''' % json.dumps(selector), label)
    for kind in ['mouseMoved', 'mousePressed', 'mouseReleased']:
        budget()
        if kind!='mouseMoved':
            assert b.evaluate('''(()=>{const e=document.querySelector(%s);return{ok:!!e&&!e.disabled&&e.contains(document.elementFromPoint(%s,%s))}})()''' % (json.dumps(selector), p['x'], p['y']))['ok'], 'click target changed: '+label
        b.raw_cdp('Input.dispatchMouseEvent', type=kind, x=p['x'], y=p['y'],
                  **({} if kind=='mouseMoved' else dict(button='left', clickCount=1)))
    result['actions'].append(label)


def send(text):
    click('[data-testid="v4-composer-input"]', 'focus original composer')
    b.raw_cdp('Input.insertText', text=text)
    until('(()=>({ok:document.querySelector("[data-testid=v4-composer-input]")?.innerText.trim()==='+json.dumps(text)+'}))()', 'exact draft before send')
    click('[data-testid="v4-composer-send"]', 'send '+text)


def proof(name):
    f.command('queueProof', name=name)
    return json.loads((evidence/(name+'-queue-proof.json')).read_text())


def user_history(sid):
    cli = next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    with sqlite3.connect(cli.as_uri()+'?mode=ro', uri=True) as db:
        messages = db.execute('SELECT id,data FROM message WHERE session_id=? ORDER BY id', (sid,)).fetchall()
        parts = db.execute('SELECT * FROM part WHERE session_id=? ORDER BY id', (sid,)).fetchall()
        users = []
        for mid, data in messages:
            if json.loads(data).get('role')!='user':
                continue
            rows = [json.loads(row[0]) for row in db.execute('SELECT data FROM part WHERE session_id=? AND message_id=? ORDER BY id', (sid, mid))]
            users.append(''.join(row.get('text', '') for row in rows if row.get('type')=='text'))
    return users, hashlib.sha256(repr((messages, parts)).encode()).hexdigest()


try:
    f = Fixture()
    f.wait_event(lambda e:e.get('event')=='ready', 60, 'fixture ready')
    f.command('launch', 30)
    launch = f.wait_event(lambda e:e.get('event')=='launched', 5, 'launched')
    b = Bridge(launch['cdpPort'], evidence=evidence)
    meta = json.loads((evidence/'desktop-state.json').read_text())
    workspace = Path(meta['root'])/'send-now-workspace'
    workspace.mkdir()
    subprocess.run(['/usr/bin/git', 'init', '--quiet', str(workspace)], check=True)
    f.command('openWorkspace', 30, workspacePath=str(workspace))
    guards = BASE['Guards'](evidence)
    first = FIRST['FirstRunUi']('file-restored', b.evaluate, b.raw_cdp, guards.guard, budget, guards.claim, guards.auth_started)
    until('(()=>({ok:!!document.querySelector("[data-testid=onboarding-page]")}))()', 'original onboarding')
    for step in FIRST['ONBOARDING_STEPS']:
        first.phase(step)
        time.sleep(.2)
    until('(()=>({ok:!!document.querySelector("[data-testid=enterprise-identity-name]")}))()', 'restored fixture identity')
    baseline = proof('baseline')
    send('PREPUBLISH_QUEUE_A')
    active = until('(()=>{const a=[...document.querySelectorAll("[data-session-id]")].filter(e=>e.getClientRects().length);return{ok:a.length===1&&!!document.querySelector("[data-testid=v4-stop]"),sid:a[0]?.dataset.sessionId}})()', 'held A active session')
    sid = active['sid']
    held = proof('held-A')
    assert held['held'] and held['modelCalls']==baseline['modelCalls']+1
    reserved = next(row for row in held['ledger'] if row['user_id']==meta['memberId'])
    for marker in ['PREPUBLISH_SEND_NOW_X', 'PREPUBLISH_SEND_NOW_Y']:
        send(marker)
        until('(()=>({ok:[...document.querySelectorAll("li[data-queue-item-id]")].some(e=>e.innerText.includes('+json.dumps(marker)+'))}))()', 'queued '+marker)
    queued = proof('queued-X-Y')
    assert queued==held
    row = until('(()=>{const a=[...document.querySelectorAll("li[data-queue-item-id]")],e=a.find(e=>e.innerText.includes("PREPUBLISH_SEND_NOW_Y"));return{ok:a.length===2&&!!e,id:e?.dataset.queueItemId}})()', 'Y queue row')
    click('[data-testid="v4-queue-item-send-now-'+row['id']+'"]', 'original Y send-now')
    until('(()=>({ok:!document.querySelector("li[data-queue-item-id]")&&!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes("PREPUBLISH_SEND_NOW_X")}))()', 'Y promoted and X drained automatically', 45)
    done = proof('send-now-drained')
    expected = ['PREPUBLISH_QUEUE_A', 'PREPUBLISH_SEND_NOW_Y', 'PREPUBLISH_SEND_NOW_X']
    streams = [json.dumps(req['messages'][-1]) for req in done['modelRequests'] if req.get('stream')]
    assert len(streams)==3 and all(marker in text for marker,text in zip(expected, streams)), streams
    assert done['modelCalls']==baseline['modelCalls']+4
    own = [row for row in done['ledger'] if row['user_id']==meta['memberId']]
    assert len(own)==4 and all(row['status']==('uncertain' if row['id']==reserved['id'] else 'settled') for row in own)
    assert next(row for row in own if row['id']==reserved['id'])['amount']==reserved['reserved']
    assert sum(row['amount'] for row in own if row['status']=='settled')==66
    assert [r for r in done['ledger'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledger'] if r['user_id']!=meta['memberId']]
    users, digest = user_history(sid)
    assert users==expected, users
    result['checks'].append('original-send-now-interrupts-A-promotes-Y-then-auto-drains-X-exactly-once')
    result['checks'].append('uncertain-matches-reservation-three-settled66-other-member-unchanged')
    b.raw_cdp('Page.reload')
    until('(()=>({ok:!!document.querySelector("[data-session-id='+sid+']")&&!document.querySelector("[data-testid=v4-stop]")}))()', 'same original session after reload')
    assert user_history(sid)==(users, digest)
    assert proof('send-now-reloaded')==done
    result['checks'].append('reload-retains-original-user-history-and-zero-reexecution')
    result['summary'] = dict(modelCalls=done['modelCalls'], userOrder=users, uncertainCredit=reserved['reserved'], settledCredit=66)
    result['status'] = 'passed'
except BaseException as error:
    result['failure'] = str(error) or type(error).__name__
    if isinstance(error, FIRST['FirstRunUiError']):
        result['firstRunDiagnostic'] = getattr(error, 'diagnostic', None)
finally:
    if b:
        try:
            b.kill()
        except Exception as error:
            result['harnessCleanupError'] = type(error).__name__
            result['status'] = 'failed'
    if f:
        try:
            f.send({'op': 'close'})
            f.child.wait(timeout=30)
            cleanup = json.loads((evidence/'cleanup.json').read_text())
            assert f.child.returncode==0 and cleanup['errors']==[] and cleanup['electronExited'] and cleanup['serversClosed'] and cleanup['ownedRootRemoved']
            result['fixtureCleanupVerified'] = True
        except Exception as error:
            result['cleanupError'] = type(error).__name__
            result['status'] = 'failed'
    if meta:
        from urllib.parse import urlparse
        ports = {urlparse(meta[k]).port for k in ['origin', 'backendOrigin', 'supplierOrigin']}|{meta['cdpPort']}
        closed = {}
        for port in ports:
            with socket.socket() as probe:
                probe.settimeout(1)
                closed[str(port)] = probe.connect_ex(('127.0.0.1', port))!=0
        result['closedPorts'] = closed
        if not all(closed.values()):
            result['status'] = 'failed'
    if b:
        cleanup = json.loads((evidence/'harness-cleanup.json').read_text())
        pid = cleanup.get('daemonPid')
        absent = pid and not subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
        if absent and cleanup['socketClosed']:
            shutil.rmtree(b.root)
            result['harnessRootRemoved'] = True
        else:
            result['status'] = 'failed'
    (evidence/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result, ensure_ascii=False))
sys.exit(0 if result['status']=='passed' else 1)
