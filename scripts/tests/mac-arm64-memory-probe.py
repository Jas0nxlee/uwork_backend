"""Original seven checks plus original Memory off/on/off settings and three new tasks."""

import argparse, ast, hashlib, json, os, runpy, subprocess, time, shlex, base64, select
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-memory-v2-20261021"
BASE = ROOT / "scripts/tests/macos-clock-probe.py"
CAP = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-model-capability-probe.py"))
COLD = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-cold-consistency-probe.py"))
cap_ui = CAP["cap_ui"]

mapped_database = COLD["mapped_database"]
assert_backend_baseline = CAP["assert_backend_baseline"]
BODY = "UWORK_NATIVE_MEMORY_BODY_20261021"
LABELS = [
    "UWORK_NATIVE_MEMORY_OFF_ONE_20261021",
    "UWORK_NATIVE_MEMORY_ON_20261021",
    "UWORK_NATIVE_MEMORY_OFF_TWO_20261021",
]


def memory_budget_left(deadline):
    left = deadline - time.monotonic()
    assert left > 0, "Memory case budget exhausted"
    return left


class MemoryCaseBudget:
    """This controller only: actual IO interfaces share work160/cleanup20, including callbacks."""

    def __init__(self, now=time.monotonic):
        self.now = now
        self.started = now()
        self.case_end = self.started + 180
        self.work_end = self.started + 160
        self.end = self.work_end

    def left(self):
        value = self.end - self.now()
        assert value > 0, "Memory shared IO deadline exceeded"
        return value

    def begin_cleanup(self):
        self.end = self.case_end

    def call(self, operation, *args, **kwargs):
        self.left()
        result = operation(*args, **kwargs)
        self.left()
        return result

    def bind_child(self, child):
        original = child.wait

        def wait(timeout=None):
            return self.call(
                original,
                timeout=min(
                    timeout if timeout is not None else self.left(), self.left()
                ),
            )

        child.wait = wait

    def bind_fixture(self, fixture):
        command, wait, send = fixture.command, fixture.wait_event, fixture.send

        def bounded_command(op, seconds=30, **extra):
            if op == "openWorkspace":
                assert self.left() >= 10, "Insufficient original secondary10s budget"
            return self.call(command, op, min(seconds, self.left()), **extra)

        def bounded_wait(predicate, seconds, label):
            return self.call(wait, predicate, min(seconds, self.left()), label)

        fixture.command = bounded_command
        fixture.wait_event = bounded_wait
        fixture.send = lambda value: self.call(send, value)
        self.bind_child(fixture.child)

    def bind_bridge(self, bridge):
        raw, evaluate, kill = bridge.raw_cdp, bridge.evaluate, bridge.kill
        bridge.raw_cdp = lambda *a, **k: self.call(raw, *a, **k)
        bridge.evaluate = lambda *a, **k: self.call(evaluate, *a, **k)
        bridge.kill = lambda: self.call(kill)
        return bridge

    def bind_guard(self, guard):
        command, read, close = guard.command, guard.read, guard.close
        guard.command = lambda *a, **k: self.call(command, *a, **k)
        guard.read = lambda: self.call(read)
        guard.close = lambda: self.call(close)
        self.bind_child(guard.child)

    def subprocess(self, original, *args, **kwargs):
        kwargs["timeout"] = min(kwargs.get("timeout") or self.left(), self.left())
        return self.call(original, *args, **kwargs)

    def select(self, original, reads, writes, errors, timeout=None):
        return self.call(
            original,
            reads,
            writes,
            errors,
            min(timeout if timeout is not None else self.left(), self.left()),
        )


def wait_renderer(launched, meta, evidence):
    end = min(MEMORY_ACTIVE_BUDGET.end, time.monotonic() + 30)
    app = Path(meta["packagedRuntime"]["appPath"])
    pid = launched["pid"]
    port = launched["cdpPort"]
    birth = subprocess.run(
        ["ps", "-p", str(pid), "-o", "lstart="],
        capture_output=True,
        text=True,
        check=True,
        timeout=min(2, memory_budget_left(end)),
    ).stdout.strip()

    def guard():
        memory_budget_left(end)
        current = subprocess.run(
            ["ps", "-p", str(pid), "-o", "lstart="],
            capture_output=True,
            text=True,
            check=True,
            timeout=min(2, memory_budget_left(end)),
        ).stdout.strip()
        mapped = subprocess.run(
            ["lsof", "-nP", "-a", "-p", str(pid), "-d", "txt", "-Fn"],
            capture_output=True,
            text=True,
            check=True,
            timeout=min(2, memory_budget_left(end)),
        ).stdout.splitlines()
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
            timeout=min(2, memory_budget_left(end)),
        ).stdout.splitlines()
        memory_budget_left(end)
        return (
            current == birth
            and "n" + str(app / "Contents/MacOS/UWork Preview") in mapped
            and "n127.0.0.1:" + str(port) in listener
        )

    readiness = runpy.run_path(str(ROOT / "scripts/tests/macos-x64-readiness.py"))

    def fetch(port, seconds):
        value = readiness["fetch_owned_targets"](
            port, min(seconds, memory_budget_left(end))
        )
        memory_budget_left(end)
        return value

    def persist(value):
        (evidence / ("readiness-" + str(pid) + ".json")).write_text(
            json.dumps(value, indent=2) + "\n"
        )

    return readiness["wait_owned_renderer"](
        port,
        (app / "Contents/Resources/app.asar").as_uri() + "/",
        guard,
        persist,
        seconds=min(30, memory_budget_left(end)),
        fetch=fetch,
    )


def settings_projection():
    return """(()=>{const visible=e=>!!e&&e.getClientRects().length&&!e.closest('[inert],[aria-hidden="true"]'),page=document.querySelector('[data-testid="settings-page"]'),sw=document.querySelector('[data-testid="settings-memory-switch"]'),scope=document.querySelector('[data-testid="settings-memory-scope-trigger"]');return{ok:visible(page)&&page.getAttribute('data-active-section')==='memory'&&visible(sw),checked:sw?.getAttribute('aria-checked')==='true',fileRows:[...document.querySelectorAll('[data-testid="settings-memory-file-MEMORY.md"]')].filter(visible).length,fileNames:[...document.querySelectorAll('[data-testid^="settings-memory-file-name-"]')].filter(visible).map(e=>e.textContent.trim()),scopeKey:scope?.getAttribute('data-plugin-scope-key')??null,scopeLabel:scope?.textContent.trim()??null,count:document.querySelector('[data-testid="settings-memory-count"]')?.textContent.trim()??null}})()"""


def expect(expression, condition):
    return (
        "(()=>{const v=("
        + expression
        + ");v.ok=!!v.ok&&!!("
        + condition
        + ");return v})()"
    )


def pty_memory_command(root, file):
    # This source is typed into the original PTY, not executed by this controller.
    code = """import fs from 'node:fs';import p from 'node:path';const root=process.argv[1],file=process.argv[2];if(fs.realpathSync(root)!==root||p.resolve(file)!==file||!file.startsWith(root+p.sep)||!file.endsWith('/memory/MEMORY.md'))throw Error('ownedroot');let cur=root;for(const part of p.relative(root,p.dirname(file)).split(p.sep)){cur=p.join(cur,part);try{fs.mkdirSync(cur,{mode:448})}catch(e){if(e.code!=='EEXIST')throw e}let s=fs.lstatSync(cur);if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(cur)!==cur)throw Error('plainpath')}const fd=fs.openSync(file,'wx',384);try{fs.writeFileSync(fd,'UWORK_NATIVE_MEMORY_BODY_20261021\\n')}finally{fs.closeSync(fd)}"""
    return shlex.join(
        [
            "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node",
            "--input-type=module",
            "-e",
            code,
            str(root),
            str(file),
        ]
    )


MEMORY_SLICE = """
        warm_ui=until(cap_ui('',[],False,meta['modelId']),'Original warm task before Memory',15)
        memory_db,memory_bindings=mapped_database(observations['packagedCli'],root,workspace)
        warm=f.command('memoryProof',15,stage='warm',sessionId=warm_ui['taskId'],dbPath=memory_db)['facts']
        assert_backend_baseline(warm,delivered,meta['modelId'])
        memory_file=Path(warm['file']['filePath']);assert str(memory_file).startswith(str(root/'data/.uwork/cli/memories/projects')+'/')
        assert not memory_file.exists()
        click('[data-testid="terminal-toggle"]','memory-original-terminal-open')
        click('[data-testid="terminal"] .xterm-screen','memory-original-xterm-focus')
        bridge.raw_cdp('Input.insertText',text=pty_memory_command(root,memory_file))
        for kind in ['keyDown','keyUp']:
            bridge.raw_cdp('Input.dispatchKeyEvent',type=kind,key='Enter',code='Enter',windowsVirtualKeyCode=13,nativeVirtualKeyCode=36)
        written_end=min(memory_work_end,time.monotonic()+5)
        while time.monotonic()<written_end and not memory_file.exists():time.sleep(.05)
        assert memory_file.is_file() and not memory_file.is_symlink() and memory_file.read_bytes()==(BODY+'\\n').encode()
        file_sha=hashlib.sha256(memory_file.read_bytes()).hexdigest()
        click('[data-testid="terminal-close-button"]','memory-original-terminal-close')
        observations['memoryWarm']={'ui':warm_ui,'backend':warm,'actualDatabaseBindings':memory_bindings,'bodySha256':file_sha,'createdBy':'original xterm shell'}
        prior=[warm_ui['taskId']];observations['memoryStages']=[]
        for ordinal,(stage,enabled,label)in enumerate(zip(['off-one','on','off-two'],[False,True,False],LABELS),1):
            click('[data-testid="task-settings-button"]',stage+'-original-settings')
            click('[data-testid="settings-section-nav-memory"]',stage+'-original-memory-section')
            ui=until(settings_projection(),stage+' original Memory settings',10)
            if ordinal==1 and ui['checked'] is False:
                click('[data-testid="settings-memory-switch"]',stage+'-explicit-on-before-off')
                until(expect(settings_projection(),'v.checked'),stage+' interim on acknowledgement',8)
            ui=bridge.evaluate(settings_projection())
            if ui['checked'] is not enabled:click('[data-testid="settings-memory-switch"]',stage+'-original-switch')
            ui=until(expect(settings_projection(),'v.checked==='+json.dumps(enabled)),stage+' switch acknowledgement',8)
            setting_path=root/'data/.uwork/v2/setting.json'
            setting_end=min(memory_work_end,time.monotonic()+5)
            while time.monotonic()<setting_end:
                persisted=json.loads(setting_path.read_text())
                if persisted.get('memoryEnabled') is enabled:break
                time.sleep(.05)
            assert persisted.get('memoryEnabled') is enabled
            if enabled:
                click('[data-testid="settings-memory-refresh"]','on-original-memory-refresh')
                ui=until(expect(settings_projection(),"v.checked&&v.fileRows===1&&v.fileNames.length===1&&v.fileNames[0]==='MEMORY.md'&&v.scopeKey==="+json.dumps(memory_file.parent.parent.name)+"&&(v.count==='1 条记忆'||v.count==='1 memory')"),'Original Memory catalog exact workspace/file',10)
                assert memory_file.read_bytes()==(BODY+'\\n').encode()
            observations['memoryStages'].append({'stage':stage,'settingUi':ui,'persistedSetting':persisted['memoryEnabled']})
            click('[data-testid="settings-back-button"]',stage+'-original-settings-back')
            click('[data-testid="enterprise-menu-chat"]',stage+'-original-new-task')
            draft=until(cap_ui(label,prior,True),stage+' fresh workspace draft',12)
            if draft['model']!=meta['modelId']:
                click('[data-testid="chat-model-select-trigger"]',stage+'-model-picker')
                click('[data-testid="chat-model-select-group-registry-provider:ucas"]',stage+'-provider')
                click('[data-testid='+json.dumps('chat-model-select-item-custom:ucas:'+meta['modelId'])+']',stage+'-same-model')
            draft=until(cap_ui(label,prior,True,meta['modelId']),stage+' same-model draft',10)
            assert draft['thought']=='none' and draft['workspace']=='packaged-workspace'
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer"] [contenteditable="true"]',stage+'-composer')
            bridge.raw_cdp('Input.insertText',text=label)
            click('[data-root-workspace-surface="interactive"] [data-session-id="draft"] [data-testid="v4-composer-send"]',stage+'-send-once')
            task=until(cap_ui(label,prior,False,meta['modelId']),stage+' actual completed task',25)
            prior.append(task['taskId'])
            settle=min(memory_work_end,time.monotonic()+10)
            while time.monotonic()<settle:
                updated=proof();assert updated['modelCalls']<=4+ordinal*2
                if updated['own']['settled']==2+ordinal*2:break
                time.sleep(.1)
            assert updated['own']=={'count':2+ordinal*2,'settled':2+ordinal*2,'amount':44*(ordinal+1),'inputTokens':24*(ordinal+1),'outputTokens':20*(ordinal+1)}
            assert updated['other']==baseline['other'] and updated['modelCalls']==4+ordinal*2 and updated['modelWorkingDirectories']==[str(workspace)]
            memory_rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in memory_rows)
            memory_cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,memory_rows)
            current_db,current_bindings=mapped_database(memory_cli,root,workspace);assert current_db==memory_db
            stage_proof=f.command('memoryProof',10,stage=stage,sessionId=task['taskId'],dbPath=memory_db)['facts']
            after_rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in after_rows)
            after_cli=OLD['verify_packaged_cli'](evidence,meta['packagedRuntime']['appPath'],root,after_rows)
            after_db,after_bindings=mapped_database(after_cli,root,workspace);assert after_db==current_db
            assert after_bindings==current_bindings,'CLI generation/FD changed during readonly Memory proof'
            assert stage_proof['session']['memoryEnabled'] is enabled and stage_proof['session']['originalSchedulerWouldExecute']==0
            assert stage_proof['file']['sha256']==file_sha
            # A second actual backend proof closes a title/extraction surprise without changing products.
            time.sleep(.2);assert proof()==updated
            observations['memoryStages'][-1].update(uiDraft=draft,uiTask=task,oracle=stage_proof,accounting=updated,currentCli=memory_cli,currentDatabaseBindings=current_bindings,afterDatabaseBindings=after_bindings)
            delivered=updated
        assert delivered['own']['count']==8 and delivered['own']['amount']==176 and delivered['modelCalls']==10
        checks.append('original-ui-memory-off-on-off-new-task-context-private-file-and-exact-accounting')
"""


def deriveMemoryProbe(original):
    s = original
    assert s.count("import argparse\n") == 1
    s = s.replace("import argparse\n", "import argparse\nimport hashlib\n")

    def once(a, b):
        nonlocal s
        assert s.count(a) == 1, a
        s = s.replace(a, b)

    once(
        "    facts = {'status': 'failed'",
        "    memory_case_end=MEMORY_BUDGET.case_end\n    memory_work_end=MEMORY_BUDGET.work_end\n    facts = {'status': 'failed'",
    )
    once(
        "        deadline = time.monotonic() + seconds",
        "        deadline = min(memory_work_end,time.monotonic() + seconds)",
    )
    once(
        "            value = bridge.evaluate(expression)\n            if value.get('ok'):",
        "            value = bridge.evaluate(expression)\n            memory_budget_left(deadline)\n            if value.get('ok'):",
    )
    once(
        "        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)",
        "        memory_budget_left(memory_work_end)\n        wait_renderer(launched,meta,evidence)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence,renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')",
    )
    once(
        "        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n",
        "        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n"
        + MEMORY_SLICE,
    )
    once(
        "        assert len(derived_launches) == 1",
        "        assert len(derived_launches) == 1\n        MEMORY_BUDGET.bind_fixture(f)",
    )
    once(
        "        guard = OLD['OsGuard'](protocol_only=True)",
        "        guard = OLD['OsGuard'](protocol_only=True)\n        MEMORY_BUDGET.bind_guard(guard)",
    )
    once(
        "        return value\n\n    try:",
        "        return MEMORY_BUDGET.bind_bridge(value)\n\n    try:",
    )
    once(
        "        f.wait_event(lambda row: row.get('event') == 'ready', 180,",
        "        f.wait_event(lambda row: row.get('event') == 'ready', min(45,memory_budget_left(memory_work_end)),",
    )
    once(
        "        launched = f.wait_event(lambda row: row.get('event') == 'launched', 120,",
        "        launched = f.wait_event(lambda row: row.get('event') == 'launched', min(30,memory_budget_left(memory_work_end)),",
    )
    once(
        "        cold = f.wait_event(lambda row: row.get('event') == 'launched' and row.get('pid') != launched['pid'], 120,",
        "        cold = f.wait_event(lambda row: row.get('event') == 'launched' and row.get('pid') != launched['pid'], min(30,memory_budget_left(memory_work_end)),",
    )
    once(
        "['scripts/fixtures/macos-clock-derived.mjs']",
        "['scripts/fixtures/mac-arm64-memory-derived.mjs']",
    )
    once(
        "    finally:\n        if f:",
        "    finally:\n        MEMORY_BUDGET.begin_cleanup()\n        if f:",
    )
    # The actual outer function's input calls all check the same work deadline immediately before dispatch.
    lines = s.splitlines(True)
    for i in range(len(lines) - 1, -1, -1):
        if "bridge.raw_cdp('Input." in lines[i]:
            lines.insert(
                i,
                lines[i][: len(lines[i]) - len(lines[i].lstrip())]
                + "memory_budget_left(memory_work_end)\n",
            )
    s = "".join(lines)
    once(
        "        facts['cleanup'] =",
        "        facts['elapsedSeconds']=time.monotonic()-(memory_case_end-180)\n        if facts['elapsedSeconds']>180:errors.append('Memory case180s exceeded')\n        facts['cleanup'] =",
    )
    return s


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def create_memory_namespace(source, budget):
    ns = {
        "__file__": str(BASE),
        "__name__": "reviewed_native_memory",
        **{
            k: globals()[k]
            for k in [
                "wait_renderer",
                "mapped_database",
                "assert_backend_baseline",
                "cap_ui",
                "settings_projection",
                "expect",
                "pty_memory_command",
                "LABELS",
                "BODY",
                "memory_budget_left",
            ]
        },
        "MEMORY_BUDGET": budget,
    }
    exec(compile(source, str(BASE), "exec"), ns)
    return ns


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert (
        plan["profile"] == PROFILE
        and args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for p, h in plan["sources"].items():
        assert digest(ROOT / p) == h, p
    assert digest(plan["manifestPath"]) == plan["manifestSha256"]
    assert digest(__file__) == plan["driverSha256"]
    runpy.run_path(str(ROOT / "scripts/tests/macos-clock-profile.test.py"))["check"](
        PROFILE
    )
    source = deriveMemoryProbe(BASE.read_text())
    compile(source, str(BASE), "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    global MEMORY_ACTIVE_BUDGET
    MEMORY_BUDGET = MemoryCaseBudget()
    MEMORY_ACTIVE_BUDGET = MEMORY_BUDGET
    ns = create_memory_namespace(source, MEMORY_BUDGET)
    original_run = subprocess.run
    original_select = select.select
    subprocess.run = lambda *a, **kw: MEMORY_BUDGET.subprocess(original_run, *a, **kw)
    select.select = lambda *a, **kw: MEMORY_BUDGET.select(original_select, *a, **kw)
    try:
        return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.run = original_run
        select.select = original_select


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
