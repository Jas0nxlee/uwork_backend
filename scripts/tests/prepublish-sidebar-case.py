"""Original context menu and command center; read-only owned persistence oracles."""
import hashlib
import json
import sqlite3
import time
from pathlib import Path


def run_sidebar_case(*, bridge, click, until, proof, baseline, sid, index, cli,
                     workspace, evidence, result, budget):
    (evidence / 'sidebar-driver-source.json').write_text(json.dumps(dict(sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())))
    row = '[data-testid="task-item-' + sid + '"]'

    def key(name, code, number, modifiers=0, text=None):
        for kind in ['keyDown', 'keyUp']:
            budget()
            extra = dict(text=text, unmodifiedText=text) if text and kind == 'keyDown' else {}
            if name == 'a' and modifiers == 4 and kind == 'keyDown':
                extra['commands'] = ['selectAll']
            bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key=name, code=code,
                           windowsVirtualKeyCode=number, modifiers=modifiers, **extra)

    def text_input(selector, value):
        click(selector, 'focus original input')
        key('a', 'KeyA', 65, modifiers=4)
        until('(()=>{const e=document.activeElement;return{ok:e?.tagName==="INPUT"&&e.selectionStart===0&&e.selectionEnd===e.value.length,start:e?.selectionStart,end:e?.selectionEnd,length:e?.value?.length}})()', 'native input selection')
        if value:
            bridge.raw_cdp('Input.insertText', text=value)
        else:
            key('Backspace', 'Backspace', 8)
        until('(()=>({ok:document.activeElement?.value===' + json.dumps(value) + ',value:document.activeElement?.value}))()', 'native input readback')

    def text_click(selector, label):
        expression = '''(()=>{const a=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length&&e.textContent.trim()===%s),e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),count:a.length,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()''' % (json.dumps(selector), json.dumps(label))
        point = until(expression, 'original control ' + label)
        for kind in ['mouseMoved', 'mousePressed', 'mouseReleased']:
            budget()
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'],
                           **({} if kind == 'mouseMoved' else dict(button='left', clickCount=1)))
        result['actions'].append(label)

    def menu(label):
        point = until('''(()=>{const a=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r?.x+r?.width/2,y:r?.y+r?.height/2,hit:document.elementFromPoint(r?.x+r?.width/2,r?.y+r?.height/2)?.tagName}})()''' % json.dumps(row), 'own task row')
        result.setdefault('contextMenuTargets', []).append(dict(label=label, **point))
        for kind in ['mouseMoved', 'mousePressed', 'mouseReleased']:
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'],
                           **({} if kind == 'mouseMoved' else dict(button='right', clickCount=1)))
        text_click('[role="menuitem"]', label)

    def read():
        with sqlite3.connect(index.as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            rows = [dict(r) for r in db.execute('SELECT task_id,workspace_path,title,pinned,archived,deleted,meta_json FROM tasks WHERE task_id=?', (sid,))]
        assert len(rows) == 1 and rows[0]['workspace_path'] == str(workspace)
        with sqlite3.connect(cli.as_uri() + '?mode=ro', uri=True) as db:
            session = db.execute('SELECT id,title,directory,path FROM session WHERE id=?', (sid,)).fetchone()
            messages = db.execute('SELECT * FROM message WHERE session_id=? ORDER BY id', (sid,)).fetchall()
            parts = db.execute('SELECT * FROM part WHERE session_id=? ORDER BY id', (sid,)).fetchall()
        assert session and session[0] == sid and session[2:] == (str(workspace), str(workspace))
        return rows[0], session[1], hashlib.sha256(repr((messages, parts)).encode()).hexdigest()

    original, original_cli_title, transcript = read()
    assert original['pinned'] == 0 and original['title'] == original_cli_title

    def stage(name, title, pinned):
        deadline = time.monotonic() + 10
        while True:
            state, cli_title, digest = read()
            if state['title'] == cli_title == title and state['pinned'] == pinned:
                break
            assert time.monotonic() < deadline, (name, state, cli_title)
            time.sleep(.1)
        assert state['archived'] == state['deleted'] == 0
        assert digest == transcript
        dom = until('''(()=>{const a=[...document.querySelectorAll(%s)].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!!e&&e.textContent.includes(%s),count:a.length,text:e?.textContent.trim(),pinButton:!!e?.querySelector('button[aria-label="取消置顶任务"]')}})()''' % (json.dumps(row), json.dumps(title)), name)
        assert dom['pinButton'] == bool(pinned), (name, dom)
        assert proof('sidebar-' + name) == baseline
        (evidence / ('sidebar-' + name + '.json')).write_text(json.dumps(dict(stage=name,
            title=state['title'], cliTitle=cli_title, pinned=state['pinned'],
            titleOverridden=json.loads(state['meta_json']).get('titleOverridden'),
            unreadAt=json.loads(state['meta_json']).get('unreadAt'),
            transcriptDigest=digest, ui=dom), ensure_ascii=False, indent=2))

    stage('baseline', original['title'], 0)
    menu('重命名任务')
    text_input('[role="dialog"] input', 'UW_SIDEBAR_CANCELLED')
    text_click('[role="dialog"] button', '取消')
    until('(()=>({ok:!document.querySelector("[role=dialog]")}))()', 'rename cancelled')
    stage('cancelled', original['title'], 0)

    first_title, final_title = 'UW_SIDEBAR_RENAMED 中文任务', 'UW_PINNED_RENAMED 中文任务'
    menu('重命名任务')
    text_input('[role="dialog"] input', first_title)
    key('Enter', 'Enter', 13, text='\r')
    stage('renamed', first_title, 0)
    menu('置顶任务')
    stage('pinned', first_title, 1)
    bridge.raw_cdp('Page.reload')
    stage('pinned-reloaded', first_title, 1)
    menu('重命名任务')
    text_input('[role="dialog"] input', final_title)
    text_click('[role="dialog"] button', '确认')
    stage('pinned-renamed', final_title, 1)
    bridge.raw_cdp('Page.reload')
    stage('pinned-renamed-reloaded', final_title, 1)
    click('[data-testid="conversation-new-task"]', 'leave task for original new conversation draft')
    until('(()=>({ok:![...document.querySelectorAll("[data-session-id]")].filter(e=>e.getClientRects().length).some(e=>e.getAttribute("data-session-id")==='+json.dumps(sid)+')}))()', 'original task no longer active')
    menu('标记为未读')
    deadline=time.monotonic()+10
    while not json.loads(read()[0]['meta_json']).get('unreadAt'):
        assert time.monotonic()<deadline, 'unread metadata not persisted'
        time.sleep(.1)
    stage('pinned-unread', final_title, 1)
    click(row, 'select marked unread original task')
    deadline=time.monotonic()+10
    while json.loads(read()[0]['meta_json']).get('unreadAt'):
        assert time.monotonic()<deadline, 'select did not clear unread metadata'
        time.sleep(.1)
    stage('pinned-read', final_title, 1)
    menu('取消置顶任务')
    stage('unpinned', final_title, 0)
    bridge.raw_cdp('Page.reload')
    stage('unpinned-reloaded', final_title, 0)

    key('k', 'KeyK', 75, modifiers=4)
    text_click('[role="dialog"] [role="tab"]', '任务')
    for query, found in [('UW_PINNED_RENAMED', True), ('PREPUBLISH_QUEUE_C', True), ('UW_ABSENT_SEARCH_MARKER', False)]:
        text_input('[role="dialog"] input', query)
        projection = until('''(()=>{const d=document.querySelector('[role="dialog"]'),a=d?[...d.querySelectorAll('[role="option"]')].filter(e=>e.getClientRects().length&&e.textContent.includes(%s)):[];return{ok:!!d&&( %s ? a.length===1 : a.length===0&&d.textContent.includes('暂无相关结果')),hits:a.length,text:d?.textContent.slice(0,1500)}})()''' % (json.dumps(final_title), json.dumps(found)), 'search ' + query)
        assert proof('sidebar-search-' + query.lower().replace('_', '-')) == baseline
        (evidence / ('search-' + query + '.json')).write_text(json.dumps(projection, ensure_ascii=False, indent=2))
    text_input('[role="dialog"] input', 'UW_PINNED_RENAMED')
    point = until('''(()=>{const a=[...document.querySelectorAll('[role="dialog"] [role="option"]')].filter(e=>e.getClientRects().length&&e.textContent.includes(%s)),e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()''' % json.dumps(final_title), 'open search result')
    for kind in ['mousePressed', 'mouseReleased']:
        bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
    until('''(()=>({ok:!document.querySelector('[role="dialog"]')&&[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length).some(e=>e.getAttribute('data-session-id')===%s)}))()''' % json.dumps(sid), 'same task selected from search')
    stage('searched', final_title, 0)
    result['checks'].append('original-task-rename-cancel-pin-pinned-rename-unpin-title-content-search-reload-zero-inference')
