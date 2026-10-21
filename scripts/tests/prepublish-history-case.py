"""Original edit/cancel/fork/child consumers; real requests and readonly canonical branch."""
import json
from pathlib import Path
import subprocess
import sqlite3
import time

A='PREPUBLISH_HISTORY_QUERY_A';E='PREPUBLISH_HISTORY_QUERY_E';B='PREPUBLISH_HISTORY_QUERY_B'
AR='PREPUBLISH_HISTORY_ANSWER_A';ER='PREPUBLISH_HISTORY_ANSWER_E';BR='PREPUBLISH_HISTORY_ANSWER_B'


def run_history_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget,node,root):
    original_proof=proof
    def full_ledger():
        backend=Path(meta['root'])/'backend.sqlite'
        with sqlite3.connect(backend.as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            return [dict(row) for row in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':full_ledger()}
    previous_full=baseline['ledgerFull']
    def proof(name):
        p={**original_proof(name),'ledgerFull':full_ledger()}
        (evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2))
        return p
    counter=0
    def accounting(name,delta):
        nonlocal counter,previous_full
        deadline=time.monotonic()+20
        while True:
            budget();counter+=1;p=proof('history-'+name+'-'+str(counter))
            mine=[r for r in p['ledger'] if r['user_id']==meta['memberId']]
            if p['modelCalls']==baseline['modelCalls']+delta and len(mine)==delta and all(r['status']=='settled' for r in mine):break
            assert time.monotonic()<deadline,'actual history accounting did not settle'
            time.sleep(.1)
        assert sum(r['amount'] for r in mine)==delta*22
        assert [r for r in p['ledger'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledger'] if r['user_id']!=meta['memberId']]
        assert [r for r in p['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
        assert all(row in p['ledgerFull'] for row in previous_full),'previous complete ledger rows must stay unchanged'
        previous_full=p['ledgerFull']
        return p
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    def read(sid,name):
        req=evidence/(name+'-read-input.json')
        req.write_text(json.dumps(dict(root=meta['root'],workspace=str(workspace),cli=str(cli),sid=sid)))
        p=subprocess.run([node,'--import','tsx',str(root/'scripts/fixtures/prepublish-history-readonly.mjs'),str(req)],cwd=root,text=True,capture_output=True,timeout=15)
        assert p.returncode==0,'readonly history projection failed: '+p.stderr[:1000]
        r=json.loads(p.stdout);(evidence/(name+'-canonical.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
    def active(expected=None,excluded=None):
        return until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null,id=e?.getAttribute('data-session-id');return{ok:!!id&&(!%s||id===%s)&&(!%s||id!==%s),sid:id}})()'''%(json.dumps(expected),json.dumps(expected),json.dumps(excluded),json.dumps(excluded)),'actual active history session')
    def reply(marker):
        until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps(marker)+')}))()','completed original reply '+marker,45)
    def texts(r):return [(m['role'],m['text']) for m in r['semantic']['active']]
    def hover(selector):
        p=until('(()=>{const e=document.querySelector('+json.dumps(selector)+'),r=e?.getBoundingClientRect();return{ok:!!r,x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()','history action hover')
        bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y'])
    def edit_open():
        d=until('''(()=>{const es=[...document.querySelectorAll('[data-testid^=v4-edit-]')].filter(e=>e.getClientRects().length&&e.tagName==='BUTTON'),e=es.length===1?es[0]:null;return{ok:!!e,id:e?.getAttribute('data-testid')}})()''','unique original edit')
        suffix=d['id'].removeprefix('v4-edit-');sel='[data-testid="'+d['id']+'"]';hover(sel);click(sel,'open original historical edit')
        input_sel='[data-testid="v4-edit-input-'+suffix+'"]';until('(()=>({ok:!!document.querySelector('+json.dumps(input_sel)+')}))()','original inline editor')
        return suffix,input_sel
    def replace(selector,text):
        click(selector,'focus original inline editor')
        bridge.raw_cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4,commands=['selectAll'])
        bridge.raw_cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4)
        bridge.raw_cdp('Input.insertText',text=text)
        until('(()=>{const e=document.querySelector('+json.dumps(selector)+');return{ok:e?.innerText.trim()==='+json.dumps(text)+',value:e?.innerText}})()','exact historical edit text')

    send(A);reply(AR);warm=accounting('warm',2);parent=active()['sid']
    before=read(parent,'history-warm');assert texts(before)==[('user',A),('assistant','原生企业资产联动完成。 '+AR)]
    suffix,editor=edit_open();replace(editor,'PREPUBLISH_HISTORY_CANCELLED')
    click('[data-testid="v4-edit-cancel-'+suffix+'"]','cancel original historical edit')
    reply(AR);assert proof('history-cancel-no-inference')==warm
    assert read(parent,'history-cancel')['rawDigest']==before['rawDigest']
    result['checks'].append('original-historical-edit-cancel-preserves-canonical-history-and-billing')
    suffix,editor=edit_open();replace(editor,E)
    click('[data-testid="v4-edit-submit-'+suffix+'"]','submit original conversation-only edit')
    reply(ER);assert active(parent)['sid']==parent;edited=accounting('edited',3)
    p=read(parent,'history-edited');assert texts(p)==[('user',E),('assistant','原生企业资产联动完成。 '+ER)]
    assert set(before['physicalMessageIds']).issubset(p['physicalMessageIds'])
    new=edited['modelRequests'][len(warm['modelRequests']):];assert len(new)==1 and new[0].get('stream') is True
    assert all(A not in json.dumps(m) and AR not in json.dumps(m) for m in new[0]['messages'])
    assert E in json.dumps(new[0]['messages'][-1])
    result['checks'].append('same-session-edit-reexecutes-one-model-call-and-canonical-active-branch')
    fork=until('''(()=>{const rows=[...document.querySelectorAll('[data-row-id]')].filter(e=>e.innerText.includes(%s)),r=rows.length===1?rows[0]:null,id=r?.getAttribute('data-row-id'),b=document.querySelector('[data-testid="v4-fork-'+id+'"]');return{ok:!!r&&!!b&&r.closest('section[data-turn-id]')===b.closest('section[data-turn-id]'),tid:b?.getAttribute('data-testid')}})()'''%json.dumps(ER),'exact edited assistant fork in same turn')
    hover('[data-testid="'+fork['tid']+'"]');click('[data-testid="'+fork['tid']+'"]','fork edited assistant via original footer')
    child=active(excluded=parent)['sid'];reply(ER)
    assert proof('history-fork-no-inference')==edited
    c=read(child,'history-fork-child');prepared_parent=read(parent,'history-fork-parent')
    assert c['semantic']['parentId']==parent and c['semantic']['taskType']=='fork'
    project=lambda m:{k:m[k] for k in ['role','text','modelSelection','completed','partTypes']}
    assert [project(m) for m in c['semantic']['active'][:2]]==[project(m) for m in p['semantic']['active']]
    assert set(m['id'] for m in c['semantic']['active']).isdisjoint(m['id'] for m in p['semantic']['active'])
    assert texts(prepared_parent)==texts(p)
    send(B);reply(BR);done=accounting('child',4)
    extra=done['modelRequests'][len(edited['modelRequests']):];assert len(extra)==1 and extra[0].get('stream') is True
    payload=json.dumps(extra[0]['messages'],ensure_ascii=False)
    assert E in payload and ER in payload and B in payload and A not in payload and AR not in payload
    completed=read(child,'history-child-completed');assert any(m['text']==B for m in completed['semantic']['active'])
    assert any(BR in m['text'] for m in completed['semantic']['active'])
    click('[data-testid="task-item-'+parent+'"]','read original parent after child completed');reply(ER);active(parent)
    assert read(parent,'history-parent-unchanged')['semantic']==prepared_parent['semantic']
    click('[data-testid="task-item-'+child+'"]','return to actual fork child');reply(BR);active(child)
    bridge.raw_cdp('Page.reload');reply(BR);active(child)
    assert read(child,'history-child-reloaded')['semantic']==completed['semantic']
    assert proof('history-reload-no-replay')==done
    result['checks'].append('edited-history-fork-inheritance-actual-child-context-parent-isolation-reload-zero-replay')
    result['history']=dict(parentId=parent,childId=child,currentSettled=4,currentCredits=88,supplierDelta=4,forkSupplierDelta=0)
