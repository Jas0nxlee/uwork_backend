"""One original x64 workspace secondary after diagnostic-only owned target readiness; no UI/BH/inspector."""
import argparse,json,hashlib,os,runpy,signal,socket,subprocess,time,threading
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'scripts/tests/native-packaged-runtime-probe.py'));NATIVE=M['MODULE'];NODE=NATIVE['NODE24']
PROFILE='client-native-packaged-macos-clock-x64-startup-v6-20261021'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def remaining(deadline,reserve=0):
    value=deadline-time.monotonic()-reserve;assert value>0,'Case120s budget exhausted';return value
def zero_delta(before,after):
    assert before['modelCalls']==after['modelCalls']==before['rawInferencePosts']==after['rawInferencePosts']==2
    assert before['supplierRequestDigests']==after['supplierRequestDigests']
    for actor in ['current','other']:assert before['snapshot']['actors'][actor]['accounting']==after['snapshot']['actors'][actor]['accounting']
def read_actor(pid,executable,deadline,expected_birth=None):
    remaining(deadline)
    birth=subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True,timeout=min(2,remaining(deadline))).stdout.strip();assert birth
    assert expected_birth is None or birth==expected_birth,'Owned PID birth changed'
    mapped=subprocess.run(['lsof','-nP','-a','-p',str(pid),'-d','txt','-Fn'],capture_output=True,text=True,check=True,timeout=min(2,remaining(deadline))).stdout.splitlines();assert 'n'+executable in mapped
    with open(executable,'rb')as stream:assert stream.read(8)==bytes.fromhex('cffaedfe07000001')
    assert birth==subprocess.run(['ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,check=True,timeout=min(2,remaining(deadline))).stdout.strip()
    remaining(deadline)
    return {'pid':pid,'birth':birth,'mappedX64':True}
def command_outcome(send,observe,deadline):
    outcome={}
    def command():
        try:outcome['result']=send()
        except BaseException as error:outcome['_exception']=error;outcome['error']={'type':type(error).__name__,'message':str(error)[:200]}
    thread=threading.Thread(target=command,daemon=True);thread.start()
    try:observe(thread)
    except BaseException as error:outcome['observerError']={'type':type(error).__name__}
    finally:thread.join(timeout=max(0,deadline-time.monotonic()))
    outcome['threadClosed']=not thread.is_alive()
    return dict(outcome)
def run_case(plan):
    started=time.monotonic();deadline=started+120;work_deadline=deadline-20;profile=plan['profile'];evidence=ROOT/'evidence'/profile;root=ROOT/'data'/profile
    assert not evidence.exists()and not root.exists()
    (evidence/'controller-home').mkdir(parents=True,mode=0o700);(evidence/'controller-tmp').mkdir(mode=0o700)
    facts={'status':'failed','diagnosticOnly':True,'original7Accepted':False,'original30sRendererAccepted':False,'budgetSeconds':120};errors=[];known=set();f=guard=None;meta={};main_pid=None;main_birth=None;original_error=None
    try:
        guard=M['OsGuard'](protocol_only=True);known.add(guard.child.pid);facts['osGuard']=guard.ready;assert guard.ready['usesSystemClipboard']is False
        original=subprocess.Popen;launches=[]
        def popen(command,*args,**kwargs):
            if isinstance(command,list)and command[-1:]==['scripts/fixtures/client-native-enterprise.mjs']:
                assert kwargs['cwd']==ROOT and kwargs['env']['UWORK_NATIVE_FIXTURE_NAME']==profile
                command=command[:-1]+['scripts/fixtures/macos-x64-secondary-derived.mjs'];launches.append(command)
            return original(command,*args,**kwargs)
        subprocess.Popen=popen
        try:f=NATIVE['Fixture'](profile,evidence/'controller-home',evidence/'controller-tmp',mode='experience',packaged_manifest=Path(plan['manifestPath']))
        finally:subprocess.Popen=original
        known.add(f.child.pid);assert len(launches)==1
        f.wait_event(lambda row:row.get('event')=='ready',min(20,remaining(work_deadline,40)),'owned backend ready')
        meta=json.loads((evidence/'desktop-state.json').read_text());assert not meta['copiedProductionMain']
        before=f.command('secondaryDiagnosticSnapshot',min(5,remaining(work_deadline,30)))['facts'];facts['before']=before
        assert before['modelCalls']==before['rawInferencePosts']==2
        accounts=before['snapshot']['actors'];assert all(not accounts['current']['accounting'][key]for key in ['ledger','traces','gatewayCalls']);assert all(len(accounts['other']['accounting'][key])==2 for key in ['ledger','traces','gatewayCalls']);assert sum(row['amount']for row in accounts['other']['accounting']['ledger'])==44
        f.send({'op':'launch'});launched=f.wait_event(lambda row:row.get('event')=='launched',min(10,remaining(work_deadline,25)),'ordinary x64 Main')
        main_pid=launched['pid'];known.add(main_pid);executable=meta['packagedRuntime']['executable'];main=read_actor(main_pid,executable,work_deadline);main_birth=main['birth'];facts['main']=main
        def main_guard():
            try:
                remaining(work_deadline)
                assert f.child.poll()is None
                with f.lock:assert not any(row.get('event')=='electron-exit'for row in f.events)
                read_actor(main_pid,executable,work_deadline,main_birth)
                listener=subprocess.run(['lsof','-nP','-a','-p',str(main_pid),'-iTCP:'+str(meta['cdpPort']),'-sTCP:LISTEN','-Fn'],capture_output=True,text=True,timeout=min(2,remaining(work_deadline)))
                remaining(work_deadline)
                return listener.returncode==0 and 'n127.0.0.1:'+str(meta['cdpPort'])in listener.stdout.splitlines()
            except Exception:return False
        readiness=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-secondary-readiness.py'))
        prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/'
        def persist(value):(evidence/'primary-readiness.json').write_text(json.dumps(value,indent=2)+'\n')
        ready_seconds=min(60,remaining(work_deadline,20));ready_deadline=time.monotonic()+ready_seconds
        original_fetch=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-readiness.py'))['fetch_owned_targets']
        def owned_fetch(port,seconds):
            assert main_guard();remaining(ready_deadline)
            try:return original_fetch(port,min(seconds,remaining(ready_deadline)))
            finally:
                assert main_guard();remaining(ready_deadline)
        target=readiness['wait_secondary_primary_target'](meta['cdpPort'],prefix,main_guard,persist,seconds=ready_seconds,fetch=owned_fetch)
        facts['primaryTarget']={'id':target['id'],'type':target['type'],'ownedFilePrefix':prefix};assert main_guard()
        assert remaining(work_deadline)>=20,'Insufficient full original10s+reap/observer budget'
        workspace=root/'packaged-workspace';workspace.mkdir(mode=0o700);subprocess.run(['git','init','--quiet',str(workspace)],check=True,timeout=min(2,remaining(work_deadline)))
        with f.lock:cursor=len(f.events)
        command_deadline=min(time.monotonic()+15,work_deadline)
        def observe(thread):
            end=command_deadline
            while thread.is_alive()and time.monotonic()<end:
                with f.lock:rows=list(f.events[cursor:])
                starts=[row for row in rows if row.get('event')=='workspace-secondary-started']
                if starts:
                    assert len(starts)==1 and starts[0]['primaryPid']==main_pid
                    secondary=starts[0]['secondaryPid'];known.add(secondary)
                    try:facts['secondaryActor']=read_actor(secondary,executable,work_deadline)
                    except Exception as error:facts['secondaryActorObservationError']={'type':type(error).__name__}
                    return
                time.sleep(.01)
        outcome=command_outcome(lambda:f.command('openWorkspace',remaining(command_deadline),workspacePath=str(workspace)),observe,command_deadline)
        original_error=outcome.pop('_exception',None);facts['secondaryCommand']=outcome
        with f.lock:events=[row for row in f.events[cursor:]if row.get('event')in ['workspace-secondary-started','workspace-secondary-exit']]
        facts['secondaryEvents']=events
        starts=[row for row in events if row['event']=='workspace-secondary-started'];exits=[row for row in events if row['event']=='workspace-secondary-exit'];assert len(starts)==len(exits)==1
        known.add(starts[0]['secondaryPid']);assert starts[0]['secondaryPid']==exits[0]['secondaryPid']and starts[0]['primaryPid']==exits[0]['primaryPid']==main_pid
        parser=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-log.py'));facts['phases']=parser['read_owned_single_instance_phases'](ROOT,profile,events)
        after=f.command('secondaryDiagnosticSnapshot',min(5,remaining(work_deadline)))['facts'];zero_delta(before,after);facts['after']=after
        assert main_guard();facts['primaryAfter']=read_actor(main_pid,executable,work_deadline,main_birth)
        assert facts['secondaryCommand']['threadClosed']and 'result'in facts['secondaryCommand']and 'observerError'not in facts['secondaryCommand']
        assert 'secondaryActor'in facts,'Secondary kernel identity not observed; do not infer from logs'
        assert exits[0]['exit']['code']==0 and not exits[0]['timedOut']and exits[0]['primaryStillExists']
        remaining(work_deadline)
        facts['status']='passed-secondary-diagnostic-only'
    except BaseException as error:
        cause=original_error if original_error is not None else error
        facts['failure']=type(cause).__name__+': '+str(cause)[:300]
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
        for port in {meta.get('cdpPort'),*[urlparse(meta.get(key,'')).port for key in ['origin','backendOrigin','supplierOrigin']]}-{None}:
            with socket.socket()as connection:connection.settimeout(.3);ports[str(port)]=connection.connect_ex(('127.0.0.1',port))!=0
        if not all(absent.values())or not all(ports.values()):errors.append('owned-resource-not-closed')
        elapsed=time.monotonic()-started
        if elapsed>120:errors.append('case-exceeded120s')
        facts['elapsedSeconds']=elapsed;facts['cleanup']={'errors':errors,'pidsAbsent':absent,'portsClosed':ports}
        if errors:facts['status']='failed'
        (evidence/'result.json').write_text(json.dumps(facts,indent=2)+'\n')
    print(json.dumps({'status':facts['status'],'failure':facts.get('failure'),'elapsedSeconds':facts['elapsedSeconds'],'cleanup':facts['cleanup']}))
    return facts['status']=='passed-secondary-diagnostic-only'
def run(args):
    plan=json.loads(args.preparation.read_text());assert plan['profile']==PROFILE and args.preparation.resolve()==ROOT/'data/sandbox-verification'/PROFILE/'preparation.json'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']and digest(__file__)==plan['driverSha256']
    runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-probe.py'))['validate_original_clock_profile'](PROFILE)
    code="import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{validateSecondaryProfile,deriveSecondaryFixture}from'./scripts/fixtures/macos-x64-secondary-derived.mjs';validateSecondaryProfile(process.argv[1]);console.log(createHash('sha256').update(deriveSecondaryFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'))).digest('hex'));"
    actual=subprocess.run([NODE,'--input-type=module','-e',code,PROFILE],cwd=ROOT,check=True,capture_output=True,text=True,timeout=10).stdout.strip();assert actual==plan['fixtureDerivedSha256']and digest(plan['compiledFixturePath'])==actual
    variant=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-secondary-readiness.py'));derived=variant['deriveSecondaryReadiness']((ROOT/'scripts/tests/macos-x64-readiness.py').read_text());assert hashlib.sha256(derived.encode()).hexdigest()==plan['derivedReadinessSha256']
    if not args.run:print(json.dumps({'status':'prepared-not-run','profile':PROFILE}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation);return run_case(plan)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args())else 1)
