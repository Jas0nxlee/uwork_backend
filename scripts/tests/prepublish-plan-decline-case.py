"""Original plan decline stops the turn, then explicit new input resumes approval."""
import json
from pathlib import Path
import sqlite3
import time

PLAN_B='# 修订计划B\n\nOWNED_PLAN_B\n\n1. 检查真实前后端联动。\n2. 保留中文记录，不改业务文件。\n'


def run_plan_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget):
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'));original_proof=proof;counter=0
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def settle(stage,total):
        nonlocal counter
        stop=time.monotonic()+20
        while True:
            budget();counter+=1;p=proof('plan-decline-'+stage+'-'+str(counter));mine=[r for r in p['ledgerFull'] if r['user_id']==meta['memberId']]
            assert p['modelCalls']<=baseline['modelCalls']+total,'unexpected extra model call after plan decline'
            if p['modelCalls']==baseline['modelCalls']+total and len(mine)==total and all(r['status']=='settled' for r in mine):break
            assert time.monotonic()<stop,'plan decline accounting did not settle';time.sleep(.1)
        assert sum(r['amount'] for r in mine)==total*22
        assert [r for r in p['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
        return p
    def canonical(stage):
        with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
            rows=[json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY time_created,rowid',(session,))]
            users=[json.loads(r[0]) for r in db.execute("SELECT p.data FROM part p JOIN message m ON m.id=p.message_id WHERE p.session_id=? AND json_extract(m.data,'$.role')='user' ORDER BY p.time_created,p.rowid",(session,))]
        p=dict(tools=[r for r in rows if r.get('type')=='tool' and r.get('tool') in ['EnterPlanMode','ExitPlanMode']],users=[r['text'] for r in users if r.get('type')=='text']);(evidence/('plan-decline-'+stage+'-canonical.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ready(marker):
        return until('''(()=>({ok:!!document.querySelector('[data-elicitation-dialog-card]')&&document.querySelector('[data-elicitation-dialog-card]').innerText.includes('实施计划')&&document.body.innerText.includes(%s)&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='true'}))()'''%json.dumps(marker),'original plan approval '+marker)
    def press(label):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==label];assert len(a)==1
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!e.disabled&&!!e.closest('[data-elicitation-dialog-card]')&&(e.getAttribute('aria-label')||e.innerText)===%s}})()'''%(x,y,json.dumps(label)))['ok']
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('original plan '+label)
    def stopped():
        return until('''(()=>({ok:!document.querySelector('[data-elicitation-dialog-card]')&&!document.querySelector('[data-testid=v4-stop]')&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='true',text:document.body.innerText}))()''','plain plan decline stops and remains in plan mode',45)
    send('PREPUBLISH_PLAN_DECLINE');ready('OWNED_PLAN_A');session=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','actual plan decline session')['sid'];planfile=workspace/'.zcode/plans'/('plan-'+session+'.md');assert not planfile.exists()
    press('忽略');state=stopped();(evidence/'plan-decline-stopped-ui.json').write_text(json.dumps(state,ensure_ascii=False,indent=2));first=settle('stopped',3);assert first['planApproval']==dict(entered=True,proposed=1,approved=False) and not planfile.exists()
    old=canonical('stopped');assert [p['state']['status'] for p in old['tools']]==['completed','error'];assert 'Permission denied for ExitPlanMode' in old['tools'][1]['state']['error'];assert old['users']==['PREPUBLISH_PLAN_DECLINE']
    bridge.raw_cdp('Page.reload');stopped();assert proof('plan-decline-reloaded')==first and canonical('reloaded')==old and not planfile.exists()
    result['checks'].append('original-plan-ignore-stops-with-no-self-rewrite-or-feedback-steer-and-no-approved-file')
    send('PREPUBLISH_PLAN_DECLINE_RESUME');ready('OWNED_PLAN_B');assert proof('plan-decline-resume-pending')['planApproval']==dict(entered=True,proposed=2,approved=False);assert not planfile.exists();press('提交')
    until('''(()=>({ok:!document.querySelector('[data-elicitation-dialog-card]')&&!document.querySelector('[data-testid=v4-stop]')&&document.body.innerText.includes('PREPUBLISH_PLAN_DECLINE_RESUMED')&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='false'}))()''','explicit new input resumes and approves plan',45)
    done=settle('resumed',5);assert done['planApproval']==dict(entered=True,proposed=2,approved=True);assert all(r in done['ledgerFull'] for r in first['ledgerFull']);new=canonical('resumed');assert new['tools'][:2]==old['tools'] and [r['state']['status'] for r in new['tools']]==['completed','error','completed'];assert new['users']==['PREPUBLISH_PLAN_DECLINE','PREPUBLISH_PLAN_DECLINE_RESUME'];assert planfile.read_bytes()==PLAN_B.encode();(evidence/'plan-decline-approved.md').write_bytes(planfile.read_bytes())
    bridge.raw_cdp('Page.reload');until('''(()=>({ok:document.body.innerText.includes('PREPUBLISH_PLAN_DECLINE_RESUMED')&&!document.querySelector('[data-elicitation-dialog-card]')&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='false'}))()''','resumed plan survives final reload');assert proof('plan-decline-final')==done and canonical('final')==new and planfile.read_bytes()==PLAN_B.encode()
    result['checks'].append('only-explicit-new-user-input-resumes-plan-approval-with-old-denial-preserved')
    result['planDecline']=dict(sessionId=session,stoppedModelCalls=3,stoppedCredits=66,finalModelCalls=5,finalCredits=110,feedbackSteerCount=0,approvedFileOnlyAfterExplicitResume=True)
