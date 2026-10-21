"""Original Git dialog generation, cancellation, staged-only and remaining commits."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

FIRST_GENERATED='test: 生成已暂存联动记录';MANUAL='test: 明确提交已暂存记录';SECOND_GENERATED='test: 提交剩余联动变更'


def run_git_case(*,bridge,click,until,proof,send,baseline,meta,workspace,evidence,result,budget):
    commit_only=os.environ.get('PREPUBLISH_GIT_COMMIT_ONLY')=='1';snapshot_only=os.environ.get('PREPUBLISH_GIT_STAGED_SNAPSHOT')=='1';assert not snapshot_only or commit_only
    original_proof=proof;counter=0;git_env={**os.environ,'GIT_CONFIG_GLOBAL':os.devnull,'GIT_CONFIG_NOSYSTEM':'1'}
    def git(*args):
        p=subprocess.run(['/usr/bin/git','-C',str(workspace),*args],env=git_env,check=True,capture_output=True,text=True,timeout=15);return p.stdout
    def repo(stage):
        p=dict(head=git('rev-parse','HEAD').strip(),count=int(git('rev-list','--count','HEAD')),status=git('status','--porcelain=v1'),indexPatch=git('diff','--cached','--binary'),worktreePatch=git('diff','--binary'),messages=git('log','-3','--format=%s').splitlines(),files={n:hashlib.sha256((workspace/n).read_bytes()).hexdigest() for n in ['staged.txt','unstaged.txt','new.txt']},headFiles={n:git('show','HEAD:'+n) for n in git('ls-tree','--name-only','HEAD').splitlines()});(evidence/('git-'+stage+'-repo.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def ledger():
        with sqlite3.connect((Path(meta['root'])/'backend.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM ledger ORDER BY id')]
    def tasks():
        with sqlite3.connect((Path(meta['home'])/'.uwork/v2/tasks-index.sqlite').as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM tasks WHERE workspace_path=? ORDER BY task_id',(str(workspace),))]
    send('PREPUBLISH_GIT_CONTEXT')
    until('''(()=>({ok:!document.querySelector('[data-testid=v4-stop]')&&document.body.innerText.includes('原生企业资产联动完成。')&&!!document.querySelector('[data-testid=enterprise-identity-name]')}))()''','original conversation prepares Git status panel',45)
    prep_stop=time.monotonic()+20
    while True:
        counter+=1;prep=original_proof('git-context-preparation-'+str(counter));mine=[r for r in ledger() if r['user_id']==meta['memberId']]
        if prep['modelCalls']==baseline['modelCalls']+2 and len(mine)==2 and all(r['status']=='settled' for r in mine):break
        assert time.monotonic()<prep_stop,'Git task precondition accounting did not settle';time.sleep(.1)
    baseline={**prep,'ledgerFull':ledger(),'tasks':tasks()}
    assert len(baseline['tasks'])==1
    (evidence/'git-task-prepared-full-proof.json').write_text(json.dumps(baseline,ensure_ascii=False,indent=2))

    def proof(name):
        p={**original_proof(name),'ledgerFull':ledger(),'tasks':tasks()};(evidence/(name+'-full-proof.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2));return p
    def settle(total):
        nonlocal counter
        stop=time.monotonic()+20
        while True:
            budget();counter+=1;p=proof('git-generated-'+str(counter));mine=[r for r in p['ledgerFull'] if r['user_id']==meta['memberId']]
            assert p['modelCalls']<=baseline['modelCalls']+total
            if p['modelCalls']==baseline['modelCalls']+total and len(mine)==2+total and all(r['status']=='settled' for r in mine):break
            assert time.monotonic()<stop,'commit message generation accounting did not settle';time.sleep(.1)
        assert p['gitCommit']==dict(generated=total) and sum(r['amount'] for r in mine)==22*(2+total)
        assert [r for r in p['ledgerFull'] if r['user_id']!=meta['memberId']]==[r for r in baseline['ledgerFull'] if r['user_id']!=meta['memberId']]
        assert [(r['task_id'],r['archived'],r['deleted']) for r in p['tasks']]==[(r['task_id'],r['archived'],r['deleted']) for r in baseline['tasks']],'helper generation must not publish a user task'
        return p
    def open_dialog():
        visible=bridge.evaluate('''(()=>({ok:[...document.querySelectorAll('[data-testid=git-action-trigger]')].some(e=>e.getClientRects().length)}))()''')
        if not visible['ok']:
            click('[data-testid=chat-summary-panel] button[aria-label="展开状态"]','expand original conversation status panel')
        section=until('''(()=>{const e=document.querySelector('[data-testid=chat-summary-panel] [data-status-section-trigger=environment]');return{ok:!!e,open:e?.getAttribute('aria-expanded')}})()''','original environment section')
        if section['open']!='true':click('[data-testid=chat-summary-panel] [data-status-section-trigger=environment]','expand original Git environment section')
        click('[data-testid=git-action-trigger]','open original Git action')
        until('''(()=>({ok:!!document.querySelector('[data-testid=git-commit-dialog] textarea[data-testid=git-commit-message-input]')&&!document.querySelector('[data-testid=git-commit-generate-button]').disabled&&document.querySelector('[data-testid=git-commit-include-unstaged]')?.getAttribute('aria-checked')==='true'}))()''','original commit dialog ready')
    def staged_only():
        click('[data-testid=git-commit-include-unstaged]','exclude unstaged from original commit dialog')
        until('''(()=>({ok:document.querySelector('[data-testid=git-commit-include-unstaged]')?.getAttribute('aria-checked')==='false'}))()''','staged-only original selection')
    def message(expected):until('(()=>({ok:document.querySelector("[data-testid=git-commit-message-input]")?.value==='+json.dumps(expected)+'&&!document.querySelector("[data-testid=git-commit-generate-button]").disabled}))()','actual generated/manual commit message')
    def commit():
        until('''(()=>{const e=document.querySelector('[data-testid=git-commit-action-item-commit]');return{ok:!!e&&e.getAttribute('aria-disabled')!=='true'&&e.getAttribute('data-disabled')!=='true'}})()''','original local commit enabled')
        click('[data-testid=git-commit-action-item-commit]','original local commit')
        until('''(()=>({ok:!document.querySelector('[data-testid=git-commit-dialog]')}))()''','original commit dialog closes',30)
    initial=repo('initial');assert initial['count']==1 and git('diff','--cached','--name-only').splitlines()==['staged.txt'];assert not git('remote')
    if not commit_only:
        open_dialog();staged_only();click('[data-testid=git-commit-generate-button]','generate message for original staged-only selection');message(FIRST_GENERATED);first=settle(1);assert repo('generated')==initial
        for kind in ['keyDown','keyUp']:bridge.raw_cdp('Input.dispatchKeyEvent',type=kind,key='Escape',code='Escape',windowsVirtualKeyCode=27,nativeVirtualKeyCode=27)
        result['actions'].append('cancel original Git dialog with Escape');until('''(()=>({ok:!document.querySelector('[data-testid=git-commit-dialog]')}))()''','cancelled Git dialog');assert repo('cancelled')==initial and proof('git-cancelled')==first
        result['checks'].append('original-staged-only-generation-uses-real-diff-and-cancel-preserves-head-index-and-worktree')
    else:first=proof('git-commit-only-baseline')
    open_dialog();staged_only();selector='[data-testid=git-commit-message-input]';r=bridge.raw_cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        bridge.raw_cdp('DOM.getDocument',depth=0);nid=bridge.raw_cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];bridge.raw_cdp('DOM.scrollIntoViewIfNeeded',nodeId=nid);bridge.raw_cdp('DOM.focus',nodeId=nid)
    finally:bridge.raw_cdp('Runtime.releaseObject',objectId=r['objectId'])
    bridge.raw_cdp('Input.insertText',text=MANUAL);message(MANUAL);commit();one=repo('staged-committed');assert one['count']==2 and one['messages'][0]==MANUAL and git('show','--format=','--name-only','HEAD').strip()=='staged.txt';assert one['headFiles']==dict(**{'staged.txt':'OWNED_STAGED_B\n','unstaged.txt':'OWNED_UNSTAGED_A\n'});assert git('diff','--cached','--name-only')=='' and 'unstaged.txt' in one['status'] and 'new.txt' in one['status'];assert proof('git-manual-commit-no-model')==first
    if snapshot_only:
        assert initial['files']==one['files'] and one['worktreePatch']==initial['worktreePatch']
        assert git('show','HEAD:staged.txt')=='OWNED_STAGED_B\n' and (workspace/'staged.txt').read_bytes()==b'OWNED_STAGED_C\n'
        assert one['indexPatch']=='' and one['head']!=initial['head'] and ' M staged.txt' in one['status']
        bridge.raw_cdp('Page.reload');until('''(()=>({ok:!!document.querySelector('[data-testid=enterprise-identity-name]')&&document.body.innerText.includes('PREPUBLISH_GIT_CONTEXT')}))()''','original same-file staged snapshot reload')
        assert repo('snapshot-reloaded')==one and proof('git-snapshot-final')==first and first['gitCommit']==dict(generated=0)
        result['checks'].append('original-staged-only-commit-uses-index-B-while-preserving-same-file-working-C-and-other-dirty-files')
        result['gitStagedSnapshot']=dict(currentSettled=2,currentCredits=44,newCommits=1,generated=0,indexSnapshot='B',workingCopy='C',otherFilesUnchanged=True)
        return
    open_dialog();click('[data-testid=git-commit-generate-button]','generate message for remaining original unstaged selection');message(SECOND_GENERATED);second=settle(1 if commit_only else 2);commit();done=repo('all-committed');assert done['count']==3 and done['messages']==[SECOND_GENERATED,MANUAL,'Owned Git baseline'];assert done['status']=='' and done['indexPatch']=='' and done['worktreePatch']=='' and done['files']==initial['files'];assert git('show','--format=','--name-only','HEAD').split()==['new.txt','unstaged.txt'];assert done['headFiles']=={'new.txt':'OWNED_NEW_D\n','staged.txt':'OWNED_STAGED_B\n','unstaged.txt':'OWNED_UNSTAGED_C\n'}
    assert proof('git-final-before-reload')==second;bridge.raw_cdp('Page.reload');until('''(()=>({ok:!!document.querySelector('[data-testid=enterprise-identity-name]')&&document.body.innerText.includes('PREPUBLISH_GIT_CONTEXT')}))()''','original workspace after Git reload');assert proof('git-final')==second and repo('reloaded')==done and not git('remote')
    result['checks'].append('original-manual-staged-only-and-generated-remaining-commits-write-exact-paths-without-helper-task-or-replay')
    result['gitCommit']=dict(generated=1 if commit_only else 2,currentSettled=3 if commit_only else 4,currentCredits=66 if commit_only else 88,commitOnly=commit_only,newCommits=2,helperTaskDelta=0,remoteCount=0)
