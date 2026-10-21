"""Original file-rewind edit: actual Read/Write, external conflict refusal and atomic recovery."""
import hashlib
import json
import os
import runpy
from pathlib import Path
import sqlite3
import subprocess
import time

INITIAL='OWNED_REWIND_INITIAL\n第二行保持\n';AFTER='OWNED_REWIND_AGENT_WRITE\n';EXTERNAL='OWNED_REWIND_EXTERNAL_EDIT\n'
A='PREPUBLISH_REWIND_QUERY_A';E='PREPUBLISH_REWIND_QUERY_E';AR='PREPUBLISH_REWIND_ANSWER_A';ER='PREPUBLISH_REWIND_ANSWER_E'


def run_rewind_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget,node,root):
    fallback=os.environ.get('PREPUBLISH_REWIND_FALLBACK')=='1'
    edited_query='PREPUBLISH_REWIND_QUERY_F' if fallback else E
    owned=workspace/'owned-rewind.txt';assert owned.read_text()==INITIAL
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'));original_proof=proof;count=0
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        r={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
    def settled(stage,n):
        nonlocal count
        deadline=time.monotonic()+20
        while True:
            budget();count+=1;r=proof('rewind-'+stage+'-'+str(count));mine=[row for row in r['ledgerFull'] if row['user_id']==meta['memberId']]
            if r['modelCalls']==baseline['modelCalls']+n and len(mine)==n and all(row['status']=='settled' for row in mine):break
            assert time.monotonic()<deadline,'rewind accounting did not settle';time.sleep(.1)
        assert sum(row['amount'] for row in mine)==n*22
        assert [row for row in r['ledgerFull'] if row['user_id']!=meta['memberId']]==[row for row in baseline['ledgerFull'] if row['user_id']!=meta['memberId']]
        return r
    def canonical(sid,stage):
        req=evidence/(stage+'-read-input.json');req.write_text(json.dumps(dict(root=meta['root'],workspace=str(workspace),cli=str(cli),sid=sid)))
        proc=subprocess.run([node,'--import','tsx',str(root/'scripts/fixtures/prepublish-history-readonly.mjs'),str(req)],cwd=root,capture_output=True,text=True,timeout=15)
        assert proc.returncode==0,'readonly canonical failure: '+proc.stderr[:1000]
        r=json.loads(proc.stdout);(evidence/(stage+'-canonical.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
    def scroll(selector,focus=False):
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId']
            bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid)
            if focus:bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
    def complete(marker):
        until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps(marker)+')}))()','original rewind reply '+marker,45)

    send(A)
    seen=set();deadline=time.monotonic()+45
    while True:
        budget();p=bridge.evaluate('''(()=>{const a=[...document.querySelectorAll('button[data-permission-option-kind="allowOnce"]')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!document.querySelector('[data-testid=v4-stop]')&&document.body.innerText.includes(%s),permission:!!e,text:e?.closest('[role=listbox]')?.parentElement?.parentElement?.innerText,selected:e?.getAttribute('aria-selected')}})()'''%json.dumps(AR))
        if p['ok']:break
        if p.get('permission') and p.get('text') not in seen:
            assert 'owned-rewind.txt' in p.get('text',''),'only the exact owned file approval is authorized'
            assert len(seen)<2,'unexpected additional permission request'
            seen.add(p['text']);selector='button[data-permission-option-kind="allowOnce"]';scroll(selector,focus=True)
            until("(()=>({ok:document.querySelector('button[data-permission-option-kind=allowOnce]')?.getAttribute('aria-selected')==='true'}))()",'original allow-once selected')
            click(selector,'allow original owned Read/Write once')
        assert time.monotonic()<deadline,'original tool approval/completion timeout';time.sleep(.1)
    assert owned.read_text()==AFTER,'production Write must change the actual file'
    warm=settled('warm',4);assert warm['rewind']['readIssued'] and warm['rewind']['writeIssued'] and warm['rewind']['finalReplies']==1
    sid=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','original rewind session')['sid']
    before=canonical(sid,'rewind-warm');assert any(m['role']=='user' and m['text']==A for m in before['semantic']['active'])
    result['checks'].append('original-tool-read-write-and-allow-once-change-only-owned-workspace-file')
    if os.environ.get('PREPUBLISH_FILE_ONLY_REWIND')=='1':
        assert not fallback
        runpy.run_path(str(root/'scripts/tests/prepublish-file-only-case.py'))['run_file_only_case'](
            bridge=bridge,click=click,until=until,proof=proof,canonical=canonical,scroll=scroll,owned=owned,
            warm=warm,before=before,sid=sid,evidence=evidence,result=result,initial=INITIAL,after=AFTER,external=EXTERNAL)
        return
    action=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=v4-edit-]')].filter(e=>e.tagName==='BUTTON'&&e.getClientRects().length);return{ok:a.length===1,id:a[0]?.getAttribute('data-testid')}})()''','original latest user edit')
    suffix=action['id'].removeprefix('v4-edit-');sel='[data-testid="'+action['id']+'"]';scroll(sel);click(sel,'open original file-changing query edit')
    editor='[data-testid="v4-edit-input-'+suffix+'"]';scroll(editor);click(editor,'focus original rewind edit text')
    bridge.raw_cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4,commands=['selectAll'])
    bridge.raw_cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4);bridge.raw_cdp('Input.insertText',text=edited_query)
    until('(()=>({ok:document.querySelector('+json.dumps(editor)+')?.innerText.trim()==='+json.dumps(edited_query)+'}))()','exact original rewind draft')
    rewind='[data-testid="v4-edit-rewind-workspace-'+suffix+'"]'
    until('(()=>({ok:!!document.querySelector('+json.dumps(rewind)+')&&!document.querySelector('+json.dumps(rewind)+').disabled}))()','original file rewind enabled')
    owned.write_text(EXTERNAL)
    scroll(rewind);click(rewind,'original combined edit refuses externally modified file')
    conflict='[data-testid="v4-edit-workspace-conflict-dialog"]'
    until('(()=>{const d=document.querySelector('+json.dumps(conflict)+');return{ok:!!d&&d.innerText.includes("owned-rewind.txt"),text:d?.innerText}})()','original external-file conflict preview')
    assert owned.read_text()==EXTERNAL
    assert proof('rewind-conflict-no-inference')==warm
    conflict_state=canonical(sid,'rewind-conflict');assert conflict_state['semantic']==before['semantic'] and conflict_state['physicalMessageIds']==before['physicalMessageIds']
    if fallback:
        choose='[data-testid="v4-edit-workspace-conflict-conversation-only"]'
        until('(()=>({ok:!!document.querySelector('+json.dumps(choose)+')}))()','original conversation-only fallback option')
        scroll(choose);click(choose,'original conflict fallback resets conversation only')
        marker='PREPUBLISH_REWIND_ANSWER_F';complete(marker);done=settled('fallback',5)
        assert owned.read_text()==EXTERNAL and done['rewind']['externalPreservedBeforeFallbackRequest'] and done['rewind']['fallbackReplies']==1
        assert done['rewind']['editedReplies']==0 and not done['rewind']['restoredBeforeEditedRequest']
        assert all(row in done['ledgerFull'] for row in warm['ledgerFull'])
        extra=done['modelRequests'][len(warm['modelRequests']):];assert len(extra)==1 and extra[0]['stream'] is True
        assert edited_query in json.dumps(extra[0]['messages'][-1]) and A not in json.dumps(extra[0]['messages']) and AR not in json.dumps(extra[0]['messages'])
        state=canonical(sid,'rewind-fallback');assert any(m['text']==edited_query for m in state['semantic']['active'])
        assert all(A not in m['text'] and AR not in m['text'] for m in state['semantic']['active'])
        bridge.raw_cdp('Page.reload');complete(marker)
        assert owned.read_text()==EXTERNAL and proof('rewind-fallback-reload-no-replay')==done
        assert canonical(sid,'rewind-fallback-reloaded')['semantic']==state['semantic']
        result['checks'].append('original-conflict-conversation-only-fallback-keeps-external-file-and-reexecutes-once')
        result['rewindFallback']=dict(sessionId=sid,approvalRequests=len(seen),externalFilePreserved=True,currentSettled=5,currentCredits=110)
        return
    cancel=until('''(()=>{const d=document.querySelector(%s),b=[...d.querySelectorAll('button')].filter(e=>e.textContent.trim()==='取消');return{ok:b.length===1,id:b[0]?.outerHTML}})()'''%json.dumps(conflict),'conflict cancel available')
    # Only the dialog's Cancel is selected; the independent inline editor also has Cancel.
    r=bridge.evaluate('''(()=>{const d=document.querySelector(%s),e=[...d.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消'),r=e.getBoundingClientRect();return{ok:true,x:r.x+r.width/2,y:r.y+r.height/2}})()'''%json.dumps(conflict))
    for kind in ['mouseMoved','mousePressed','mouseReleased']:bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=r['x'],y=r['y'],**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
    until('(()=>({ok:!document.querySelector('+json.dumps(conflict)+')}))()','original conflict dialog cancelled')
    result['checks'].append('external-modification-conflict-preserves-file-canonical-history-and-complete-ledger')
    owned.write_text(AFTER)  # Controlled external editor undoes only its own third-party change.
    scroll(rewind);click(rewind,'retry original combined edit after external undo')
    complete(ER);done=settled('edited',5)
    assert owned.read_text()==INITIAL and done['rewind']['restoredBeforeEditedRequest'] is True and done['rewind']['editedReplies']==1
    assert all(row in done['ledgerFull'] for row in warm['ledgerFull'])
    extra=done['modelRequests'][len(warm['modelRequests']):];assert len(extra)==1 and extra[0].get('stream') is True
    assert E in json.dumps(extra[0]['messages'][-1]) and A not in json.dumps(extra[0]['messages']) and AR not in json.dumps(extra[0]['messages'])
    edited=canonical(sid,'rewind-edited');assert any(m['text']==E for m in edited['semantic']['active'])
    assert all(A not in m['text'] and AR not in m['text'] for m in edited['semantic']['active'])
    bridge.raw_cdp('Page.reload');complete(ER)
    assert owned.read_text()==INITIAL and proof('rewind-reload-no-replay')==done
    assert canonical(sid,'rewind-reloaded')['semantic']==edited['semantic']
    result['checks'].append('combined-file-and-conversation-rewind-precedes-new-model-request-and-persists-without-replay')
    result['rewind']=dict(sessionId=sid,approvalRequests=len(seen),initialSha256=hashlib.sha256(INITIAL.encode()).hexdigest(),agentSha256=hashlib.sha256(AFTER.encode()).hexdigest(),restoredBeforeModel=True,currentSettled=5,currentCredits=110)
