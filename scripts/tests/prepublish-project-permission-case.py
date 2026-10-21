"""Original project rule grant, real Main/CLI cold restore, exact-path match and negative control."""
import json
from pathlib import Path
import sqlite3
import subprocess
import time


def run_project_permission_case(*,bridge,click,until,proof,send,restart,baseline,meta,workspace,evidence,result,budget,node,root):
    owned=workspace/'owned-permission.txt';other=workspace/'other-permission.txt';initial='OWNED_PERMISSION_INITIAL\n第二行保持\n';other_initial='OWNED_PROJECT_OTHER_INITIAL\n'
    assert owned.read_text()==initial and other.read_text()==other_initial
    original_proof=proof;counter=0;cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        r={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
    def settled(phase,n):
        nonlocal counter
        stop=time.monotonic()+20
        while True:
            budget();counter+=1;r=proof('project-'+phase+'-'+str(counter));mine=[x for x in r['ledgerFull'] if x['user_id']==meta['memberId']]
            if r['modelCalls']==baseline['modelCalls']+n and len(mine)==n and all(x['status']=='settled' for x in mine):break
            assert time.monotonic()<stop,'project permission accounting did not settle';time.sleep(.1)
        assert sum(x['amount'] for x in mine)==n*22
        assert [x for x in r['ledgerFull'] if x['user_id']!=meta['memberId']]==[x for x in baseline['ledgerFull'] if x['user_id']!=meta['memberId']]
        return r
    def rule(sid,name):
        req=evidence/(name+'-rule-input.json');req.write_text(json.dumps(dict(root=meta['root'],cli=str(cli),sid=sid)))
        p=subprocess.run([node,'--import','tsx',str(root/'scripts/fixtures/prepublish-project-permission-readonly.mjs'),str(req)],cwd=root,text=True,capture_output=True,timeout=15)
        assert p.returncode==0,'original project permission getter failed: '+p.stderr[:900]
        r=json.loads(p.stdout);(evidence/(name+'-rule.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2));return r
    def choose(kind,file,label):
        selector='button[data-permission-option-kind="'+kind+'"]'
        until('(()=>{const a=[...document.querySelectorAll('+json.dumps(selector)+')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!!e&&e.closest("[role=listbox]")?.parentElement?.parentElement?.innerText.includes('+json.dumps(file.name)+')}})()','original project grant/denial option')
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.getAttribute("aria-selected")==="true"}))()','selected original project option')
        click(selector,label)
    def complete(phase):
        until('(()=>({ok:!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps('PREPUBLISH_PROJECT_DONE_'+phase)+')&&!document.querySelector("button[data-permission-option-kind]")}))()','completed original project phase '+phase,45)

    send('PREPUBLISH_PROJECT_ALLOW_P');choose('allowAlways',owned,'original allow matching file requests for project');complete('P')
    first=settled('granted',4);assert owned.read_text()=='OWNED_PROJECT_PERMISSION_A\n' and other.read_text()==other_initial
    sid=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','actual project permission session')['sid']
    rules=rule(sid,'project-granted')
    assert rules['rules'].get('allow')==[dict(toolName='Write',ruleContent=str(owned))]
    assert not rules['rules'].get('deny') and not rules['rules'].get('ask') and rules['rules'].get('mode')!='yolo'
    result['checks'].append('original-project-allow-persists-only-the-exact-write-path-without-full-access')
    bridge=restart()
    until('(()=>({ok:!!document.querySelector('+json.dumps('[data-testid="task-item-'+sid+'"]')+')}))()','same project task after actual Main cold launch')
    click('[data-testid="task-item-'+sid+'"]','original task resume after Main and CLI cold restart');complete('P')
    assert proof('project-cold-no-replay')==first and rule(sid,'project-cold-restored')==rules
    send('PREPUBLISH_PROJECT_ALLOW_Q')
    outcome=until("(()=>({ok:document.body.innerText.includes('PREPUBLISH_PROJECT_DONE_Q')||!!document.querySelector('button[data-permission-option-kind]'),permission:!!document.querySelector('button[data-permission-option-kind]')}))()",'matching request after cold restore',45)
    assert not outcome['permission'],'matching exact-path project permission must survive a real cold restart'
    complete('Q');second=settled('matched',7);assert owned.read_text()=='OWNED_PROJECT_PERMISSION_B\n' and other.read_text()==other_initial
    assert all(x in second['ledgerFull'] for x in first['ledgerFull']) and rule(sid,'project-after-match')==rules
    send('PREPUBLISH_PROJECT_ALLOW_R');choose('rejectOnce',other,'different file still requires original approval');complete('R')
    done=settled('nonmatching-denied',10);assert owned.read_text()=='OWNED_PROJECT_PERMISSION_B\n' and other.read_text()==other_initial
    assert done['permission']['R']['final']==1 and all(x in done['ledgerFull'] for x in second['ledgerFull']) and rule(sid,'project-after-negative-control')==rules
    bridge.raw_cdp('Page.reload');complete('R')
    assert proof('project-final-reload-no-replay')==done and rule(sid,'project-reloaded')==rules
    assert owned.read_text()=='OWNED_PROJECT_PERMISSION_B\n' and other.read_text()==other_initial
    result['checks'].append('project-rule-survives-real-main-cli-cold-restart-matches-only-granted-path-and-reload-never-replays')
    result['projectPermission']=dict(sessionId=sid,exactPathRules=1,mainColdRestart=True,matchingWriteNoApproval=True,otherFileApprovalRequired=True,currentSettled=10,currentCredits=220)
