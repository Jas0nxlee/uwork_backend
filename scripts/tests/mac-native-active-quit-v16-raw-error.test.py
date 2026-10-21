"""Exact v11 namespace and original Fixture construction contracts; no App or HTTP."""

import ast
import runpy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(
    str(ROOT / "scripts/tests/mac-native-active-quit-v16-raw-error-probe.py")
)
V10 = runpy.run_path(str(M["V10_DRIVER"]))


class Contract(unittest.TestCase):
    def test_original_business_and_perform_unchanged_only_private_raw_is_overridden(
        self,
    ):
        self.assertEqual(
            M["deriveActiveQuitProbe"](M["BASE"].read_text()),
            V10["deriveActiveQuitProbe"](V10["BASE"].read_text()),
        )
        self.assertTrue(M["verify_globals"](M["actual_clock_namespace"]()))
        M["validate_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](V10["PROFILE"])
        self.assertNotEqual(
            M["AX_NAMESPACE"]["_QuitAx"]._raw.__code__.co_filename,
            V10["AX_NAMESPACE"]["_QuitAx"]._raw.__code__.co_filename,
        )
        for name in ["perform_owned_quit_action", "_confirmation"]:

            def function(source):
                return next(
                    n
                    for n in ast.parse(source).body
                    if isinstance(n, ast.FunctionDef) and n.name == name
                )

            self.assertEqual(
                ast.dump(function(M["AX_DERIVED"]), include_attributes=False),
                ast.dump(function(V10["AX_DERIVED"]), include_attributes=False),
            )

    def test_actual_original_fixture_constructor_env_and_two_popen_layers(self):
        path = ROOT / "scripts/tests/mac-native-active-quit-v15.test.py"
        old = runpy.run_path(str(path))
        tree = ast.parse(path.read_text())
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
                "mac-native-active-quit-v16-raw-error-derived.mjs",
            )
            .replace("validateActiveQuitV15Profile", "validateActiveQuitV16Profile")
        )
        exec(compile(text, "actual-v11-constructor-contract", "exec"), scope)
        scope[fn.name](self)


if __name__ == "__main__":
    unittest.main()
