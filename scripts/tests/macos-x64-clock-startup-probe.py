"""Versioned profile-only replay of original v9 x64 seven-check startup-log diagnostic."""
import argparse,ast,copy,hashlib,json,runpy,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-x64-startup-probe.py'
CLOCK=ROOT/'scripts/tests/macos-clock-probe.py'
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def deriveClockStartupProbe(source):
    replacements={"'scripts/tests/macos-x64-startup-log.py'":"'scripts/tests/macos-x64-clock-startup-log.py'","['scripts/fixtures/macos-x64-startup-derived.mjs']":"['scripts/fixtures/macos-x64-clock-startup-derived.mjs']"}
    for before,after in replacements.items():
        assert source.count(before)==1
        source=source.replace(before,after)
    return source
def validate_original_clock_profile(profile):
    tree=ast.parse(CLOCK.read_text());function=next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='run')
    body=function.body[:2];assert all(isinstance(node,ast.Assert)for node in body)
    wrapper=ast.FunctionDef(name='check',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='profile')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(body),decorator_list=[])
    namespace={};exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper],type_ignores=[])),str(CLOCK),'exec'),namespace);namespace['check'](profile)
    return profile
def validate_variant_guards(profile):
    validate_original_clock_profile(profile)
    parser=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-clock-startup-log.py'));parser['validate_clock_startup_profile'](profile)
    code="import {validateClockStartupProfile} from './scripts/fixtures/macos-x64-clock-startup-derived.mjs';validateClockStartupProfile(process.argv[1]);"
    subprocess.run([NODE,'--input-type=module','-e',code,profile],cwd=ROOT,capture_output=True,text=True,check=True,timeout=10)
    return profile
def run(args):
    plan=json.loads(args.preparation.read_text());assert args.preparation.resolve()==ROOT/'data/sandbox-verification'/plan['profile']/'preparation.json'
    assert plan['profile']=='client-native-packaged-macos-clock-x64-startup-v2-20261021'
    for path,expected in plan['sources'].items():assert digest(ROOT/path)==expected,path
    assert digest(plan['manifestPath'])==plan['manifestSha256']
    validate_variant_guards(plan['profile'])
    source=deriveClockStartupProbe(BASE.read_text());compile(source,str(BASE),'exec')
    assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256']
    namespace={'__file__':str(BASE),'__name__':'owned_clock_startup_probe'}
    exec(compile(source,str(BASE),'exec'),namespace)
    return namespace['run'](args)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args())else 1)
