"""Real v9 namespaces and source/constructor contracts only; no native AX or App."""

import ast, runpy, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(
    str(ROOT / "scripts/tests/mac-native-active-quit-v16-native-domain-probe.py")
)
OLD = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v16-probe.py"))


class Contract(unittest.TestCase):
    def test_same_business_private_ax_original_perform_single_replacement(self):
        self.assertEqual(
            M["deriveActiveQuitProbe"](M["BASE"].read_text()),
            OLD["deriveActiveQuitProbe"](OLD["BASE"].read_text()),
        )
        self.assertTrue(M["verify_globals"](M["actual_clock_namespace"]()))
        M["validate_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](OLD["PROFILE"])
        ns = M["AX_NAMESPACE"]
        self.assertIsNot(ns["_QuitAx"], OLD["AX_NAMESPACE"]["_QuitAx"])
        tree = ast.parse(M["AX_DERIVED"])
        original = ast.parse(M["AX_SOURCE"].read_text())
        call = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "wait_quit_candidates"
        )
        replacement = ast.parse(
            'adapter.candidates(binding["pid"], end)', mode="eval"
        ).body

        class Inverse(ast.NodeTransformer):
            def visit_Call(self, node):
                return replacement if node is call else self.generic_visit(node)

        tree = Inverse().visit(tree)
        a = next(
            n
            for n in tree.body
            if isinstance(n, ast.FunctionDef) and n.name == "perform_owned_quit_action"
        )
        b = next(
            n
            for n in original.body
            if isinstance(n, ast.FunctionDef) and n.name == "perform_owned_quit_action"
        )
        self.assertEqual(
            ast.dump(a, include_attributes=False), ast.dump(b, include_attributes=False)
        )
        self.assertEqual(
            ast.dump(
                next(
                    n
                    for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == "_confirmation"
                ),
                include_attributes=False,
            ),
            ast.dump(
                next(
                    n
                    for n in original.body
                    if isinstance(n, ast.FunctionDef) and n.name == "_confirmation"
                ),
                include_attributes=False,
            ),
        )

    def test_actual_original_constructor_env_and_two_popen_layers(self):
        source = (ROOT / "scripts/tests/mac-native-active-quit-v15.test.py").read_text()
        tree = ast.parse(source)
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
        old = runpy.run_path(
            str(ROOT / "scripts/tests/mac-native-active-quit-v15.test.py")
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
                "mac-native-active-quit-v16-native-domain-derived.mjs",
            )
            .replace("validateActiveQuitV15Profile", "validateActiveQuitV16Profile")
        )
        exec(compile(text, "actual-v9-constructor-contract", "exec"), scope)
        scope[fn.name](self)


if __name__ == "__main__":
    unittest.main()
