"""Original Mac UI installer -> fresh task -> real Skill tool body in same-call-id followup."""
import argparse,hashlib,json,runpy
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
BASE=REPO/'scripts/tests/macos-clock-probe.py'
PROMPT='UWORK_NATIVE_PLUGIN_SKILL_RUN_20261021 请调用已安装的uwork-native-bridge-plugin:bridge'
INSTALL_ID='uwork-native-bridge-plugin@uwork-native-bridge-market'
wait_renderer=runpy.run_path(str(REPO/'scripts/tests/mac-arm64-model-capability-probe.py'))['wait_renderer']
cap_ui=runpy.run_path(str(REPO/'scripts/tests/mac-arm64-model-capability-probe.py'))['cap_ui']
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def assert_seed(value):
    assert value['counters']=={'supplierCalls':2,'modelRequests':2,'rawInferencePosts':2}
    for actor,count in [('current',0),('other',2)]:
        account=value['snapshot']['actors'][actor]['accounting']
        assert all(len(account[key])==count for key in ['ledger','traces','gatewayCalls'])
        assert all(row['status']=='settled' for row in account['ledger']) and sum(row['amount']for row in account['ledger'])==22*count
        assert all(row['status']=='succeeded'for row in account['traces']) and all(row['has_result']for row in account['gatewayCalls'])
def installer_projection():return '''(()=>{const visible=e=>!!e&&e.getClientRects().length&&!e.closest('[inert],[aria-hidden="true"]'),all=id=>[...document.querySelectorAll('[data-testid="'+id+'"]')].filter(visible),settings=all('settings-page')[0],scope=all('plugin-settings-scope-trigger')[0],row=all('plugin-settings-plugin-row').filter(e=>e.getAttribute('data-plugin-id')===%s),sw=row[0]?.querySelector('[data-testid="plugin-settings-enabled-switch"]'),installed=all('plugin-store-installed-item').filter(e=>e.getAttribute('data-plugin-id')===%s);return{ok:true,settingsPresent:!!settings,section:settings?.getAttribute('data-active-section')??null,userScope:scope?.getAttribute('data-plugin-scope-key')==='user',dialog:all('plugin-store-add-source-dialog').length===1,sourceValue:all('plugin-store-add-source-input')[0]?.value??null,personal:all('plugin-store-segment-personal')[0]?.getAttribute('aria-pressed')==='true',installed:installed.length===1,rowCount:row.length,enabled:sw?.getAttribute('aria-checked')==='true',busy:sw?.getAttribute('aria-busy')==='true',pending:row[0]?.querySelectorAll('[data-testid="plugin-settings-enabled-pending"]').length??0,error:all('plugin-store-add-source-error').length+all('plugin-store-error').length>0}})()'''%(json.dumps(INSTALL_ID),json.dumps(INSTALL_ID))
def expecting(expression,condition):return '(()=>{const v=('+expression+');v.ok=!!('+condition+');return v})()'
PLUGIN_SLICE='''        before=f.command('pluginSkillProof',30,stage='before-install')['facts'];assert_seed(before)
        observations['beforeInstall']=before
        click('[data-testid="task-settings-button"]','original-settings-open')
        click('[data-testid="settings-section-nav-plugin"]','original-plugin-settings')
        settings=until(expecting(installer_projection(),"v.section==='plugin'"),'Original plugin settings')
        if not settings['userScope']:
            click('[data-testid="plugin-settings-scope-trigger"]','original-plugin-scope')
            click('[data-testid="plugin-settings-scope-user-option"]','original-user-scope')
        until(expecting(installer_projection(),"v.userScope&&!v.error"),'Original User scope')
        click('[data-testid="plugin-settings-add"]','original-plugin-add')
        click('[data-testid="plugin-store-add-source-menu-item"]','original-marketplace-source-menu')
        until(expecting(installer_projection(),"v.dialog&&v.sourceValue===''&&!v.error"),'Original empty source dialog')
        click('[data-testid="plugin-store-add-source-input"]','original-source-input')
        source=meta['supplierOrigin']+'/owned-native-skill/marketplace.json'
        bridge.raw_cdp('Input.insertText',text=source)
        until(expecting(installer_projection(),'v.dialog&&v.sourceValue==='+json.dumps(source)+'&&!v.error'),'Original typed source')
        click('[data-testid="plugin-store-add-source-submit"]','original-source-submit-once')
        until(expecting(installer_projection(),"!v.dialog&&v.personal&&!v.error"),'Original source added personal marketplace',45)
        click('[data-testid="plugin-store-install"][data-plugin-id='+json.dumps(INSTALL_ID)+']','original-exact-plugin-install-once')
        installed=until(expecting(installer_projection(),'v.installed&&!v.error'),'Original exact installed strip',60)
        click('[data-testid="plugin-store-manage-open"]','original-manage-installed')
        managed=until(expecting(installer_projection(),'v.userScope&&v.rowCount===1&&v.enabled&&!v.busy&&v.pending===0&&!v.error'),'Original User same-id enabled row',30)
        observations['installedUi']={'strip':installed,'management':managed}
        click('[data-testid="plugin-settings-plugin-row"][data-plugin-id='+json.dumps(INSTALL_ID)+'] > button:first-child','original-installed-plugin-detail')
        until("(()=>({ok:document.querySelector('[data-testid=plugin-store-detail]')?.getAttribute('data-plugin-id')==="+json.dumps(INSTALL_ID)+"}))()",'Original same-plugin detail')
        click('[data-testid="plugin-store-detail"][data-plugin-id='+json.dumps(INSTALL_ID)+'] [data-testid="plugin-store-advanced"] > summary','original-installation-details')
        installation=until("""(()=>{const detail=document.querySelector('[data-testid="plugin-store-detail"][data-plugin-id="'+%s+'"]'),advanced=detail?.querySelector('[data-testid="plugin-store-advanced"]');const rows=[...advanced?.querySelectorAll('div')??[]].filter(e=>e.children.length===2&&e.children[0].textContent.trim()==='根路径');return{ok:advanced?.open&&rows.length===1&&!!rows[0].children[1].textContent.trim(),pluginId:detail?.getAttribute('data-plugin-id'),rootPath:rows.length===1?rows[0].children[1].textContent.trim():null}})()"""%json.dumps(INSTALL_ID),'Original User plugin installation root')
        ui_root=Path(installation['rootPath']);assert ui_root.is_absolute() and '..' not in ui_root.parts
        ui_root.relative_to(root)
        observations['originalInstallationMetadata']=installation
        installed_proof=f.command('pluginSkillProof',30,stage='after-install')['facts'];assert_seed(installed_proof)
        assert installed_proof['supplierRequestDigests']==before['supplierRequestDigests']
        observations['afterInstall']=installed_proof
        checks.append('original-ui-installer-text-package-and-user-enabled-zero-inference')
        # Clear the original store return target, then original Back to the same workspace.
        click('[data-testid="settings-section-nav-plugin"]','original-clear-plugin-store-return')
        click('[data-testid="settings-back-button"]','original-settings-back')
        click('[data-testid="enterprise-menu-chat"]','original-current-workspace-new-task')
        draft=until(cap_ui('',[],True,meta['modelId']),'Original fresh same-model workspace draft',45)
        assert draft['workspace']=='packaged-workspace' and draft['thought']=='none'
        observations['newDraft']=draft
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]','original-composer-focus')
        bridge.raw_cdp('Input.insertText',text=PROMPT)
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]','original-skill-send-once')
        task=until(cap_ui(PROMPT,[],False,meta['modelId']),'Original Skill task completes',90)
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            delivered=proof();assert delivered['modelCalls']<=5
            if delivered['own']['settled']==3:break
            time.sleep(.2)
        assert delivered['own']=={'count':3,'settled':3,'amount':66,'inputTokens':36,'outputTokens':30}
        assert delivered['other']==baseline['other'] and delivered['modelCalls']==5
        assert delivered['modelWorkingDirectories']==[str(workspace)]
        proof_after=f.command('pluginSkillProof',30,stage='after-send')['facts']
        observations['afterSend']=delivered;observations['taskUi']=task;observations['pluginSkillProof']=proof_after
        followups=[row for row in proof_after['oracle']['receipts']if row['kind']=='main-followup'];assert len(followups)==1
        assert followups[0]['fullSkillBodyMatched'] is True and followups[0]['bodyMarkerMatched'] is True and followups[0]['baseDirectoryMatched'] is True
        attestation=followups[0]['attestation'];relative=Path(attestation['caseRelativePluginRoot'])
        assert not relative.is_absolute() and '..' not in relative.parts and ui_root==root/relative
        observations['installationRootMatch']={'originalUiRootPath':str(ui_root),'attestedCaseRelativePluginRoot':str(relative),'exactMatch':True,'source':'Original User installed-plugin metadata and independent Skill tool-result filesystem attestation'}
        rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs')
        known.update(row['pid']for row in rows)
        observations['packagedCli']=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows)
        checks.append('native-original-skill-same-call-id-body-cache-followup-and-accounting')
        (evidence/'final-ui.png').write_bytes(base64.b64decode(bridge.raw_cdp('Page.captureScreenshot',format='png')['data']))
'''
def derivePluginProbe(source):
    start='        def open_file(label):';end="        facts['status'] = 'passed'"
    assert source.count(start)==source.count(end)==1
    source=source[:source.index(start)]+PLUGIN_SLICE+source[source.index(end):]
    old="        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)";assert source.count(old)==1
    source=source.replace(old,"        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence, renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')")
    entry="['scripts/fixtures/macos-clock-derived.mjs']";assert source.count(entry)==1
    return source.replace(entry,"['scripts/fixtures/mac-plugin-skill-derived.mjs']")
def run(args):
    path=args.preparation.resolve();plan=json.loads(path.read_text());profile=plan['profile']
    assert path==REPO/'data/sandbox-verification'/profile/'preparation.json'
    assert profile=='client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021'
    for source,expected in plan['sources'].items():assert digest(REPO/source)==expected,source
    assert digest(plan['manifestPath'])==plan['manifestSha256'] and digest(__file__)==plan['driverSha256']
    derived=derivePluginProbe(BASE.read_text());compile(derived,str(BASE),'exec')
    assert hashlib.sha256(derived.encode()).hexdigest()==plan['derivedProbeSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':profile}));return True
    assert args.reviewed_plan_sha256==digest(path)
    namespace={'__file__':str(BASE),'__name__':'reviewed_mac_plugin_skill','wait_renderer':wait_renderer,'cap_ui':cap_ui,'assert_seed':assert_seed,'installer_projection':installer_projection,'expecting':expecting,'PROMPT':PROMPT,'INSTALL_ID':INSTALL_ID}
    exec(compile(derived,str(BASE),'exec'),namespace)
    return namespace['run'](profile,Path(plan['manifestPath']))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args()) else 1)
