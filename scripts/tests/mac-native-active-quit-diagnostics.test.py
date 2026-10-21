"""Execute actual exception catch + safe finally only; no AX, processes, sockets or backend."""

import ast, json, runpy, sys, tempfile, types, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v15-probe.py"))
OLD = (
    ROOT
    / "evidence/client-macos-active-quit-v15-preparation-20261021/before-traceback-review/preparation/probe-derived.py"
)


def outer(source):
    run = next(
        n
        for n in ast.parse(source).body
        if isinstance(n, ast.FunctionDef) and n.name == "run"
    )
    return next(n for n in run.body if isinstance(n, ast.Try) and n.finalbody)


def execute_catch_finally(folder, capture=None):
    code = 'def owned_failure(argument):\n local_value="DO_NOT_CAPTURE_LOCAL"\n raise AssertionError()\n'
    functions = {}
    exec(
        compile(code, str(ROOT / "scripts/tests/mac-native-active-quit-ax.py"), "exec"),
        functions,
    )
    attempt = outer(M["deriveActiveQuitProbe"](M["BASE"].read_text()))
    attempt.body = [
        ast.Expr(
            value=ast.Call(
                func=ast.Name(id="trigger", ctx=ast.Load()),
                args=[ast.Constant(value="DO_NOT_CAPTURE_ARGUMENT")],
                keywords=[],
            )
        )
    ]
    budget = M["BUDGETS"]["MemoryCaseBudget"](now=lambda: 0)
    obs = {}
    facts = {"status": "failed", "checks": [], "observations": obs}
    ns = {
        "trigger": functions["owned_failure"],
        "capture_quit_failure_traceback": capture
        or M["capture_quit_failure_traceback"],
        "safe_native_cleanup": M["SAFE"]["safe_native_cleanup"],
        "QUIT_V15_BUDGET": budget,
        "f": None,
        "bridge": None,
        "guard": None,
        "OLD": {},
        "meta": {},
        "known": set(),
        "errors": [],
        "observations": obs,
        "facts": facts,
        "evidence": folder,
    }
    exec(
        compile(
            ast.fix_missing_locations(ast.Module(body=[attempt], type_ignores=[])),
            "actual-catch-finally-test",
            "exec",
        ),
        ns,
    )
    return json.loads((folder / "result.json").read_text())


class Contract(unittest.TestCase):
    def test_actual_before_catch_business_and_finally_equal_v6(self):
        before = outer(OLD.read_text())
        after = outer(M["deriveActiveQuitProbe"](M["BASE"].read_text()))
        self.assertEqual(
            ast.dump(
                ast.Module(body=before.body, type_ignores=[]), include_attributes=False
            ),
            ast.dump(
                ast.Module(body=after.body, type_ignores=[]), include_attributes=False
            ),
        )
        self.assertEqual(
            ast.dump(
                ast.Module(body=before.finalbody, type_ignores=[]),
                include_attributes=False,
            ),
            ast.dump(
                ast.Module(body=after.finalbody, type_ignores=[]),
                include_attributes=False,
            ),
        )
        self.assertEqual(
            ast.dump(before.handlers[0].body[0]), ast.dump(after.handlers[0].body[0])
        )

    def test_actual_catch_records_only_code_locations_and_runs_finally(self):
        with tempfile.TemporaryDirectory(prefix="owned-quit-location-") as tmp:
            folder = Path(tmp)
            result = execute_catch_finally(folder)
            path = folder / "active-quit-failure-traceback.json"
            value = json.loads(path.read_text())
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["failure"], "AssertionError: ")
            self.assertEqual(result["failureTracebackCapture"]["status"], "saved")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(
                any(
                    frame["file"] == "scripts/tests/mac-native-active-quit-ax.py"
                    and frame["function"] == "owned_failure"
                    and frame["line"] == 3
                    for frame in value["frames"]
                )
            )
            for frame in value["frames"]:
                self.assertEqual(set(frame), {"file", "function", "line"})
            self.assertNotIn("DO_NOT_CAPTURE", path.read_text())
            self.assertFalse(value["localsCaptured"])
            self.assertFalse(value["argumentsCaptured"])
            self.assertFalse(value["environmentCaptured"])
            self.assertTrue(result["cleanup"]["knownPidsAbsent"])

    def test_observer_exception_or_unwritable_receipt_cannot_mask_original_or_skip_result(
        self,
    ):
        with tempfile.TemporaryDirectory(prefix="owned-quit-observer-") as tmp:
            folder = Path(tmp)

            def fail(*args):
                raise OSError("controlled observer failure")

            result = execute_catch_finally(folder, fail)
            self.assertEqual(result["failure"], "AssertionError: ")
            self.assertEqual(result["status"], "failed")
            self.assertIn("cleanup", result)
            # Existing file triggers O_EXCL instead of modifying the receipt; observer reports unavailable.
            path = folder / "active-quit-failure-traceback.json"
            path.write_text("owned existing receipt")
            result = execute_catch_finally(folder)
            self.assertEqual(path.read_text(), "owned existing receipt")
            self.assertEqual(result["failureTracebackCapture"]["status"], "unavailable")
            self.assertEqual(result["failure"], "AssertionError: ")


if __name__ == "__main__":
    unittest.main()
