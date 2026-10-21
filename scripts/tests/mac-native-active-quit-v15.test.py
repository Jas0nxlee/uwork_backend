"""Actual retarget/namespace/constructor contracts only; no App, native AX or HTTP."""

import ast, hashlib, io, json, runpy, subprocess, sys, types, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-v15-probe.py"))


class Contract(unittest.TestCase):
    def test_controller_exact_retarget_and_budget_anchors_old_sources_unmodified(self):
        old = M["PREVIOUS"].read_text()
        new = M["deriveV15Controller"](old)
        reverted = (
            new.replace(
                M["PROFILE"],
                "client-native-packaged-macos-clock-arm64-active-quit-v4-20261021",
            )
            .replace(
                "scripts/fixtures/mac-native-active-quit-v15-derived.mjs",
                "scripts/fixtures/mac-native-active-quit-derived.mjs",
            )
            .replace(
                '"__name__": "owned_native_active_quit",\n        "hashlib": hashlib,\n        "QUIT_V15_BUDGET": QUIT_V15_BUDGET,\n        "safe_native_cleanup": safe_native_cleanup,\n        "capture_quit_failure_traceback": capture_quit_failure_traceback,',
                '"__name__": "owned_native_active_quit",',
            )
        )
        self.assertEqual(reverted, old)
        M["validate_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](M["PROFILE"].replace("-v7-", "-v4-"))
        core = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        for new, old in [
            (
                "    case_deadline = QUIT_V15_BUDGET.case_end",
                "    case_deadline = time.monotonic() + 180",
            ),
            ("\n        QUIT_V15_BUDGET.bind_fixture(f)", ""),
            ("\n        QUIT_V15_BUDGET.bind_guard(guard)", ""),
            ("return QUIT_V15_BUDGET.bind_bridge(value)", "return value"),
            (
                "        QUIT_V15_BUDGET.left()\n        facts['status'] = 'passed'",
                "        facts['status'] = 'passed'",
            ),
        ]:
            self.assertEqual(core.count(new), 1)
            core = core.replace(new, old)
        original_tree = ast.parse(M["LEGACY_DERIVER"](M["BASE"].read_text()))
        actual_tree = ast.parse(core)
        for tree in [original_tree, actual_tree]:
            run = next(
                n
                for n in tree.body
                if isinstance(n, ast.FunctionDef) and n.name == "run"
            )
            attempt = next(
                n for n in run.body if isinstance(n, ast.Try) and n.finalbody
            )
            attempt.finalbody = []
            for handler in attempt.handlers:
                if handler.name == "error" and len(handler.body) > 1:
                    handler.body = handler.body[:1]
        self.assertEqual(
            ast.dump(actual_tree, include_attributes=False),
            ast.dump(original_tree, include_attributes=False),
        )

    def test_actual_namespace_old_hashlib_read_fails_new_has_zero_missing_globals(self):
        ns = M["actual_clock_namespace"]()
        self.assertTrue(M["verify_globals"](ns))
        old = M["M"].copy()
        oldController = ast.parse(M["PREVIOUS"].read_text())
        run = next(
            n
            for n in oldController.body
            if isinstance(n, ast.FunctionDef) and n.name == "run"
        )
        assign = next(
            n
            for n in run.body
            if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "ns" for t in n.targets)
        )
        oldns = eval(
            compile(ast.Expression(assign.value), "old-real-namespace", "eval"), old
        )
        exec(
            compile(
                M["deriveActiveQuitProbe"](M["BASE"].read_text()),
                str(M["BASE"]),
                "exec",
            ),
            oldns,
        )
        tree = ast.parse(M["deriveActiveQuitProbe"](M["BASE"].read_text()))
        node = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Assign)
            and any(
                isinstance(t, ast.Subscript)
                and ast.unparse(t).endswith("['originalQuitLog']")
                for t in n.targets
            )
        )
        actual = compile(
            ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])),
            "actual-after-allow-log",
            "exec",
        )
        values = {
            "observations": {"activeQuitAfter": {}},
            "native_log": "controlled fixed phases only",
            "fixed_phases": ["known"],
        }
        oldns.update(values)
        with self.assertRaises(NameError):
            exec(actual, oldns)
        ns.update(values)
        exec(actual, ns)
        self.assertEqual(
            ns["observations"]["activeQuitAfter"]["originalQuitLog"]["fileSha256"],
            hashlib.sha256(values["native_log"].encode()).hexdigest(),
        )

    def test_actual_two_popen_layers_and_original_constructor_env_pass_new_scope_without_spawn(
        self,
    ):
        controller = ast.parse(M["deriveV15Controller"](M["PREVIOUS"].read_text()))
        outer = next(
            n
            for n in ast.walk(controller)
            if isinstance(n, ast.FunctionDef) and n.name == "popen"
        )
        core = ast.parse(M["deriveActiveQuitProbe"](M["BASE"].read_text()))
        inner = next(
            n
            for n in ast.walk(core)
            if isinstance(n, ast.FunctionDef) and n.name == "owned_fixture_popen"
        )
        module = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        launches = []

        def capture(command, **kw):
            launches.append((command, kw))
            return types.SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        ns = {"PROFILE": M["PROFILE"], "ROOT": ROOT, "original": capture}
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[outer], type_ignores=[])),
                "actual-outer-popen",
                "exec",
            ),
            ns,
        )
        scope = {
            "NATIVE": {"NODE24": module["NODE24"]},
            "REPO": ROOT,
            "original_popen": ns["popen"],
            "derived_launches": [],
        }
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[inner], type_ignores=[])),
                "actual-inner-popen",
                "exec",
            ),
            scope,
        )
        with patch("subprocess.Popen", scope["owned_fixture_popen"]), patch(
            "threading.Thread"
        ):
            module["Fixture"](
                M["PROFILE"],
                Path("/owned/home"),
                Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=Path("/owned/v15.json"),
            )
        self.assertEqual(len(launches), 1)
        command, kw = launches[0]
        self.assertEqual(
            command[-1], "scripts/fixtures/mac-native-active-quit-v15-derived.mjs"
        )
        code = "import{validateActiveQuitV15Profile,ACTIVE_QUIT_PROFILE}from'./scripts/fixtures/mac-native-active-quit-v15-derived.mjs';let s='';for await(const x of process.stdin)s+=x;const e=JSON.parse(s);validateActiveQuitV15Profile(e.UWORK_NATIVE_FIXTURE_NAME,e);"
        result = subprocess.run(
            [module["NODE24"], "--input-type=module", "-e", code],
            cwd=ROOT,
            input=json.dumps(kw["env"]),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_original_unclamped_io_red_and_new_single_work_cleanup_budget_enforced(
        self,
    ):
        clock = [0.0]
        budget = M["BUDGETS"]["MemoryCaseBudget"](now=lambda: clock[0])
        M["install_budget"](budget)
        calls = []

        import threading

        module = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        original = module["Fixture"].command
        actual = types.FunctionType(
            original.__code__,
            {
                **original.__globals__,
                "time": types.SimpleNamespace(
                    monotonic=lambda: clock[0],
                    sleep=lambda s: clock.__setitem__(0, clock[0] + s),
                ),
            },
            argdefs=original.__defaults__,
        )
        fixture = types.SimpleNamespace(
            events=[],
            lock=threading.Lock(),
            child=types.SimpleNamespace(wait=lambda timeout=None: None),
            wait_event=lambda *a: None,
        )

        def slow_send(value):
            clock[0] = 161
            fixture.events.append({"op": value["op"], "status": "done"})

        fixture.send = slow_send

        def old_command(op, seconds=30, **extra):
            calls.append((op, seconds))
            return actual(fixture, op, seconds, **extra)

        fixture.command = old_command
        clock[0] = 159
        self.assertEqual(old_command("poll", 30)["status"], "done")
        clock[0] = 159
        fixture.events.clear()
        budget.bind_fixture(fixture)
        with self.assertRaises(AssertionError):
            fixture.command("poll", 30)
        self.assertEqual(calls[-1], ("poll", 1))
        with self.assertRaises(AssertionError):
            M["phase_budget_left"](200)
        budget.begin_cleanup()
        self.assertEqual(M["phase_budget_left"](180), 19)
        clock[0] = 180
        with self.assertRaises(AssertionError):
            M["phase_budget_left"](200)
        M["install_budget"](None)

    def test_only_original_frontmost_helper_and_no_alternate_activation(self):
        source = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        self.assertIn("AX['perform_owned_quit_action']", source)
        self.assertEqual(source.count("quit_action('menu')"), 2)
        self.assertEqual(source.count("quit_action('cancel')"), 1)
        self.assertEqual(source.count("quit_action('allow')"), 1)
        for bad in [
            "NSRunningApplication",
            "activateWithOptions",
            "osascript",
            "Cmd+Q",
            "Runtime.evaluate",
        ]:
            self.assertNotIn(bad, source)
        helper = (ROOT / "scripts/tests/mac-native-active-quit-ax.py").read_text()
        self.assertEqual(helper.count("AXUIElementSetAttributeValue("), 1)
        self.assertIn("AXFrontmost", helper)


if __name__ == "__main__":
    unittest.main()
