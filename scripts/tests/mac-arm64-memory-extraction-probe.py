"""Thin derivation of frozen Memory controller: natural extraction A and fresh recall B."""

import argparse, ast, dis, builtins, types, hashlib, json, runpy, subprocess, select, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021"
M = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))
BASE = M["BASE"]
MemoryCaseBudget = M["MemoryCaseBudget"]
cap_ui = M["cap_ui"]
expect = M["expect"]
mapped_database = M["mapped_database"]
memory_budget_left = M["memory_budget_left"]
assert_backend_baseline = M["assert_backend_baseline"]
AUTO_BODY = "UWORK_NATIVE_AUTO_MEMORY_BODY_20261021"
AUTO_PROMPT = (
    "UWORK_NATIVE_AUTO_MEMORY_CREATE_20261021 remember owned preference " + AUTO_BODY
)
AUTO_LABEL = "UWORK_NATIVE_AUTO_MEMORY_RECALL_20261021"


def make_auto_renderer(budget):
    """Own callable closes over its budget; no mutation of a runpy module's global fields."""

    def wait(launched, meta, evidence):
        end = min(budget.end, time.monotonic() + 30)
        app = Path(meta["packagedRuntime"]["appPath"])
        pid = launched["pid"]
        port = launched["cdpPort"]

        def command(args):
            return subprocess.run(
                args,
                capture_output=True,
                text=True,
                check=True,
                timeout=min(2, memory_budget_left(end)),
            ).stdout

        birth = command(["ps", "-p", str(pid), "-o", "lstart="]).strip()

        def guard():
            memory_budget_left(end)
            current = command(["ps", "-p", str(pid), "-o", "lstart="]).strip()
            mapped = command(
                ["lsof", "-nP", "-a", "-p", str(pid), "-d", "txt", "-Fn"]
            ).splitlines()
            listener = subprocess.run(
                [
                    "lsof",
                    "-nP",
                    "-a",
                    "-p",
                    str(pid),
                    "-iTCP:" + str(port),
                    "-sTCP:LISTEN",
                    "-Fn",
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=min(2, memory_budget_left(end)),
            )
            memory_budget_left(end)
            return (
                current == birth
                and "n" + str(app / "Contents/MacOS/UWork Preview") in mapped
                and listener.returncode == 0
                and "n127.0.0.1:" + str(port) in listener.stdout.splitlines()
            )

        readiness = runpy.run_path(str(ROOT / "scripts/tests/macos-x64-readiness.py"))

        def fetch(port, seconds):
            result = readiness["fetch_owned_targets"](
                port, min(seconds, memory_budget_left(end))
            )
            memory_budget_left(end)
            return result

        def save(value):
            (evidence / ("readiness-" + str(pid) + ".json")).write_text(
                json.dumps(value, indent=2) + "\n"
            )

        return readiness["wait_owned_renderer"](
            port,
            (app / "Contents/Resources/app.asar").as_uri() + "/",
            guard,
            save,
            seconds=min(30, memory_budget_left(end)),
            fetch=fetch,
        )

    return wait


def auto_settings_projection():
    return """(()=>{const visible=e=>!!e&&e.getClientRects().length&&!e.closest('[inert],[aria-hidden="true"]'),page=document.querySelector('[data-testid="settings-page"]'),sw=document.querySelector('[data-testid="settings-memory-switch"]'),scope=document.querySelector('[data-testid="settings-memory-scope-trigger"]');return{ok:visible(page)&&page.getAttribute('data-active-section')==='memory'&&visible(sw),checked:sw?.getAttribute('aria-checked')==='true',names:[...document.querySelectorAll('[data-testid^="settings-memory-file-name-"]')].filter(visible).map(e=>e.textContent.trim()).sort(),scopeKey:scope?.getAttribute('data-plugin-scope-key')??null,count:document.querySelector('[data-testid="settings-memory-count"]')?.textContent.trim()??null}})()"""


AUTO_SLICE = """
        def auto_until(expression,label,seconds):
            end=min(memory_work_end,time.monotonic()+seconds)
            while time.monotonic()<end:
                f.command('autoMemoryStatus',min(3,memory_budget_left(end)))
                value=bridge.evaluate(expression);memory_budget_left(end)
                if value.get('ok'):return value
                time.sleep(.1)
            raise AssertionError(label)
        auto_warm_ui=until(cap_ui('',[],False,meta['modelId']),'Completed original warm task',12)
        auto_db,auto_bindings=mapped_database(observations['packagedCli'],root,workspace)
        auto_warm=f.command('autoMemoryProof',10,stage='warm',sessionId=auto_warm_ui['taskId'],dbPath=auto_db)['facts'];assert_backend_baseline(auto_warm,delivered,meta['modelId'])
        assert auto_warm['files']['indexAbsent'] and auto_warm['files']['topicAbsent'] and auto_warm['files']['outsideAbsent']
        observations['automaticMemoryWarm']={'ui':auto_warm_ui,'oracle':auto_warm,'databaseBindings':auto_bindings}
        click('[data-testid="task-settings-button"]','auto-memory-original-settings')
        click('[data-testid="settings-section-nav-memory"]','auto-memory-original-section')
        ui=until(auto_settings_projection(),'Original Memory settings',10)
        if not ui['checked']:click('[data-testid="settings-memory-switch"]','auto-memory-original-enable')
        until(expect(auto_settings_projection(),'v.checked'),'Original Memory on',8)
        setting_end=min(memory_work_end,time.monotonic()+5)
        while time.monotonic()<setting_end:
            setting=json.loads((root/'data/.uwork/v2/setting.json').read_text())
            if setting.get('memoryEnabled') is True:break
            time.sleep(.05)
        assert setting.get('memoryEnabled') is True
        click('[data-testid="settings-back-button"]','auto-memory-original-back')
        prior=[auto_warm_ui['taskId']];observations['automaticMemoryStages']=[]
        auto_created_session=None
        for phase,prompt,expected_calls,expected_total in [('after-A',AUTO_PROMPT,6,8),('after-B',AUTO_LABEL,8,10)]:
            click('[data-testid="enterprise-menu-chat"]',phase+'-original-new-task')
            draft=until(cap_ui(prompt,prior,True),phase+' original draft',12)
            if draft['model']!=meta['modelId']:
                click('[data-testid="chat-model-select-trigger"]',phase+'-picker')
                click('[data-testid="chat-model-select-group-registry-provider:ucas"]',phase+'-provider')
                click('[data-testid='+json.dumps('chat-model-select-item-custom:ucas:'+meta['modelId'])+']',phase+'-model')
            draft=until(cap_ui(prompt,prior,True,meta['modelId']),phase+' selected draft',10)
            assert draft['workspace']=='packaged-workspace' and draft['thought']=='none'
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]',phase+'-composer')
            bridge.raw_cdp('Input.insertText',text=prompt)
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]',phase+'-send')
            task=auto_until(cap_ui(prompt,prior,False,meta['modelId']),phase+' actual original task complete',25)
            prior.append(task['taskId'])
            if phase=='after-A':auto_created_session=task['taskId']
            settle=min(memory_work_end,time.monotonic()+20)
            while time.monotonic()<settle:
                f.command('autoMemoryStatus',min(3,memory_budget_left(settle)))
                updated=proof();assert updated['modelCalls']<=expected_total
                if updated['own']['settled']==expected_calls:break
                time.sleep(.1)
            assert updated['modelCalls']==expected_total and updated['own']=={'count':expected_calls,'settled':expected_calls,'amount':expected_calls*22,'inputTokens':expected_calls*12,'outputTokens':expected_calls*10}
            assert updated['other']==baseline['other'] and updated['modelWorkingDirectories']==[str(workspace)]
            current_rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in current_rows)
            current_cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,current_rows)
            current_db,current_bindings=mapped_database(current_cli,root,workspace);assert current_db==auto_db
            accepted=f.command('autoMemoryProof',15,stage=phase,sessionId=task['taskId'],dbPath=auto_db)['facts']
            after_rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in after_rows)
            after_cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,after_rows);after_db,after_bindings=mapped_database(after_cli,root,workspace);assert after_db==current_db and after_bindings==current_bindings
            assert accepted['files']['topic']['originSessionId']==auto_created_session and accepted['files']['outsideAbsent']
            assert accepted['session']['gateOracleWouldExecute']==(1 if phase=='after-A' else 0)
            assert accepted['oracle']['sidecar']==2 and accepted['oracle']['mainA']==1
            time.sleep(.25);assert proof()==updated
            observations['automaticMemoryStages'].append({'phase':phase,'ui':task,'draft':draft,'oracle':accepted,'beforeBindings':current_bindings,'afterBindings':after_bindings,'accounting':updated,'normalSupplierFinishAndSettled':True,'runtimeSchedulerCursorObserved':False})
            delivered=updated
            if phase=='after-A':
                click('[data-testid="task-settings-button"]','auto-memory-catalog-settings')
                click('[data-testid="settings-section-nav-memory"]','auto-memory-catalog-section')
                until(expect(auto_settings_projection(),'v.checked'),'Original on catalog',8)
                click('[data-testid="settings-memory-refresh"]','auto-memory-original-refresh')
                index_path=Path(accepted['files']['index']['path'])
                catalog=until(expect(auto_settings_projection(),"v.checked&&JSON.stringify(v.names)===JSON.stringify(['MEMORY.md','owned-preference.md'])&&v.scopeKey==="+json.dumps(index_path.parent.parent.name)+"&&(v.count==='2 条记忆'||v.count==='2 memories')"),'Original two-file Memory catalog',10)
                observations['automaticMemoryCatalog']=catalog
                click('[data-testid="settings-back-button"]','auto-memory-catalog-back')
        assert delivered['own']['count']==8 and delivered['own']['amount']==176 and delivered['modelCalls']==10
        checks.append('native-natural-memory-extraction-two-writes-root-denial-and-fresh-index-consumption')
"""


def deriveAutoMemoryProbe(original):
    source = M["deriveMemoryProbe"](original)
    start = "        warm_ui=until(cap_ui('',[],False,meta['modelId']),'Original warm task before Memory',15)"
    end = "        checks.append('original-ui-memory-off-on-off-new-task-context-private-file-and-exact-accounting')"
    assert source.count(start) == source.count(end) == 1
    a = source.index(start)
    b = source.index(end, a) + len(end)
    block = AUTO_SLICE
    lines = block.splitlines(True)
    for i in range(len(lines) - 1, -1, -1):
        if "bridge.raw_cdp('Input." in lines[i]:
            lines.insert(
                i,
                lines[i][: len(lines[i]) - len(lines[i].lstrip())]
                + "memory_budget_left(memory_work_end)\n",
            )
    source = source[:a] + "".join(lines) + source[b:]
    entry = "scripts/fixtures/mac-arm64-memory-derived.mjs"
    assert source.count(entry) == 1
    source = source.replace(
        entry, "scripts/fixtures/mac-arm64-memory-extraction-derived.mjs"
    )
    return source


def create_auto_namespace(source, budget):
    namespace = M["create_memory_namespace"](source, budget)
    namespace.update(
        AUTO_PROMPT=AUTO_PROMPT,
        AUTO_LABEL=AUTO_LABEL,
        auto_settings_projection=auto_settings_projection,
    )
    namespace["wait_renderer"] = make_auto_renderer(budget)
    return namespace


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_globals(ns):
    missing = set()

    def inspect(code):
        for instruction in dis.get_instructions(code):
            if (
                instruction.opname == "LOAD_GLOBAL"
                and instruction.argval not in ns
                and not hasattr(builtins, instruction.argval)
            ):
                missing.add(instruction.argval)
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                inspect(value)

    inspect(ns["run"].__code__)
    assert not missing, sorted(missing)


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
    source = deriveAutoMemoryProbe(BASE.read_text())
    compile(source, "actual-auto-memory", "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = MemoryCaseBudget()
    ns = create_auto_namespace(source, budget)
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
