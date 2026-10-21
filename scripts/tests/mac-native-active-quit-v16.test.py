"""Actual v8 derived namespaces and bounded observer; no AX libraries, App or HTTP."""

import ast, json, os, runpy, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v16-probe.py"))
OLD = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v15-probe.py"))


class Contract(unittest.TestCase):
    def test_actual_business_equal_except_cap_receipt_and_exact_profile(self):
        source = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        self.assertEqual(
            source.count(
                "                capture_candidate_bound(error,evidence,facts)\n"
            ),
            1,
        )
        self.assertEqual(
            source.replace(
                "                capture_candidate_bound(error,evidence,facts)\n", ""
            ),
            OLD["deriveActiveQuitProbe"](OLD["BASE"].read_text()),
        )
        M["validate_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](OLD["PROFILE"])
        self.assertTrue(M["verify_globals"](M["actual_clock_namespace"]()))

    def test_private_ax_namespace_retains_actions_and_original_module_unchanged(self):
        original = runpy.run_path(str(M["AX_SOURCE"]))
        self.assertIsNot(M["AX_NAMESPACE"]["_QuitAx"], original["_QuitAx"])
        self.assertEqual(
            M["AX_NAMESPACE"]["_QuitAx"].candidates.__code__.co_filename,
            "actual-bounded-candidate-diagnostic",
        )
        self.assertNotEqual(
            original["_QuitAx"].candidates.__code__.co_filename,
            "actual-bounded-candidate-diagnostic",
        )
        tree = ast.parse(M["AX_DERIVED"])
        old = ast.parse(M["AX_SOURCE"].read_text())
        a = next(
            n
            for n in tree.body
            if isinstance(n, ast.FunctionDef) and n.name == "perform_owned_quit_action"
        )
        b = next(
            n
            for n in old.body
            if isinstance(n, ast.FunctionDef) and n.name == "perform_owned_quit_action"
        )
        # Added owner callback and exception attachment only; no action/condition changes.
        a.body = [
            n
            for n in a.body
            if not (
                isinstance(n, ast.Assign)
                and any(
                    isinstance(t, ast.Attribute)
                    and t.attr == "_candidate_diag_owner_guard"
                    for t in n.targets
                )
            )
        ]
        attempt = next(n for n in a.body if isinstance(n, ast.Try))
        attempt.handlers = []
        self.assertEqual(
            ast.dump(a, include_attributes=False), ast.dump(b, include_attributes=False)
        )

    def test_actual_capture_only_cap_private_and_failure_does_not_mask(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            facts = {}
            error = AssertionError()
            error.ownedCandidateBoundReceipt = {
                "schema": "owned-native-candidate-bound-v1",
                "depth": 5,
                "textsCaptured": False,
            }
            M["capture_candidate_bound"](error, root, facts)
            p = root / "active-quit-candidate-bound.json"
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(p.read_text())["depth"], 5)
            M["capture_candidate_bound"](error, root, facts)
            self.assertEqual(
                facts["candidateBoundObservation"]["status"], "unavailable"
            )
            self.assertEqual(str(error), "")
            M["capture_candidate_bound"](RuntimeError("not a cap"), root, {})

    def test_actual_constructor_env_and_popen_layers_without_spawn(self):
        oldtest = runpy.run_path(
            str(ROOT / "scripts/tests/mac-native-active-quit-v15.test.py")
        )
        tree = ast.parse(
            (ROOT / "scripts/tests/mac-native-active-quit-v15.test.py").read_text()
        )
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
        text = (
            ast.unparse(fn)
            .replace(
                "mac-native-active-quit-v15-derived.mjs",
                "mac-native-active-quit-v16-derived.mjs",
            )
            .replace("validateActiveQuitV15Profile", "validateActiveQuitV16Profile")
        )
        scope = dict(
            oldtest[
                "Contract"
            ].test_actual_two_popen_layers_and_original_constructor_env_pass_new_scope_without_spawn.__globals__
        )
        scope["M"] = M
        exec(compile(text, "actual-v8-constructor-contract", "exec"), scope)
        scope[fn.name](self)

    def test_fixture_is_exact_artifact_retarget(self):
        import subprocess

        code = """import fs from 'node:fs';import assert from 'node:assert/strict';import * as a from './scripts/fixtures/mac-native-active-quit-v15-derived.mjs';import * as b from './scripts/fixtures/mac-native-active-quit-v16-derived.mjs';let s=fs.readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8');assert.equal(b.deriveActiveQuitFixture(s).replace('./native-packaged-macos-arm64-memory-manifest-runtime.mjs','./native-packaged-macos-arm64-project-memory-runtime.mjs'),a.deriveActiveQuitFixture(s));b.validateActiveQuitV16Profile(b.ACTIVE_QUIT_PROFILE,{UWORK_NATIVE_CLIENT_EXPERIENCE:'enabled',UWORK_NATIVE_CONFIGURATION_WITNESS:'enabled',UWORK_NATIVE_PACKAGED_MANIFEST:'bound'});"""
        r = subprocess.run(
            [
                "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node",
                "--input-type=module",
                "-e",
                code,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
