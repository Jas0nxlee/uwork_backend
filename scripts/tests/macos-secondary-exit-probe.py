"""Original seven UI checks against new sealed ARM/x64 candidate; no run without exact review."""
import argparse,hashlib,json,runpy,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-x64-startup-probe.py'
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
APPS={
 'x64':'/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v11-x64-secondary-exit/mac/UWork Preview.app',
 'arm64':'/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v12-arm64-secondary-exit/mac-arm64/UWork Preview.app',
}
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def deriveSecondaryExitProbe(source,arch):
    assert arch in APPS
    pairs=[
      ('/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v9-x64-startup-log/mac/UWork Preview.app',APPS[arch]),
      ("plan['target'] == 'darwin-x64'", "plan['target'] == 'darwin-"+arch+"'"),
      ("'scripts/tests/macos-x64-startup-log.py'","'scripts/tests/macos-secondary-exit-log.py'"),
      ("['scripts/fixtures/macos-x64-startup-derived.mjs']","['scripts/fixtures/macos-secondary-exit-derived.mjs']"),
    ]
    for before,after in pairs:
        assert source.count(before)==1,before
        source=source.replace(before,after)
    if arch=='x64':
        mapped_start="    def mapped(pid, role):"
        mapped_stop="    def capture_secondary(fixture):"
        assert source.count(mapped_start)==1 and source.count(mapped_stop)==1
        start=source.index(mapped_start);stop=source.index(mapped_stop,start)
        mapped=source[start:stop]
        assert mapped.count("check=True)")==3
        mapped=mapped.replace(mapped_start,"""    def mapped(pid, role, diagnostic_deadline=None):
        import time as diagnostic_time
        def diagnostic_options():
            if diagnostic_deadline is None:
                return {}
            remaining=diagnostic_deadline-diagnostic_time.monotonic()
            if remaining<=0:
                raise TimeoutError('Owned architecture diagnostic deadline exceeded')
            return {'timeout':min(.75,remaining)}""")
        mapped=mapped.replace("check=True)","check=True, **diagnostic_options())")
        assert mapped.count(".stdout.strip()\n")==2 and mapped.count(".stdout.splitlines()\n")==1
        mapped=mapped.replace(".stdout.strip()\n",".stdout.strip()\n        diagnostic_options()\n").replace(".stdout.splitlines()\n",".stdout.splitlines()\n        diagnostic_options()\n")
        source=source[:start]+mapped+source[stop:]
        guard_start="        def guard():"
        guard_stop="        number = len(facts.setdefault('rendererReadiness', []))"
        assert source.count(guard_start)==1 and source.count(guard_stop)==1
        start=source.index(guard_start);stop=source.index(guard_stop,start)
        guard=source[start:stop]
        guard=guard.replace(guard_start,"""        def guard(diagnostic_deadline=None):
            import time as diagnostic_time
            def diagnostic_options():
                if diagnostic_deadline is None:
                    return {}
                remaining=diagnostic_deadline-diagnostic_time.monotonic()
                if remaining<=0:
                    raise TimeoutError('Owned architecture diagnostic deadline exceeded')
                return {'timeout':min(.75,remaining)}
            diagnostic_options()""")
        assert guard.count("mapped(binding['pid'], 'renderer readiness guard')")==1
        guard=guard.replace("mapped(binding['pid'], 'renderer readiness guard')","mapped(binding['pid'], 'renderer readiness guard', diagnostic_deadline)\n            diagnostic_options()")
        assert guard.count("capture_output=True, text=True)")==1
        guard=guard.replace("capture_output=True, text=True)","capture_output=True, text=True, **diagnostic_options())\n            diagnostic_options()")
        source=source[:start]+guard+source[stop:]
        anchor="        target = readiness['wait_owned_renderer'](port, prefix, guard, persist, seconds=30)"
        assert source.count(anchor)==1
        dismissal="""
        architecture=runpy.run_path(str(ROOT/'scripts/tests/macos-architecture-warning-dismiss.py'))
        import time as architecture_time
        architecture_deadline=architecture_time.monotonic()+5
        warning=architecture['dismiss_owned_architecture_warning'](
            pid=binding['pid'],birth=binding['birth'],
            executable=str(APP/'Contents/MacOS/UWork Preview'),
            deadline=architecture_deadline,actor_guard=lambda:guard(architecture_deadline))
        facts.setdefault('architectureWarnings',[]).append(warning)
        save()
"""
        source=source.replace(anchor,anchor+"\n"+dismissal.rstrip())
    if arch=='arm64':
        source=source.replace("'mappedX64Files'","'mappedTargetFiles'")
        source=source.replace('darwin-x64/pty.node','darwin-arm64/pty.node').replace('cffaedfe07000001','cffaedfe0c000001').replace('x86_64 Mach-O','arm64 Mach-O').replace('frozen x64 NAPI addon','frozen arm64 NAPI addon').replace('Rosetta on Apple silicon; physical Intel not accepted','Native ARM64 on Apple silicon; no cross-platform claim')
    return source

def validate_secondary_exit_guards(profile,arch):
    assert arch in APPS
    old=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-probe.py'))
    old['validate_original_clock_profile'](profile)
    reader=runpy.run_path(str(ROOT/'scripts/tests/macos-secondary-exit-log.py'))
    reader['validate_secondary_exit_profile'](profile)
    code="import {validateSecondaryExitProfile} from './scripts/fixtures/macos-secondary-exit-derived.mjs';validateSecondaryExitProfile(process.argv[1],process.argv[2]);"
    subprocess.run([NODE,'--input-type=module','-e',code,profile,arch],cwd=ROOT,capture_output=True,text=True,check=True,timeout=10)
    return profile

def run(args):
    plan=json.loads(args.preparation.read_text());arch=plan['target'].removeprefix('darwin-')
    assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/plan['profile']/'preparation.json'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']
    validate_secondary_exit_guards(plan['profile'],arch)
    source=deriveSecondaryExitProbe(BASE.read_text(),arch);compile(source,str(BASE),'exec')
    assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256']
    namespace={'__file__':str(BASE),'__name__':'owned_secondary_exit_probe'}
    exec(compile(source,str(BASE),'exec'),namespace)
    return namespace['run'](args)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args()) else 1)
