"""Actual v12 namespaces, FAIL-only snapshot ordering and original env. No App/HTTP."""

import ast
import runpy
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(
    str(ROOT / "scripts/tests/mac-native-active-quit-v16-message-budget-probe.py")
)
V11 = runpy.run_path(
    str(ROOT / "scripts/tests/mac-native-active-quit-v16-raw-error-probe.py")
)


class Contract(unittest.TestCase):
    def test_original_business_except_failure_observer_and_original_confirmation_perform(
        self,
    ):
        source = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        observer = "        capture_before_cleanup(f,evidence,facts,work_deadline,QUIT_V15_BUDGET)\n"
        self.assertEqual(source.count(observer), 1)
        self.assertEqual(
            source.replace(observer, ""),
            V11["deriveActiveQuitProbe"](V11["BASE"].read_text()),
        )
        self.assertTrue(M["verify_globals"](M["actual_clock_namespace"]()))
        M["validate_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](V11["PROFILE"])

        def function(text, name):
            return next(
                n
                for n in ast.parse(text).body
                if isinstance(n, ast.FunctionDef) and n.name == name
            )

        current = function(M["AX_DERIVED"], "perform_owned_quit_action")
        result = next(n for n in ast.walk(current) if isinstance(n, ast.Return))
        self.assertIsInstance(result.value, ast.Call)
        result.value = result.value.args[0]
        next(n for n in current.body if isinstance(n, ast.Try)).handlers = []
        self.assertEqual(
            ast.dump(current, include_attributes=False),
            ast.dump(
                function(V11["AX_DERIVED"], "perform_owned_quit_action"),
                include_attributes=False,
            ),
        )
        self.assertEqual(
            ast.dump(
                function(M["AX_DERIVED"], "_confirmation"), include_attributes=False
            ),
            ast.dump(
                function(V11["AX_DERIVED"], "_confirmation"), include_attributes=False
            ),
        )

    def test_actual_fail_handler_snapshot_precedes_original_finally_and_cannot_mask(
        self,
    ):
        tree = ast.parse(M["deriveActiveQuitProbe"](M["BASE"].read_text()))
        run = next(
            n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
        )
        attempt = next(n for n in run.body if isinstance(n, ast.Try) and n.finalbody)
        code = compile(
            ast.fix_missing_locations(
                ast.Module(
                    body=attempt.handlers[0].body + attempt.finalbody, type_ignores=[]
                )
            ),
            "actual-v12-handler-and-finally",
            "exec",
        )
        for fails in [False, True]:
            order = []

            def command(op, seconds, **kw):
                order.append((op, seconds, kw))
                if fails:
                    raise RuntimeError("controlled snapshot failure")
                return {
                    "facts": {"nativeAlive": True, "nativeExit": None, "modelCalls": 5}
                }

            with tempfile.TemporaryDirectory() as folder:
                facts = {"status": "failed", "observations": {"activeQuitHeld": {}}}
                scope = M["actual_clock_namespace"]()
                budget = M["BUDGETS"]["MemoryCaseBudget"](now=lambda: 0)
                scope.update(
                    error=AssertionError("original failure"),
                    f=types.SimpleNamespace(command=command),
                    evidence=Path(folder),
                    facts=facts,
                    work_deadline=160,
                    QUIT_V15_BUDGET=budget,
                    bridge=None,
                    guard=None,
                    meta={},
                    known=set(),
                    errors=[],
                    observations=facts["observations"],
                )
                scope["capture_quit_failure_traceback"] = lambda *a: order.append(
                    "traceback"
                )
                scope["safe_native_cleanup"] = lambda **kw: order.append(
                    "original-finally"
                )
                exec(code, scope)
                self.assertEqual(facts["failure"], "AssertionError: original failure")
                self.assertEqual(facts["status"], "failed")
                self.assertEqual(order[0], ("activeQuitSnapshot", 3, {"phase": "poll"}))
                self.assertEqual(order[-1], "original-finally")
                self.assertEqual(
                    facts["beforeCleanupObservation"]["status"],
                    "unavailable" if fails else "saved",
                )
                self.assertEqual(budget.end, 160)

    def test_actual_original_fixture_constructor_env_and_two_popen_layers(self):
        p = ROOT / "scripts/tests/mac-native-active-quit-v15.test.py"
        old = runpy.run_path(str(p))
        tree = ast.parse(p.read_text())
        cls = next(
            n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Contract"
        )
        fn = next(
            n
            for n in cls.body
            if isinstance(n, ast.FunctionDef)
            and n.name
            == "test_actual_two_popen_layers_and_original_constructor_env_pass_new_scope_without_spawn"
        )
        scope = dict(
            old[
                "Contract"
            ].test_actual_two_popen_layers_and_original_constructor_env_pass_new_scope_without_spawn.__globals__
        )
        scope["M"] = M
        text = (
            ast.unparse(fn)
            .replace(
                "mac-native-active-quit-v15-derived.mjs",
                "mac-native-active-quit-v16-message-budget-derived.mjs",
            )
            .replace("validateActiveQuitV15Profile", "validateActiveQuitV16Profile")
        )
        exec(compile(text, "actual-v12-constructor-contract", "exec"), scope)
        scope[fn.name](self)


if __name__ == "__main__":
    unittest.main()
