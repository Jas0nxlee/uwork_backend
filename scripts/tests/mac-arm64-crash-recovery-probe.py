"""Original warm7 plus actual Main crash/recovery zero-replay and a new UI task."""

import argparse, ast, copy, hashlib, json, os, runpy, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-consistency-v5-20261021"
MARKER = "MACOS_CRASH_RECOVERED_NEW_TASK_20261021"
BASE = ROOT / "scripts/tests/macos-clock-probe.py"
CRASH = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-crash-consistency-probe.py"))
COLD = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-cold-consistency-probe.py"))
CAP = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-model-capability-probe.py"))
for _name in [
    "ui_expression",
    "mapped_database",
    "stable_local",
    "absent",
    "wait_renderer",
    "assert_backend_baseline",
]:
    globals()[_name] = CRASH[_name]
cold_identity_expression = COLD["cold_identity_expression"]
cap_ui = CAP["cap_ui"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


RECOVERY_SLICE = """
        crashed_main_pid=launched['pid']
        prior_mains={row['pid'] for row in f.events if row.get('event')=='launched'}
        f.send({'op':'launch'})
        recovered=f.wait_event(lambda row:row.get('event')=='launched' and row.get('pid')not in prior_mains,120,'same-profile original launch after actual Main crash')
        bridge=attach(recovered)
        until(cold_identity_expression(),'Recovered logged-in original identity',60)
        restored=bridge.evaluate(ui_expression(before_ui['taskId']))
        if not restored.get('ok'):click('[data-testid="task-item-'+before_ui['taskId']+'"]','post-crash-original-open-task-A')
        until(ui_expression(before_ui['taskId']),'Original completed task A after crash',45)
        recovered_local,recovered_ui=stable_local(root,workspace,bridge,cold_db,before_ui['taskId'])
        assert recovered_ui==before_ui and recovered_local['semantic']==before_local['semantic'],'Original task semantics changed after real crash'
        recovered_backend=f.command('macCrashSnapshot',30,phase='post-recovery')['facts']
        assert recovered_backend['bootstrapActor']==before_backend['bootstrapActor']
        for field in ['identity','configurations','policies','tenantModelDefinitions','subscription','memberLimit']:
            assert recovered_backend['snapshot']['actors']['current'][field]==before_backend['snapshot']['actors']['current'][field],field
        assert proof()==delivered
        observations['crashRecovered']={'ui':recovered_ui,'local':recovered_local,'backend':recovered_backend,'initialMainPid':crashed_main_pid,'recoveredMainPid':recovered['pid'],'sameControllerPid':f.child.pid,'sameProfile':str(root),'oldGenerationAlreadyGone':True}
        checks.append('actual-main-sigkill-same-profile-completed-task-recovery-zero-replay')
        click('[data-testid="enterprise-menu-chat"]','post-crash-original-new-task-B')
        draft=until(cap_ui(MARKER,[before_ui['taskId']],True),'Original post-crash draft B',45)
        assert draft['workspace']==workspace.name and draft['identity']=='企业用户甲'
        if draft['model']!=meta['modelId']:
            click('[data-testid="chat-model-select-trigger"]','post-crash-model-picker')
            click('[data-testid="chat-model-select-group-registry-provider:ucas"]','post-crash-provider-menu')
            click('[data-testid='+json.dumps('chat-model-select-item-custom:ucas:'+meta['modelId'])+']','post-crash-select-original-model')
        draft=until(cap_ui(MARKER,[before_ui['taskId']],True,meta['modelId']),'Post-crash B model/reasoning ready',20)
        assert draft['thought']=='none'
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]','post-crash-new-B-original-composer')
        bridge.raw_cdp('Input.insertText',text=MARKER+' 请简短回复，不调用工具。')
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]','post-crash-new-B-original-send')
        task_b=until(cap_ui(MARKER,[before_ui['taskId']],False,meta['modelId']),'Original post-crash B completed',75)
        assert task_b['taskId']!=before_ui['taskId'] and task_b['taskId'].startswith('sess_')
        settled=time.monotonic()+35
        while time.monotonic()<settled:
            updated=proof();assert updated['modelCalls']<=6
            if updated['own']['settled']==4:break
            time.sleep(.2)
        assert updated['own']=={'count':4,'settled':4,'amount':88,'inputTokens':48,'outputTokens':40} and updated['modelCalls']==6
        assert updated['other']==baseline['other'] and updated['modelWorkingDirectories']==[str(workspace)]
        recovered_rows=OLD['owned_processes'](recovered['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in recovered_rows)
        recovered_cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,recovered_rows)
        assert recovered_cli and all(row['pid']not in prior for row in recovered_cli)
        recovered_kernel=f.command('macRecoveryGeneration',45,requiredPids=[row['pid']for row in recovered_cli])['facts']
        assert recovered_kernel['mainPid']==recovered['pid']
        known.update(row['pid']for row in recovered_kernel['rows'])
        for cli in recovered_cli:
            bound=next(row for row in recovered_kernel['rows']if row['pid']==cli['pid']);assert bound['executable'].startswith(meta['packagedRuntime']['appPath']+'/') and bound['birth']
        new_db,new_bindings=mapped_database(recovered_cli,root,workspace);assert new_db==cold_db
        b_local,b_ui=stable_local(root,workspace,bridge,new_db,task_b['taskId'])
        assert b_local['semantic']['sessionId']==task_b['taskId'] and b_local['semantic']['modelSelection']==before_local['semantic']['modelSelection']
        assert MARKER in json.dumps(b_local['semantic']['messages'],ensure_ascii=False)
        click('[data-testid="task-item-'+before_ui['taskId']+'"]','post-B-original-open-old-task-A')
        until(ui_expression(before_ui['taskId']),'Task A original UI after B',45)
        final_a,final_a_ui=stable_local(root,workspace,bridge,new_db,before_ui['taskId'])
        assert final_a['semantic']==before_local['semantic'] and final_a_ui==before_ui
        click('[data-testid="task-item-'+task_b['taskId']+'"]','post-B-original-back-to-B')
        final_b_ui=until(cap_ui(MARKER,[before_ui['taskId']],False,meta['modelId']),'Return to real task B before original seat test',45)
        assert final_b_ui['taskId']==task_b['taskId']
        new_backend=f.command('macCrashSnapshot',30,phase='post-new-task')['facts']
        assert new_backend['supplier']['main']['toolCount']==32 and new_backend['supplier']['main']['cwdMatches']
        assert proof()==updated
        observations['postCrashNewTask']={'uiDraft':draft,'ui':task_b,'local':b_local,'newCli':recovered_cli,'newKernelGeneration':recovered_kernel,'actualDatabaseBindings':new_bindings,'backend':new_backend,'oldTaskUnchanged':True,'oldTaskAfterNewLocal':final_a,'accounting':updated}
        delivered=updated
        launched=recovered
        recovery_prior_mains={row['pid']for row in f.events if row.get('event')=='launched'}
        checks.append('post-crash-original-new-task-and-accounting-old-task-unchanged')
"""


def deriveCrashRecoveryProbe(source):
    stop = "        facts['scope']='crash-observation-only'"
    assert CRASH["CRASH_SLICE"].count(stop) == 1
    crash = CRASH["CRASH_SLICE"][: CRASH["CRASH_SLICE"].index(stop)]
    oldcheck = "        checks.append('actual-main-sigkill-owned-generation-disappearance-zero-replay')\n"
    assert crash.count(oldcheck) == 1
    crash = crash.replace(oldcheck, "")
    crash = crash.replace(
        "actual SIGKILL; no recovery/new task/seat/logout executed in this limited slice",
        "actual SIGKILL observation before same-profile recovery",
    )
    anchor = "        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n"
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor + crash + RECOVERY_SLICE)
    attach = "        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)"
    assert source.count(attach) == 1
    source = source.replace(
        attach,
        "        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence, renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')",
    )
    predicate = "row.get('pid') != launched['pid']"
    assert source.count(predicate) == 1
    source = source.replace(predicate, "row.get('pid') not in recovery_prior_mains")
    return source


def validate_original_profile(profile):
    assert profile == PROFILE
    tree = ast.parse(BASE.read_text())
    body = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "run"
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
    derived = deriveCrashRecoveryProbe(BASE.read_text())
    compile(derived, str(BASE), "exec")
    assert hashlib.sha256(derived.encode()).hexdigest() == plan["derivedClockSha256"]
    if not args.run:
        print(
            json.dumps(
                {
                    "status": "prepared-not-run",
                    "scope": "actual-crash-recovery-and-new-task",
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
        "__name__": "owned_crash_recovery",
        **{
            name: globals()[name]
            for name in [
                "ui_expression",
                "mapped_database",
                "stable_local",
                "absent",
                "wait_renderer",
                "assert_backend_baseline",
                "cold_identity_expression",
                "cap_ui",
                "MARKER",
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
                "scripts/fixtures/mac-arm64-crash-recovery-derived.mjs"
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
