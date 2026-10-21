"""Warm five checks and one explicit-FS=false Memory negative. Not original-seven acceptance."""

import argparse, hashlib, json, runpy, subprocess, select, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = (
    "client-native-packaged-macos-clock-arm64-memory-filesystem-denied-v4-20261021"
)
A = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-extraction-probe.py"))
M = A["M"]
BASE = M["BASE"]
MemoryCaseBudget = M["MemoryCaseBudget"]
verify_globals = A["verify_globals"]
DENIED_LABEL = "UWORK_NATIVE_MEMORY_FILESYSTEM_DENIED_20261021"
NEGATIVE_SLICE = """
        def deny_status():
            current=f.command('memoryFilesystemStatus',min(3,memory_budget_left(memory_work_end)))['facts']
            observations['memoryFilesystemLatest']=current
            if current['bodyEscaped']:
                (evidence/'memory-filesystem-failure-observation.json').write_text(json.dumps(current,indent=2)+'\\n')
                raise AssertionError('MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE')
            return current
        def denied_until(expression,label,seconds):
            end=min(memory_work_end,time.monotonic()+seconds)
            while time.monotonic()<end:
                deny_status()
                value=bridge.evaluate(expression);memory_budget_left(end)
                if value.get('ok'):return value
                time.sleep(.1)
            raise AssertionError(label)
        deny_status()
        click('[data-testid="task-settings-button"]','memory-denied-original-settings')
        click('[data-testid="settings-section-nav-memory"]','memory-denied-original-section')
        ui=until(settings_projection(),'Original Memory settings before denial',10)
        if not ui['checked']:click('[data-testid="settings-memory-switch"]','memory-denied-enable-once')
        until(expect(settings_projection(),'v.checked'),'Original Memory on acknowledgement',8)
        setting_end=min(memory_work_end,time.monotonic()+5)
        while time.monotonic()<setting_end:
            persisted=json.loads((root/'data/.uwork/v2/setting.json').read_text())
            if persisted.get('memoryEnabled') is True:break
            time.sleep(.05)
        assert persisted.get('memoryEnabled') is True
        observations['memoryFilesystemSetting']={'uiEnabled':True,'persistedEnabled':True}
        click('[data-testid="settings-back-button"]','memory-denied-original-back')
        click('[data-testid="enterprise-menu-chat"]','memory-denied-original-new-task')
        prior=[warm_ui['taskId']]
        draft=until(cap_ui(DENIED_LABEL,prior,True),'Memory-denied original draft',12)
        if draft['model']!=meta['modelId']:
            click('[data-testid="chat-model-select-trigger"]','memory-denied-picker')
            click('[data-testid="chat-model-select-group-registry-provider:ucas"]','memory-denied-provider')
            click('[data-testid='+json.dumps('chat-model-select-item-custom:ucas:'+meta['modelId'])+']','memory-denied-model')
        draft=until(cap_ui(DENIED_LABEL,prior,True,meta['modelId']),'Memory-denied same-model draft',10)
        assert draft['workspace']=='packaged-workspace' and draft['thought']=='none'
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]','memory-denied-composer')
        bridge.raw_cdp('Input.insertText',text=DENIED_LABEL)
        click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]','memory-denied-send-once')
        task=denied_until(cap_ui(DENIED_LABEL,prior,False,meta['modelId']),'Memory-denied actual completed task',25)
        end=min(memory_work_end,time.monotonic()+10)
        while time.monotonic()<end:
            deny_status();updated=proof();assert updated['modelCalls']<=6
            if updated['own']['settled']==4:break
            time.sleep(.1)
        assert updated['own']=={'count':4,'settled':4,'amount':88,'inputTokens':48,'outputTokens':40}
        assert updated['other']==baseline['other'] and updated['modelCalls']==6 and updated['modelWorkingDirectories']==[str(workspace)]
        rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows)
        cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows)
        db,bindings=mapped_database(cli,root,workspace);assert db==memory_db
        accepted=f.command('memoryFilesystemComplete',min(10,memory_budget_left(memory_work_end)),sessionId=task['taskId'],dbPath=db)['facts']
        rows_after=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows_after)
        cli_after=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,rows_after)
        db_after,bindings_after=mapped_database(cli_after,root,workspace);assert db_after==db and bindings_after==bindings
        assert accepted['file']['sha256']==file_sha and accepted['session']['originalSchedulerWouldExecute']==0
        observations['memoryFilesystemAccepted']={'ui':task,'draft':draft,'proof':accepted,'beforeBindings':bindings,'afterBindings':bindings_after}
        deny_status();memory_budget_left(memory_work_end)
        facts['scope']={'notOriginalSevenAcceptance':True,'originalWarmChecks':5,'negativeTasks':1,'seatLogoutColdNotRun':True}
        checks.append('explicit-filesystem-false-native-memory-body-withheld-and-normal-text-accounting')
"""


def deriveDeniedMemoryProbe(original):
    source = M["deriveMemoryProbe"](original)
    start = "        prior=[warm_ui['taskId']];observations['memoryStages']=[]"
    end = "        facts['status'] = 'passed'"
    assert source.count(start) == source.count(end) == 1
    a = source.index(start)
    b = source.index(end, a)
    block = NEGATIVE_SLICE
    lines = block.splitlines(True)
    for i in range(len(lines) - 1, -1, -1):
        if "bridge.raw_cdp('Input." in lines[i]:
            lines.insert(
                i,
                "                "[: len(lines[i]) - len(lines[i].lstrip())]
                + "memory_budget_left(memory_work_end)\n",
            )
    source = source[:a] + "".join(lines) + source[b:]
    old = "scripts/fixtures/mac-arm64-memory-derived.mjs"
    assert source.count(old) == 1
    source = source.replace(
        old, "scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs"
    )
    source = source.replace(
        "    facts = {'status': 'failed'",
        "    facts = {'scope':{'notOriginalSevenAcceptance':True,'warmFivePlusSingleNegative':True},'status': 'failed'",
        1,
    )
    return source


def create_denied_namespace(source, budget):
    ns = M["create_memory_namespace"](source, budget)
    ns["DENIED_LABEL"] = DENIED_LABEL
    ns["wait_renderer"] = A["make_auto_renderer"](budget)
    return ns


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert (
        plan["profile"] == PROFILE
        and args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, h in plan["sources"].items():
        assert digest(ROOT / path) == h, path
    assert (
        digest(plan["manifestPath"]) == plan["manifestSha256"]
        and digest(__file__) == plan["driverSha256"]
    )
    runpy.run_path(str(ROOT / "scripts/tests/macos-clock-profile.test.py"))["check"](
        PROFILE
    )
    source = deriveDeniedMemoryProbe(BASE.read_text())
    compile(source, "actual-memory-denied", "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = MemoryCaseBudget()
    ns = create_denied_namespace(source, budget)
    verify_globals(ns)
    old_run, old_select = subprocess.run, select.select
    subprocess.run = lambda *a, **k: budget.subprocess(old_run, *a, **k)
    select.select = lambda *a, **k: budget.select(old_select, *a, **k)
    try:
        return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.run = old_run
        select.select = old_select


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
