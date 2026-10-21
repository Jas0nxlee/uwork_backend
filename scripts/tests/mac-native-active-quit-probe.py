"""Finite original menu Quit cancel/allow; default only verifies a frozen plan."""

import argparse, hashlib, json, os, runpy, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "scripts/tests/macos-clock-probe.py"
PROFILE = "client-native-packaged-macos-clock-arm64-active-quit-v4-20261021"
NODE = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"
AX = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-ax.py"))
COLD = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-cold-consistency-probe.py"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_profile(profile):
    assert profile == PROFILE
    runpy.run_path(str(ROOT / "scripts/tests/macos-x64-clock-startup-probe.py"))[
        "validate_original_clock_profile"
    ](profile)
    return profile


def quit_budget_left(deadline):
    value = deadline - time.monotonic()
    assert value > 0, "Active Quit shared work deadline exhausted"
    return value


def oracle(name, *values, deadline):
    assert name in [
        "assertHeldAccounting",
        "assertCancelAccounting",
        "assertQuitAccounting",
    ]
    code = "import * as m from './scripts/fixtures/mac-native-active-quit-runtime.mjs';let s='';for await(const p of process.stdin)s+=p;try{const x=JSON.parse(s);const v=m[x.name](...x.values);console.log(JSON.stringify({ok:true,value:v??null}));}catch(e){console.log(JSON.stringify({ok:false,errorType:e.constructor.name}));process.exitCode=1;}"
    r = subprocess.run(
        [NODE, "--input-type=module", "-e", code],
        input=json.dumps({"name": name, "values": values}),
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=min(3, quit_budget_left(deadline)),
    )
    assert r.returncode == 0, (
        "Exact active Quit accounting oracle failed: " + r.stdout[:150]
    )
    quit_budget_left(deadline)
    return json.loads(r.stdout)["value"]


def pending_expression(task):
    return (
        """(()=>{const ps=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length&&e.closest('[data-root-workspace-surface="interactive"]')&&!e.closest('[inert]')&&e.getAttribute('data-session-id')!=='draft');const p=ps.length===1?ps[0]:null,s=p?.querySelector('[data-testid="v4-stop"]')??document.querySelector('[data-testid="v4-stop"]');return{ok:p?.getAttribute('data-session-id')===%s&&!!s&&!!s.getClientRects().length&&p.innerText.includes('MACOS_ACTIVE_QUIT_HOLD_20261021'),taskId:p?.getAttribute('data-session-id')??null,stopVisible:!!s&&!!s.getClientRects().length,identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null,model:document.querySelector('[data-testid="v4-model-config"][data-source="composer"]')?.getAttribute('data-model')??null}})()"""
        % json.dumps(task)
    )


def capture_generation(pid, required, deadline):
    rows = []
    pending = [pid]
    seen = set()

    def command(args):
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=min(0.75, quit_budget_left(deadline)),
        )
        quit_budget_left(deadline)
        assert r.returncode in (0, 1)
        return r.stdout.strip()

    while pending:
        p = pending.pop()
        assert p not in seen
        seen.add(p)
        assert len(seen) <= 64
        birth = command(["ps", "-p", str(p), "-o", "lstart="])
        assert birth, "Owned generation disappeared before Allow"
        parent = command(["ps", "-p", str(p), "-o", "ppid="])
        assert parent.isdigit()
        rows.append({"pid": p, "birth": birth, "parentPid": int(parent)})
        pending.extend(int(x) for x in command(["pgrep", "-P", str(p)]).split())
    assert (
        set(required) <= seen
    ), "Original CLI/PTY must remain in owned Main generation"
    for row in rows:
        assert command(["ps", "-p", str(row["pid"]), "-o", "lstart="]) == row["birth"]
    return rows


def wait_active_renderer(launched, meta, evidence, deadline):
    end = min(deadline, time.monotonic() + 30)
    pid = launched["pid"]
    port = launched["cdpPort"]
    app = Path(meta["packagedRuntime"]["appPath"])

    def query(args):
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=min(0.75, quit_budget_left(end)),
        )
        quit_budget_left(end)
        assert r.returncode in (0, 1)
        return r.stdout.strip()

    birth = query(["ps", "-p", str(pid), "-o", "lstart="])
    assert birth

    def guard():
        current = query(["ps", "-p", str(pid), "-o", "lstart="])
        mapped = query(
            ["lsof", "-nP", "-a", "-p", str(pid), "-d", "txt", "-Fn"]
        ).splitlines()
        listener = query(
            [
                "lsof",
                "-nP",
                "-a",
                "-p",
                str(pid),
                "-iTCP:" + str(port),
                "-sTCP:LISTEN",
                "-Fn",
            ]
        ).splitlines()
        return (
            current == birth
            and "n" + str(app / "Contents/MacOS/UWork Preview") in mapped
            and "n127.0.0.1:" + str(port) in listener
        )

    helper = runpy.run_path(str(ROOT / "scripts/tests/macos-x64-readiness.py"))[
        "wait_owned_renderer"
    ]

    def persist(value):
        (evidence / "active-quit-renderer-readiness.json").write_text(
            json.dumps(value, indent=2) + "\n"
        )

    return helper(
        port,
        (app / "Contents/Resources/app.asar").as_uri() + "/",
        guard,
        persist,
        seconds=quit_budget_left(end),
    )


QUIT_SLICE = """
        before_ui=until(COLD['ui_expression'](),'Original completed titled task before held turn',20)
        assert before_ui['taskId']==before_ui['sessionId'] and before_ui['userVisible'] and before_ui['assistantVisible']
        assert before_ui['identity']=='企业用户甲' and before_ui['model']==meta['modelId']
        warm=f.command('activeQuitSnapshot',min(5,quit_budget_left(work_deadline)),phase='warm')['facts']
        assert warm['bootstrapActor']=={'userId':meta['memberId'],'tenantId':meta['tenantId']}
        COLD['assert_backend_baseline'](warm,delivered,meta['modelId'])
        observations['activeQuitWarm']={'ui':before_ui,'backend':warm}
        armed=f.command('activeQuitArm',min(5,quit_budget_left(work_deadline)),workspacePath=str(workspace))
        assert armed['pid']==launched['pid']
        click(editor,'same-titled-task-held-turn-focus')
        bridge.raw_cdp('Input.insertText',text='MACOS_ACTIVE_QUIT_HOLD_20261021 请继续等待。')
        click('[data-testid="v4-composer-send"]','original-held-main-send-once')
        held_ui=until(pending_expression(before_ui['taskId']),'Original same task running held model',10)
        held_end=min(work_deadline,time.monotonic()+8)
        while True:
            held=f.command('activeQuitSnapshot',min(3,quit_budget_left(held_end)),phase='held')['facts']
            assert held['modelCalls']<=5 and held['rawInferencePosts']<=5
            if held['hold']['received'] and len(held['snapshot']['actors']['current']['accounting']['ledger'])==3:break
            time.sleep(min(.1,quit_budget_left(held_end)))
        reservation=oracle('assertHeldAccounting',warm,held,deadline=work_deadline)
        assert reservation['model_id']==meta['modelId'] and reservation['application']=='uwork' and reservation['user_id']==meta['memberId'] and reservation['tenant_id']==meta['tenantId']
        observations['activeQuitHeld']={'ui':held_ui,'backend':held}
        checks.append('same-completed-task-real-dispatched-main-reservation-and-header-only-hold')
        executable=str(Path(meta['packagedRuntime']['appPath'])/'Contents/MacOS/UWork Preview')
        birth=subprocess.run(['ps','-p',str(launched['pid']),'-o','lstart='],capture_output=True,text=True,check=True,timeout=min(.75,quit_budget_left(work_deadline))).stdout.strip()
        binding={'pid':launched['pid'],'birth':birth,'executable':executable,'applicationName':meta['activeQuitApplicationName']}
        def actor_guard():
            quit_budget_left(work_deadline)
            with f.lock:latest=[r['pid']for r in f.events if r.get('event')=='launched']
            return f.child.poll()is None and latest==[launched['pid']]
        def quit_action(operation):
            try:
                result=AX['perform_owned_quit_action'](binding,operation,deadline=min(work_deadline,time.monotonic()+5),actor_guard=actor_guard)
            except BaseException as error:
                try:
                    receipt=getattr(error,'ownedForegroundReceipt',None)
                    if receipt is not None:
                        observations.setdefault('originalQuitActions',[]).append({'operation':operation,'failureType':type(error).__name__,'ownedForegroundReceipt':receipt})
                        (evidence/'original-quit-actions.json').write_text(json.dumps(observations['originalQuitActions'],ensure_ascii=False,indent=2)+'\\n')
                except BaseException:pass
                raise
            observations.setdefault('originalQuitActions',[]).append(result)
            (evidence/'original-quit-actions.json').write_text(json.dumps(observations['originalQuitActions'],ensure_ascii=False,indent=2)+'\\n')
            return result
        quit_action('menu')
        cancelled=quit_action('cancel');assert cancelled['activeSessionCount']>0
        after_cancel_ui=until(pending_expression(before_ui['taskId']),'Cancel preserves same active task and original hold',3)
        cancel_one=f.command('activeQuitSnapshot',min(3,quit_budget_left(work_deadline)),phase='cancel-one')['facts']
        oracle('assertCancelAccounting',held,cancel_one,deadline=work_deadline)
        cancel_two=f.command('activeQuitSnapshot',min(3,quit_budget_left(work_deadline)),phase='cancel-two')['facts']
        oracle('assertCancelAccounting',held,cancel_two,deadline=work_deadline)
        assert after_cancel_ui==held_ui
        current_cli=[r for r in observations['packagedCli']if r['workingDirectory']==str(workspace)]
        assert current_cli,'Original current workspace CLI must remain active while held'
        required=[shell_pid,*[r['pid']for r in current_cli]]
        generation=capture_generation(launched['pid'],required,min(work_deadline,time.monotonic()+5))
        known.update(row['pid']for row in generation)
        observations['activeQuitCancel']={'ui':after_cancel_ui,'first':cancel_one,'second':cancel_two,'generationBeforeAllow':generation}
        checks.append('original-application-Quit-Cancel-preserves-owner-task-hold-and-full-accounting')
        hold=f.command('activeQuitSnapshot',min(3,quit_budget_left(work_deadline)),phase='poll')['facts']['hold']
        assert hold['remainingMs']>=15000 and not hold['closed'] and quit_budget_left(work_deadline)>=16
        quit_action('menu')
        allow_hold=f.command('activeQuitSnapshot',min(3,quit_budget_left(work_deadline)),phase='poll')['facts']['hold']
        assert allow_hold['remainingMs']>=15000 and not allow_hold['closed']
        allow_started=time.monotonic()
        allowed=quit_action('allow');assert allowed['activeSessionCount']>0 and allowed['requiresOriginalChildExitReceipt']
        exit_end=min(work_deadline,allow_started+15)
        while True:
            after=f.command('activeQuitSnapshot',min(3,quit_budget_left(exit_end)),phase='poll')['facts']
            if after['nativeExit'] is not None:break
            time.sleep(min(.1,quit_budget_left(exit_end)))
        exit_receipt=after['nativeExit'];assert exit_receipt['pid']==launched['pid'] and exit_receipt['code']==0 and exit_receipt['signal'] is None
        while len(after['snapshot']['actors']['current']['accounting']['traces'])<3:
            time.sleep(min(.1,quit_budget_left(exit_end)))
            after=f.command('activeQuitSnapshot',min(3,quit_budget_left(exit_end)),phase='after')['facts']
        assertion=oracle('assertQuitAccounting',warm,held,after,deadline=exit_end)
        remaining_pids=[]
        for row in generation:
            try:os.kill(row['pid'],0);remaining_pids.append(row['pid'])
            except ProcessLookupError:pass
        observations['activeQuitAfter']={'backend':after,'accounting':assertion,'elapsedAfterAllowSeconds':time.monotonic()-allow_started,'oldGenerationResidualBeforeCleanup':remaining_pids,'originalChildExit':exit_receipt,'testSignalBeforeNativeExit':False}
        native_log=(evidence/'electron.log').read_text()
        fixed_phases=['[app-quit] explicit quit requested','[app-quit] waiting for host process cleanup','[disposeHostProcess] disposing host process','[app-quit] host process cleanup completed','[app-quit] preparation finished','[app-quit] exiting prepared app','[disposeHostProcessAndWait] host process exit wait timed out']
        observations['activeQuitAfter']['originalQuitLog']={'fileSha256':hashlib.sha256(native_log.encode()).hexdigest(),'fixedPhaseCounts':{mark:native_log.count(mark)for mark in fixed_phases},'internalHostFallbackSignalObservable':False,'doesNotInferIndividualChildNaturalExit':True}
        assert not remaining_pids,'Original Quit left owned Host/CLI/PTY generation before any test cleanup'
        bridge.kill();harness=json.loads((evidence/'harness-cleanup.json').read_text());assert harness['daemonAbsent'] and harness['socketClosed'];bridge=None
        observations['activeQuitAfter']['harness']=harness
        checks.append('original-application-Quit-Allow-exit0-uncertain-reservation-CANCELLED-and-generation-closure')
        facts['originalSevenAccepted']=False
        facts['scope']='Original active task native application menu Quit cancel/allow only; not logout, crash, Stop or original seven'
"""


def deriveActiveQuitProbe(source):
    def once(a, b):
        nonlocal source
        assert source.count(a) == 1, a
        source = source.replace(a, b)

    a = "        def open_file(label):"
    b = "        marker = workspace / 'terminal-proof.txt'"
    assert source.count(a) == source.count(b) == 1
    source = source[: source.index(a)] + source[source.index(b) :]
    a = "        f.command('memberSeat', value=False)"
    b = "        facts['status'] = 'passed'"
    assert source.count(a) == source.count(b) == 1
    source = source[: source.index(a)] + QUIT_SLICE + source[source.index(b) :]
    once(
        "    facts = {'status': 'failed'",
        "    case_deadline = time.monotonic() + 180\n    work_deadline = case_deadline - 20\n    facts = {'status': 'failed'",
    )
    once(
        "        deadline = time.monotonic() + seconds",
        "        deadline = min(work_deadline,time.monotonic() + seconds)",
    )
    once(
        "            value = bridge.evaluate(expression)\n            if value.get('ok'):",
        "            value = bridge.evaluate(expression)\n            quit_budget_left(deadline)\n            if value.get('ok'):",
    )
    once(
        "        f.wait_event(lambda row: row.get('event') == 'ready', 180,",
        "        f.wait_event(lambda row: row.get('event') == 'ready', min(60,quit_budget_left(work_deadline)),",
    )
    once(
        "        launched = f.wait_event(lambda row: row.get('event') == 'launched', 120,",
        "        launched = f.wait_event(lambda row: row.get('event') == 'launched', min(40,quit_budget_left(work_deadline)),",
    )
    once(
        "        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence)",
        "        wait_active_renderer(launched,meta,evidence,work_deadline)\n        value = OLD['HARNESS'](launched['cdpPort'], evidence=evidence,renderer_prefix=(Path(meta['packagedRuntime']['appPath'])/'Contents/Resources/app.asar').as_uri()+'/')",
    )
    once(
        "        facts['cleanup'] = {'errors': errors",
        "        facts['caseElapsedSeconds']=180-(case_deadline-time.monotonic())\n        if time.monotonic()>case_deadline:errors.append('active-quit-case-deadline')\n        facts['cleanup'] = {'errors': errors",
    )
    lines = source.splitlines(keepends=True)
    inputs = [
        i
        for i, line in enumerate(lines)
        if line.lstrip().startswith("bridge.raw_cdp('Input.")
    ]
    assert len(inputs) == 6, "Six original UI input call sites required"
    for i in reversed(inputs):
        indentation = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
        lines.insert(i, indentation + "quit_budget_left(work_deadline)\n")
    source = "".join(lines)
    return source


def run(args):
    plan = json.loads(args.preparation.read_text())
    validate_profile(plan["profile"])
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, h in plan["sources"].items():
        assert digest(ROOT / path) == h, path
    assert digest(plan["manifestPath"]) == plan["manifestSha256"]
    assert digest(plan["compiledFixturePath"]) == plan["fixtureDerivedSha256"]
    source = deriveActiveQuitProbe(BASE.read_text())
    compile(source, str(BASE), "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert digest(args.preparation) == args.reviewed_plan_sha256
    for prefix in ["data", "evidence"]:
        assert not (ROOT / prefix / PROFILE).exists()
    ns = {
        "__file__": str(BASE),
        "__name__": "owned_native_active_quit",
        "AX": AX,
        "COLD": COLD,
        "quit_budget_left": quit_budget_left,
        "oracle": oracle,
        "pending_expression": pending_expression,
        "capture_generation": capture_generation,
        "wait_active_renderer": wait_active_renderer,
    }
    exec(compile(source, str(BASE), "exec"), ns)
    original = subprocess.Popen

    def popen(command, *a, **kw):
        if isinstance(command, list) and command[-1:] == [
            "scripts/fixtures/macos-clock-derived.mjs"
        ]:
            assert (
                kw["cwd"] == ROOT and kw["env"]["UWORK_NATIVE_FIXTURE_NAME"] == PROFILE
            )
            command = command[:-1] + [
                "scripts/fixtures/mac-native-active-quit-derived.mjs"
            ]
        return original(command, *a, **kw)

    subprocess.Popen = popen
    try:
        return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.Popen = original


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
