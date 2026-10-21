"""Original Git Graph metadata, paging, merge details, refresh and empty state."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def run_graph_case(*,bridge,click,until,proof,baseline,meta,workspace,evidence,result,budget):
    empty=os.environ.get('PREPUBLISH_GIT_GRAPH_EMPTY')=='1';original_proof=proof;git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
    def git(*args):return subprocess.run(['/usr/bin/git','-C',str(workspace),*args],env=git_env,check=True,capture_output=True,text=True,timeout=15).stdout
    def repo(stage):
        p=dict(branch=git('symbolic-ref','--short','HEAD').strip(),refs=git('for-each-ref','--format=%(refname)|%(objectname)').splitlines(),status=git('status','--porcelain=v1'),files={n:(workspace/n).read_text() for n in ['history.txt','feature.txt','fork.txt'] if (workspace/n).exists()});(evidence/('graph-'+stage+'-repo.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()};(evidence/'graph-baseline-full-proof.json').write_text(json.dumps(baseline,ensure_ascii=False,indent=2))
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def press(label,scope='body'):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==label];assert len(a)==1,'unique original graph control '+label
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!e.disabled&&!!e.closest(%s)&&(e.getAttribute('aria-label')||e.innerText).trim()===%s}})()'''%(x,y,json.dumps(scope),json.dumps(label)))['ok'],'original graph target moved '+label
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('graph '+label)
    def rows(n,stage):
        p=until('''(()=>{const svg=document.querySelector('[role=dialog] svg[aria-label="Git 提交图"]'),root=svg?.closest('section'),rows=[...(root?.querySelectorAll('button')??[])].filter(e=>e.innerText.includes('OWNED_GRAPH_')).map(e=>({subject:[...e.querySelectorAll('span')].find(s=>s.children.length===0&&s.textContent.startsWith('OWNED_GRAPH_'))?.textContent.trim(),short:e.lastElementChild?.textContent.trim(),text:e.innerText})),detail=root?.querySelector(':scope > div.border-t');return{ok:!!svg&&rows.length===%s,rows,circles:svg?.querySelectorAll('circle').length,lanes:svg?new Set([...svg.querySelectorAll('circle')].map(e=>e.getAttribute('cx'))).size:0,paths:svg?.querySelectorAll('path').length,detail:detail?.innerText??null,text:root?.innerText}})()'''%n,'original graph rows '+stage)
        (evidence/('graph-'+stage+'-ui.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));assert p['circles']==n+1 and p['lanes']>=2 and p['paths']>0;assert 'OWNED_GRAPH_INTERNAL_ONLY' not in p['text'];return p
    def row_click(subject):
        expression='''[...document.querySelectorAll('[role=dialog] section button')].find(e=>[...e.querySelectorAll('span')].some(s=>s.children.length===0&&s.textContent.trim()===%s))'''%json.dumps(subject)
        r=bridge.raw_cdp('Runtime.evaluate',expression=expression,returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',nodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button');return{ok:!!e&&!!e.closest('[role=dialog]')&&e.innerText.includes(%s)}})()'''%(x,y,json.dumps(subject)))['ok']
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('graph inspect '+subject)
    def detail(record,stage):
        p=until('''(()=>{const root=document.querySelector('[role=dialog] svg[aria-label="Git 提交图"]')?.closest('section'),e=root?.querySelector(':scope > div.border-t');return{ok:!!e&&e.innerText.includes(%s),text:e?.innerText}})()'''%json.dumps(record['hash']),'original commit detail '+stage)
        assert record['subject'] in p['text'] and record['author'] in p['text'] and '父提交' in p['text']
        for parent in record['parents']:assert parent[:7] in p['text']
        (evidence/('graph-detail-'+stage+'.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def wheel(delta):
        p=until('''(()=>{const s=document.querySelector('[role=dialog] svg[aria-label="Git 提交图"]')?.closest('section')?.querySelector(':scope > div.overflow-auto'),r=s?.getBoundingClientRect();return{ok:!!r&&s.contains(document.elementFromPoint(r.x+r.width*0.65,r.y+r.height/2)),x:r?.x+r?.width*0.65,y:r?.y+r?.height/2}})()''','original graph scroll hit')
        budget();bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y']);bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseWheel',x=p['x'],y=p['y'],deltaX=0,deltaY=delta);result['actions'].append('graph wheel '+str(delta))
    initial=repo('initial');assert initial['status']=='' and not git('remote');expected=[]
    if not empty:
        for line in git('log','HEAD','--branches','--tags','--remotes','--date-order','--topo-order','--format=%H%x00%P%x00%an%x00%at%x00%s').splitlines():
            h,parents,author,when,subject=line.split('\0');expected.append(dict(hash=h,parents=parents.split(),author=author,timestamp=int(when)*1000,subject=subject))
        assert len(expected)==56 and int(git('rev-list','--all','--count'))==57 and len(expected[0]['parents'])==2 and len(expected[-1]['parents'])==0;(evidence/'graph-expected-commits.json').write_text(json.dumps(expected,ensure_ascii=False,indent=2))
    press('切换 Git 分支');press('Git 图谱','[role=dialog]')
    if empty:
        state=until('''(()=>{const a=[...document.querySelectorAll('[role=dialog]')].filter(e=>e.innerText.includes('暂无提交')&&e.innerText.includes('当前仓库还没有提交历史。'));return{ok:a.length===1&&!a[0].querySelector('svg[aria-label="Git 提交图"]'),text:a[0]?.innerText}})()''','original empty graph');(evidence/'graph-empty-ui.json').write_text(json.dumps(state,ensure_ascii=False,indent=2));press('刷新 Git 图谱','[role=dialog]');until('''(()=>({ok:document.body.innerText.includes('暂无提交')&&!document.body.innerText.includes('Git 图谱加载失败')&&document.querySelector('[role=dialog] button[aria-label="刷新 Git 图谱"]')?.disabled===false}))()''','empty graph refresh')
        result['checks'].append('original-unborn-repository-graph-and-refresh-show-real-empty-history-without-creating-head')
    else:
        first=rows(50,'initial');assert [(r['subject'],r['short']) for r in first['rows']]==[(r['subject'],r['hash'][:7]) for r in expected[:50]];assert all(s in first['rows'][0]['text'] for s in ['HEAD','main','owned-release']);assert any('owned-graph-feature' in r['text'] for r in first['rows']);row_click(expected[0]['subject']);detail(expected[0],'merge');row_click(expected[0]['subject']);until('''(()=>({ok:!document.querySelector('[role=dialog] svg[aria-label="Git 提交图"]')?.closest('section')?.querySelector(':scope > div.border-t')}))()''','merge detail toggles closed')
        wheel(3000);allrows=rows(56,'paged');assert [(r['subject'],r['short']) for r in allrows['rows']]==[(r['subject'],r['hash'][:7]) for r in expected] and len({r['short'] for r in allrows['rows']})==56;assert '加载更多提交' not in allrows['text'];row_click(expected[-1]['subject']);detail(expected[-1],'root');wheel(-4000);until('''(()=>{const e=document.querySelector('[role=dialog] svg[aria-label="Git 提交图"]')?.closest('section')?.querySelector(':scope > div.overflow-auto');return{ok:!!e&&e.scrollTop<=1}})()''','graph scrolled back to top');press('刷新 Git 图谱','[role=dialog]');refreshed=rows(50,'refreshed');assert refreshed['rows']==first['rows'] and refreshed['detail'] is None
        result['checks'].append('original-graph-first-page-merge-refs-details-wheel-pagination-root-detail-and-refresh-match-real-visible-git-history')
    assert repo('before-close')==initial and proof('graph-before-close')==baseline;press('关闭','[role=dialog]');until('''(()=>({ok:!document.querySelector('[role=dialog]')&&!!document.querySelector('button[aria-label="切换 Git 分支"]')}))()''','original graph closed');bridge.raw_cdp('Page.reload');until('''(()=>({ok:!document.querySelector('[role=dialog]')&&!!document.querySelector('button[aria-label="切换 Git 分支"]')&&!!document.querySelector('[data-testid=enterprise-identity-name]')}))()''','graph remains closed after original reload');assert repo('final')==initial and proof('graph-final')==baseline
    result['checks'].append('read-only-graph-does-not-mutate-git-or-replay-model-usage-after-close-and-reload')
    result['gitGraph']=dict(empty=empty,visibleCommits=0 if empty else 56,pages=0 if empty else 2,currentModelCalls=0,currentLedgerRows=0,internalRefsExcluded=not empty)
