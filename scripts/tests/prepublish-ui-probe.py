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
                UWORK_NATIVE_CLIENT_EXPERIENCE='enabled',
                UWORK_NATIVE_REWIND_FILES='1' if os.environ.get('PREPUBLISH_REWIND_FILES')=='1' else '0',
                UWORK_NATIVE_PERMISSION_DENY='1' if os.environ.get('PREPUBLISH_PERMISSION_DENY')=='1' else '0',
                UWORK_NATIVE_PERMISSION_PROJECT='1' if os.environ.get('PREPUBLISH_PERMISSION_PROJECT')=='1' else '0',
                UWORK_NATIVE_PLAN_DETAIL='1' if os.environ.get('PREPUBLISH_PLAN_DETAIL_ONLY')=='1' else '0',
                UWORK_NATIVE_PLAN_APPROVAL='1' if os.environ.get('PREPUBLISH_PLAN_APPROVAL')=='1' else '0',
                UWORK_NATIVE_QUESTIONS='1' if os.environ.get('PREPUBLISH_QUESTIONS')=='1' else '0',
                UWORK_NATIVE_QUESTION_DISMISS='1' if os.environ.get('PREPUBLISH_QUESTION_DISMISS')=='1' else '0',
                **(dict(UWORK_NATIVE_OUT_MANIFEST=os.environ['UWORK_NATIVE_OUT_MANIFEST'],UWORK_NATIVE_OUT_CACHE_BASE=str(Path.home()/'.cache/uwork-prepublish-desktop')) if os.environ.get('UWORK_NATIVE_OUT_MANIFEST') else {})),
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
        # 发送/停止共用同一位置，React换按钮后不能继续按旧坐标误点停止。
        if kind!='mouseMoved':
            same=b.evaluate('''(()=>{const e=document.querySelector(%s);return{ok:!!e&&!e.disabled&&e.contains(document.elementFromPoint(%s,%s))}})()'''%(json.dumps(selector),p['x'],p['y']))
            assert same['ok'], 'original click target changed: '+label
        budget(); b.raw_cdp('Input.dispatchMouseEvent',type=kind,x=p['x'],y=p['y'],**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
    result['actions'].append(label)
def send(text):
    click('[contenteditable="true"]','composer '+text)
    b.raw_cdp('Input.insertText',text=text)
    until('(()=>({ok:document.querySelector("[contenteditable=true]")?.innerText.trim()==='+json.dumps(text)+'}))()','composer exact readback before send')
    click('[data-testid="v4-composer-send"]','send '+text)
def proof(name):
    f.command('queueProof',name=name)
    return json.loads((evidence/(name+'-queue-proof.json')).read_text())
try:
    f=Fixture()
    f.wait_event(lambda e:e.get('event')=='ready',60,'fixture ready')
    if os.environ.get('PREPUBLISH_REWIND_FILES')=='1':f.command('rewindSetup')
    if any(os.environ.get(k)=='1' for k in ['PREPUBLISH_PERMISSION_DENY','PREPUBLISH_PERMISSION_PROJECT']):f.command('permissionSetup')
    f.command('launch',30)
    launch=f.wait_event(lambda e:e.get('event')=='launched',5,'launched')
    result['nativePids']=[launch['pid']]
    b=HarnessBridge(launch['cdpPort'],evidence=evidence)
    meta=json.loads((evidence/'desktop-state.json').read_text())
    workspace=Path(meta['root'])/'prepublish-workspace'; workspace.mkdir()
    subprocess.run(['/usr/bin/git','init','--quiet',str(workspace)],check=True)
    if os.environ.get('PREPUBLISH_REWIND_FILES')=='1':
        (workspace/'owned-rewind.txt').write_text('OWNED_REWIND_INITIAL\n第二行保持\n')
        git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
        subprocess.run(['/usr/bin/git','-C',str(workspace),'add','owned-rewind.txt'],env=git_env,check=True)
        subprocess.run(['/usr/bin/git','-C',str(workspace),'-c','user.name=Owned rewind','-c','user.email=owned-rewind@example.test','-c','commit.gpgsign=false','commit','--quiet','-m','Owned rewind baseline'],env=git_env,check=True)
    if os.environ.get('PREPUBLISH_PERMISSION_DENY')=='1':
        (workspace/'owned-permission.txt').write_text('OWNED_PERMISSION_INITIAL\n第二行保持\n')
        git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
        subprocess.run(['/usr/bin/git','-C',str(workspace),'add','owned-permission.txt'],env=git_env,check=True)
        subprocess.run(['/usr/bin/git','-C',str(workspace),'-c','user.name=Owned permission','-c','user.email=owned-permission@example.test','-c','commit.gpgsign=false','commit','--quiet','-m','Owned permission baseline'],env=git_env,check=True)
    if os.environ.get('PREPUBLISH_PERMISSION_PROJECT')=='1':
        (workspace/'owned-permission.txt').write_text('OWNED_PERMISSION_INITIAL\n第二行保持\n');(workspace/'other-permission.txt').write_text('OWNED_PROJECT_OTHER_INITIAL\n')
        git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
        subprocess.run(['/usr/bin/git','-C',str(workspace),'add','owned-permission.txt','other-permission.txt'],env=git_env,check=True)
        subprocess.run(['/usr/bin/git','-C',str(workspace),'-c','user.name=Owned project rule','-c','user.email=owned-project-rule@example.test','-c','commit.gpgsign=false','commit','--quiet','-m','Owned project rule baseline'],env=git_env,check=True)
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
    def restart_owned_ui():
        global b,launch
        b.kill();f.command('stopNative',30)
        with f.lock:start=len(f.events)
        f.command('launch',30)
        with f.lock:events=[e for e in f.events[start:] if e.get('event')=='launched']
        assert len(events)==1 and events[0]['pid']!=launch['pid']
        launch=events[0];result['nativePids'].append(launch['pid'])
        cold=evidence/('question-cold' if os.environ.get('PREPUBLISH_QUESTION_HISTORY')=='1' else 'project-cold');cold.mkdir(mode=0o700)
        b=HarnessBridge(launch['cdpPort'],evidence=cold);f.command('openWorkspace',30,workspacePath=str(workspace))
        return b
    if os.environ.get('PREPUBLISH_PLAN_APPROVAL')=='1':
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_QUESTIONS','PREPUBLISH_PERMISSION_PROJECT','PREPUBLISH_PERMISSION_DENY','PREPUBLISH_REWIND_FILES','PREPUBLISH_HISTORY','PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-plan-approval-case.py'))['run_plan_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,baseline=baseline,meta=meta,workspace=workspace,evidence=evidence,result=result,budget=budget)
    elif os.environ.get('PREPUBLISH_QUESTIONS')=='1':
        if os.environ.get('PREPUBLISH_QUESTION_DISMISS')=='1':assert os.environ.get('PREPUBLISH_QUESTION_SKIP')!='1' and os.environ.get('PREPUBLISH_QUESTION_HISTORY')!='1'
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_PERMISSION_PROJECT','PREPUBLISH_PERMISSION_DENY','PREPUBLISH_REWIND_FILES','PREPUBLISH_HISTORY','PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/('scripts/tests/prepublish-question-dismiss-case.py' if os.environ.get('PREPUBLISH_QUESTION_DISMISS')=='1' else 'scripts/tests/prepublish-question-case.py')))['run_question_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,baseline=baseline,meta=meta,evidence=evidence,result=result,budget=budget,node=NODE,root=ROOT,restart=restart_owned_ui)
    elif os.environ.get('PREPUBLISH_PERMISSION_PROJECT')=='1':
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_PERMISSION_DENY','PREPUBLISH_REWIND_FILES','PREPUBLISH_HISTORY','PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-project-permission-case.py'))['run_project_permission_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,restart=restart_owned_ui,baseline=baseline,meta=meta,
            workspace=workspace,evidence=evidence,result=result,budget=budget,node=NODE,root=ROOT)
    elif os.environ.get('PREPUBLISH_PERMISSION_DENY')=='1':
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_REWIND_FILES','PREPUBLISH_HISTORY','PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-permission-case.py'))['run_permission_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,baseline=baseline,meta=meta,
            workspace=workspace,evidence=evidence,result=result,budget=budget,node=NODE,root=ROOT)
    elif os.environ.get('PREPUBLISH_REWIND_FILES')=='1':
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_HISTORY','PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-rewind-case.py'))['run_rewind_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,baseline=baseline,meta=meta,
            workspace=workspace,evidence=evidence,result=result,budget=budget,node=NODE,root=ROOT)
    elif os.environ.get('PREPUBLISH_HISTORY')=='1':
        assert not any(os.environ.get(key)=='1' for key in ['PREPUBLISH_QUEUE_EDIT','PREPUBLISH_QUEUE_REORDER','PREPUBLISH_QUEUE_PAUSE','PREPUBLISH_FEEDBACK','PREPUBLISH_SIDEBAR','PREPUBLISH_BATCH_DELETE'])
        runpy.run_path(str(ROOT/'scripts/tests/prepublish-history-case.py'))['run_history_case'](
            bridge=b,click=click,until=until,proof=proof,send=send,baseline=baseline,meta=meta,
            workspace=workspace,evidence=evidence,result=result,budget=budget,node=NODE,root=ROOT)
    else:
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
        pause=os.environ.get('PREPUBLISH_QUEUE_PAUSE')=='1'
        paused_reservation=None
        if pause:
            assert os.environ.get('PREPUBLISH_QUEUE_EDIT')!='1' and os.environ.get('PREPUBLISH_QUEUE_REORDER')!='1'
            paused_reservation=runpy.run_path(str(ROOT/'scripts/tests/prepublish-queue-pause-case.py'))['run_queue_pause_case'](
                bridge=b,click=click,until=until,proof=proof,queued=c,member=meta['memberId'],result=result)
        drained_marker='PREPUBLISH_QUEUE_C'
        if os.environ.get('PREPUBLISH_QUEUE_EDIT')=='1':
            drained_marker=runpy.run_path(str(ROOT/'scripts/tests/prepublish-queue-edit-case.py'))['run_queue_edit_case'](
                bridge=b,click=click,until=until,proof=proof,queued=c,result=result,budget=budget)
        reorder=os.environ.get('PREPUBLISH_QUEUE_REORDER')=='1'
        if reorder:
            assert os.environ.get('PREPUBLISH_QUEUE_EDIT')=='1'
            runpy.run_path(str(ROOT/'scripts/tests/prepublish-queue-reorder-case.py'))['run_queue_reorder_case'](
                bridge=b,click=click,until=until,proof=proof,queued=c,result=result,budget=budget)
        f.command('queueRelease')
        until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&!document.querySelector("[data-testid^=v4-queue-item-delete-]")&&document.body.innerText.includes('+json.dumps(drained_marker)+')}))()','drained queued input',45)
        done=proof('drained')
        payload=json.dumps(done['modelRequests'],ensure_ascii=False)
        assert 'PREPUBLISH_QUEUE_B' not in payload
        assert any(drained_marker in json.dumps(req) and req.get('stream') for req in done['modelRequests'])
        if os.environ.get('PREPUBLISH_QUEUE_EDIT')=='1':
            assert 'PREPUBLISH_QUEUE_C' not in payload
            assert 'PREPUBLISH_DRAFT_KEEP' not in payload
        if reorder or pause or os.environ.get('PREPUBLISH_QUEUE_EDIT')=='1':
            expected_inputs=['PREPUBLISH_QUEUE_A', *(['PREPUBLISH_QUEUE_E'] if reorder else []), drained_marker]
            current_inputs=[json.dumps(req['messages'][-1]) for req in done['modelRequests'] if req.get('stream')]
            assert len(current_inputs)==len(expected_inputs)
            assert all(marker in text for marker,text in zip(expected_inputs,current_inputs))
        assert all(row['status']==('uncertain' if paused_reservation and row['id']==paused_reservation['id'] else 'settled') for row in done['ledger'])
        if paused_reservation:
            assert next(r for r in done['ledger'] if r['id']==paused_reservation['id'])['amount']==paused_reservation['reserved']
        assert [r for r in done['ledger'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledger'] if r['user_id']!=meta['memberId']]
        result['checks'].append('real-busy-composer-queue-remove-drain-no-B-dispatch-settled-and-other-member-unchanged')
        assert done['modelCalls']==baseline['modelCalls']+(4 if reorder else 3)
        expected_amount=paused_reservation['reserved']+44 if paused_reservation else (88 if reorder else 66)
        assert sum(r['amount'] for r in done['ledger'] if r['user_id']==meta['memberId'])==expected_amount
        active=until('(()=>{const a=[...document.querySelectorAll("[data-session-id]")].filter(e=>e.getClientRects().length);return {ok:a.length===1,sid:a[0]?.getAttribute("data-session-id")}})()','active task')
        sid=active['sid']; assert sid.startswith('sess_')
        index=Path(meta['home'])/'.uwork/v2/tasks-index.sqlite'
        cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
        if reorder or pause or os.environ.get('PREPUBLISH_QUEUE_EDIT')=='1':
            with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
                users=[]
                for mid,data in db.execute('SELECT id,data FROM message WHERE session_id=? ORDER BY id',(sid,)):
                    if json.loads(data).get('role')!='user': continue
                    parts=[json.loads(row[0]) for row in db.execute('SELECT data FROM part WHERE session_id=? AND message_id=? ORDER BY id',(sid,mid))]
                    users.append(''.join(part.get('text','') for part in parts if part.get('type')=='text'))
            assert users==expected_inputs, users
            (evidence/'queue-executed-inputs.json').write_text(json.dumps(dict(userInputs=users,modelOrderVerified=True),indent=2))
            result['checks'].append('actual-queued-dispatch-and-CLI-user-history-order')
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
        if os.environ.get('PREPUBLISH_BATCH_DELETE')=='1':
            runpy.run_path(str(ROOT/'scripts/tests/prepublish-archive-batch-case.py'))['run_archive_batch_case'](
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
            assert len(session)==1 and len(messages)==(6 if reorder else 4)
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
    if isinstance(error, FIRST['FirstRunUiError']):
        result['firstRunDiagnostic']=getattr(error, 'diagnostic', None)
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
