"""Original warm7 plus same-task UI archive/unarchive/reload. Default is prepare-only."""
import argparse,hashlib,json,runpy,subprocess,select,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROFILE='client-native-packaged-macos-clock-arm64-task-archive-v1-20261021'
A=runpy.run_path(str(ROOT/'scripts/tests/mac-arm64-memory-extraction-probe.py'))
M=A['M'];BASE=M['BASE'];MemoryCaseBudget=M['MemoryCaseBudget'];memory_budget_left=M['memory_budget_left']

def archive_ui(task,title,workspace,model,stage,target=None):
    params=json.dumps(dict(task=task,title=title,workspace=str(workspace),model=model,stage=stage,target=target))
    return """(()=>{const q=%s,visible=e=>!!e&&!!e.getClientRects().length&&!e.closest("[inert],[aria-hidden=true]"),side=document.querySelector('[data-testid="sidebar"]'),panes=[...document.querySelectorAll('[data-session-id]')].filter(e=>visible(e)&&e.closest('[data-root-workspace-surface="interactive"]')),pane=panes.length===1?panes[0]:null,sid=pane?.getAttribute('data-session-id')??null,models=pane?[...pane.querySelectorAll('[data-testid="v4-model-config"][data-source="composer"]')]:[],m=models.length===1?models[0]:null,norm=[...document.querySelectorAll('[data-testid='+JSON.stringify('task-item-'+q.task)+']')].filter(visible),normal=norm.length===1?norm[0]:null,arch=side?[...side.querySelectorAll('li')].filter(li=>visible(li)&&[...li.querySelectorAll('p[title]')].some(p=>p.closest('li')===li&&p.getAttribute('title')===q.title)&&[...li.querySelectorAll('span[title]')].some(s=>s.closest('li')===li&&s.getAttribute('title')===q.workspace)):[],row=arch.length===1?arch[0]:null,buttons=side?[...side.querySelectorAll('button')].filter(visible):[],toggle=buttons.filter(b=>q.target==='close'?['关闭','Close'].includes(b.getAttribute('aria-label'))&&b.getAttribute('data-state')==='on':['归档','Archived'].includes(b.getAttribute('aria-label'))&&b.getAttribute('data-state')==='off'),unarchive=row?[...row.querySelectorAll('button')].filter(b=>visible(b)&&['取消归档任务','Unarchive task'].includes(b.getAttribute('aria-label'))):[],target=q.target==='archived-row'?row:q.target==='normal-row'?normal:q.target==='unarchive'?(unarchive.length===1?unarchive[0]:null):q.target==='toggle'||q.target==='close'?(toggle.length===1?toggle[0]:null):null,r=target?.getBoundingClientRect(),point=r?{ok:r.width>0&&r.height>0&&target.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r.x+r.width/2,y:r.y+r.height/2}:null,content=pane?.innerText??'',active=sid===q.task&&models.length===1&&m.getAttribute('data-model')===q.model&&m.getAttribute('data-thought')==='none'&&content.includes('MACOS_CLOCK_LINK_20261020')&&content.includes('原生企业资产联动完成。')&&!pane.querySelector('[data-testid="v4-stop"]'),confirming=normal?.getAttribute('data-archive-confirming-task-id')===q.task;return{ok:q.stage==='archived'?norm.length===0:q.stage==='opened'?active&&arch.length===1:q.stage==='restored'?active&&arch.length===0:q.stage==='confirming'?active&&norm.length===1&&confirming:active&&norm.length===1,stage:q.stage,taskId:q.task,sessionId:sid,normalRows:norm.length,archivedRows:arch.length,confirming,model:m?.getAttribute('data-model')??null,thought:m?.getAttribute('data-thought')??null,modelAnchorCount:models.length,title:normal?.querySelector('[data-task-title-copy="original"]')?.textContent.trim()??q.title,userVisible:content.includes('MACOS_CLOCK_LINK_20261020'),assistantVisible:content.includes('原生企业资产联动完成。'),identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null,point,targetCount:q.target==='unarchive'?unarchive.length:q.target==='toggle'||q.target==='close'?toggle.length:q.target==='archived-row'?arch.length:q.target==='normal-row'?norm.length:null}})()"""%params

ARCHIVE_SLICE="""
        archive_warm=until(cap_ui('',[],False,meta['modelId']),'Completed original task before archive',12)
        archive_task=archive_warm['taskId'];archive_title=archive_warm['title'];assert archive_title and archive_task.startswith('sess_')
        archive_db,archive_bindings=mapped_database(observations['packagedCli'],root,workspace)
        observations['taskArchiveStages']=[]
        def archive_view(stage,target=None):
            return archive_ui(archive_task,archive_title,workspace,meta['modelId'],stage,target)
        def archive_stage(stage):
            dom=until(archive_view(stage),'Original task archive '+stage,10)
            rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows)
            cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows);db,bindings=mapped_database(cli,root,workspace);assert db==archive_db
            accepted=f.command('archiveStage',min(12,memory_budget_left(memory_work_end)),stage=stage,taskId=archive_task,dbPath=db,dom=dom)['facts']
            rows_after=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows_after)
            cli_after=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows_after);db_after,bindings_after=mapped_database(cli_after,root,workspace);assert db_after==db and bindings_after==bindings
            assert_backend_baseline(accepted,delivered,meta['modelId']);assert proof()==delivered
            observations['taskArchiveStages'].append({'stage':stage,'ui':dom,'proof':accepted,'beforeBindings':bindings,'afterBindings':bindings_after})
            return accepted
        def archive_point(stage,target,label):
            expression='(()=>{const v=('+archive_view(stage,target)+');return v.point&&(v.ok||'+json.dumps(target=='normal-row')+')?v.point:{ok:false,projection:v}})()'
            point=until(expression,label,10);memory_budget_left(memory_work_end)
            bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=point['x'],y=point['y'])
            point=until(expression,label+' stable',5)
            for kind in ['mousePressed','mouseReleased']:
                memory_budget_left(memory_work_end)
                bridge.raw_cdp('Input.dispatchMouseEvent',type=kind,x=point['x'],y=point['y'],button='left',clickCount=1)
            actions.append(label)
        archive_stage('baseline')
        row_selector='[data-testid='+json.dumps('task-item-'+archive_task)+']'
        point=until('(()=>{const es=[...document.querySelectorAll('+json.dumps(row_selector)+')].filter(e=>e.getClientRects().length&&!e.closest("[inert],[aria-hidden=true]"));const e=es.length===1?es[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&r.width>0&&r.height>0,count:es.length,x:r?r.x+r.width/2:0,y:r?r.y+r.height/2:0}})()','Original own task hover',5)
        memory_budget_left(memory_work_end)
        bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=point['x'],y=point['y'])
        archive_selector='[data-testid='+json.dumps('task-archive-'+archive_task)+']'
        click(archive_selector,'original-archive-arm-once')
        archive_stage('confirming')
        click(archive_selector,'original-archive-confirm-same-task')
        archive_stage('archived')
        archive_point('archived','toggle','original-sidebar-archived-view')
        archive_point('archived','archived-row','original-open-archived-same-task')
        archive_stage('opened')
        archive_point('opened','unarchive','original-unarchive-same-task')
        archive_stage('restored')
        archive_point('restored','close','original-close-archived-view')
        bridge.raw_cdp('Page.reload')
        archive_point('reloaded','normal-row','original-reopen-restored-after-reload')
        archive_stage('reloaded')
        assert proof()==delivered
        checks.append('original-same-task-archive-confirm-archived-open-unarchive-reload-zero-replay')
"""

def deriveArchiveProbe(original):
    source=M['deriveMemoryProbe'](original)
    start="        warm_ui=until(cap_ui('',[],False,meta['modelId']),'Original warm task before Memory',15)"
    end="        checks.append('original-ui-memory-off-on-off-new-task-context-private-file-and-exact-accounting')"
    assert source.count(start)==source.count(end)==1
    a=source.index(start);b=source.index(end,a)+len(end);source=source[:a]+ARCHIVE_SLICE+source[b:]
    old='scripts/fixtures/mac-arm64-memory-derived.mjs';assert source.count(old)==1
    return source.replace(old,'scripts/fixtures/mac-arm64-task-archive-derived.mjs')

def create_archive_namespace(source,budget):
    ns=M['create_memory_namespace'](source,budget);ns['archive_ui']=archive_ui;ns['wait_renderer']=A['make_auto_renderer'](budget);return ns

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(args):
    plan=json.loads(args.preparation.read_text());assert plan['profile']==PROFILE and args.preparation.resolve()==ROOT/'data/sandbox-verification'/PROFILE/'preparation.json'
    for path,h in plan['sources'].items():assert digest(ROOT/path)==h,path
    assert digest(plan['manifestPath'])==plan['manifestSha256'] and digest(__file__)==plan['driverSha256']
    runpy.run_path(str(ROOT/'scripts/tests/macos-clock-profile.test.py'))['check'](PROFILE)
    source=deriveArchiveProbe(BASE.read_text());assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256'];compile(source,'actual-task-archive','exec')
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':PROFILE}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation)
    budget=MemoryCaseBudget();ns=create_archive_namespace(source,budget);A['verify_globals'](ns);old_run,old_select=subprocess.run,select.select
    subprocess.run=lambda *a,**k:budget.subprocess(old_run,*a,**k);select.select=lambda *a,**k:budget.select(old_select,*a,**k)
    try:return ns['run'](PROFILE,Path(plan['manifestPath']))
    finally:subprocess.run=old_run;select.select=old_select

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--preparation',type=Path,required=True);p.add_argument('--run',action='store_true');p.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(p.parse_args())else 1)
