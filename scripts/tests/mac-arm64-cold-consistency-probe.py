"""Original seven Mac checks plus one logged-in completed-task controlled-stop cold slice."""
import argparse,ast,copy,hashlib,json,os,runpy,socket,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-clock-probe.py'
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def ui_expression(task=None):
    return '''(()=>{const visible=e=>!!e&&!!e.getClientRects().length;const panes=[...document.querySelectorAll('[data-session-id]')].filter(e=>visible(e)&&e.closest('[data-root-workspace-surface="interactive"]')&&!e.closest('[inert]')&&e.getAttribute('data-session-id')!=='draft');const pane=panes.length===1?panes[0]:null,sid=pane?.getAttribute('data-session-id')??null;const item=sid?document.querySelector('[data-testid="task-item-'+sid+'"]'):null,model=document.querySelector('[data-testid="v4-model-config"][data-source="composer"]'),path=document.querySelector('[data-testid="workspace-path"]')?.getAttribute('aria-label')??document.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()??null,text=pane?.innerText??'';return{ok:!!pane&&!!item&&!!item.querySelector('[data-task-title-copy="original"]')&&(!%s||sid===%s)&&!visible(document.querySelector('[data-testid="root-startup-loading"]'))&&!document.querySelector('[data-testid="v4-stop"]'),uiTaskOpened:!!pane&&!!item,sessionId:sid,taskId:item?.getAttribute('data-testid')?.slice('task-item-'.length)??null,title:item?.querySelector('[data-task-title-copy="original"]')?.textContent.trim()??null,identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null,model:model?.getAttribute('data-model')??null,reasoning:model?.getAttribute('data-thought')??null,workspaceLabel:path,userVisible:text.includes('MACOS_CLOCK_LINK_20261020'),assistantVisible:text.includes('原生企业资产联动完成。')}})()'''%(json.dumps(task),json.dumps(task))

def cold_identity_expression():
    return """(()=>({ok:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText==='企业用户甲'&&!document.querySelector('[data-testid="root-startup-loading"]')}))()"""

def assert_backend_baseline(value,delivered,model_id):
    for label,expected in [('current',delivered['own']),('other',delivered['other'])]:
        actor=value['snapshot']['actors'][label];accounting=actor['accounting'];ledger=accounting['ledger'];traces=accounting['traces'];calls=accounting['gatewayCalls']
        actual={'count':len(ledger),'settled':sum(row['status']=='settled' for row in ledger),'amount':sum(row['amount'] for row in ledger),'inputTokens':sum(row['input_tokens'] for row in ledger),'outputTokens':sum(row['output_tokens'] for row in ledger)}
        assert actual==expected and len(traces)==2 and len(calls)==2
        assert all(row['status']=='succeeded' and row['model_id']==model_id and row['application']=='uwork' for row in traces)
        assert all(row['model_id']==model_id and row['application']=='uwork' for row in ledger)
        assert all(row['has_result'] for row in calls)
        assert {row['requestKeyDigest'] for row in ledger}=={row['requestKeyDigest'] for row in calls}
        assert sum(row['input_tokens'] for row in traces)==expected['inputTokens'] and sum(row['output_tokens'] for row in traces)==expected['outputTokens']
    current=value['snapshot']['actors']['current']['identity']
    assert current['user_id']==value['bootstrapActor']['userId'] and current['tenant_id']==value['bootstrapActor']['tenantId']

def read_local(root,workspace,dom,db_path):
    request={'root':str(root),'workspace':str(workspace),'taskId':dom['taskId'],'dom':dom,'dbPath':db_path}
    source="import {readCompletedTaskSemantics} from './scripts/fixtures/mac-completed-task-readonly.mjs';try{let s='';for await(const x of process.stdin)s+=x;console.log(JSON.stringify(readCompletedTaskSemantics(JSON.parse(s))));}catch(e){console.log(JSON.stringify({errorType:e.constructor.name}));process.exitCode=1;}"
    result=subprocess.run([NODE,'--input-type=module','-e',source],cwd=ROOT,input=json.dumps(request),capture_output=True,text=True,timeout=5)
    assert result.returncode==0,'Readonly task snapshot unavailable: '+json.loads(result.stdout).get('errorType','unknown')
    return json.loads(result.stdout)

def mapped_database(cli_facts,root,workspace):
    paths={str(root/'data/.zcode/cli/db/db.sqlite'),str(root/'data/.uwork/cli/db/db.sqlite')}
    bindings=[]
    for row in cli_facts:
        if row['workingDirectory']!=str(workspace):continue
        pid=row['pid'];birth=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True).stdout.strip()
        listed=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-d','0-1024','-Fn'],capture_output=True,text=True,check=True).stdout.splitlines()
        found=sorted({line[1:] for line in listed if line.startswith('n') and line[1:] in paths})
        assert birth and subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True).stdout.strip()==birth
        for path in found:bindings.append({'pid':pid,'birth':birth,'dbPath':path,'workingDirectory':row['workingDirectory'],'originalSpawnAndExecutableVerified':True})
    choices={row['dbPath'] for row in bindings};assert len(choices)==1,'Unique actual owned project CLI database FD mapping required'
    return choices.pop(),bindings

def stable_local(root,workspace,bridge,db_path,task_id):
    deadline=time.monotonic()+20;previous=None
    while time.monotonic()<deadline:
        try:
            dom=bridge.evaluate(ui_expression(task_id))
            assert dom.get('ok')
            value=read_local(root,workspace,dom,db_path)
            if previous and value['semanticSha256']==previous[0]['semanticSha256'] and dom==previous[1]:return value,dom
            previous=(value,dom)
        except AssertionError:previous=None
        time.sleep(.2)
    raise AssertionError('Completed/task-title/model/history failed to settle in original store')

def absent(pids):
    for pid in pids:
        try:os.kill(pid,0);return False
        except ProcessLookupError:pass
    return True

def wait_renderer(launched,meta,evidence):
    app=Path(meta['packagedRuntime']['appPath']);pid=launched['pid'];port=launched['cdpPort']
    birth=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True).stdout.strip()
    def guard():
        current=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True).stdout.strip()
        mapped=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-d','txt','-Fn'],capture_output=True,text=True).stdout.splitlines()
        listening=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-iTCP:'+str(port),'-sTCP:LISTEN','-Fn'],capture_output=True,text=True).stdout.splitlines()
        return current==birth and 'n'+str(app/'Contents/MacOS/UWork Preview') in mapped and 'n127.0.0.1:'+str(port) in listening
    readiness=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-readiness.py'))
    def save(value):(evidence/('readiness-'+str(pid)+'.json')).write_text(json.dumps(value,indent=2)+'\n')
    return readiness['wait_owned_renderer'](port,(app/'Contents/Resources/app.asar').as_uri()+'/',guard,save,seconds=30)

COLD_SLICE='''
        before_ui = until(ui_expression(), 'Completed task visible before controlled stop', 30)
        assert before_ui['identity'] == '企业用户甲' and before_ui['model'] == meta['modelId'] and before_ui['userVisible'] and before_ui['assistantVisible']
        assert before_ui['workspaceLabel'].split(' · ')[0] == workspace.name, 'UI label is project/branch, not absolute path'
        cold_db, cold_db_bindings = mapped_database(observations['packagedCli'], root, workspace)
        before_local, before_ui = stable_local(root, workspace, bridge, cold_db, before_ui['taskId'])
        selection = before_local['semantic']['modelSelection']
        assert before_local['semantic']['executionState'] == {'mode':'build','planEnabled':False}
        assert selection and selection['providerId'] == 'ucas' and selection['modelId'] == meta['modelId']
        assert selection.get('options', {}).get('reasoningLevel') == before_ui['reasoning']
        assert before_local['semantic']['messages'][0]['modelSelection'] == selection
        before_backend = f.command('macColdSnapshot', 30, phase='before-cold')['facts']
        assert_backend_baseline(before_backend,delivered,meta['modelId'])
        assert before_backend['bootstrapActor'] == {'userId':meta['memberId'],'tenantId':meta['tenantId']}
        prior_mains = {row['pid'] for row in f.events if row.get('event') == 'launched'}
        before_owned = OLD['owned_processes'](launched['pid'], meta['packagedRuntime']['appPath'] + '/Contents/Resources/glm/zcode.cjs')
        prior_pids = {row['pid'] for row in before_owned} | {launched['pid'], shell_pid}
        known.update(prior_pids)
        observations['loggedInColdBefore'] = {'ui':before_ui,'local':before_local,'backend':before_backend,'databaseKernelBindings':cold_db_bindings,'ownedBeforeStop':before_owned,'controllerPid':f.child.pid}
        f.command('stopNative', 25)
        bridge.kill()
        first_cold_harness = json.loads((evidence/'harness-cleanup.json').read_text())
        assert first_cold_harness['daemonAbsent'] and first_cold_harness['socketClosed']
        bridge = None
        deadline = time.monotonic()+5
        while not absent(prior_pids) and time.monotonic()<deadline: time.sleep(.1)
        assert absent(prior_pids), 'Prior Main/Host/CLI/PTY generation must close'
        f.send({'op':'launch'})
        logged_cold = f.wait_event(lambda row: row.get('event')=='launched' and row.get('pid') not in prior_mains,120,'same-controller logged-in cold generation')
        bridge = attach(logged_cold)
        until(cold_identity_expression(), 'Cold identity remains logged in',60)
        current_view = bridge.evaluate(ui_expression(before_ui['taskId']))
        if not current_view.get('ok'):
            click('[data-testid="task-item-'+before_ui['taskId']+'"]','cold-original-open-existing-task')
        after_ui = until(ui_expression(before_ui['taskId']), 'Original same completed task restored',45)
        after_local, after_ui = stable_local(root,workspace,bridge,cold_db,before_ui['taskId'])
        assert after_ui == before_ui, 'Stable visible task/session/title/model/reasoning/workspace-label/identity/content flags must match'
        assert after_local['semantic'] == before_local['semantic'], 'Persisted semantics changed across cold restore'
        after_backend = f.command('macColdSnapshot',30,phase='post-cold')['facts']
        assert after_backend['stop']['pid'] == launched['pid'] and after_backend['stop']['killObserved'] is False
        assert after_backend['bootstrapActor'] == before_backend['bootstrapActor']
        for field in ['identity','configurations','policies','tenantModelDefinitions','subscription','memberLimit']:
            assert after_backend['snapshot']['actors']['current'][field] == before_backend['snapshot']['actors']['current'][field], field
        assert proof() == delivered
        new_rows = OLD['owned_processes'](logged_cold['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs')
        known.update(row['pid'] for row in new_rows)
        post_cli = OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,new_rows) if any(row['packagedCli'] for row in new_rows) else []
        observations['loggedInColdAfter'] = {'ui':after_ui,'local':after_local,'backend':after_backend,'controllerPid':f.child.pid,'firstPid':launched['pid'],'coldPid':logged_cold['pid'],'oldGenerationAbsent':True,'firstHarnessCleanup':first_cold_harness,'newCliIfSpawned':post_cli,'scope':'controlled SIGTERM stop, not menu quit; UI/persisted/initial execution are separate; no prompt/resume/send issued by observer'}
        checks.append('logged-in-completed-same-task-controlled-cold-zero-replay')
        consistency_previous_mains = {row['pid'] for row in f.events if row.get('event')=='launched'}
'''
def derive_clock(source):
    anchor="        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n"
    assert source.count(anchor)==1;source=source.replace(anchor,anchor+COLD_SLICE)
    predicate="row.get('pid') != launched['pid']";assert source.count(predicate)==1;source=source.replace(predicate,"row.get('pid') not in consistency_previous_mains")
    attach="        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)"
    assert source.count(attach)==1;source=source.replace(attach,"        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence, renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')")
    return source

def run(args):
    plan=json.loads(args.preparation.read_text());assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/plan['profile']/'preparation.json'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']
    tree=ast.parse(BASE.read_text());body=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='run').body[:2]
    assert all(isinstance(node,ast.Assert) for node in body)
    guards=ast.FunctionDef(name='check',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='profile')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(body),decorator_list=[])
    test_scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[guards],type_ignores=[])),str(BASE),'exec'),test_scope);test_scope['check'](plan['profile'])
    derived=derive_clock(BASE.read_text());compile(derived,str(BASE),'exec')
    assert hashlib.sha256(derived.encode()).hexdigest()==plan['derivedClockSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':plan['profile']}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation)
    assert not (ROOT/'data'/plan['profile']).exists() and not (ROOT/'evidence'/plan['profile']).exists()
    scope={'__file__':str(BASE),'__name__':'reviewed_mac_cold_consistency','ui_expression':ui_expression,'cold_identity_expression':cold_identity_expression,'assert_backend_baseline':assert_backend_baseline,'mapped_database':mapped_database,'stable_local':stable_local,'absent':absent,'wait_renderer':wait_renderer};exec(compile(derived,str(BASE),'exec'),scope)
    original=subprocess.Popen
    def owned_popen(command,*positional,**kwargs):
        if isinstance(command,list) and command[-1:]==['scripts/fixtures/macos-clock-derived.mjs']:
            assert kwargs.get('cwd')==ROOT and kwargs['env']['UWORK_NATIVE_FIXTURE_NAME']==plan['profile'];command=command[:-1]+['scripts/fixtures/mac-arm64-cold-consistency-derived.mjs']
        return original(command,*positional,**kwargs)
    subprocess.Popen=owned_popen
    try:return scope['run'](plan['profile'],Path(plan['manifestPath']))
    finally:subprocess.Popen=original
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args()) else 1)
