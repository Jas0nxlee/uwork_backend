"""Thin Native PDF producer/share/upload/download slice; never runs without reviewed fresh plan."""
import argparse,base64,hashlib,json,os,runpy,stat,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-clock-probe.py'
PROFILE='client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021'
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def validate_original_profile(profile):
    assert profile==PROFILE
    runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-probe.py'))['validate_original_clock_profile'](profile)
    return profile

def read_owned_pdf(root,meta):
    path=root/'packaged-workspace'/meta['shareArtifact']['fileName'];assert path.name=='native-share-proof.pdf'and path.resolve()==path
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd);assert stat.S_ISREG(info.st_mode)and 100<info.st_size<4096
        actual=os.read(fd,4097);assert len(actual)==info.st_size
    finally:os.close(fd)
    expected=base64.b64decode(meta['shareArtifact']['base64'],validate=True)
    assert actual==expected and hashlib.sha256(actual).hexdigest()==meta['shareArtifact']['sha256']
    return {'fileName':path.name,'sizeBytes':len(actual),'sha256':hashlib.sha256(actual).hexdigest(),'nativeTerminalProducedExactValidFixture':True}

def share_preview_expression():
    return '''(()=>{const p=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length&&e.closest('[data-root-workspace-surface="interactive"]')&&!e.closest('[inert]')&&e.getAttribute('data-session-id')!=='draft');const pane=p.length===1?p[0]:null,cards=pane?[...pane.querySelectorAll('[data-zcode-stream-animate="true"]')].filter(e=>{const title=e.querySelector(':scope > div:nth-child(2) > div:first-child');return title?.textContent.trim()==='native-share-proof.pdf'&&e.querySelector('button')&&e.getClientRects().length}):[];return{ok:cards.length===1,taskId:pane?.getAttribute('data-session-id')??null,visibleCardCount:cards.length,title:cards[0]?.querySelector(':scope > div:nth-child(2) > div:first-child')?.textContent.trim()??null}})()'''

def wait_share_renderer(launched,meta,evidence):
    pid=launched['pid'];port=launched['cdpPort'];app=Path(meta['packagedRuntime']['appPath']);end=time.monotonic()+30
    def options():
        remaining=end-time.monotonic();assert remaining>0,'Owned30s renderer deadline exhausted';return {'timeout':min(.75,remaining)}
    birth=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True,**options()).stdout.strip();assert birth
    def guard():
        current=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,**options()).stdout.strip()
        mapped=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-d','txt','-Fn'],capture_output=True,text=True,**options()).stdout.splitlines()
        listener=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-iTCP:'+str(port),'-sTCP:LISTEN','-Fn'],capture_output=True,text=True,**options()).stdout.splitlines();options()
        return current==birth and 'n'+str(app/'Contents/MacOS/UWork Preview')in mapped and 'n127.0.0.1:'+str(port)in listener
    ready=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-readiness.py'))
    def persist(value):(evidence/'renderer-readiness.json').write_text(json.dumps(value,indent=2)+'\n')
    return ready['wait_owned_renderer'](port,(app/'Contents/Resources/app.asar').as_uri()+'/',guard,persist,seconds=max(.001,end-time.monotonic()))

SHARE_SLICE='''
        source_pdf=read_owned_pdf(root,meta)
        observations['nativePdf']=source_pdf
        checks.append('original-xterm-produced-byte-valid-one-page-PDF')
        preview=until(share_preview_expression(),'Original visible PDF assistant preview card',30)
        observations['originalPdfPreview']=preview
        settle=time.monotonic()+15
        while time.monotonic()<settle:
            before_share=f.command('secondaryDiagnosticSnapshot',10)['facts']
            try:assert_backend_baseline(before_share,delivered,meta['modelId']);break
            except AssertionError:time.sleep(.2)
        else:raise AssertionError('Share accounting baseline not fully settled')
        observations['beforeShare']=before_share
        click('[data-testid="conversation-share-trigger"]','original-share-trigger')
        until('(()=>{const b=document.querySelector("[data-testid=conversation-share-next]");return{ok:!!b&&!b.disabled}})()','Original share preflight ready')
        click('[data-testid="conversation-share-next"]','original-share-next')
        until('(()=>({ok:!!document.querySelector("[data-testid=conversation-share-disclosure-checkbox]")}))()','Original disclosure ready')
        click('[data-testid="conversation-share-disclosure-checkbox"]','original-share-disclosure')
        until('(()=>{const b=document.querySelector("[data-testid=conversation-share-confirm]");return{ok:!!b&&!b.disabled}})()','Original share confirm enabled')
        click('[data-testid="conversation-share-confirm"]','original-share-confirm-once')
        until('(()=>({ok:!!document.querySelector("[data-testid=conversation-share-success-dock]")}))()','Original one-PDF share success',60)
        artifact=f.command('shareArtifactProof',30,phase='after')['facts']
        assert artifact['share']=={'status':'confirmed','artifactCount':1,'ownedByCurrent':True}
        assert artifact['source']['sha256']==artifact['upload']['sha256']==artifact['stored']['sha256']==artifact['download']['sha256']==source_pdf['sha256']
        observations['shareArtifact']=artifact
        checks.append('original-share-UI-one-PDF-upload-stored-and-downloaded-SHA')
        after_share=f.command('secondaryDiagnosticSnapshot',10)['facts']
        assert_share_zero(before_share,after_share)
        assert proof()['own']==delivered['own'] and proof()['modelCalls']==delivered['modelCalls']
        revoked=f.command('shareArtifactProof',30,phase='revoke')['facts']
        assert revoked['revoked']=={'rowStatus':'revoked','artifactsRemaining':0,'downloadStatus':404}
        final_share=f.command('secondaryDiagnosticSnapshot',10)['facts'];assert_share_zero(before_share,final_share)
        observations['afterShare']=after_share;observations['shareRevoke']=revoked;observations['afterRevoke']=final_share
        checks.append('share-zero-models-full-accounting-and-owned-revoke-cleanup')
'''
def assert_share_zero(before,after):
    for key in ['modelCalls','rawInferencePosts','supplierRequestDigests','bootstrapActor']:assert after[key]==before[key],key
    assert before['rawInferencePosts']==before['modelCalls']==4
    for actor in ['current','other']:assert after['snapshot']['actors'][actor]['accounting']==before['snapshot']['actors'][actor]['accounting'],actor

def deriveShareArtifactProbe(source):
    a="        def open_file(label):";b="        marker = workspace / 'terminal-proof.txt'";assert source.count(a)==source.count(b)==1;source=source[:source.index(a)]+source[source.index(b):]
    a="        bridge.raw_cdp('Input.insertText', text=command)";assert source.count(a)==1
    source=source.replace(a,"        assert not (workspace/meta['shareArtifact']['fileName']).exists()\n        command += '; printf %s ' + shlex.quote(meta['shareArtifact']['base64']) + ' | /usr/bin/base64 -D > ' + shlex.quote(str(workspace/meta['shareArtifact']['fileName']))\n"+a)
    assert source.count('MACOS_CLOCK_LINK_20261020')==1;source=source.replace('MACOS_CLOCK_LINK_20261020','MAC_NATIVE_SHARE_ARTIFACT_20261021')
    a="        f.command('memberSeat', value=False)";b="        facts['status'] = 'passed'";assert source.count(a)==source.count(b)==1;source=source[:source.index(a)]+SHARE_SLICE+source[source.index(b):]
    a="        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)";assert source.count(a)==1
    source=source.replace(a,"        wait_share_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence,renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')")
    return source

def run(args):
    plan=json.loads(args.preparation.read_text());validate_original_profile(plan['profile']);assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/PROFILE/'preparation.json'
    for path,h in plan['sources'].items():assert digest(ROOT/path)==h,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']
    source=deriveShareArtifactProbe(BASE.read_text());compile(source,str(BASE),'exec');assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':PROFILE}));return True
    assert digest(args.preparation)==args.reviewed_plan_sha256
    cold=runpy.run_path(str(ROOT/'scripts/tests/mac-arm64-cold-consistency-probe.py'))
    ns={'__file__':str(BASE),'__name__':'owned_native_share_artifact','read_owned_pdf':read_owned_pdf,'share_preview_expression':share_preview_expression,'wait_share_renderer':wait_share_renderer,'assert_backend_baseline':cold['assert_backend_baseline'],'assert_share_zero':assert_share_zero}
    exec(compile(source,str(BASE),'exec'),ns);original=subprocess.Popen
    def popen(command,*a,**kw):
        if isinstance(command,list)and command[-1:]==['scripts/fixtures/macos-clock-derived.mjs']:
            assert kw['cwd']==ROOT and kw['env']['UWORK_NATIVE_FIXTURE_NAME']==PROFILE;command=command[:-1]+['scripts/fixtures/mac-native-share-artifact-derived.mjs']
        return original(command,*a,**kw)
    subprocess.Popen=popen
    try:return ns['run'](PROFILE,Path(plan['manifestPath']))
    finally:subprocess.Popen=original
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args())else 1)
