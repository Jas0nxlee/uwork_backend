"""Original deb protocol driver; vary only one owned outer Docker seccomp profile."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[3]
NAME = 'client-linux-desktop-deb-userns-v5-20261020'
CONTAINER = 'uwork-' + NAME
IMAGE = 'uwork-linux-desktop-installed:20261020-v4-async'
DOCKER = ['docker', '--context', 'colima-uwork-backend']
AUDIT = REPO / 'evidence/client-linux-deb-protocol-v4-20261020'
original_run = subprocess.run
facts = {'status': 'failed', 'injectedLaunches': 0, 'onlyOuterSeccompRelaxed': True,
         'productFlagsUnchanged': True, 'desktopUnchanged': True}

# This sampler only reads this container's kernel metadata. It does not infer a
# renderer role from inherited zygote argv or pretend the first --no-sandbox
# renderer is a positive sandbox case.
SAMPLER = r'''
const fs=require('node:fs');const out='/work/userns-kernel.json';const seen=new Map();const started=Date.now();let samples=0;
function sample(){samples++;for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).slice(0,512)){try{
 const executable=fs.readlinkSync('/proc/'+pid+'/exe');if(executable!=='/opt/UWork Preview/zcode-preview')continue;
 const status=fs.readFileSync('/proc/'+pid+'/status','utf8'),fields={};for(const k of ['Name','PPid','Uid','Gid','NSpid','NoNewPrivs','Seccomp','Seccomp_filters','CapEff'])fields[k]=status.match(new RegExp('^'+k+':\\s*(.*)$','m'))?.[1];
 const namespaces={};for(const k of ['pid','user','net'])try{namespaces[k]=fs.readlinkSync('/proc/'+pid+'/ns/'+k)}catch(e){namespaces[k]={unavailable:e.code}}
 const row={pid:Number(pid),executable,args:fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').filter(Boolean),fields,namespaces};
 if(!seen.has(pid))seen.set(pid,{firstSeenMs:Date.now()-started,first:row});const known=seen.get(pid);known.lastSeenMs=Date.now()-started;known.last=row;
 }catch{}}
 if(samples%5===0)fs.writeFileSync(out,JSON.stringify({samples,elapsedMs:Date.now()-started,processes:[...seen.values()]},null,2));
 if(Date.now()-started>65000){clearInterval(timer);fs.writeFileSync(out,JSON.stringify({samples,elapsedMs:Date.now()-started,processes:[...seen.values()]},null,2));}}
const timer=setInterval(sample,100);sample();
'''


def scoped_run(args, *positional, **kwargs):
    if isinstance(args, list) and args[:3] == DOCKER and len(args) > 4 and args[3:5] == ['run', '-d'] and '--name' in args:
        actual_name = args[args.index('--name') + 1]
        if actual_name == CONTAINER:
            assert facts['injectedLaunches'] == 0
            assert IMAGE in args and '--user' in args and args[args.index('--user') + 1] == '1000:1000'
            assert 'no-new-privileges' in args and 'ALL' in args and '--privileged' not in args
            args = args[:5] + ['--security-opt', 'seccomp=unconfined'] + args[5:]
            facts['injectedLaunches'] += 1
            facts['actualLaunchArguments'] = args
            result = original_run(args, *positional, **kwargs)
            if result.returncode == 0:
                inspected = original_run(DOCKER + ['inspect', CONTAINER], capture_output=True, text=True, check=True)
                config = json.loads(inspected.stdout)[0]
                facts['actualOuterContainer'] = {'user': config['Config']['User'],
                    'securityOpt': config['HostConfig']['SecurityOpt'], 'capDrop': config['HostConfig']['CapDrop'],
                    'privileged': config['HostConfig']['Privileged'], 'readonlyRootfs': config['HostConfig']['ReadonlyRootfs'],
                    'imageId': config['Image']}
                sampler = original_run(DOCKER + ['exec', '-d', '--user', '1000:1000', CONTAINER, 'node', '-e', SAMPLER],
                    capture_output=True, text=True, check=True)
                facts['samplerStarted'] = sampler.returncode == 0
            return result
    return original_run(args, *positional, **kwargs)


try:
    for relative in ['scripts/tests/linux-desktop/probe.py', 'scripts/tests/linux-desktop/protocol.py', 'scripts/tests/linux-desktop/backend.mjs']:
        facts.setdefault('originalSourceSha256', {})[relative] = hashlib.sha256((REPO / relative).read_bytes()).hexdigest()
    module = runpy.run_path(str(REPO / 'scripts/tests/linux-desktop/probe.py'))
    subprocess.run = scoped_run
    ok = module['run'](NAME, installed=True, ordinary_user=True, test_image=IMAGE,
                       protocol_only=True, window_manager=True, protocol_hold_seconds=25)
    assert facts['injectedLaunches'] == 1
    facts['status'] = 'passed' if ok else 'failed'
finally:
    subprocess.run = original_run
    kernel = REPO / 'data/sandbox-verification' / NAME / 'work/userns-kernel.json'
    if kernel.exists():
        shutil.copyfile(kernel, AUDIT / 'userns-kernel.json')
    (AUDIT / 'userns-comparison-controller.json').write_text(json.dumps(facts, indent=2) + '\n')

raise SystemExit(0 if facts['status'] == 'passed' else 1)
