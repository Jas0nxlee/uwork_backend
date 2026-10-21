"""Original Mac warm7 plus same-ID tools true-false-true on two original UI new tasks."""
import argparse,ast,copy,hashlib,json,os,runpy,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-clock-probe.py'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

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

def cap_ui(marker, prior, draft=False, expected_model=None):
    return '''(()=>{const panes=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length&&e.closest('[data-root-workspace-surface="interactive"]')&&!e.closest('[inert]')),p=panes.length===1?panes[0]:null,id=p?.getAttribute('data-session-id'),m=p?.querySelector('[data-testid="v4-model-config"][data-source="composer"]'),editor=p?.querySelector('[data-testid="v4-composer"] [contenteditable="true"]'),text=p?.innerText??'',row=id?document.querySelector('[data-testid="task-item-'+id+'"]'):null;return{ok:!!p&&document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText==='企业用户甲'&&(!%s||m?.getAttribute('data-model')===%s&&m?.getAttribute('data-thought')==='none')&&(%s?id==='draft'&&!!editor&&!!editor.getClientRects().length&&p.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()==='packaged-workspace':id?.startsWith('sess_')&&!%s.includes(id)&&text.includes(%s)&&text.includes('原生企业资产联动完成。')&&!p.querySelector('[data-testid="v4-stop"]')&&!!row),taskId:id??null,title:row?.querySelector('[data-task-title-copy="original"]')?.textContent.trim()??null,model:m?.getAttribute('data-model')??null,thought:m?.getAttribute('data-thought')??null,workspace:p?.querySelector('[data-testid="composer-workspace-trigger"]')?.innerText.trim()??null,identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null}})()'''%(json.dumps(expected_model),json.dumps(expected_model),json.dumps(draft),json.dumps(prior),json.dumps(marker))

def provider_sync(root,model_id):
    directory=root/'data/.uwork/v2'
    provider=json.loads((directory/'provider_config.json').read_text());rows=[row for row in provider['config']['modelConfigRules']['providerModelRules'] if row['providerId']=='ucas' and row['modelId']==model_id];assert len(rows)==1
    gateway=json.loads((directory/'ucas-gateway.json').read_text())
    return {'supportsTools':rows[0]['config']['properties']['supportsToolCall'],'lastSyncedAt':gateway['lastSyncedAt']}

def manual_completions(evidence):
    return sum('[host-log]' in line and 'UCAS gateway provisioning synced' in line and '"reason":"manual"' in line for line in (evidence/'electron.log').read_text().splitlines())

CAP_SLICE='''
        warm_cap = f.command('capabilityProof',30,stage='warm')['facts']
        assert_backend_baseline(warm_cap,delivered,meta['modelId'])
        assert warm_cap['bootstrapActor'] == {'userId':meta['memberId'],'tenantId':meta['tenantId']}
        observations['capabilityWarm'] = warm_cap
        prior_ids = []
        initial_pane = bridge.evaluate(cap_ui('',[],False))
        assert initial_pane['taskId'] and initial_pane['taskId'].startswith('sess_')
        prior_ids.append(initial_pane['taskId'])
        observations['capabilityStages'] = []
        for ordinal,enabled,stage,marker in [(1,False,'tools-off','MAC_CAP_TOOLS_OFF_20261021'),(2,True,'tools-on','MAC_CAP_TOOLS_ON_20261021')]:
            previous_sync = provider_sync(root,meta['modelId'])
            previous_manual = manual_completions(evidence)
            mutation = f.command('capabilityChange',30,supportsTools=enabled)['facts']
            click('[data-testid="enterprise-identity-name"]',stage+'-identity-menu')
            click('[data-testid="enterprise-identity-sync-gateway"]',stage+'-original-manual-sync')
            sync_deadline = time.monotonic()+45
            while time.monotonic()<sync_deadline:
                status = f.command('capabilityStatus',10)['facts']
                current_sync = provider_sync(root,meta['modelId'])
                completed_manual = manual_completions(evidence)
                if status['catalogReady'] and current_sync['supportsTools'] is enabled and current_sync['lastSyncedAt']>previous_sync['lastSyncedAt'] and completed_manual>previous_manual:break
                time.sleep(.2)
            else:raise AssertionError('Original manual sync did not complete with current catalog and Provider property')
            click('[data-testid="enterprise-menu-chat"]',stage+'-original-enterprise-new-task')
            draft = until(cap_ui(marker,prior_ids,True),stage+' original current-workspace draft',45)
            assert draft['workspace']=='packaged-workspace' and draft['identity']=='企业用户甲'
            if draft['model'] != meta['modelId']:
                click('[data-testid="chat-model-select-trigger"]',stage+'-original-model-picker')
                item_id = 'chat-model-select-item-custom:ucas:'+meta['modelId']
                click('[data-testid="chat-model-select-group-registry-provider:ucas"]',stage+'-original-provider-submenu')
                click('[data-testid='+json.dumps(item_id)+']',stage+'-original-select-same-model')
                draft = until(cap_ui(marker,prior_ids,True,meta['modelId']),stage+' selected draft',20)
            draft = until(cap_ui(marker,prior_ids,True,meta['modelId']),stage+' model/reasoning ready',20)
            assert draft['model']==meta['modelId'] and draft['thought']=='none'
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]',stage+'-composer-focus')
            bridge.raw_cdp('Input.insertText',text=marker+' 请简短回复，不调用工具。')
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]',stage+'-original-send')
            task = until(cap_ui(marker,prior_ids,False,meta['modelId']),stage+' original successful new task',75)
            assert task['model']==meta['modelId'] and task['identity']=='企业用户甲'
            prior_ids.append(task['taskId'])
            settle = time.monotonic()+35
            while time.monotonic()<settle:
                updated=proof()
                assert updated['modelCalls']<=4+2*ordinal
                if updated['own']['settled']==2+2*ordinal:break
                time.sleep(.2)
            expected={'count':2+2*ordinal,'settled':2+2*ordinal,'amount':44*(ordinal+1),'inputTokens':24*(ordinal+1),'outputTokens':20*(ordinal+1)}
            assert updated['own']==expected and updated['other']==baseline['other'] and updated['modelCalls']==4+2*ordinal
            assert updated['modelWorkingDirectories']==[str(workspace)]
            stage_proof=f.command('capabilityProof',30,stage=stage)['facts']
            assert stage_proof['supplier']['main']['toolCount']==(32 if enabled else 0)
            observations['capabilityStages'].append({'stage':stage,'mutation':mutation,'catalog':status['catalog'],'provider':current_sync,'manualCompletionsBefore':previous_manual,'manualCompletionsAfter':completed_manual,'uiDraft':draft,'uiTask':task,'oracle':stage_proof,'accounting':updated})
            delivered=updated
        assert delivered['own']['count']==6 and delivered['own']['amount']==132
        checks.append('same-model-tools-true-false-true-original-sync-new-tasks-and-accounting')
'''

def derive_clock(source):
    anchor="        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n";assert source.count(anchor)==1;source=source.replace(anchor,anchor+CAP_SLICE)
    attach="        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)";assert source.count(attach)==1
    return source.replace(attach,"        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence, renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')")

def run(args):
    plan=json.loads(args.preparation.read_text());assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/plan['profile']/'preparation.json'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']
    base=BASE.read_text();derived=derive_clock(base);compile(derived,str(BASE),'exec');assert hashlib.sha256(derived.encode()).hexdigest()==plan['derivedClockSha256']
    tree=ast.parse(base);body=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='run').body[:2];assert all(isinstance(node,ast.Assert) for node in body)
    check=ast.FunctionDef(name='check',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='profile')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(body),decorator_list=[]);scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[check],type_ignores=[])),str(BASE),'exec'),scope);scope['check'](plan['profile'])
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':plan['profile']}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation);assert not (ROOT/'data'/plan['profile']).exists() and not (ROOT/'evidence'/plan['profile']).exists()
    scope={'__file__':str(BASE),'__name__':'reviewed_mac_model_capability','assert_backend_baseline':assert_backend_baseline,'wait_renderer':wait_renderer,'cap_ui':cap_ui,'provider_sync':provider_sync,'manual_completions':manual_completions};exec(compile(derived,str(BASE),'exec'),scope)
    original=subprocess.Popen
    def owned_popen(command,*positional,**kwargs):
        if isinstance(command,list) and command[-1:]==['scripts/fixtures/macos-clock-derived.mjs']:
            assert kwargs.get('cwd')==ROOT and kwargs['env']['UWORK_NATIVE_FIXTURE_NAME']==plan['profile'];command=command[:-1]+['scripts/fixtures/mac-arm64-model-capability-derived.mjs']
        return original(command,*positional,**kwargs)
    subprocess.Popen=owned_popen
    try:return scope['run'](plan['profile'],Path(plan['manifestPath']))
    finally:subprocess.Popen=original
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--preparation',type=Path,required=True);p.add_argument('--run',action='store_true');p.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(p.parse_args()) else 1)
