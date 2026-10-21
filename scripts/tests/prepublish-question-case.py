"""Original AskUserQuestion controls, pending replay and actual answer delivery."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time


def run_question_case(*,bridge,click,until,proof,send,baseline,meta,evidence,result,budget,node,root,restart=None):
    history=os.environ.get('PREPUBLISH_QUESTION_HISTORY')=='1';skip=os.environ.get('PREPUBLISH_QUESTION_SKIP')=='1';assert not(history and skip)
    mode='history' if history else 'skip' if skip else 'multi';counter=0;original_proof=proof
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite'))
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def title(question):
        until('(()=>({ok:document.querySelectorAll("[data-elicitation-dialog-card]").length===1&&!!document.querySelector('+json.dumps('[data-elicitation-dialog-card] span[title="'+question+'"]')+')}))()','original question '+question)
    def press(role,label,exact=True):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes']
        matches=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')==role and (n.get('name',{}).get('value')==label if exact else label in n.get('name',{}).get('value',''))]
        assert len(matches)==1,'unique original question control required: '+label
        nid=matches[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid)
        q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            check=bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!e.disabled&&!!e.closest('[data-elicitation-dialog-card]')&&(e.getAttribute('aria-label')||e.innerText).includes(%s)}})()'''%(x,y,json.dumps(label)))
            assert check['ok'],'original question click is occluded or moved'
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('question '+label)
    def checked(label,value):
        until('''(()=>{const e=[...document.querySelectorAll('[data-elicitation-dialog-card] button[role=checkbox]')].find(e=>e.innerText.includes(%s));return{ok:e?.getAttribute('aria-checked')===%s}})()'''%(json.dumps(label),json.dumps(str(value).lower())),'original multi selection '+label)
    send('PREPUBLISH_QUESTION_HISTORY' if history else 'PREPUBLISH_QUESTION_SKIP' if skip else 'PREPUBLISH_QUESTION_MULTI');title('选择本次验证环境？')
    pending=proof('question-before-reload');assert pending['question']==dict(asked=1,answered=0,mode=mode)
    if not history:bridge.raw_cdp('Page.reload');title('选择本次验证环境？')
    resumed=proof('question-pending-restored');assert resumed['question']==pending['question']
    assert sum(bool(q.get('stream')) for q in resumed['modelRequests'])==sum(bool(q.get('stream')) for q in pending['modelRequests'])
    if history:press('option','南京',False)
    elif skip:
        press('button','下一题');title('需要验证哪些输出？');press('button','下一题');title('还有什么补充要求？')
    else:
        press('option','北京',False);title('需要验证哪些输出？')
        for label in ['日志','文件','指标']:press('checkbox',label,False);checked(label,True)
        press('checkbox','指标',False);checked('指标',False)
        selector='[data-elicitation-dialog-card] textarea';r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        bridge.raw_cdp('Input.insertText',text='补充：仅此案例')
        until("(()=>({ok:document.querySelector('[data-elicitation-dialog-card] textarea')?.value==='补充：仅此案例'}))()",'original custom answer')
        press('button','上一题');title('选择本次验证环境？');press('option','南京',False);title('需要验证哪些输出？')
        checked('日志',True);checked('文件',True);checked('指标',False)
        until("(()=>({ok:document.querySelector('[data-elicitation-dialog-card] textarea')?.value==='补充：仅此案例'}))()",'draft after changing previous answer')
        press('button','继续');title('还有什么补充要求？')
    if not history:press('button','提交')
    marker='PREPUBLISH_QUESTION_DONE_'+mode
    until('(()=>({ok:!document.querySelector("[data-elicitation-dialog-card]")&&!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps(marker)+')}))()','original question reply completed',45)
    stop=time.monotonic()+20
    while True:
        counter+=1;done=proof('question-completed-'+str(counter));mine=[r for r in done['ledgerFull'] if r['user_id']==meta['memberId']]
        if done['modelCalls']==baseline['modelCalls']+3 and len(mine)==3 and all(r['status']=='settled' for r in mine):break
        assert time.monotonic()<stop,'question accounting not settled';time.sleep(.1)
    assert sum(r['amount'] for r in mine)==66 and done['question']==dict(asked=1,answered=1,mode=mode)
    assert [r for r in done['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
    sid=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','question session')['sid']
    with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:
        parts=[json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY time_created,rowid',(sid,))]
    tools=[p for p in parts if p.get('type')=='tool' and p.get('tool')=='AskUserQuestion'];assert len(tools)==1 and tools[0]['state']['status']=='completed'
    (evidence/'question-canonical-tool.json').write_text(json.dumps(tools[0],ensure_ascii=False,indent=2))
    expected='did not provide answers' if skip else 'User has answered' if history else 'skipped 1';assert expected in tools[0]['state']['output']
    def show_history(stage):
        fold=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=chat-assistant-history-trigger]')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!!e,id:e?.getAttribute('data-testid'),open:e?.getAttribute('data-history-open')}})()''','original assistant work history')
        if fold['open']!='true':
            click('[data-testid="'+fold['id']+'"]','open original assistant work history')
            until('(()=>({ok:document.querySelector('+json.dumps('[data-testid="'+fold['id']+'"]')+').getAttribute("data-history-open")==="true"}))()','original work history expanded')
        target=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=tool-summary-trigger]')].filter(e=>e.getClientRects().length&&e.innerText.includes('已询问')),e=a.length===1?a[0]:null;return{ok:!!e,id:e?.getAttribute('data-testid'),open:e?.getAttribute('aria-expanded')}})()''','original completed question summary')
        selector='[data-testid="'+target['id']+'"]'
        if target['open']!='true':click(selector,'expand original answered question history')
        state=until('''(()=>{const e=document.querySelector(%s),c=e?.closest('[data-slot=collapsible]');return{ok:!!c&&e.getAttribute('aria-expanded')==='true'&&c.innerText.includes('选择本次验证环境？'),text:c?.innerText}})()'''%json.dumps(selector),'original answered card expanded')
        (evidence/('question-history-'+stage+'.json')).write_text(json.dumps(state,ensure_ascii=False,indent=2))
        if skip:assert '未回答，已自动继续' in state['text'] and '历史回答不可用' not in state['text'],'explicit empty answer map must remain different from missing history'
        else:assert '南京' in state['text'] and '未提供回答' not in state['text'],'original answered question card must display the real answer'
    if history or skip:show_history('live')
    result['checks'].append('original-single-question-model-and-canonical-answer' if history else 'original-empty-question-submit-pending-reload-and-model-continuation' if skip else 'original-question-pending-reload-single-multi-custom-navigation-and-optional-answer-deliver-to-actual-model')
    bridge.raw_cdp('Page.reload')
    until('(()=>({ok:document.body.innerText.includes('+json.dumps(marker)+')&&!document.querySelector("[data-elicitation-dialog-card]")}))()','completed question survives reload')
    assert proof('question-final-no-replay')==done
    if skip:show_history('renderer-reloaded')
    if history:
        show_history('renderer-reloaded');assert restart
        bridge=restart();until('(()=>({ok:!!document.querySelector('+json.dumps('[data-testid="task-item-'+sid+'"]')+')}))()','original question task after cold restore')
        click('[data-testid="task-item-'+sid+'"]','resume original question task after Main/CLI restart')
        until('(()=>({ok:document.body.innerText.includes('+json.dumps(marker)+')}))()','question result after cold restore')
        show_history('cold');assert proof('question-cold-no-replay')==done
        result['checks'].append('original-answered-question-history-persists-across-renderer-and-main-cli-cold-restore')
    result['question']=dict(sessionId=sid,mode=mode,currentSettled=3,currentCredits=66,pendingReloadPerformed=not history,pendingReloadNoDuplicate=True if not history else None)
