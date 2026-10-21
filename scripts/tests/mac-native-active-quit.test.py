"""Pure actual derived source contracts; never opens an App or backend."""

import ast, copy, pathlib, runpy, types, unittest

R = pathlib.Path(__file__).resolve().parents[2]
M = runpy.run_path(str(R / "scripts/tests/mac-native-active-quit-probe.py"))


class Contracts(unittest.TestCase):
    def test_original_profile_and_full_derived_python(self):
        self.assertEqual(M["validate_profile"](M["PROFILE"]), M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_profile"](M["PROFILE"].replace("-clock-", "-"))
        s = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        compile(s, "actual-active-quit", "exec")
        self.assertNotIn("Page.reload", s)
        self.assertNotIn("f.command('memberSeat'", s)
        self.assertNotIn("original-logout", s)
        self.assertIn("f.command('stopNative', 25)", s)
        self.assertIn("AX['perform_owned_quit_action']", s)
        self.assertNotIn("'app.quit'", s)
        self.assertEqual(s.count("quit_action('menu')"), 2)
        self.assertEqual(s.count("quit_action('cancel')"), 1)
        self.assertEqual(s.count("quit_action('allow')"), 1)

    def test_allows_only_actual_same_task_pending_without_new_prompt_shortcuts(self):
        expr = M["pending_expression"]("sess-owned")
        self.assertIn("sess-owned", expr)
        self.assertIn("[data-session-id]", expr)
        self.assertIn("v4-stop", expr)
        self.assertNotIn("dispatchEvent", expr)
        self.assertNotIn("platform", expr)
        self.assertIn("MACOS_ACTIVE_QUIT_HOLD_20261021", expr)

    def test_budget_and_original_cleanup_are_not_weakened(self):
        s = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        self.assertIn("case_deadline = time.monotonic() + 180", s)
        self.assertIn("work_deadline = case_deadline - 20", s)
        self.assertIn("hold['remainingMs']>=15000", s)
        self.assertIn("exit_receipt['signal'] is None", s)
        self.assertIn("assert not remaining_pids", s)
        self.assertIn("known-process-still-alive", s)

    def test_complete_actual_run_has_no_private_helper_local_or_cell_shadow(self):
        source = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        full_code = compile(source, "actual-full-derived-run", "exec")
        run_code = next(
            value
            for value in full_code.co_consts
            if isinstance(value, types.CodeType) and value.co_name == "run"
        )
        budget_name = "quit_budget_left" if "quit_budget_left" in M else "remaining"
        helpers = {
            budget_name,
            "AX",
            "COLD",
            "oracle",
            "pending_expression",
            "capture_generation",
            "wait_active_renderer",
        }
        local_names = set(run_code.co_varnames) | set(run_code.co_cellvars)
        self.assertEqual(
            helpers & local_names,
            set(),
            "Actual complete run scope shadows a private global helper",
        )

    def actual_function(self, name, scope):
        source = M["deriveActiveQuitProbe"](M["BASE"].read_text())
        node = next(
            n
            for n in ast.walk(ast.parse(source))
            if isinstance(n, ast.FunctionDef) and n.name == name
        )
        exec(
            compile(
                ast.fix_missing_locations(
                    ast.Module(body=[copy.deepcopy(node)], type_ignores=[])
                ),
                "actual-derived-" + name,
                "exec",
            ),
            scope,
        )
        return scope[name]

    def guard(self, clock):
        env = dict(M["quit_budget_left"].__globals__)
        env["time"] = types.SimpleNamespace(monotonic=lambda: clock[0])
        return types.FunctionType(M["quit_budget_left"].__code__, env)

    def test_actual_until_slow_positive_projection_past_local_or_work_deadline_rejects(
        self,
    ):
        for work, local, after in [(10, 45, 11), (20, 3, 4)]:
            clock = [0]

            def evaluate(_):
                clock[0] = after
                return {"ok": True}

            scope = {
                "time": types.SimpleNamespace(monotonic=lambda: clock[0]),
                "work_deadline": work,
                "bridge": types.SimpleNamespace(evaluate=evaluate),
                "quit_budget_left": self.guard(clock),
            }
            with self.subTest(work=work, local=local), self.assertRaises(
                AssertionError
            ):
                self.actual_function("until", scope)("readonly", "deadline", local)

    def test_actual_click_stops_before_first_or_later_expired_input_without_retry(self):
        for first_clock in [9, 11]:
            clock = [0]
            sent = []

            def until(*_):
                clock[0] = max(clock[0], first_clock)
                return {"ok": True, "x": 1, "y": 2}

            def send(method, **kw):
                sent.append((method, kw["type"]))
                clock[0] = 11

            scope = {
                "json": __import__("json"),
                "until": until,
                "bridge": types.SimpleNamespace(raw_cdp=send),
                "quit_budget_left": self.guard(clock),
                "work_deadline": 10,
                "observations": {},
                "actions": [],
            }
            with self.subTest(first_clock=first_clock), self.assertRaises(
                AssertionError
            ):
                self.actual_function("click", scope)(
                    "original-selector", "one-original-action"
                )
            self.assertEqual(
                sent,
                (
                    [("Input.dispatchMouseEvent", "mouseMoved")]
                    if first_clock == 9
                    else []
                ),
            )

    def test_actual_quit_action_failure_preserves_original_error_and_safe_receipt_when_save_fails(
        self,
    ):
        import json, tempfile

        original = AssertionError("Owned foreground deadline")
        original.ownedForegroundReceipt = {
            "pid": 123,
            "wasFrontmost": False,
            "setCode": 0,
            "readbackSamples": [{"elapsedMs": 100, "frontmost": False}],
        }

        def fail(*_, **__):
            raise original

        observations = {}
        with tempfile.TemporaryDirectory(prefix="owned-quit-pure-") as directory:
            scope = {
                "AX": {"perform_owned_quit_action": fail},
                "binding": {},
                "work_deadline": 10,
                "time": types.SimpleNamespace(monotonic=lambda: 0),
                "actor_guard": lambda: True,
                "observations": observations,
                "evidence": pathlib.Path(directory) / "missing",
                "json": json,
            }
            with self.assertRaises(AssertionError) as caught:
                self.actual_function("quit_action", scope)("menu")
        self.assertIs(caught.exception, original)
        self.assertEqual(
            observations["originalQuitActions"][0]["ownedForegroundReceipt"],
            original.ownedForegroundReceipt,
        )


if __name__ == "__main__":
    unittest.main()
