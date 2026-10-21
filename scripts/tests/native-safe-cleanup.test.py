"""Execute actual derived finally AST with original budget bindings; no processes or sockets."""

import ast, json, runpy, sys, tempfile, threading, types, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v15-probe.py"))
SAFE = runpy.run_path(str(ROOT / "scripts/tests/native-safe-cleanup.py"))
OLD = (
    ROOT
    / "evidence/client-macos-active-quit-v15-preparation-20261021/before-safe-cleanup-review/preparation/probe-derived.py"
)


def final_code(source):
    tree = ast.parse(source)
    run = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
    )
    attempt = next(n for n in run.body if isinstance(n, ast.Try) and n.finalbody)
    return compile(
        ast.fix_missing_locations(ast.Module(body=attempt.finalbody, type_ignores=[])),
        "actual-derived-finally",
        "exec",
    )


def scenario(folder, clock_value, *, stop_error=False):
    calls = []
    clock = [0.0]
    budget = M["BUDGETS"]["MemoryCaseBudget"](now=lambda: clock[0])
    clock[0] = clock_value

    class Child:
        returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            calls.append("fixture-terminate")
            self.returncode = 0

        def kill(self):
            calls.append("fixture-kill")
            self.returncode = -9

        def wait(self, timeout=None):
            calls.append("fixture-wait")
            return self.returncode

    child = Child()
    child.stdin = types.SimpleNamespace(close=lambda: calls.append("fixture-eof"))

    def stop(op, seconds, **kw):
        calls.append(op)
        if stop_error:
            raise OSError("controlled teardown failure")
        return {"status": "done"}

    fixture = types.SimpleNamespace(
        child=child,
        lock=threading.Lock(),
        events=[],
        command=stop,
        wait_event=lambda *a: None,
        send=lambda x: None,
    )

    def guard_close():
        calls.append("guard-close")
        return {"protocolRestored": True, "usesSystemClipboard": False}

    gchild = types.SimpleNamespace(
        stdin=types.SimpleNamespace(close=lambda: calls.append("guard-eof")),
        wait=lambda timeout=None: 0,
    )
    guard = types.SimpleNamespace(
        close=guard_close, command=lambda *a: None, read=lambda: None, child=gchild
    )

    def close_bridge():
        calls.append("bridge-close")
        (folder / "harness-cleanup.json").write_text(
            json.dumps({"daemonAbsent": True, "socketClosed": True})
        )

    bridge = types.SimpleNamespace(
        kill=close_bridge, raw_cdp=lambda *a, **k: None, evaluate=lambda *a: None
    )
    budget.bind_fixture(fixture)
    budget.bind_guard(guard)
    budget.bind_bridge(bridge)
    ns = {
        "f": fixture,
        "bridge": bridge,
        "guard": guard,
        "OLD": {"owned_processes": lambda *a: []},
        "meta": {},
        "known": {123, 124},
        "errors": [],
        "observations": {},
        "facts": {"status": "passed"},
        "evidence": folder,
        "budget": budget,
        "QUIT_V15_BUDGET": budget,
        "safe_native_cleanup": SAFE["safe_native_cleanup"],
        "subprocess": __import__("subprocess"),
        "json": json,
        "time": types.SimpleNamespace(monotonic=lambda: clock[0]),
        "case_deadline": 180,
        "socket": __import__("socket"),
        "urlparse": __import__("urllib.parse", fromlist=["urlparse"]).urlparse,
    }
    return ns, calls


def execute_new(ns):
    with patch(
        "subprocess.run", return_value=types.SimpleNamespace(returncode=1, stdout="")
    ):
        exec(final_code(M["deriveActiveQuitProbe"](M["BASE"].read_text())), ns)


class Contract(unittest.TestCase):
    def test_original_v5_actual_finally_budget_assertion_skips_guard_and_result_red(
        self,
    ):
        with tempfile.TemporaryDirectory(prefix="owned-cleanup-red-") as tmp:
            folder = Path(tmp)
            ns, calls = scenario(folder, 180)
            with self.assertRaises(AssertionError):
                exec(final_code(OLD.read_text()), ns)
            self.assertIn("fixture-terminate", calls)
            self.assertNotIn("guard-close", calls)
            self.assertFalse((folder / "result.json").exists())

    def test_new_actual_finally_at_work160_uses_twenty_and_prioritizes_os_restore(self):
        with tempfile.TemporaryDirectory(prefix="owned-cleanup-green-") as tmp:
            folder = Path(tmp)
            ns, calls = scenario(folder, 160)
            execute_new(ns)
            self.assertEqual(calls[0], "guard-close")
            self.assertIn("stopNative", calls)
            self.assertIn("bridge-close", calls)
            self.assertEqual(ns["budget"].case_end, 180)
            result = json.loads((folder / "result.json").read_text())
            self.assertEqual(result["status"], "passed")
            self.assertTrue(result["observations"]["osRestore"]["protocolRestored"])

    def test_new_actual_finally_case180_attempts_guard_eof_never_claims_restore_and_always_writes_failed(
        self,
    ):
        with tempfile.TemporaryDirectory(prefix="owned-cleanup-expired-") as tmp:
            folder = Path(tmp)
            ns, calls = scenario(folder, 180)
            execute_new(ns)
            self.assertIn("guard-eof", calls)
            self.assertIn("fixture-terminate", calls)
            self.assertNotIn("guard-close", calls)
            result = json.loads((folder / "result.json").read_text())
            self.assertEqual(result["status"], "failed")
            self.assertFalse(ns["observations"]["osRestoreAttempt"]["verified"])
            self.assertFalse(ns["observations"]["cleanupEofFallbacks"][0]["verified"])
            self.assertIsNone(result["cleanup"]["knownPidsAbsent"])
            labels = {r["step"] for r in result["cleanup"]["steps"]}
            self.assertTrue(
                {"OS-guard", "stopNative", "harness", "known-process-census"} <= labels
            )

    def test_stop_failure_and_census_failure_cannot_skip_later_steps_or_result(self):
        with tempfile.TemporaryDirectory(prefix="owned-cleanup-isolated-") as tmp:
            folder = Path(tmp)
            ns, calls = scenario(folder, 160, stop_error=True)
            ns["f"].events = [{"event": "launched", "pid": 123}]
            ns["OLD"]["owned_processes"] = lambda *a: (_ for _ in ()).throw(
                OSError("controlled census")
            )
            execute_new(ns)
            result = json.loads((folder / "result.json").read_text())
            self.assertEqual(result["status"], "failed")
            self.assertEqual(calls[0], "guard-close")
            self.assertIn("bridge-close", calls)
            self.assertIn("fixture-terminate", calls)
            self.assertTrue(
                any(
                    s.startswith("owned-process-census:")
                    for s in result["cleanup"]["errors"]
                )
            )
            self.assertTrue(
                any(s.startswith("stopNative:") for s in result["cleanup"]["errors"])
            )

    def test_deriver_is_pure_and_rejects_unknown_cleanup_shape(self):
        source = M["LEGACY_DERIVER"](M["BASE"].read_text())
        self.assertIn(
            "safe_native_cleanup(",
            SAFE["derive_safe_native_cleanup"](source, "OWNED_BUDGET"),
        )
        with self.assertRaises(AssertionError):
            SAFE["derive_safe_native_cleanup"](
                source.replace("known-process-still-alive", "unknown"), "OWNED_BUDGET"
            )


if __name__ == "__main__":
    unittest.main()
