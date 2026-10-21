"""Diagnostic-only original x64 Main Node CPU profile; no UI, secondary, renderer acceptance or sampler."""
import argparse,json,hashlib,os,runpy,signal,socket,stat,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/native-packaged-runtime-probe.py'))
NATIVE=M['MODULE'];NODE=NATIVE['NODE24']
PROFILE='client-native-packaged-macos-clock-x64-startup-v5-20261021'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def zero_delta(before,after):
    assert before['modelCalls']==after['modelCalls']==before['rawInferencePosts']==after['rawInferencePosts']==2
    assert before['supplierRequestDigests']==after['supplierRequestDigests']
    for actor in ['current','other']:assert before['snapshot']['actors'][actor]['accounting']==after['snapshot']['actors'][actor]['accounting']
def remaining(deadline,reserve=0):
    value=deadline-time.monotonic()-reserve
    assert value>0,'Case90s budget exhausted'
    return value
def main_cpu_work_budget(work_deadline):
    value=min(70000,int(remaining(work_deadline)*1000)-1000)
    assert value>=35000,'Insufficient work budget for full30s sample and protocol cleanup'
    return value
def run_case(plan):
    started=time.monotonic();deadline=started+90;work_deadline=deadline-20;profile=plan['profile'];evidence=ROOT/'evidence'/profile;root=ROOT/'data'/profile
    assert not evidence.exists() and not root.exists()
    (evidence/'controller-home').mkdir(parents=True,mode=0o700);(evidence/'controller-tmp').mkdir(mode=0o700)
    facts={'status':'failed','diagnosticOnly':True,'original7Accepted':False,'originalRendererOrSecondaryAcceptance':False,'budgetSeconds':90};errors=[];known=set();f=guard=None;meta={};main_pid=None;main_birth=None
    try:
        guard=M['OsGuard'](protocol_only=True);known.add(guard.child.pid);facts['osGuard']=guard.ready
        assert guard.ready['usesSystemClipboard'] is False
        original=subprocess.Popen;launches=[]
        def popen(command,*args,**kwargs):
            if isinstance(command,list) and command[-1:]==['scripts/fixtures/client-native-enterprise.mjs']:
                assert kwargs['cwd']==ROOT and kwargs['env']['UWORK_NATIVE_FIXTURE_NAME']==profile
                command=command[:-1]+['scripts/fixtures/macos-x64-cpu-derived.mjs'];launches.append(command)
            return original(command,*args,**kwargs)
        subprocess.Popen=popen
        try:f=NATIVE['Fixture'](profile,evidence/'controller-home',evidence/'controller-tmp',mode='experience',packaged_manifest=Path(plan['manifestPath']))
        finally:subprocess.Popen=original
        known.add(f.child.pid);assert len(launches)==1
        f.wait_event(lambda row:row.get('event')=='ready',min(20,remaining(deadline,55)),'owned backend ready')
        meta=json.loads((evidence/'desktop-state.json').read_text());assert not meta['copiedProductionMain']
        assert len({meta['mainInspectorPort'],meta['cdpPort']})==2
        baseline=f.command('mainCpuSnapshot',min(5,remaining(deadline,50)))['facts']
        assert baseline['modelCalls']==2
        accounts=baseline['snapshot']['actors'];assert all(len(accounts['current']['accounting'][key])==0 for key in ['ledger','traces','gatewayCalls'])
        assert all(len(accounts['other']['accounting'][key])==2 for key in ['ledger','traces','gatewayCalls'])
        assert sum(row['amount']for row in accounts['other']['accounting']['ledger'])==44
        facts['baseline']=baseline
        f.send({'op':'launch'});launched=f.wait_event(lambda row:row.get('event')=='launched',min(10,remaining(deadline,50)),'owned x64 Main paused launch')
        main_pid=launched['pid'];known.add(main_pid)
        main_birth=subprocess.run(['ps','-p',str(main_pid),'-o','lstart='],capture_output=True,text=True,check=True,timeout=2).stdout.strip();facts['main']={'pid':main_pid,'birth':main_birth,'inspectPort':meta['mainInspectorPort']}
        work_ms=main_cpu_work_budget(work_deadline)
        facts['workBudgetMs']=work_ms
        result=f.command('mainCpuProfile',remaining(work_deadline),budgetMs=work_ms)['facts']
        assert result['releasedInitialBreak'] is True and result['requestedDurationMs']==30000 and result['socketClosed'] is True and result['profileOnly'] is True and result['actualSampleWaitMs']>=29999
        path=evidence/'main-cpu-profile.json';info=path.lstat();assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode)==0o600 and info.st_size==result['profileBytes'] and 0<info.st_size<=8*1024*1024
        facts['cpu']=result;facts['rawCpuProfile']={'file':path.name,'bytes':info.st_size,'sha256':digest(path),'mode':'0600'}
        after=f.command('mainCpuSnapshot',min(5,remaining(work_deadline)))['facts'];zero_delta(baseline,after);facts['after']=after
        facts['preCleanupElapsedSeconds']=time.monotonic()-started
        facts['status']='passed-diagnostic-only'
    except BaseException as error:facts['failure']=type(error).__name__+': '+str(error)[:300]
    finally:
        if f:
            try:
                if main_pid:
                    rows=M['owned_processes'](main_pid,meta.get('packagedRuntime',{}).get('appPath','')+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows);facts['shutdownOwnedProcesses']=rows
                f.command('stopNative',max(.5,min(15,deadline-time.monotonic()-3)))
            except Exception as error:errors.append('stopNative:'+type(error).__name__)
        if f and f.child.poll()is None:
            f.child.terminate()
            try:f.child.wait(timeout=max(.5,min(5,deadline-time.monotonic()-2)))
            except subprocess.TimeoutExpired:f.child.kill();f.child.wait(timeout=2);errors.append('fixture-required-kill')
        if f:
            facts['fixtureExitCode']=f.child.returncode
            if f.child.returncode!=0:errors.append('fixture-exit-not-zero')
        if main_pid and subprocess.run(['ps','-p',str(main_pid),'-o','lstart='],capture_output=True,text=True).stdout.strip()==main_birth:
            # Emergency cleanup only for the original detached group, after fresh PID/birth/exe/group checks.
            executable=meta.get('packagedRuntime',{}).get('executable','');mapped=subprocess.run(['lsof','-nP','-a','-p',str(main_pid),'-d','txt','-Fn'],capture_output=True,text=True).stdout.splitlines();group=subprocess.run(['ps','-p',str(main_pid),'-o','pgid='],capture_output=True,text=True).stdout.strip()
            if executable and 'n'+executable in mapped and group==str(main_pid):
                os.killpg(main_pid,signal.SIGKILL);errors.append('original-main-required-emergency-owned-group-kill')
        if guard:
            try:
                facts['osRestore']=guard.close()
                if not facts['osRestore']['protocolRestored'] or facts['osRestore']['usesSystemClipboard']:errors.append('OS-guard-restore')
            except Exception as error:errors.append('OSguard:'+type(error).__name__)
        absent={}
        for pid in sorted(known):
            try:os.kill(pid,0);absent[str(pid)]=False
            except ProcessLookupError:absent[str(pid)]=True
        ports={}
        from urllib.parse import urlparse
        for port in {meta.get('cdpPort'),meta.get('mainInspectorPort'),*[urlparse(meta.get(key,'')).port for key in ['origin','backendOrigin','supplierOrigin']]}-{None}:
            with socket.socket()as connection:connection.settimeout(.3);ports[str(port)]=connection.connect_ex(('127.0.0.1',port))!=0
        if not all(absent.values())or not all(ports.values()):errors.append('owned-resource-not-closed')
        elapsed=time.monotonic()-started
        if elapsed>90:errors.append('case-exceeded90s')
        facts['elapsedSeconds']=elapsed;facts['cleanup']={'errors':errors,'pidsAbsent':absent,'portsClosed':ports}
        if errors:facts['status']='failed'
        (evidence/'result.json').write_text(json.dumps(facts,indent=2)+'\n')
    print(json.dumps({'status':facts['status'],'failure':facts.get('failure'),'elapsedSeconds':facts['elapsedSeconds'],'cleanup':facts['cleanup']}))
    return facts['status']=='passed-diagnostic-only'
def run(args):
    plan=json.loads(args.preparation.read_text());assert plan['profile']==PROFILE and args.preparation.resolve()==ROOT/'data/sandbox-verification'/PROFILE/'preparation.json'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256'] and digest(__file__)==plan['driverSha256']
    clock=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-probe.py'));clock['validate_original_clock_profile'](PROFILE)
    code="import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{validateMainCpuProfile,deriveMainCpuFixture}from'./scripts/fixtures/macos-x64-cpu-derived.mjs';validateMainCpuProfile(process.argv[1]);console.log(createHash('sha256').update(deriveMainCpuFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'))).digest('hex'));"
    derived=subprocess.run([NODE,'--input-type=module','-e',code,PROFILE],cwd=ROOT,check=True,capture_output=True,text=True,timeout=10).stdout.strip()
    assert derived==plan['fixtureDerivedSha256']
    assert digest(plan['compiledFixturePath'])==derived
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':PROFILE}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation)
    return run_case(plan)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args())else 1)
