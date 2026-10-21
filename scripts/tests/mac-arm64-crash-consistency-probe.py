"""Original warm5 plus an explicitly limited Main SIGKILL observation; no run without review."""

import argparse, ast, copy, hashlib, json, os, runpy, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-consistency-v4-20261021"
BASE = ROOT / "scripts/tests/macos-clock-probe.py"
COLD = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-cold-consistency-probe.py"))
for _name in [
    "ui_expression",
    "mapped_database",
    "stable_local",
    "absent",
    "wait_renderer",
    "assert_backend_baseline",
]:
    globals()[_name] = COLD[_name]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


CRASH_SLICE = """
        before_ui=until(ui_expression(),'Completed task visible before actual crash',30)
        assert before_ui['identity']=='企业用户甲' and before_ui['model']==meta['modelId'] and before_ui['userVisible'] and before_ui['assistantVisible']
        cold_db,cold_db_bindings=mapped_database(observations['packagedCli'],root,workspace)
        before_local,before_ui=stable_local(root,workspace,bridge,cold_db,before_ui['taskId'])
        selection=before_local['semantic']['modelSelection']
        assert selection and selection['providerId']=='ucas' and selection['modelId']==meta['modelId'] and selection.get('options',{}).get('reasoningLevel')==before_ui['reasoning']
        before_backend=f.command('macCrashSnapshot',30,phase='before-crash')['facts']
        assert_backend_baseline(before_backend,delivered,meta['modelId'])
        observations['crashBefore']={'ui':before_ui,'local':before_local,'backend':before_backend,'databaseKernelBindings':cold_db_bindings,'pty':observations['pty']}
        required=[shell_pid,*[row['pid'] for row in observations['packagedCli']]]
        try:
            crashed=f.command('macCrashMain',45,requiredPids=required)['facts']
        except BaseException:
            captured=evidence/'crash-owned-generation-before.json'
            if captured.exists():
                capture=json.loads(captured.read_text());known.update(row['pid'] for row in capture['rows'])
                observations['crashFailureExactCleanup']=f.command('macCrashCleanup',45)['facts']
            raise
        assert crashed['exit']=={'code':None,'signal':'SIGKILL'} and crashed['capture']['mainPid']==launched['pid'] and crashed['capture']['groupId']==launched['pid']
        prior={row['pid'] for row in crashed['capture']['rows']};known.update(prior)
        observations['crashSignal']=crashed
        bridge.kill()
        crashed_harness=json.loads((evidence/'harness-cleanup.json').read_text())
        assert crashed_harness['daemonAbsent'] and crashed_harness['socketClosed'];bridge=None
        deadline=time.monotonic()+5
        while not absent(prior) and time.monotonic()<deadline:time.sleep(.1)
        residual=[]
        for pid in sorted(prior):
            try:os.kill(pid,0);residual.append(pid)
            except ProcessLookupError:pass
        observation={'observationSeconds':5,'priorPids':sorted(prior),'residualBeforeAnyCleanup':residual,'allOldGenerationGone':not residual,'harness':crashed_harness,'scope':'actual SIGKILL; no recovery/new task/seat/logout executed in this limited slice'}
        (evidence/'crash-original-observation.json').write_text(json.dumps(observation,indent=2)+'\\n')
        observations['crashObservation']=observation
        try:
            observations['crashPostBackend']=f.command('macCrashSnapshot',30,phase='post-crash')['facts']
            assert proof()==delivered
        finally:
            if residual:observations['crashResidualExactCleanup']=f.command('macCrashCleanup',45)['facts']
        assert not residual,'Original crash left prior Host/CLI/PTY generation; cleanup does not change this FAILED result'
        checks.append('actual-main-sigkill-owned-generation-disappearance-zero-replay')
        facts['scope']='crash-observation-only'
        facts['originalSevenAccepted']=False
        facts['scopeOmissions']=['same-profile recovery','recovery old-task UI/readonly semantics','new-task after recovery','original seat/logout/cold after new-task baseline']
        facts['status']='passed-crash-observation-only'
"""


def deriveCrashProbe(source):
    anchor = "        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n"
    assert source.count(anchor) == 1
    tailstart = "        f.command('memberSeat', value=False)"
    tailend = "        facts['status'] = 'passed'"
    assert source.count(tailstart) == source.count(tailend) == 1
    start = source.index(tailstart)
    end = source.index(tailend, start) + len(tailend)
    source = source[:start] + source[end:]
    source = source.replace(anchor, anchor + CRASH_SLICE)
    attach = "        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)"
    assert source.count(attach) == 1
    source = source.replace(
        attach,
        "        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence, renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')",
    )
    outcome = "    return facts['status'] == 'passed'"
    assert source.count(outcome) == 1
    return source.replace(
        outcome, "    return facts['status'] == 'passed-crash-observation-only'"
    )


def validate_original_profile(profile):
    assert profile == PROFILE
    tree = ast.parse(BASE.read_text())
    body = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
    ).body[:2]
    assert all(isinstance(n, ast.Assert) for n in body)
    fn = ast.FunctionDef(
        name="check",
        args=ast.arguments(
            posonlyargs=[],
            args=[ast.arg(arg="profile")],
            kwonlyargs=[],
            kw_defaults=[],
            defaults=[],
        ),
        body=copy.deepcopy(body),
        decorator_list=[],
    )
    scope = {}
    exec(
        compile(
            ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
            str(BASE),
            "exec",
        ),
        scope,
    )
    scope["check"](profile)


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    validate_original_profile(plan["profile"])
    for path, expected in plan["sources"].items():
        assert digest(ROOT / path) == expected, path
    assert digest(plan["manifestPath"]) == plan["manifestSha256"]
    derived = deriveCrashProbe(BASE.read_text())
    compile(derived, str(BASE), "exec")
    assert hashlib.sha256(derived.encode()).hexdigest() == plan["derivedClockSha256"]
    if not args.run:
        print(
            json.dumps(
                {
                    "status": "prepared-not-run",
                    "scope": "crash-observation-only",
                    "profile": PROFILE,
                }
            )
        )
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    assert (
        not (ROOT / "data" / PROFILE).exists()
        and not (ROOT / "evidence" / PROFILE).exists()
    )
    scope = {
        "__file__": str(BASE),
        "__name__": "owned_crash_observation",
        **{
            name: globals()[name]
            for name in [
                "ui_expression",
                "mapped_database",
                "stable_local",
                "absent",
                "wait_renderer",
                "assert_backend_baseline",
            ]
        },
    }
    exec(compile(derived, str(BASE), "exec"), scope)
    original = subprocess.Popen

    def owned_popen(command, *positional, **kwargs):
        if isinstance(command, list) and command[-1:] == [
            "scripts/fixtures/macos-clock-derived.mjs"
        ]:
            assert (
                kwargs.get("cwd") == ROOT
                and kwargs["env"]["UWORK_NATIVE_FIXTURE_NAME"] == PROFILE
            )
            command = command[:-1] + [
                "scripts/fixtures/mac-arm64-crash-consistency-derived.mjs"
            ]
        return original(command, *positional, **kwargs)

    subprocess.Popen = owned_popen
    try:
        return scope["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.Popen = original


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preparation", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(parser.parse_args()) else 1)
