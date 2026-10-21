"""Original local branch creation, search, switch and overwrite protection."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess

CREATED='codex/owned-branch';TARGET='owned-target';SAVE='test: 保存切换分支前的本地改动'


def run_branch_case(*,bridge,click,until,proof,baseline,meta,workspace,evidence,result,budget):
    blocked=os.environ.get('PREPUBLISH_GIT_BRANCH_BLOCKED')=='1';untracked=os.environ.get('PREPUBLISH_GIT_BRANCH_UNTRACKED')=='1';assert not untracked or blocked;original_proof=proof
    git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
    def git(*args):return subprocess.run(['/usr/bin/git','-C',str(workspace),*args],env=git_env,check=True,capture_output=True,text=True,timeout=15).stdout
    def repo(stage):
        p=dict(branch=git('branch','--show-current').strip(),head=git('rev-parse','HEAD').strip(),refs=git('for-each-ref','--format=%(refname:short)|%(objectname)','refs/heads').splitlines(),count=int(git('rev-list','--all','--count')),status=git('status','--porcelain=v1'),index=git('diff','--cached','--binary'),worktree=git('diff','--binary'),stash=git('stash','list'),files={n:(workspace/n).read_text() for n in ['conflict.txt','keep.txt','target-only.txt','unrelated.txt'] if (workspace/n).exists()});(evidence/('branch-'+stage+'-repo.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()}
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def press(role,label,scope='body',exact=True):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')==role and (n.get('name',{}).get('value')==label if exact else label in n.get('name',{}).get('value',''))];assert len(a)==1,'unique original control '+label
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button,[cmdk-item]');return{ok:!!e&&!e.disabled&&e.getAttribute('data-disabled')!=='true'&&!!e.closest(%s)&&(e.getAttribute('aria-label')||e.innerText).includes(%s)}})()'''%(x,y,json.dumps(scope),json.dumps(label)))['ok'],'original target moved or occluded '+label
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('branch '+label)
    def fill(selector,value):
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        bridge.raw_cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4,commands=['selectAll']);bridge.raw_cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',windowsVirtualKeyCode=65,modifiers=4);bridge.raw_cdp('Input.insertText',text=value)
        until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.value==='+json.dumps(value)+'}))()','original input exact readback')
    def label(branch):
        until('''(()=>{const a=[...document.querySelectorAll('button[aria-label="切换 Git 分支"]')].filter(e=>e.getClientRects().length);return{ok:a.length===1&&a[0].innerText.trim()===%s}})()'''%json.dumps(branch),'original branch label '+branch)
    def menu():
        press('button','切换 Git 分支')
        until('''(()=>({ok:[...document.querySelectorAll('[cmdk-item]')].some(e=>e.getClientRects().length&&e.getAttribute('data-value')==='owned-target')}))()''','original branch list loaded')
    def choose(branch):menu();press('option',branch,exact=False)
    def modal(title):
        return until('''(()=>{const a=[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getClientRects().length&&e.innerText.includes(%s));return{ok:a.length===1,text:a[0]?.innerText}})()'''%json.dumps(title),'original dialog '+title)
    initial=repo('initial');assert initial['branch']=='main' and initial['count']==2 and not git('remote');label('main')
    if blocked:
        choose(TARGET);warning=modal('提交更改以切换分支');(evidence/'branch-blocked-visible.json').write_text(json.dumps(warning,ensure_ascii=False,indent=2));assert ('target-only.txt' if untracked else 'conflict.txt') in warning['text'] and 'unrelated.txt' not in warning['text'];assert not untracked or '以下未跟踪文件会被检出操作覆盖' in warning['text'];assert '1 个文件' in warning['text'],'affected file count must match the one listed overwrite conflict'
        assert repo('blocked')==initial and proof('branch-blocked')==baseline
        press('button','取消','[role=dialog]');label('main');assert repo('cancelled')==initial and proof('branch-cancelled')==baseline
        choose(TARGET);modal('提交更改以切换分支');press('button','提交并切换分支...','[role=dialog]');preview=modal('提交完成后会自动继续切换到');(evidence/'branch-commit-preview.json').write_text(json.dumps(preview,ensure_ascii=False,indent=2));assert '2 个文件' in preview['text'] and TARGET in preview['text'];fill('[role=dialog] textarea',SAVE);press('button','提交并切换分支','[role=dialog]');label(TARGET)
        final=repo('assisted-switched');assert final['status']=='' and final['stash']=='' and final['count']==3 and final['files']=={'conflict.txt':'OWNED_BRANCH_T\n','keep.txt':'OWNED_BRANCH_KEEP\n','target-only.txt':'OWNED_BRANCH_TARGET_ONLY\n'}
        preserved={n:git('show','main:'+n) for n in ['conflict.txt','unrelated.txt']+(['target-only.txt'] if untracked else [])};(evidence/'branch-preserved-main.json').write_text(json.dumps(preserved,ensure_ascii=False,indent=2))
        assert preserved['conflict.txt']==('OWNED_BRANCH_A\n' if untracked else 'OWNED_BRANCH_LOCAL\n') and preserved['unrelated.txt']=='OWNED_BRANCH_UNRELATED\n';assert not untracked or preserved['target-only.txt']=='OWNED_BRANCH_LOCAL_UNTRACKED\n';assert git('log','-1','--format=%s','main').strip()==SAVE;assert next(r for r in final['refs'] if r.startswith(TARGET+'|'))==next(r for r in initial['refs'] if r.startswith(TARGET+'|'))
        result['checks'].append('original-untracked-overwrite-warning-cancel-and-local-commit-preserve-the-target-and-current-file-versions' if untracked else 'original-overwrite-warning-count-cancel-and-commit-current-branch-before-target-switch-preserve-both-histories')
    else:
        menu();press('button','创建并检出新分支...','[role=dialog]');modal('创建并检出新分支');until('''(()=>({ok:document.querySelector('[role=dialog] button[type=submit]')?.disabled===true}))()''','empty branch name disabled');fill('#git-branch-switcher-create-input','bad branch');press('button','创建并切换','[role=dialog]');until('''(()=>({ok:document.body.innerText.includes('分支名无效，请重新输入。')&&!!document.querySelector('#git-branch-switcher-create-input')}))()''','invalid branch rejected');assert repo('invalid')==initial;press('button','取消','[role=dialog]');assert repo('create-cancelled')==initial
        menu();press('button','创建并检出新分支...','[role=dialog]');modal('创建并检出新分支');fill('#git-branch-switcher-create-input',CREATED);press('button','创建并切换','[role=dialog]');label(CREATED);created=repo('created');assert created['head']==initial['head'] and created['files']==initial['files'] and created['count']==2 and created['status']=='' and len(created['refs'])==3
        choose(CREATED);label(CREATED);assert repo('current-noop')==created
        menu();fill('[data-slot=command-input]','no-owned-match');until('''(()=>({ok:document.body.innerText.includes('未找到匹配分支')&&!Array.from(document.querySelectorAll('[cmdk-item]')).some(e=>e.getClientRects().length)}))()''','original no-match branch search');assert repo('no-match')==created
        for kind in ['keyDown','keyUp']:bridge.raw_cdp('Input.dispatchKeyEvent',type=kind,key='Escape',code='Escape',windowsVirtualKeyCode=27,nativeVirtualKeyCode=27)
        menu();fill('[data-slot=command-input]',TARGET);press('option',TARGET);label(TARGET);final=repo('switched');assert final['count']==2 and final['refs']==created['refs'] and final['status']=='' and final['files']=={'conflict.txt':'OWNED_BRANCH_T\n','keep.txt':'OWNED_BRANCH_KEEP\n','target-only.txt':'OWNED_BRANCH_TARGET_ONLY\n'}
        result['checks'].append('original-invalid-create-cancel-new-branch-current-noop-search-and-target-switch-use-real-git-state')
    assert proof('branch-before-reload')==baseline;bridge.raw_cdp('Page.reload');label(TARGET);assert repo('reloaded')==final and proof('branch-final')==baseline and not git('remote')
    result['checks'].append('original-branch-reload-preserves-head-files-and-zero-model-ledger-delta')
    result['gitBranch']=dict(blocked=blocked,untracked=untracked,currentModelCalls=0,currentLedgerRows=0,newCommits=1 if blocked else 0,newBranches=0 if blocked else 1)
