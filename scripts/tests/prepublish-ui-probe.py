"""Shared UI integration through owned browser-harness, without a release package."""
import hashlib, json, os, runpy, sqlite3, subprocess, sys, threading, time, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = runpy.run_path(str(ROOT / 'scripts/tests/native-g04k-cdp-probe.py'))
HARNESS = runpy.run_path(str(ROOT / 'scripts/tests/native-harness-bridge.py'))
FIRST = runpy.run_path(str(ROOT / 'scripts/fixtures/native-first-run-ui.py'))
NODE = BASE['NODE24']
profile = sys.argv[1]
assert __import__('re').fullmatch(r'client-native-prepublish-v\d+-20261021', profile)
evidence = ROOT / 'evidence' / profile
evidence.mkdir(mode=0o700)
for name in ['home', 'tmp']: (evidence / name).mkdir(mode=0o700)

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

class HarnessBridge(HARNESS['HarnessBridge']):
    def raw_cdp(self, method, session_id=None, **params):
        # harness 的 IPC 默认只有 5 秒，短于原 35 秒单次进程预算。
        # 保留失败且不重试输入；仅显式设置传输等待，业务断言/240 秒总预算不变。
        params['_response_timeout'] = 15
        return super().raw_cdp(method, session_id=session_id, **params)

f = None
b = None
result = dict(status='failed', checks=[], actions=[])
end = time.monotonic()+240
def budget():
    assert time.monotonic()<end, 'case deadline'
def until(expression, label, seconds=20):
    stop=min(end,time.monotonic()+seconds)
    last=None
    while time.monotonic()<stop:
        last=b.evaluate(expression)
        if last.get('ok'): return last
        time.sleep(.15)
    raise AssertionError(label+': '+json.dumps(last, ensure_ascii=False)[:1500])
def click(selector, label):
    expression='''(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length&&!e.closest('[inert],[aria-hidden=true]'));const e=es.length===1?es[0]:null,r=e?.getBoundingClientRect();return {ok:!!r&&!e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),n:es.length,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()'''%json.dumps(selector)
    p=until(expression,label)
    for kind in ['mouseMoved','mousePressed','mouseReleased']:
        budget(); b.raw_cdp('Input.dispatchMouseEvent',type=kind,x=p['x'],y=p['y'],**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
    result['actions'].append(label)
def send(text):
    click('[contenteditable="true"]','composer '+text)
    b.raw_cdp('Input.insertText',text=text)
    click('[data-testid="v4-composer-send"]','send '+text)
def proof(name):
    f.command('queueProof',name=name)
    return json.loads((evidence/(name+'-queue-proof.json')).read_text())
try:
    f=Fixture()
    f.wait_event(lambda e:e.get('event')=='ready',60,'fixture ready')
    f.command('launch',30)
    launch=f.wait_event(lambda e:e.get('event')=='launched',5,'launched')
    b=HarnessBridge(launch['cdpPort'],evidence=evidence)
    meta=json.loads((evidence/'desktop-state.json').read_text())
    workspace=Path(meta['root'])/'prepublish-workspace'; workspace.mkdir()
    subprocess.run(['/usr/bin/git','init','--quiet',str(workspace)],check=True)
    f.command('openWorkspace',30,workspacePath=str(workspace))
    guards=BASE['Guards'](evidence)
    first=FIRST['FirstRunUi']('file-restored',b.evaluate,b.raw_cdp,guards.guard,budget,guards.claim,guards.auth_started)
    stop=time.monotonic()+20
    while first.phase('observe')['step']!='role' and time.monotonic()<stop: time.sleep(.15)
    for step in FIRST['ONBOARDING_STEPS']:
        first.phase(step); time.sleep(.2)
    until('(()=>({ok:!!document.querySelector("[data-testid=enterprise-identity-name]")}))()','restored identity')
    result['checks'].append('fresh-shared-ui-original-onboarding-and-restored-test-identity')
    baseline=proof('baseline')
    send('PREPUBLISH_QUEUE_A')
    until('(()=>({ok:!!document.querySelector("[data-testid=v4-stop]"),panes:[...document.querySelectorAll("[data-session-id]")].map(e=>e.getAttribute("data-session-id"))}))()','running A')
    a=proof('held-a'); assert a['held']
    send('PREPUBLISH_QUEUE_B')
    until('(()=>({ok:!!document.querySelector("[data-testid^=v4-queue-item-delete-]")}))()','queued B')
    queued=proof('queued-b'); assert queued['modelCalls']==a['modelCalls']
    click('[data-testid^="v4-queue-item-delete-"]','delete queued B')
    until('(()=>({ok:!document.querySelector("[data-testid^=v4-queue-item-delete-]")}))()','removed B')
    send('PREPUBLISH_QUEUE_C')
    until('(()=>({ok:!!document.querySelector("[data-testid^=v4-queue-item-delete-]")}))()','queued C')
    c=proof('queued-c'); assert c['modelCalls']==a['modelCalls']
    f.command('queueRelease')
    until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&!document.querySelector("[data-testid^=v4-queue-item-delete-]")&&document.body.innerText.includes("PREPUBLISH_QUEUE_C")}))()','drained C',45)
    done=proof('drained')
    payload=json.dumps(done['modelRequests'],ensure_ascii=False)
    assert 'PREPUBLISH_QUEUE_B' not in payload
    assert any('PREPUBLISH_QUEUE_C' in json.dumps(req) and req.get('stream') for req in done['modelRequests'])
    assert all(row['status']=='settled' for row in done['ledger'])
    assert [r for r in done['ledger'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledger'] if r['user_id']!=meta['memberId']]
    result['checks'].append('real-busy-composer-queue-remove-drain-no-B-dispatch-settled-and-other-member-unchanged')
    assert done['modelCalls']==baseline['modelCalls']+3
    assert sum(r['amount'] for r in done['ledger'] if r['user_id']==meta['memberId'])==66
    active=until('(()=>{const a=[...document.querySelectorAll("[data-session-id]")].filter(e=>e.getClientRects().length);return {ok:a.length===1,sid:a[0]?.getAttribute("data-session-id")}})()','active task')
    sid=active['sid']; assert sid.startswith('sess_')
    index=Path(meta['home'])/'.uwork/v2/tasks-index.sqlite'
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    if os.environ.get('PREPUBLISH_FEEDBACK')=='1':
        feedback_target=until('(()=>{const es=[...document.querySelectorAll("[data-testid^=v4-feedback-like-]")].filter(e=>e.getClientRects().length),e=es.at(-1);return {ok:es.length===2,like:e?.getAttribute("data-testid")}})()','two original assistant reactions')
        like_id=feedback_target['like'];dislike_id=like_id.replace('v4-feedback-like-','v4-feedback-dislike-')
        def feedback_state(stage,expected):
            expected_json=json.dumps(expected)
            dom=until('(()=>{const like=document.querySelector('+json.dumps('[data-testid="'+like_id+'"]')+'),dislike=document.querySelector('+json.dumps('[data-testid="'+dislike_id+'"]')+');return{ok:!!like&&!!dislike&&like.getAttribute("aria-pressed")===String('+expected_json+'==="like")&&dislike.getAttribute("aria-pressed")===String('+expected_json+'==="dislike"),like:like?.getAttribute("aria-pressed"),dislike:dislike?.getAttribute("aria-pressed")}})()','feedback '+stage)
            deadline=time.monotonic()+10
            while True:
                with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
                    rows=db.execute('SELECT id,data FROM message WHERE session_id=? ORDER BY id',(sid,)).fetchall()
                assistant=[(i,json.loads(d)) for i,d in rows if json.loads(d).get('role')=='assistant']
                values=[d.get('metadata',{}).get('assistantFeedback') for _,d in assistant]
                if len(assistant)==2 and values==[None,expected]: break
                assert time.monotonic()<deadline, ('transcript feedback',values,expected)
                time.sleep(.1)
            (evidence/('feedback-'+stage+'.json')).write_text(json.dumps(dict(stage=stage,ui=dom,values=values,messageIds=[i for i,_ in assistant]),indent=2))
            assert proof('feedback-'+stage)==done
        feedback_state('baseline',None)
        for stage,button,value in [('liked',like_id,'like'),('disliked',dislike_id,'dislike'),('cleared',dislike_id,None)]:
            click('[data-testid="'+button+'"]','assistant feedback '+stage)
            feedback_state(stage,value)
            b.raw_cdp('Page.reload')
            feedback_state(stage+'-reloaded',value)
        result['checks'].append('original-assistant-like-dislike-clear-persist-across-reload-with-zero-inference')
    if os.environ.get('PREPUBLISH_SIDEBAR')=='1':
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-sidebar-case.py'))['run_sidebar_case'](
            bridge=b,click=click,until=until,proof=proof,baseline=done,sid=sid,index=index,cli=cli,
            workspace=workspace,evidence=evidence,result=result,budget=budget)
    def task_state(stage,archived,deleted):
        with sqlite3.connect(index.as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            rows=[dict(r) for r in db.execute('SELECT task_id,workspace_path,archived,deleted FROM tasks WHERE task_id=?',(sid,))]
        assert len(rows)==1 and rows[0]['workspace_path']==str(workspace)
        assert rows[0]['archived']==archived and rows[0]['deleted']==deleted
        with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
            session=db.execute('SELECT id,directory,path,title FROM session WHERE id=?',(sid,)).fetchall()
            messages=db.execute('SELECT * FROM message WHERE session_id=? ORDER BY id',(sid,)).fetchall()
            parts=db.execute('SELECT * FROM part WHERE session_id=? ORDER BY id',(sid,)).fetchall()
        assert len(session)==1 and len(messages)==4
        digest=hashlib.sha256(repr((session,messages,parts)).encode()).hexdigest()
        out=dict(stage=stage,index=rows[0],retainedCliDigest=digest,messageCount=len(messages))
        (evidence/('delete-'+stage+'.json')).write_text(json.dumps(out,indent=2))
        snapshot=proof('delete-'+stage)
        assert snapshot==done, 'archive/delete dispatched inference or changed ledger'
        return digest
    original=task_state('baseline',0,0)
    task_selector='[data-testid="task-item-'+sid+'"]'
    # Archive button is shown on row hover; no business state is written by the observer.
    hover=until('(()=>{const e=document.querySelector('+json.dumps(task_selector)+'),r=e?.getBoundingClientRect();return {ok:!!r,x:r?.x+10,y:r?.y+10}})()','own sidebar row')
    b.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=hover['x'],y=hover['y'])
    click('[data-testid="task-archive-'+sid+'"]','archive arm')
    click('[data-testid="task-archive-'+sid+'"]','archive confirm')
    until('(()=>({ok:!document.querySelector('+json.dumps(task_selector)+')}))()','archived row absent')
    assert task_state('archived',1,0)==original
    click('button[aria-label="归档"][data-state="off"],button[aria-label="Archived"][data-state="off"]','open archived list')
    click('button[aria-label="删除任务"],button[aria-label="Delete task"]','delete task dialog')
    until('(()=>({ok:document.querySelectorAll("[role=dialog]").length===1}))()','delete confirmation')
    cancel=until('(()=>{const a=[...document.querySelectorAll("[role=dialog] button")].filter(e=>["取消","Cancel"].includes(e.querySelector("span")?.textContent.trim())),r=a[0]?.getBoundingClientRect();return{ok:a.length===1,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()','cancel button')
    if os.environ.get('PREPUBLISH_KEYBOARD_CANCEL')=='1':
        # 原确认按钮自动聚焦；Shift+Tab 由浏览器将焦点交给取消按钮。
        b.raw_cdp('Input.dispatchKeyEvent',type='keyDown',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=8)
        b.raw_cdp('Input.dispatchKeyEvent',type='keyUp',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=8)
        focus=b.evaluate('(()=>({label:document.activeElement?.querySelector("span")?.textContent,tag:document.activeElement?.tagName}))()')
        assert focus==dict(label='取消',tag='BUTTON'), focus
        result['keyboardCancelFocus']=focus
        for kind in ['keyDown','keyUp']:
            b.raw_cdp('Input.dispatchKeyEvent',type=kind,key='Enter',code='Enter',windowsVirtualKeyCode=13,**(dict(text='\r',unmodifiedText='\r') if kind=='keyDown' else {}))
        result['actions'].append('keyboard Enter on focused Cancel')
    else:
        for kind in ['mousePressed','mouseReleased']: b.raw_cdp('Input.dispatchMouseEvent',type=kind,x=cancel['x'],y=cancel['y'],button='left',clickCount=1)
    until('(()=>({ok:!document.querySelector("[role=dialog]")}))()','cancelled')
    assert task_state('cancelled',1,0)==original
    click('button[aria-label="删除任务"],button[aria-label="Delete task"]','delete task again')
    click('[data-testid="confirm-dialog-confirm"]','confirm delete')
    until('(()=>({ok:!document.querySelector("[role=dialog]")&&!document.querySelector("button[aria-label=删除任务]")}))()','deleted row absent')
    assert task_state('deleted',1,1)==original
    b.raw_cdp('Page.reload')
    until('(()=>({ok:!!document.querySelector("[data-testid=workspace-mode-header]")&&!document.querySelector('+json.dumps(task_selector)+')}))()','reload deletion persists')
    assert task_state('reloaded',1,1)==original
    result['checks'].append('original-archive-delete-cancel-confirm-reload-tombstone-retained-history-zero-inference')
    result['status']='passed'
except BaseException as error:
    result['failure']=str(error) or type(error).__name__
    if b:
        try: result['dom']=b.evaluate('(()=>({text:document.body.innerText.slice(0,9000),inputs:[...document.querySelectorAll("input,textarea,[contenteditable]")].map(e=>({tag:e.tagName,role:e.getAttribute("role"),tid:e.getAttribute("data-testid")}))}))()')
        except Exception: pass
    traceback.print_exc()
finally:
    if b:
        try:b.kill()
        except Exception as e:result['harnessCleanupError']=str(e)
    if f:
        try:
            f.send({'op':'close'})
            f.child.wait(timeout=30)
            result['fixtureExit']=f.child.returncode
            assert f.child.returncode==0, 'fixture cleanup exit'
            cleanup=json.loads((evidence/'cleanup.json').read_text())
            assert cleanup['errors']==[] and cleanup['electronExited'] and cleanup['serversClosed']
            result['cleanupVerified']=True
        except Exception as e:
            result['cleanupError']=str(e)
            result['status']='failed'
    (evidence/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))
sys.exit(0 if result['status']=='passed' else 1)
