"""Owned single archived child deletion only. Import/default never starts App or backend."""
import argparse, hashlib, json, runpy, subprocess, select, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-task-delete-v1-20261021"
A = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-extraction-probe.py"))
M = A["M"]
BASE = M["BASE"]
MESSAGE = runpy.run_path(str(ROOT / "scripts/tests/mac-message-edit-fork-probe.py"))
SAFE = runpy.run_path(str(ROOT / "scripts/tests/native-safe-cleanup.py"))
MemoryCaseBudget = M["MemoryCaseBudget"]

def delete_ui(parent, child, title, workspace, model, stage, target=None):
    q = json.dumps(dict(parentId=parent, childId=child, title=title, workspace=str(workspace), model=model, stage=stage, target=target))
    return r'''(()=>{const q=%s,visible=e=>!!e&&!!e.getClientRects().length&&!e.closest('[inert],[aria-hidden="true"]'),side=document.querySelector('[data-testid="sidebar"]'),panes=[...document.querySelectorAll('[data-session-id]')].filter(e=>visible(e)&&e.closest('[data-root-workspace-surface="interactive"]')),pane=panes.length===1?panes[0]:null,sid=pane?.getAttribute('data-session-id')??null,models=pane?[...pane.querySelectorAll('[data-testid="v4-model-config"][data-source="composer"]')]:[],m=models.length===1?models[0]:null,body=pane?.innerText??'',normal=id=>id?[...document.querySelectorAll('[data-testid='+JSON.stringify('task-item-'+id)+']')].filter(visible):[],childRows=normal(q.childId),parentRows=normal(q.parentId),arch=side?[...side.querySelectorAll('li')].filter(li=>visible(li)&&[...li.querySelectorAll('p[title]')].some(p=>p.closest('li')===li&&p.getAttribute('title')===q.title)&&[...li.querySelectorAll('span[title]')].some(s=>s.closest('li')===li&&s.getAttribute('title')===q.workspace)):[],row=arch.length===1?arch[0]:null,dialogs=[...document.querySelectorAll('[role="dialog"][data-state="open"]')].filter(visible),dialog=dialogs.length===1?dialogs[0]:null,dialogMatch=!!dialog&&['删除这个归档任务？','Delete this archived task?'].some(t=>dialog.innerText.includes(t))&&['任务将从任务列表和归档列表中移除。','The task will be removed from task lists and archived lists.'].some(t=>dialog.innerText.includes(t)),buttons=side?[...side.querySelectorAll('button')].filter(visible):[],toggle=buttons.filter(b=>['归档','Archived'].includes(b.getAttribute('aria-label'))&&b.getAttribute('data-state')==='off'),close=buttons.filter(b=>['关闭','Close'].includes(b.getAttribute('aria-label'))&&b.getAttribute('data-state')==='on'),deletes=row?[...row.querySelectorAll('button')].filter(b=>visible(b)&&['删除任务','Delete task'].includes(b.getAttribute('aria-label'))):[],cancel=dialog?[...dialog.querySelectorAll('button')].filter(b=>visible(b)&&['取消','Cancel'].includes(b.querySelector('span')?.textContent.trim())):[],confirm=dialog?[...dialog.querySelectorAll('[data-testid="confirm-dialog-confirm"]')].filter(visible):[],targets=q.target==='delete'?deletes:q.target==='cancel'?cancel:q.target==='confirm'?confirm:q.target==='toggle'?toggle:q.target==='close'?close:q.target==='archived-row'?arch:q.target==='parent-row'?parentRows:[],t=targets.length===1?targets[0]:null,r=t?.getBoundingClientRect(),point=r?{ok:r.width>0&&r.height>0&&!t.disabled&&t.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r.x+r.width/2,y:r.y+r.height/2}:null,active=expected=>sid===expected&&models.length===1&&m.getAttribute('data-model')===q.model&&m.getAttribute('data-thought')==='none'&&body.includes('MACOS_CLOCK_LINK_20261020')&&body.includes('原生企业资产联动完成。')&&!pane.querySelector('[data-testid="v4-stop"]'),modal=['cancel-dialog','delete-dialog'].includes(q.stage),ok=modal?dialogs.length===1&&dialogMatch:['deleted','reloaded'].includes(q.stage)?dialogs.length===0&&arch.length===0&&childRows.length===0:(q.stage==='archived'||q.stage==='cancelled')?dialogs.length===0&&arch.length===1&&active(q.childId):dialogs.length===0&&active(q.stage==='baseline'?q.parentId:q.childId);return{ok,stage:q.stage,parentId:q.parentId,childId:q.childId,sessionId:sid,normalParentRows:parentRows.length,normalChildRows:childRows.length,archivedChildRows:arch.length,dialogCount:dialogs.length,dialogMatch,parentVisible:active(q.parentId),model:m?.getAttribute('data-model')??null,thought:m?.getAttribute('data-thought')??null,identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null,point,targetCount:targets.length}})()''' % q

DELETE_SLICE = r'''
        parent=until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','原生企业资产联动完成。'),'Original warm parent before owned deletion',15)
        parent_id=parent['taskId'];child_id=None;child_title=None
        delete_db,delete_bindings=mapped_database(observations['packagedCli'],root,workspace)
        observations['taskDeleteStages']=[]
        def view(stage,target=None):return delete_ui(parent_id,child_id,child_title,workspace,meta['modelId'],stage,target)
        def stage_proof(stage,extra=None):
            dom=until(view(stage),'Original owned child deletion '+stage,10)
            if extra:dom.update(extra)
            rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(r['pid']for r in rows)
            cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows);db,bindings=mapped_database(cli,root,workspace);assert db==delete_db and bindings==delete_bindings
            value=f.command('taskDeleteStage',min(5,memory_budget_left(memory_work_end)),stage=stage,parentId=parent_id,childId=child_id,dom=dom,dbPath=db)['facts'];memory_budget_left(memory_work_end)
            assert proof()==delivered
            observations['taskDeleteStages'].append(value);return value
        def point(stage,target,label):
            expression='(()=>{const v=('+view(stage,target)+');return v.point&&(v.ok||'+json.dumps(target in ['toggle','close','parent-row','archived-row'])+')?v.point:{ok:false,projection:v}})()'
            p=until(expression,label,10);memory_budget_left(memory_work_end);bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y']);p=until(expression,label+' stable',5)
            for kind in ['mousePressed','mouseReleased']:
                memory_budget_left(memory_work_end);bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=p['x'],y=p['y'],button='left',clickCount=1)
            actions.append(label)
        warm=stage_proof('baseline');assert_backend_baseline(warm,delivered,meta['modelId'])
        p=until('(()=>{const e=document.querySelector('+json.dumps('[data-root-workspace-surface="interactive"] [data-row-id="'+parent['assistantRow']+'"]')+');if(!e)return{ok:false};e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{ok:r.width>0&&r.height>0,x:r.x+r.width/2,y:r.y+r.height/2}})()','Original owned assistant hover',8)
        memory_budget_left(memory_work_end);bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y'])
        click('[data-testid="v4-fork-'+parent['assistantRow']+'"]','original-owned-assistant-fork-no-inference')
        child=until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','原生企业资产联动完成。',excluded=[parent_id]),'Original own fork child selected',20)
        child_id=child['taskId'];child_title=child['title'];assert child_id!=parent_id and child_title
        stage_proof('forked')
        selector='[data-testid='+json.dumps('task-item-'+child_id)+']'
        p=until('(()=>{const e=document.querySelector('+json.dumps(selector)+'),r=e?.getBoundingClientRect();return{ok:!!r&&r.width>0&&r.height>0,x:r?r.x+r.width/2:0,y:r?r.y+r.height/2:0}})()','Original owned child row hover',8)
        memory_budget_left(memory_work_end);bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=p['x'],y=p['y'])
        archive='[data-testid='+json.dumps('task-archive-'+child_id)+']'
        click(archive,'original-owned-child-archive-arm');until('(()=>({ok:document.querySelector('+json.dumps(selector)+')?.getAttribute("data-archive-confirming-task-id")==='+json.dumps(child_id)+'}))()','Original child archive confirmation',5)
        click(archive,'original-owned-child-archive-confirm')
        point('archived','toggle','original-open-archived-view')
        point('archived','archived-row','original-open-bound-archived-child')
        stage_proof('archived')
        point('archived','delete','original-owned-child-delete-cancel-open')
        stage_proof('cancel-dialog')
        point('cancel-dialog','cancel','original-owned-child-delete-cancel')
        stage_proof('cancelled')
        point('cancelled','delete','original-owned-child-delete-confirm-open')
        stage_proof('delete-dialog')
        point('delete-dialog','confirm','original-owned-child-delete-confirm')
        stage_proof('deleted')
        point('deleted','close','original-close-archive-after-delete')
        point('deleted','parent-row','original-parent-unchanged-after-child-delete')
        until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','原生企业资产联动完成。',parent_id),'Original parent history before reload',10)
        memory_budget_left(memory_work_end);bridge.raw_cdp('Page.reload')
        until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','原生企业资产联动完成。',parent_id),'Original parent history after reload',20)
        normal=until(view('reloaded'),'Original normal list no deleted child',8);assert normal['normalParentRows']==1 and normal['normalChildRows']==0
        point('reloaded','toggle','original-archived-view-after-reload')
        stage_proof('reloaded',{'reloadNormal':normal})
        point('reloaded','close','original-return-parent-for-original-tail')
        until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','原生企业资产联动完成。',parent_id),'Original active parent restored for tail',10)
        assert proof()==delivered
        checks.append('original-owned-fork-child-archived-single-delete-cancel-confirm-reload-zero-inference')
'''

def deriveDeleteProbe(original):
    source = M["deriveMemoryProbe"](original)
    start = "        warm_ui=until(cap_ui('',[],False,meta['modelId']),'Original warm task before Memory',15)"
    end = "        checks.append('original-ui-memory-off-on-off-new-task-context-private-file-and-exact-accounting')"
    assert source.count(start) == source.count(end) == 1
    a = source.index(start); b = source.index(end, a) + len(end)
    source = source[:a] + DELETE_SLICE + source[b:]
    anchor = "                command = command[:-1] + ['scripts/fixtures/mac-arm64-memory-derived.mjs']"
    assert source.count(anchor) == 1
    source = source.replace(anchor, "                command = command[:-1] + ['scripts/fixtures/mac-task-delete-derived.mjs']\n                kwargs['env']['TSX_TSCONFIG_PATH']=str(REPO/'clients/uwork/apps/zcode-cli/tsconfig.test.json')")
    return SAFE["derive_safe_native_cleanup"](source, "MEMORY_BUDGET")

def create_delete_namespace(source, budget):
    ns = M["create_memory_namespace"](source, budget)
    ns.update(delete_ui=delete_ui, lifecycle_ui=MESSAGE["lifecycle_ui"], safe_native_cleanup=SAFE["safe_native_cleanup"])
    ns["wait_renderer"] = A["make_auto_renderer"](budget)
    return ns

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(args):
    if not args.run and args.preparation is None:
        print(json.dumps({"status":"not-prepared-no-app", "profile":PROFILE})); return True
    assert args.preparation is not None
    plan = json.loads(args.preparation.read_text())
    assert plan["profile"] == PROFILE and args.preparation.resolve() == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    for path, value in plan["sources"].items(): assert digest(ROOT/path) == value, path
    assert digest(plan["manifestPath"]) == plan["manifestSha256"] and digest(__file__) == plan["driverSha256"]
    source = deriveDeleteProbe(BASE.read_text()); assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    compile(source, "actual-owned-single-delete", "exec")
    if not args.run: print(json.dumps({"status":"prepared-not-run", "profile":PROFILE})); return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = MemoryCaseBudget(); ns = create_delete_namespace(source, budget); A["verify_globals"](ns)
    old_run, old_select = subprocess.run, select.select
    subprocess.run = lambda *a, **k: budget.subprocess(old_run, *a, **k)
    select.select = lambda *a, **k: budget.select(old_select, *a, **k)
    try: return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally: subprocess.run, select.select = old_run, old_select

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--preparation", type=Path); p.add_argument("--run", action="store_true"); p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
