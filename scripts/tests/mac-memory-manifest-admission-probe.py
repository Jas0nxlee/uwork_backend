"""Fresh v16 false/true cases; no launch unless an exact reviewed real-artifact plan is supplied."""
import argparse, hashlib, json, runpy, subprocess, select
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
N = runpy.run_path(str(ROOT / 'scripts/tests/mac-memory-manifest-filesystem-denied-probe.py'))
BASE = N['BASE']
PROFILES = {'deny':'client-native-packaged-macos-clock-arm64-memory-manifest-admission-false-v1-20261021','allow':'client-native-packaged-macos-clock-arm64-memory-manifest-admission-true-v1-20261021'}

def deriveAdmissionProbe(original, mode):
    assert mode in PROFILES
    source = N['deriveManifestProbe'](original)
    old = 'scripts/fixtures/mac-memory-manifest-filesystem-denied.mjs'
    assert source.count(old) == 1
    source = source.replace(old, 'scripts/fixtures/mac-memory-manifest-admission-derived.mjs')
    if mode == 'allow':
        pairs = [("updated['modelCalls']<=6", "updated['modelCalls']<=7"), ("updated['own']['settled']==4", "updated['own']['settled']==5"), ("{'count':4,'settled':4,'amount':88,'inputTokens':48,'outputTokens':40}", "{'count':5,'settled':5,'amount':110,'inputTokens':60,'outputTokens':50}"), ("updated['modelCalls']==6", "updated['modelCalls']==7"), ("'explicit-filesystem-false-native-memory-manifest-withheld-no-extract-normal-text-accounting'", "'filesystem-true-native-topic-manifest-natural-sidecar-exact-description-no-writes'")]
        for a,b in pairs:
            assert source.count(a)==1, a
            source=source.replace(a,b)
    return source

def create_admission_namespace(source,budget):
    return N['create_manifest_namespace'](source,budget)

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def run(args):
    plan=json.loads(args.preparation.read_text());mode=plan['mode'];assert mode in PROFILES and plan['profile']==PROFILES[mode]
    assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/PROFILES[mode]/'preparation.json'
    for path,h in plan['sources'].items():assert digest(ROOT/path)==h,path
    assert digest(plan['manifestPath'])==plan['manifestSha256'] and digest(__file__)==plan['driverSha256']
    source=deriveAdmissionProbe(BASE.read_text(),mode);assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256'];compile(source,'actual-manifest-admission','exec')
    if not args.run:
        print(json.dumps({'status':'prepared-not-run','profile':PROFILES[mode]}));return True
    assert args.reviewed_plan_sha256==digest(args.preparation)
    budget=N['MemoryCaseBudget']();ns=create_admission_namespace(source,budget);N['verify_globals'](ns)
    old_run,old_select=subprocess.run,select.select
    subprocess.run=lambda *a,**k:budget.subprocess(old_run,*a,**k)
    select.select=lambda *a,**k:budget.select(old_select,*a,**k)
    try:return ns['run'](PROFILES[mode],Path(plan['manifestPath']))
    finally:subprocess.run=old_run;select.select=old_select

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--preparation',type=Path,required=True);p.add_argument('--run',action='store_true');p.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(p.parse_args()) else 1)
