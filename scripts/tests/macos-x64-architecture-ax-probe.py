"""Private readonly AX diagnostic wrapper; no BH, secondary, UI action or model send."""

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-x64-startup-v10-20261021"
BASE = ROOT / "scripts/tests/macos-x64-secondary-probe.py"


def deriveArchitectureAXProbe(original):
    source = original[: original.index("\ndef run(args):")]

    def once(old, new):
        nonlocal source
        assert source.count(old) == 1, old
        source = source.replace(old, new)

    once(
        "PROFILE='client-native-packaged-macos-clock-x64-startup-v6-20261021'",
        "PROFILE=" + repr(PROFILE),
    )
    once(
        "scripts/fixtures/macos-x64-secondary-derived.mjs",
        "scripts/fixtures/macos-x64-architecture-ax-derived.mjs",
    )
    once("deadline=started+120", "deadline=started+90")
    once("'budgetSeconds':120", "'budgetSeconds':90")
    once("'Case120s budget exhausted'", "'Case90s budget exhausted'")
    once(
        "if elapsed>120:errors.append('case-exceeded120s')",
        "if elapsed>90:errors.append('case-exceeded90s')",
    )
    once("min(20,remaining(work_deadline,40))", "min(20,remaining(work_deadline,40))")
    guard_begin = source.index("        def main_guard():")
    guard_end = source.index("        readiness=runpy.run_path", guard_begin)
    guard_body = source[guard_begin:guard_end].replace(
        "work_deadline", "actor_deadline"
    )
    source = (
        source[:guard_begin]
        + "        actor_deadline=work_deadline\n"
        + guard_body
        + source[guard_end:]
    )
    begin = source.index("        assert remaining(work_deadline)>=20,")
    end = source.index(
        "        remaining(work_deadline)\n        facts['status']='passed-secondary-diagnostic-only'",
        begin,
    )
    source = (
        source[:begin]
        + """        assert remaining(work_deadline)>=8,'Insufficient AX5s plus snapshot budget'
        reader=runpy.run_path(str(ROOT/'scripts/tests/macos-x64-architecture-ax-reader.py'))
        ax_started=time.monotonic();actor_deadline=min(work_deadline,ax_started+5)
        try:
            native=reader['NativeOwnedReader'](main_pid)
            facts['architectureAX']=reader['observe_architecture_ax'](main_pid,native,main_guard,started_at=ax_started)
        except BaseException as error:
            facts['architectureAX']=getattr(error,'architectureAXReceipt',{'status':'failed-readonly','failureType':type(error).__name__})
            (evidence/'architecture-ax-observation.json').write_text(json.dumps(facts['architectureAX'],indent=2)+'\\n')
            raise
        finally:actor_deadline=work_deadline
        (evidence/'architecture-ax-observation.json').write_text(json.dumps(facts['architectureAX'],indent=2)+'\\n')
        assert {row['methodTimeoutSeconds']for row in facts['architectureAX']['reads']}=={.1,.75},'Both readonly timeout variants were not reached'
        after=f.command('secondaryDiagnosticSnapshot',min(3,remaining(work_deadline)))['facts'];zero_delta(before,after);facts['after']=after
        assert main_guard();facts['primaryAfter']=read_actor(main_pid,executable,work_deadline,main_birth)
"""
        + source[end:]
    )
    source = source.replace(
        "passed-secondary-diagnostic-only", "passed-readonly-ax-diagnostic-only"
    )
    # Definition-only execution: discard the old run/CLI. Its original guarded cleanup remains intact.
    assert "command_outcome(lambda:f.command('openWorkspace'" not in source
    assert "bh(" not in source and "AXPress" not in source
    return source


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert plan["profile"] == PROFILE
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, expected in plan["sources"].items():
        assert sha(ROOT / path) == expected, path
    assert (
        sha(plan["manifestPath"]) == plan["manifestSha256"]
        and sha(__file__) == plan["driverSha256"]
    )
    runpy.run_path(str(ROOT / "scripts/tests/macos-x64-clock-startup-probe.py"))[
        "validate_original_clock_profile"
    ](PROFILE)
    source = deriveArchitectureAXProbe(BASE.read_text())
    assert (
        hashlib.sha256(source.encode()).hexdigest()
        == plan["derivedProbeSha256"]
        == sha(plan["compiledProbePath"])
    )
    ns = {"__file__": str(__file__), "__name__": "architecture_ax_derived"}
    exec(compile(source, str(__file__) + "[actual-derived]", "exec"), ns)
    code = "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{validateArchitectureAXProfile,deriveArchitectureAXFixture}from'./scripts/fixtures/macos-x64-architecture-ax-derived.mjs';validateArchitectureAXProfile(process.argv[1],{UWORK_NATIVE_CLIENT_EXPERIENCE:'enabled',UWORK_NATIVE_CONFIGURATION_WITNESS:'enabled',UWORK_NATIVE_PACKAGED_MANIFEST:process.argv[2]});console.log(createHash('sha256').update(deriveArchitectureAXFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'))).digest('hex'));"
    actual = subprocess.run(
        [ns["NODE"], "--input-type=module", "-e", code, PROFILE, plan["manifestPath"]],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    assert actual == plan["fixtureDerivedSha256"] == sha(plan["compiledFixturePath"])
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == sha(args.preparation)
    return ns["run_case"](plan)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preparation", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(parser.parse_args()) else 1)
