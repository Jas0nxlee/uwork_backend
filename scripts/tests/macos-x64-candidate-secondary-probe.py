"""Exact original single-secondary diagnostic, bound to the new x64 candidate."""
import argparse,hashlib,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/tests/macos-x64-secondary-probe.py'
NODE='/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
OLD_PROFILE='client-native-packaged-macos-clock-x64-startup-v6-20261021'
PROFILE='client-native-packaged-macos-clock-x64-startup-v7-20261021'
def deriveCandidateSecondaryProbe(source):
    assert source.count(OLD_PROFILE)==1
    before='scripts/fixtures/macos-x64-secondary-derived.mjs'
    assert source.count(before)==2
    return source.replace(OLD_PROFILE,PROFILE).replace(before,'scripts/fixtures/macos-x64-candidate-secondary-derived.mjs')
def run(args):
    plan=json.loads(args.preparation.read_text());assert plan['profile']==PROFILE
    source=deriveCandidateSecondaryProbe(BASE.read_text());compile(source,str(BASE),'exec')
    assert hashlib.sha256(source.encode()).hexdigest()==plan['derivedProbeSha256']
    namespace={'__file__':str(Path(__file__).resolve()),'__name__':'owned_candidate_secondary_probe'}
    exec(compile(source,str(BASE),'exec'),namespace)
    return namespace['run'](args)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--run',action='store_true');parser.add_argument('--reviewed-plan-sha256');raise SystemExit(0 if run(parser.parse_args())else 1)
