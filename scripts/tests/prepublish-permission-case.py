"""Original Write rejectOnce, actual model-visible denial, reload and same-session recovery."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

INITIAL='OWNED_PERMISSION_INITIAL\n第二行保持\n';RECOVERED='OWNED_PERMISSION_RECOVERED_B\n'
A='PREPUBLISH_PERMISSION_QUERY_A';B='PREPUBLISH_PERMISSION_QUERY_B'
DENIED='PREPUBLISH_PERMISSION_DENIED_WAITING';DONE='PREPUBLISH_PERMISSION_RECOVERED'


def run_permission_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget,node,root):
    feedback_mode=os.environ.get('PREPUBLISH_PERMISSION_FEEDBACK')=='1'
    feedback='不要写入；只说明原因。\n保留“第二行”原始字节。'
    owned=workspace/'owned-permission.txt';assert owned.read_text()==INITIAL
    original_proof=proof;counter=0;cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def settle(name,n):
        nonlocal counter
        stop=time.monotonic()+20
        while True:
            budget();counter+=1;p=proof('permission-'+name+'-'+str(counter));mine=[r for r in p['ledgerFull'] if r['user_id']==meta['memberId']]
            if p['modelCalls']==baseline['modelCalls']+n and len(mine)==n and all(r['status']=='settled' for r in mine):break
            assert time.monotonic()<stop,'permission accounting not settled';time.sleep(.1)
        assert sum(r['amount'] for r in mine)==n*22
        assert [r for r in p['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
        return p
    def canonical(sid,name):
        req=evidence/(name+'-read-input.json');req.write_text(json.dumps(dict(root=meta['root'],workspace=str(workspace),cli=str(cli),sid=sid)))
        p=subprocess.run([node,'--import','tsx',str(root/'scripts/fixtures/prepublish-history-readonly.mjs'),str(req)],cwd=root,text=True,capture_output=True,timeout=15)
        assert p.returncode==0,'permission canonical read failed: '+p.stderr[:1000]
        r=json.loads(p.stdout);(evidence/(name+'-canonical.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));assert r['index']['task_status']=='completed';return r
    def writes(sid,name):
        with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
            data=[json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY time_created,rowid',(sid,))]
        selected=[r for r in data if r.get('type')=='tool' and r.get('tool')=='Write']
        (evidence/(name+'-write-parts.json')).write_text(json.dumps(selected,ensure_ascii=False,indent=2));return selected
    def choose(kind,label,status_flag):
        selector='button[data-permission-option-kind="'+kind+'"]'
        until('(()=>{const a=[...document.querySelectorAll('+json.dumps(selector)+')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!!e&&e.closest("[role=listbox]")?.parentElement?.parentElement?.innerText.includes("owned-permission.txt")}})()','original exact owned Write permission')
        pending=proof('permission-pending-'+kind);assert pending['permission'][status_flag] and owned.read_text()==INITIAL
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId']
            bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.getAttribute("aria-selected")==="true"}))()','selected original permission option')
        click(selector,label)
    def complete(marker):
        until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps(marker)+')&&!document.querySelector("button[data-permission-option-kind]")}))()','original permission turn completed '+marker,45)

    marker='PREPUBLISH_PERMISSION_FEEDBACK_ACCEPTED' if feedback_mode else DENIED
    send('PREPUBLISH_PERMISSION_QUERY_F' if feedback_mode else A)
    if feedback_mode:
        selector='textarea[data-permission-feedback-option="deny"]'
        until('(()=>({ok:!!document.querySelector('+json.dumps(selector)+')}))()','original optional denial feedback')
        pending=proof('permission-feedback-pending');assert pending['permission']['deniedWriteIssued'] and not pending['permission']['userDenialObserved'] and owned.read_text()==INITIAL
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        until("(()=>({ok:document.querySelector('button[aria-label=确认]')?.disabled===true}))()",'empty feedback confirmation disabled')
        raw='  '+feedback+'\n  ';bridge.raw_cdp('Input.insertText',text=raw)
        until('(()=>({ok:document.querySelector('+json.dumps(selector)+').value==='+json.dumps(raw)+'&&!document.querySelector("button[aria-label=确认]").disabled}))()','original multiline feedback retained before submit')
        click('button[aria-label="确认"]','original denial feedback confirmation')
    else:choose('rejectOnce','original Write rejection once','deniedWriteIssued')
    complete(marker)
    first=settle('denied',4);assert owned.read_text()==INITIAL
    assert first['permission']['userDenialObserved'] and first['permission']['deniedReply']==1 and not first['permission']['recoveryWriteIssued']
    sid=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','actual permission session')['sid']
    before=canonical(sid,'permission-denied');wp=writes(sid,'permission-denied')
    assert len(wp)==1 and wp[0]['state']['status']=='error' and wp[0]['state'].get('error')
    bridge.raw_cdp('Page.reload');complete(marker)
    assert owned.read_text()==INITIAL and proof('permission-denied-reload-no-replay')==first
    assert canonical(sid,'permission-denied-reloaded')['semantic']==before['semantic']
    result['checks'].append('original-reject-once-does-not-write-and-delivers-real-user-denial-to-model-and-canonical-error')
    if feedback_mode:
        assert first['permission']['feedbackObserved'] and feedback in wp[0]['state']['error']
        result['checks'].append('original-empty-feedback-guard-and-multiline-user-denial-delivery-persist-without-write-or-replay')
        result['permissionFeedback']=dict(sessionId=sid,emptyConfirmDisabled=True,trimmedMultilineDelivered=True,fileUnchanged=True,currentSettled=4,currentCredits=88)
        return
    send(B);choose('allowOnce','new user query requests original approval again','recoveryWriteIssued');complete(DONE)
    done=settle('recovered',6);assert owned.read_text()==RECOVERED
    assert done['permission']['recoveryConfirmed'] and done['permission']['recoveryReply']==1
    assert all(r in done['ledgerFull'] for r in first['ledgerFull'])
    extra=done['modelRequests'][len(first['modelRequests']):];assert len(extra)==2 and all(q.get('stream') for q in extra)
    assert all(B in json.dumps(q['messages'][-1] if q['messages'][-1]['role']=='user' else [m for m in q['messages'] if m['role']=='user'][-1]) for q in extra)
    parts=writes(sid,'permission-recovered');assert len(parts)==2 and parts[0]==wp[0] and parts[1]['state']['status']=='completed'
    final=canonical(sid,'permission-recovered');assert sum(m['role']=='user' and m['text']==B for m in final['semantic']['active'])==1
    bridge.raw_cdp('Page.reload');complete(DONE)
    assert owned.read_text()==RECOVERED and proof('permission-recovered-reload-no-replay')==done
    assert canonical(sid,'permission-recovered-reloaded')['semantic']==final['semantic']
    result['checks'].append('reject-once-is-not-permanent-new-user-query-approval-writes-once-and-reload-does-not-replay')
    result['permission']=dict(sessionId=sid,rejectOnce=1,laterAllowOnce=1,deniedWriteNoSideEffect=True,modelObservedOriginalDenial=True,currentSettled=6,currentCredits=132)
