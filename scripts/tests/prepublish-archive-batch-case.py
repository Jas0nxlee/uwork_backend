"""Two original forks, original bulk delete, retained parent/history and billing oracle."""
import hashlib
import json
import sqlite3
import time
from pathlib import Path


def run_archive_batch_case(*, bridge, click, until, proof, baseline, sid, index, cli,
                           workspace, evidence, result, budget):
    children = []
    snapshots = {}
    raw_reads = {}
    (evidence / 'batch-driver-source.json').write_text(json.dumps(dict(
        sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())))

    def read(task):
        with sqlite3.connect(index.as_uri() + '?mode=ro', uri=True) as db:
            state = db.execute('SELECT workspace_path,title,pinned,archived,deleted FROM tasks WHERE task_id=?', (task,)).fetchone()
        with sqlite3.connect(cli.as_uri() + '?mode=ro', uri=True) as db:
            session = db.execute('SELECT id,parent_id,task_type,directory,path,title FROM session WHERE id=?', (task,)).fetchone()
            messages = db.execute('SELECT * FROM message WHERE session_id=? ORDER BY id', (task,)).fetchall()
            parts = db.execute('SELECT * FROM part WHERE session_id=? ORDER BY id', (task,)).fetchall()
            message_data = [json.loads(r[0]) for r in db.execute('SELECT data FROM message WHERE session_id=? ORDER BY id', (task,))]
            part_data = [json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY id', (task,))]
        facts = dict(taskId=task, indexPresent=bool(state), sessionPresent=bool(session), messageCount=len(messages), parentId=session[1] if session else None)
        (evidence / 'batch-read-last.json').write_text(json.dumps(facts))
        assert state and state[0] == str(workspace) and session, facts
        assert len(messages) == (4 if task == sid else 6), facts
        if task != sid:
            assert sum(m.get('metadata', {}).get('forkOrigin', {}).get('parentSessionId') == sid for m in message_data) == 2, facts
            assert sum(m.get('source') == 'fork' and m.get('role') == 'user' and m.get('visibility') == 'model-only' for m in message_data) == 1, facts
            assert sum(p.get('timelineType') == 'session_fork' and p.get('parentSessionId') == sid for p in part_data) == 1, facts
        raw_reads[task] = dict(index=state, session=session, messages=messages, parts=parts)
        return dict(title=state[1], cliTitle=session[5], pinned=state[2], archived=state[3], deleted=state[4],
            parentId=session[1], taskType=session[2],
            historyDigest=hashlib.sha256(repr((session, messages, parts)).encode()).hexdigest())

    original = read(sid)
    deadline = time.monotonic()+10
    while original['title'] != original['cliTitle']:
        assert time.monotonic()<deadline, 'parent title projection not settled'
        time.sleep(.1)
        original = read(sid)
    parent_records = raw_reads[sid]
    assert original['archived'] == original['deleted'] == original['pinned'] == 0

    def stage(name, deleted=0):
        current = read(sid)
        if current != original:
            (evidence / 'batch-parent-difference.json').write_text(json.dumps(dict(before=original, after=current, beforeRecords=parent_records, afterRecords=raw_reads[sid]),ensure_ascii=False,indent=2))
        assert current == original, 'bulk operation changed unarchived parent'
        facts = {}
        for child in children:
            value = read(child)
            assert value['archived'] == 1 and value['deleted'] == deleted
            assert value['parentId'] == sid and value['taskType'] == 'fork'
            assert value['historyDigest'] == snapshots[child]['historyDigest']
            facts[child] = value
        assert proof('batch-' + name) == baseline
        (evidence / ('batch-' + name + '.json')).write_text(json.dumps(dict(stage=name,
            parent=original, children=facts, parentId=sid), ensure_ascii=False, indent=2))

    for ordinal in range(2):
        if ordinal:
            click('[data-testid="task-item-' + sid + '"]', 'return to original parent for fork')
        until('(()=>({ok:[...document.querySelectorAll("[data-session-id]")].filter(e=>e.getClientRects().length).some(e=>e.getAttribute("data-session-id")==='+json.dumps(sid)+')}))()', 'original parent active')
        fork = until('''(()=>{const es=[...document.querySelectorAll('[data-testid^="v4-fork-"]')].filter(e=>e.getClientRects().length),e=es.at(-1);return{ok:es.length===2,id:e?.getAttribute('data-testid')}})()''', 'original last assistant fork')
        click('[data-testid="' + fork['id'] + '"]', 'fork owned child ' + str(ordinal))
        active = until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length),id=a.length===1?a[0].getAttribute('data-session-id'):null;return{ok:!!id&&id.startsWith('sess_')&&!%s.includes(id),id}})()''' % json.dumps([sid, *children]), 'new child active')
        child = active['id']
        children.append(child)
        snapshots[child] = read(child)
        assert snapshots[child]['parentId'] == sid
        # 原 fork 可能修复父回复缺少的 productTurnId；删除基线取合法准备完成后的事实。
        prepared_parent = read(sid)
        assert {k:v for k,v in prepared_parent.items() if k!='historyDigest'} == {k:v for k,v in original.items() if k!='historyDigest'}
        original = prepared_parent
        parent_records = raw_reads[sid]
        row = '[data-testid="task-item-' + child + '"]'
        point = until('''(()=>{const e=document.querySelector(%s),r=e?.getBoundingClientRect();return{ok:!!r,x:r?.x+10,y:r?.y+10}})()''' % json.dumps(row), 'new child sidebar row')
        bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
        click('[data-testid="task-archive-' + child + '"]', 'archive child arm')
        click('[data-testid="task-archive-' + child + '"]', 'archive child confirm')
        until('(()=>({ok:!document.querySelector('+json.dumps(row)+')}))()', 'child archived')
        stage('archived-' + str(ordinal))

    click('button[aria-label="归档"][data-state="off"]', 'open archived collection')
    def open_dialog():
        click('[data-testid="archived-tasks-actions"]', 'archived collection actions')
        click('[data-testid="delete-all-archived-tasks"]', 'original delete all archived')
        until('(()=>{const d=document.querySelector("[role=dialog]");return{ok:!!d&&d.textContent.includes("删除 2 个归档任务？"),text:d?.textContent}})()', 'exact two-child confirmation')
    open_dialog()
    stage('cancel-dialog')
    point = until('''(()=>{const a=[...document.querySelectorAll('[role="dialog"] button')].filter(e=>e.querySelector('span')?.textContent.trim()==='取消'),e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()''', 'original cancel')
    for kind in ['mouseMoved', 'mousePressed', 'mouseReleased']:
        budget()
        bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'],
                       **({} if kind == 'mouseMoved' else dict(button='left', clickCount=1)))
    until('(()=>({ok:!document.querySelector("[role=dialog]")}))()', 'bulk cancel settled')
    stage('cancelled')
    open_dialog()
    click('[data-testid="confirm-dialog-confirm"]', 'confirm exact owned two-child batch')
    until('(()=>({ok:[...document.querySelectorAll("[role=status]")].some(e=>e.textContent.includes("已删除 2 个，跳过 0 个，失败 0 个。"))}))()', 'bulk result two deleted')
    stage('deleted', 1)
    click('button[aria-label="关闭"][data-state="on"]', 'close archived collection')
    click('[data-testid="task-item-' + sid + '"]', 'unarchived parent remains selectable')
    bridge.raw_cdp('Page.reload')
    until('(()=>({ok:!!document.querySelector('+json.dumps('[data-testid="task-item-'+sid+'"]')+')}))()', 'parent remains after reload')
    click('button[aria-label="归档"][data-state="off"]', 'verify empty archived collection after reload')
    until('(()=>({ok:document.body.innerText.includes("暂无归档任务")&&!document.querySelector("button[aria-label=删除任务]")}))()', 'deleted children do not return')
    stage('reloaded', 1)
    click('button[aria-label="关闭"][data-state="on"]', 'close empty archive view')
    click('[data-testid="task-item-' + sid + '"]', 'restore original parent for tail')
    result['checks'].append('original-two-child-archived-batch-cancel-confirm-reload-retains-parent-and-cli-history-zero-inference')
