"""Fresh v15/profile v7 only; no new activation strategy or original Quit business change."""

import argparse, ast, builtins, dis, hashlib, json, runpy, types, subprocess, select, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIOUS = ROOT / "scripts/tests/mac-native-active-quit-probe.py"
PROFILE = "client-native-packaged-macos-clock-arm64-active-quit-v7-20261021"


def deriveV15Controller(source):
    def once(a, b):
        nonlocal source
        assert source.count(a) == 1, a
        source = source.replace(a, b)

    once("client-native-packaged-macos-clock-arm64-active-quit-v4-20261021", PROFILE)
    once(
        "scripts/fixtures/mac-native-active-quit-derived.mjs",
        "scripts/fixtures/mac-native-active-quit-v15-derived.mjs",
    )
    once(
        '"__name__": "owned_native_active_quit",',
        '"__name__": "owned_native_active_quit",\n        "hashlib": hashlib,\n        "QUIT_V15_BUDGET": QUIT_V15_BUDGET,\n        "safe_native_cleanup": safe_native_cleanup,\n        "capture_quit_failure_traceback": capture_quit_failure_traceback,',
    )
    return source


def controller_namespace():
    ns = {
        "__file__": str(Path(__file__).resolve()),
        "__name__": "reviewed_v15_active_quit_controller",
    }
    exec(compile(deriveV15Controller(PREVIOUS.read_text()), str(PREVIOUS), "exec"), ns)
    return ns


M = controller_namespace()
BASE = M["BASE"]
LEGACY_DERIVER = M["deriveActiveQuitProbe"]
BUDGETS = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))
ACTIVE_BUDGET = None
SAFE = runpy.run_path(str(ROOT / "scripts/tests/native-safe-cleanup.py"))


def phase_budget_left(deadline):
    assert ACTIVE_BUDGET is not None, "V15 active Quit budget not installed"
    value = min(deadline - ACTIVE_BUDGET.now(), ACTIVE_BUDGET.left())
    assert value > 0, "Active Quit local/shared phase budget exhausted"
    return value


def install_budget(budget):
    global ACTIVE_BUDGET
    ACTIVE_BUDGET = budget
    M["QUIT_V15_BUDGET"] = budget
    M["quit_budget_left"] = phase_budget_left
    M["safe_native_cleanup"] = SAFE["safe_native_cleanup"]


def deriveActiveQuitProbe(original):
    source = LEGACY_DERIVER(original)

    def once(a, b):
        nonlocal source
        assert source.count(a) == 1, a
        source = source.replace(a, b)

    once(
        "    case_deadline = time.monotonic() + 180",
        "    case_deadline = QUIT_V15_BUDGET.case_end",
    )
    once(
        "        assert len(derived_launches) == 1",
        "        assert len(derived_launches) == 1\n        QUIT_V15_BUDGET.bind_fixture(f)",
    )
    once(
        "        guard = OLD['OsGuard'](protocol_only=True)",
        "        guard = OLD['OsGuard'](protocol_only=True)\n        QUIT_V15_BUDGET.bind_guard(guard)",
    )
    once(
        "        return value\n\n    try:",
        "        return QUIT_V15_BUDGET.bind_bridge(value)\n\n    try:",
    )
    once(
        "    finally:\n        if f:",
        "    finally:\n        QUIT_V15_BUDGET.begin_cleanup()\n        if f:",
    )
    once(
        "        facts['status'] = 'passed'",
        "        QUIT_V15_BUDGET.left()\n        facts['status'] = 'passed'",
    )
    source = SAFE["derive_safe_native_cleanup"](source, "QUIT_V15_BUDGET")
    catch = "    except BaseException as error:\n        facts['failure'] = type(error).__name__ + ': ' + str(error)\n"
    assert source.count(catch) == 1
    return source.replace(
        catch,
        catch
        + "        try:\n            capture_quit_failure_traceback(error,evidence,facts)\n        except BaseException:\n            pass\n",
    )


M["deriveActiveQuitProbe"] = deriveActiveQuitProbe
M["quit_budget_left"] = phase_budget_left
M["QUIT_V15_BUDGET"] = None
M["safe_native_cleanup"] = SAFE["safe_native_cleanup"]
validate_profile = M["validate_profile"]


def capture_quit_failure_traceback(error, evidence, facts):
    """Only bounded code location metadata. Never captures frame locals, args or env."""
    try:
        frames = []
        tb = error.__traceback__
        count = 0
        while tb is not None and count < 32:
            code = tb.tb_frame.f_code
            absolute = os.path.abspath(code.co_filename)
            relative = (
                os.path.relpath(absolute, str(ROOT))
                if absolute.startswith(str(ROOT) + os.sep)
                else "<non-project-frame>"
            )
            name = (
                code.co_name
                if re.fullmatch(
                    r"[A-Za-z_][A-Za-z0-9_]{0,79}|<lambda>|<module>", code.co_name
                )
                else "<non-identifier-function>"
            )
            frames.append(
                {"file": relative, "function": name, "line": int(tb.tb_lineno)}
            )
            tb = tb.tb_next
            count += 1
        payload = {
            "schema": "owned-native-quit-failure-location-v1",
            "exceptionType": type(error).__name__,
            "frames": frames,
            "truncated": tb is not None,
            "localsCaptured": False,
            "argumentsCaptured": False,
            "environmentCaptured": False,
        }
        serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        assert len(serialized.encode()) <= 16384
        target = evidence / "active-quit-failure-traceback.json"
        fd = os.open(
            target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(fd, "w") as stream:
            stream.write(serialized)
        facts["failureTracebackCapture"] = {
            "status": "saved",
            "file": "active-quit-failure-traceback.json",
            "frames": len(frames),
            "truncated": payload["truncated"],
        }
    except BaseException as observer_error:
        try:
            facts["failureTracebackCapture"] = {
                "status": "unavailable",
                "observerErrorType": type(observer_error).__name__,
            }
        except BaseException:
            pass
        try:
            sys.stderr.write(
                "owned-quit-failure-location-unavailable: "
                + type(observer_error).__name__
                + "\n"
            )
        except BaseException:
            pass


M["capture_quit_failure_traceback"] = capture_quit_failure_traceback


def actual_clock_namespace(source=None):
    controller = ast.parse(deriveV15Controller(PREVIOUS.read_text()))
    run = next(
        n for n in controller.body if isinstance(n, ast.FunctionDef) and n.name == "run"
    )
    assignment = next(
        n
        for n in run.body
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "ns" for t in n.targets)
    )
    ns = eval(compile(ast.Expression(assignment.value), str(PREVIOUS), "eval"), M)
    code = source if source is not None else deriveActiveQuitProbe(BASE.read_text())
    exec(compile(code, str(BASE), "exec"), ns)
    return ns


def verify_globals(ns):
    missing = set()

    def visit(code):
        for instruction in dis.get_instructions(code):
            if (
                instruction.opname == "LOAD_GLOBAL"
                and instruction.argval not in ns
                and not hasattr(builtins, instruction.argval)
            ):
                missing.add(instruction.argval)
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                visit(value)

    visit(ns["run"].__code__)
    assert missing == set(), missing
    return True


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    plan = json.loads(args.preparation.read_text())
    validate_profile(plan["profile"])
    assert plan["profile"] == PROFILE
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, h in plan["sources"].items():
        assert digest(ROOT / path) == h, path
    assert digest(__file__) == plan["driverSha256"]
    source = deriveV15Controller(PREVIOUS.read_text())
    assert (
        hashlib.sha256(source.encode()).hexdigest() == plan["derivedControllerSha256"]
    )
    assert digest(plan["compiledControllerPath"]) == plan["derivedControllerSha256"]
    verify_globals(actual_clock_namespace())
    if not args.run:
        return M["run"](args)
    budget = BUDGETS["MemoryCaseBudget"]()
    install_budget(budget)
    original_run, original_select = subprocess.run, select.select
    subprocess.run = lambda *a, **kw: budget.subprocess(original_run, *a, **kw)
    select.select = lambda *a, **kw: budget.select(original_select, *a, **kw)
    try:
        return M["run"](args)
    finally:
        subprocess.run, select.select = original_run, original_select


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
