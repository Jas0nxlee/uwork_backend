"""Original plan feedback steer, revised approval, file continuity and UI recovery."""
import json
import os
from pathlib import Path
import sqlite3
import time

FEEDBACK='请保留中文记录。\n只验证联动，不改业务文件。'
PLAN_B='# 修订计划B\n\nOWNED_PLAN_B\n\n1. 检查真实前后端联动。\n2. 保留中文记录，不改业务文件。\n'


def run_plan_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget):
    detail_only=os.environ.get('PREPUBLISH_PLAN_DETAIL_ONLY')=='1';total=4 if detail_only else 5
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'));original_proof=proof;counter=0
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def sid():return until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','actual plan session')['sid']
    def canonical(stage):
        with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
            tools=[json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY time_created,rowid',(session,))]
            feedback=[json.loads(r[0]) for r in db.execute("SELECT p.data FROM part p JOIN message m ON m.id=p.message_id WHERE p.session_id=? AND json_extract(m.data,'$.role')='user' ORDER BY p.time_created,p.rowid",(session,))]
        p=dict(tools=[x for x in tools if x.get('type')=='tool' and x.get('tool') in ['EnterPlanMode','ExitPlanMode']],userText=[x.get('text') for x in feedback if x.get('type')=='text']);(evidence/('plan-'+stage+'-canonical.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ready(marker):
        return until('''(()=>{const e=document.querySelector('[data-elicitation-dialog-card]'),c=document.querySelector('[data-testid=v4-model-config]');return{ok:!!e&&e.innerText.includes('实施计划')&&document.body.innerText.includes(%s)&&c?.getAttribute('data-plan-enabled')==='true',text:e?.innerText,plan:c?.getAttribute('data-plan-enabled')}})()'''%json.dumps(marker),'original plan approval '+marker)
    def press_submit():
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='提交'];assert len(a)==1
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!e.disabled&&!!e.closest('[data-elicitation-dialog-card]')&&(e.getAttribute('aria-label')||e.innerText)==='提交'}})()'''%(x,y))['ok']
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('original plan 提交')
    send('PREPUBLISH_PLAN_APPROVAL');state=ready('OWNED_PLAN_B' if detail_only else 'OWNED_PLAN_A');session=sid();planfile=workspace/'.zcode/plans'/('plan-'+session+'.md');assert not planfile.exists()
    (evidence/'plan-first-visible.json').write_text(json.dumps(state,ensure_ascii=False,indent=2));p=proof('plan-first-pending');assert p['planApproval']==dict(entered=True,proposed=1,feedbackObserved=False,approved=False)
    before=canonical('first-pending');assert [x['tool'] for x in before['tools']]==['EnterPlanMode','ExitPlanMode'];assert before['tools'][0]['state']['status']=='completed' and before['tools'][1]['state']['status']=='running'
    if not detail_only:
        selector='[data-elicitation-dialog-card] textarea';r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        bridge.raw_cdp('Input.insertText',text='  '+FEEDBACK+'\n  ')
        until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.value==='+json.dumps('  '+FEEDBACK+'\n  ')+'}))()','original plan feedback exact draft');result['actions'].append('original plan multiline feedback');press_submit()
        ready('OWNED_PLAN_B');assert not planfile.exists();revised=canonical('revised-pending');assert FEEDBACK in revised['userText'];assert [x['state']['status'] for x in revised['tools']]==['completed','error','running'];assert FEEDBACK in revised['tools'][1]['state']['error']
        pending=proof('plan-revised-pending');assert pending['planApproval']==dict(entered=True,proposed=2,feedbackObserved=True,approved=False)
        bridge.raw_cdp('Page.reload');ready('OWNED_PLAN_B');assert not planfile.exists();assert proof('plan-revised-reloaded')==pending
    # 原主按钮无反馈时必须明确批准；不能用直接selectOption/RPC绕开这个分支。
    until('''(()=>({ok:document.querySelector('[data-elicitation-dialog-card] textarea')?.value===''&&!document.querySelector('[data-elicitation-dialog-card] [role=option][aria-selected=true]')}))()''','revised plan has no selected answer or feedback');press_submit()
    until('''(()=>({ok:!document.querySelector('[data-elicitation-dialog-card]')&&!document.querySelector('[data-testid=v4-stop]')&&document.body.innerText.includes('PREPUBLISH_PLAN_APPROVAL_DONE')&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='false'}))()''','approved plan completed',45)
    stop=time.monotonic()+20
    while True:
        budget();counter+=1;done=proof('plan-completed-'+str(counter));mine=[r for r in done['ledgerFull'] if r['user_id']==meta['memberId']]
        if done['modelCalls']==baseline['modelCalls']+total and len(mine)==total and all(r['status']=='settled' for r in mine):break
        assert time.monotonic()<stop,'plan approval accounting not settled';time.sleep(.1)
    assert sum(r['amount'] for r in mine)==total*22 and done['planApproval']==dict(entered=True,proposed=1 if detail_only else 2,feedbackObserved=not detail_only,approved=True)
    assert [r for r in done['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
    assert planfile.read_bytes()==PLAN_B.encode();(evidence/'approved-plan.md').write_bytes(planfile.read_bytes());final=canonical('completed');assert [x['state']['status'] for x in final['tools']]==(['completed','completed'] if detail_only else ['completed','error','completed']);assert detail_only or final['tools'][1]==revised['tools'][1]
    assert 'OWNED_PLAN_B' in final['tools'][-1]['state']['output'];result['checks'].append('minimal-original-plan-approval-prepares-detail-with-exact-file' if detail_only else 'original-plan-feedback-becomes-real-steer-and-revised-default-submit-approves-with-canonical-mode-and-file')
    fold=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=chat-assistant-history-trigger]')].filter(e=>e.getClientRects().length),e=a.length===%s?a[a.length-1]:null;return{ok:!!e,id:e?.getAttribute('data-testid'),open:e?.getAttribute('data-history-open')}})()'''%(1 if detail_only else 2),'original completed plan work history')
    if fold['open']!='true':click('[data-testid="'+fold['id']+'"]','expand original completed plan work history')
    target=bridge.raw_cdp('Runtime.evaluate',expression='''[...document.querySelectorAll('section[aria-label="在侧边栏查看计划"]')].find(e=>e.innerText.includes('OWNED_PLAN_B'))''',returnByValue=False)['result'];assert target.get('objectId')
    try:
        bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=target['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid)
    finally:bridge.raw_cdp('Runtime.releaseObject',objectId=target['objectId'])
    # 只在含B的原卡上打开详情，不按“第一个计划”猜测可能仍显示的A卡。
    card=until('''(()=>{const a=[...document.querySelectorAll('section[aria-label="在侧边栏查看计划"]')].filter(e=>e.getClientRects().length&&e.innerText.includes('OWNED_PLAN_B'));const e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+20)),x:r?.x+r?.width/2,y:r?.y+20}})()''','original revised plan card')
    for kind in ['mouseMoved','mousePressed','mouseReleased']:
        assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('section[aria-label="在侧边栏查看计划"]');return{ok:!!e&&e.innerText.includes('OWNED_PLAN_B')}})()'''%(card['x'],card['y']))['ok'];bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=card['x'],y=card['y'],**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
    result['actions'].append('open original revised plan card')
    detail=until('''(()=>{const e=document.querySelector('[data-plan-detail-tool-call-id="owned-plan-revised"]');return{ok:!!e&&e.innerText.includes('OWNED_PLAN_B')&&!e.innerText.includes('OWNED_PLAN_A'),text:e?.innerText}})()''','original revised plan detail');(evidence/'plan-revised-detail.json').write_text(json.dumps(detail,ensure_ascii=False,indent=2))
    bridge.raw_cdp('Page.reload');until('''(()=>({ok:document.body.innerText.includes('PREPUBLISH_PLAN_APPROVAL_DONE')&&!document.querySelector('[data-elicitation-dialog-card]')&&document.querySelector('[data-testid=v4-model-config]')?.getAttribute('data-plan-enabled')==='false'}))()''','completed plan reload')
    assert proof('plan-final')==done and planfile.read_bytes()==PLAN_B.encode() and canonical('final')==final
    result['checks'].append('original-revised-plan-card-opens-real-detail-and-reload-retains-file-with-zero-model-replay')
    result['planApproval']=dict(sessionId=session,currentSettled=total,currentCredits=total*22,detailOnly=detail_only,feedbackSteer=not detail_only,revisedApproved=True,planFileExact=True)
