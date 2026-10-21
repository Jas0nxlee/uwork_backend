"""Original question decline, canonical error and fresh same-session interaction."""
import json
from pathlib import Path
import sqlite3
import time


def run_question_case(*,bridge,click,until,proof,send,baseline,meta,evidence,result,budget,**_):
    cli=next(Path(meta['home']).glob('.*/cli/db/db.sqlite')); original_proof=proof;counter=0
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
            budget();counter+=1;p=proof('question-dismiss-'+stage+'-'+str(counter));mine=[r for r in p['ledgerFull'] if r['user_id']==meta['memberId']]
            if p['modelCalls']==baseline['modelCalls']+total and len(mine)==total and all(r['status']=='settled' for r in mine):break
            assert time.monotonic()<stop,'question decline accounting not settled';time.sleep(.1)
        assert sum(r['amount'] for r in mine)==total*22
        assert [r for r in p['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
        return p
    def parts(sid,stage):
        with sqlite3.connect(cli.as_uri()+'?mode=ro',uri=True) as db:rows=[json.loads(r[0]) for r in db.execute('SELECT data FROM part WHERE session_id=? ORDER BY time_created,rowid',(sid,))]
        selected=[p for p in rows if p.get('type')=='tool' and p.get('tool')=='AskUserQuestion'];(evidence/('question-dismiss-'+stage+'-parts.json')).write_text(json.dumps(selected,ensure_ascii=False,indent=2));return selected
    def ready():until('''(()=>({ok:document.querySelectorAll('[data-elicitation-dialog-card]').length===1&&!!document.querySelector('[data-elicitation-dialog-card] span[title="选择本次验证环境？"]')}))()''','original single question ready')
    def press(role,label,exact=True):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')==role and (n.get('name',{}).get('value')==label if exact else label in n.get('name',{}).get('value',''))];assert len(a)==1
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!e.disabled&&!!e.closest('[data-elicitation-dialog-card]')&&(e.getAttribute('aria-label')||e.innerText).includes(%s)}})()'''%(x,y,json.dumps(label)))['ok']
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('question '+label)
    def complete(mode):until('(()=>({ok:!document.querySelector("[data-elicitation-dialog-card]")&&!document.querySelector("[data-testid=v4-stop]")&&document.body.innerText.includes('+json.dumps('PREPUBLISH_QUESTION_DISMISS_DONE_'+mode)+')}))()','question '+mode+' completed',45)
    send('PREPUBLISH_QUESTION_DISMISS');ready();assert proof('question-dismiss-pending')['question']==dict(asked=1,declined=0,recovered=0)
    press('button','忽略');complete('dismiss');first=settle('declined',3);assert first['question']==dict(asked=1,declined=1,recovered=0)
    sid=until('''(()=>{const a=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length);return{ok:a.length===1,sid:a[0]?.getAttribute('data-session-id')}})()''','actual declined question session')['sid']
    old=parts(sid,'declined');assert len(old)==1 and old[0]['state']['status']=='error' and 'AskUserQuestion was declined' in old[0]['state']['error']
    bridge.raw_cdp('Page.reload');complete('dismiss');assert proof('question-dismiss-reloaded')==first and parts(sid,'reloaded')==old
    fold=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=chat-assistant-history-trigger]')].filter(e=>e.getClientRects().length),e=a.length===1?a[0]:null;return{ok:!!e,id:e?.getAttribute('data-testid'),open:e?.getAttribute('data-history-open')}})()''','original declined work history')
    if fold['open']!='true':click('[data-testid="'+fold['id']+'"]','open original declined question history')
    card=until('''(()=>{const a=[...document.querySelectorAll('[data-testid^=tool-summary-trigger]')].filter(e=>e.getClientRects().length&&e.innerText.includes('已询问')),e=a.length===1?a[0]:null;return{ok:!!e,text:e?.closest('[data-slot=collapsible]')?.innerText}})()''','original declined question card')
    (evidence/'question-dismiss-declined-card.json').write_text(json.dumps(card,ensure_ascii=False,indent=2));assert '未回答，已自动继续' not in card['text']
    result['checks'].append('original-question-dismiss-delivers-real-decline-and-canonical-error-without-replay-or-empty-success')
    send('PREPUBLISH_QUESTION_DISMISS_RECOVERY');ready();assert proof('question-dismiss-recovery-pending')['question']==dict(asked=2,declined=1,recovered=0)
    press('option','北京',False);complete('recovery');done=settle('recovered',5);assert done['question']==dict(asked=2,declined=1,recovered=1)
    new=parts(sid,'recovered');assert len(new)==2 and new[0]==old[0] and new[1]['state']['status']=='completed';assert json.loads(new[1]['state']['output'])['answers']=={'选择本次验证环境？':'北京'}
    assert all(r in done['ledgerFull'] for r in first['ledgerFull'])
    bridge.raw_cdp('Page.reload');complete('recovery');assert proof('question-dismiss-final')==done and parts(sid,'final')==new
    result['checks'].append('same-session-new-question-remains-answerable-after-dismiss-with-original-error-preserved')
    result['questionDismiss']=dict(sessionId=sid,firstSettled=3,firstCredits=66,finalSettled=5,finalCredits=110,declined=1,recovered=1)
