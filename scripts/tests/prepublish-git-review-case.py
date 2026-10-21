"""Original GitPane sources and real lazy diffs without mutating Git facts."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def run_review_case(*,bridge,click,until,proof,baseline,meta,workspace,evidence,result,budget,node,root):
    original_proof=proof;git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
    def git(*args):return subprocess.run(['/usr/bin/git','-C',str(workspace),*args],env=git_env,check=True,capture_output=True,text=True,timeout=15).stdout
    def repo(stage):
        p=dict(head=git('rev-parse','HEAD').strip(),refs=git('for-each-ref','--format=%(refname)|%(objectname)').splitlines(),status=git('status','--porcelain=v1'),index=git('ls-files','--stage'),indexPatch=git('diff','--cached','--binary'),workingPatch=git('diff','--binary'),files={n:hashlib.sha256((workspace/n).read_bytes()).hexdigest() for n in ['review.txt','rename-new.txt','branch.txt','binary.bin','new.txt']},deletedPresent=(workspace/'deleted.txt').exists());(evidence/('review-'+stage+'-repo.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    baseline={**baseline,'ledgerFull':ledger()};(evidence/'review-baseline-full-proof.json').write_text(json.dumps(baseline,ensure_ascii=False,indent=2))
    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def press(role,label,scope='body'):
        nodes=bridge.raw_cdp('Accessibility.getFullAXTree')['nodes'];a=[n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')==role and label in n.get('name',{}).get('value','')];assert len(a)==1,'unique original review control '+label
        nid=a[0]['backendDOMNodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=nid);q=bridge.raw_cdp('DOM.getBoxModel',backendNodeId=nid)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            if kind=='mousePressed':assert bridge.evaluate('''(()=>{const e=document.elementFromPoint(%s,%s)?.closest('button,[role=option]');return{ok:!!e&&!e.disabled&&e.getAttribute('data-disabled')!=='true'&&!!e.closest(%s)&&(e.getAttribute('aria-label')||e.innerText).includes(%s)}})()'''%(x,y,json.dumps(scope),json.dumps(label)))['ok']
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=x,y=y,**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('review '+label)
    def fill(selector,value):
        r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
        try:
            bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.focus',nodeId=nid)
        finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
        bridge.raw_cdp('Input.insertText',text=value);until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.value==='+json.dumps(value)+'}))()','review command input exact')
    def source(label,count):
        target=until('''(()=>{const e=document.querySelector('[data-testid=git-pane] button[role=combobox]'),r=e?.getBoundingClientRect();return{ok:!!r&&!e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()''','original source trigger')
        # Radix在pointerdown就打开菜单；同一次点击的pointerup仍须正常交付，不能要求遮罩未出现。
        for kind in ['mouseMoved','mousePressed','mouseReleased']:
            budget();bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=target['x'],y=target['y'],**({} if kind=='mouseMoved' else dict(button='left',clickCount=1)))
        result['actions'].append('open original diff source menu');press('option',label,'[role=listbox]')
        return until('''(()=>{const p=document.querySelector('[data-testid=git-pane]'),a=[...(p?.querySelectorAll('[data-git-pane-change-virtual-row]')??[])];return{ok:!!p&&p.querySelector('button[role=combobox]')?.innerText.trim()===%s&&a.length===%s,text:p?.innerText,files:a.map(e=>e.querySelector('button')?.innerText)}})()'''%(json.dumps(label),count),'original diff source '+label)
    def rendered(markers,excluded,stage):
        p=until('''(()=>{const p=document.querySelector('[data-testid=git-pane]');const parts=[],lines=[];function walk(r){const code=[...r.querySelectorAll('[data-content] [data-line]')].map(e=>({text:e.textContent,type:e.getAttribute('data-line-type')}));if(code.length){lines.push(...code);parts.push(code.map(e=>e.text).join('\\n'))}else parts.push(r.innerText??'');for(const e of r.querySelectorAll('*'))if(e.shadowRoot)walk(e.shadowRoot)}if(p)walk(p);const text=parts.join('\\n');const markers=[...new Set(text.match(/OWNED_[A-Z_]+/g)??[])];return{ok:%s.every(m=>markers.includes(m)),markers,lines,binary:text.includes('无法预览二进制 Diff'),text:text.slice(-6000),pane:p?.innerText}})()'''%json.dumps(markers),'actual rendered diff '+stage,30)
        assert all(m not in p['markers'] for m in excluded),(stage,p['markers']);(evidence/('review-render-'+stage+'.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def canonical(file,source,stage):
        req=evidence/('review-'+stage+'-read-input.json');req.write_text(json.dumps(dict(root=meta['root'],workspace=str(workspace),file=file,source=source)));p=subprocess.run([node,'--import','tsx',str(root/'scripts/fixtures/prepublish-git-review-readonly.mjs'),str(req)],cwd=root,env=git_env,text=True,capture_output=True,timeout=15);assert p.returncode==0,p.stderr[-1200:];lines=[x[len('UW_REVIEW='):] for x in p.stdout.splitlines() if x.startswith('UW_REVIEW=')];assert len(lines)==1;p=json.loads(lines[0]);(evidence/('review-'+stage+'-canonical.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    initial=repo('initial');assert not git('remote')
    def open_review():
        for kind in ['keyDown','keyUp']:bridge.raw_cdp('Input.dispatchKeyEvent',type=kind,key='k',code='KeyK',windowsVirtualKeyCode=75,modifiers=4)
        until('''(()=>({ok:!!document.querySelector('[role=dialog] input[cmdk-input]')}))()''','original command center');press('tab','操作','[role=dialog]');fill('[role=dialog] input[cmdk-input]','添加审查标签');press('option','添加审查标签','[role=dialog]');until('''(()=>({ok:!!document.querySelector('[data-testid=git-pane]')&&document.querySelectorAll('[data-testid=git-pane] [data-git-pane-change-virtual-row]').length===4}))()''','original unstaged diff list')
    open_review()
    press('button','review.txt','[data-testid=git-pane]');rendered(['OWNED_REVIEW_INDEX_B','OWNED_REVIEW_WORK_C'],['OWNED_REVIEW_A'],'unstaged-review');p=canonical('review.txt','unstaged','unstaged-review');assert p['beforeContent']=='OWNED_REVIEW_INDEX_B\nkeep\n' and p['afterContent']=='OWNED_REVIEW_WORK_C\nkeep\n'
    press('button','deleted.txt','[data-testid=git-pane]');rendered(['OWNED_REVIEW_DELETED_A'],[],'deleted');p=canonical('deleted.txt','unstaged','deleted');assert p['availability']=='patch' and '-OWNED_REVIEW_DELETED_A\n' in p['patch'] and '+++ /dev/null' in p['patch'] and p['afterContent'] is None
    press('button','new.txt','[data-testid=git-pane]');rendered(['OWNED_REVIEW_NEW_D'],[],'untracked');p=canonical('new.txt','unstaged','untracked');assert p['afterContent']=='OWNED_REVIEW_NEW_D\n'
    press('button','binary.bin','[data-testid=git-pane]');until('''(()=>({ok:document.querySelector('[data-testid=git-pane]')?.innerText.includes('无法预览二进制 Diff')}))()''','original binary diff fallback');p=canonical('binary.bin','unstaged','binary');assert p['availability']=='binary'
    result['checks'].append('original-unstaged-diff-review-deleted-untracked-and-binary-render-real-git-data')
    source('已暂存',2);press('button','review.txt','[data-testid=git-pane]');rendered(['OWNED_REVIEW_A','OWNED_REVIEW_INDEX_B'],['OWNED_REVIEW_WORK_C'],'staged-review');p=canonical('review.txt','staged','staged-review');assert p['beforeContent']=='OWNED_REVIEW_A\nkeep\n' and p['afterContent']=='OWNED_REVIEW_INDEX_B\nkeep\n'
    press('button','rename-new.txt','[data-testid=git-pane]');rename_render=until('''(()=>{const p=document.querySelector('[data-testid=git-pane]'),text=p?.innerText??'';return{ok:text.includes('similarity index 100%')&&text.includes('rename from rename-old.txt')&&text.includes('rename to rename-new.txt')&&!text.includes('OWNED_REVIEW_RENAME_CONTENT'),text}})()''','pure rename displays original metadata without invented additions');(evidence/'review-render-rename.json').write_text(json.dumps(rename_render,ensure_ascii=False,indent=2));p=canonical('rename-new.txt','staged','rename');assert p['beforeContent']==p['afterContent']=='OWNED_REVIEW_RENAME_CONTENT\n','a pure rename must retain its real pre-rename content rather than appear as a new file';assert 'rename from rename-old.txt' in p['patch'] and 'new file mode' not in p['patch']
    result['checks'].append('staged-diff-isolated-from-working-copy-and-pure-rename-retains-original-content')
    source('全部分支更改',1);press('button','branch.txt','[data-testid=git-pane]');rendered(['OWNED_REVIEW_BASE','OWNED_REVIEW_COMMIT'],[],'branch');p=canonical('branch.txt','branch','branch');assert p['beforeContent']=='OWNED_REVIEW_BASE\n' and p['afterContent']=='OWNED_REVIEW_COMMIT\n'
    source('上一轮更改',0);until('''(()=>({ok:document.querySelector('[data-testid=git-pane]')?.innerText.includes('当前任务还没有上一轮文件改动')}))()''','last-turn explicitly empty skeleton');source('未暂存',4);press('button','刷新','[data-testid=git-pane]');until('''(()=>{const p=document.querySelector('[data-testid=git-pane]');return{ok:!!p&&p.querySelectorAll('[data-git-pane-change-virtual-row]').length===4&&[...p.querySelectorAll('button')].some(e=>e.innerText.trim()==='刷新'&&!e.disabled)}})()''','original review refresh completed')
    assert repo('before-reload')==initial and proof('review-before-reload')==baseline;bridge.raw_cdp('Page.reload');until('''(()=>({ok:!!document.querySelector('[data-testid=workspace-mode-header]')}))()''','workspace restored after reload');open_review();assert repo('final')==initial and proof('review-final')==baseline
    result['checks'].append('branch-comparison-last-turn-empty-and-original-review-refresh-reload-do-not-mutate-git-or-usage')
    result['gitReview']=dict(currentModelCalls=0,currentLedgerRows=0,unstagedFiles=4,stagedFiles=2,branchFiles=1,pureRenameBeforeAfterPreserved=True)
