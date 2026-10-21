"""No App: actual derived globals, command IO and original signed fixture input contracts."""

import ast, builtins, dis, runpy, sys, types, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/tests"))
M = runpy.run_path(str(ROOT / "scripts/tests/mac-message-edit-fork-probe.py"))
SOURCE = M["deriveMessageProbe"](M["BASE"].read_text())


def find_function(name):
    return next(
        n
        for n in ast.walk(ast.parse(SOURCE))
        if isinstance(n, ast.FunctionDef) and n.name == name
    )


class Contract(unittest.TestCase):
    def test_actual_namespace_recursive_globals_and_original_seat_logout_tail(self):
        ns = M["createMessageNamespace"](SOURCE, M["M"]["MemoryCaseBudget"]())
        missing = set()

        def walk(code):
            for item in dis.get_instructions(code):
                if (
                    item.opname == "LOAD_GLOBAL"
                    and item.argval not in ns
                    and not hasattr(builtins, item.argval)
                ):
                    missing.add(item.argval)
            for value in code.co_consts:
                if isinstance(value, types.CodeType):
                    walk(value)

        walk(ns["run"].__code__)
        self.assertEqual(missing, set())
        for text in [
            "f.command('memberSeat', value=False)",
            "assert proof() == delivered",
            "same-profile cold launch without bootstrap",
            "MEMORY_BUDGET.begin_cleanup()",
        ]:
            self.assertIn(text, SOURCE)
        self.assertNotIn("MEMORY_BODY", SOURCE)
        self.assertNotIn("memoryProof", SOURCE)
        runpy.run_path(str(ROOT / "scripts/tests/macos-clock-profile.test.py"))[
            "check"
        ](M["PROFILE"])

    def test_actual_fixture_retarget_injects_only_tsx_config_and_owned_new_entry(self):
        fn = find_function("owned_fixture_popen")
        calls = []
        env = {"UWORK_NATIVE_FIXTURE_NAME": M["PROFILE"]}
        ns = {
            "NATIVE": {"NODE24": "/node"},
            "REPO": ROOT,
            "original_popen": lambda *a, **kw: calls.append((a, kw)),
            "derived_launches": [],
        }
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                "actual-owned-popen",
                "exec",
            ),
            ns,
        )
        ns["owned_fixture_popen"](
            [
                "/node",
                "--import",
                "tsx",
                "scripts/fixtures/client-native-enterprise.mjs",
            ],
            cwd=ROOT,
            env=env,
        )
        self.assertEqual(
            calls[0][0][0][-1], "scripts/fixtures/mac-message-edit-fork-derived.mjs"
        )
        self.assertEqual(
            env["TSX_TSCONFIG_PATH"],
            str(ROOT / "clients/uwork/apps/zcode-cli/tsconfig.test.json"),
        )

    def test_actual_stage_gate_refreshes_ui_waits_readonly_stability_then_one_observer(
        self,
    ):
        fn = find_function("stage_proof")
        events = []
        dom = {"taskId": "sess_parent", "title": "old"}

        class Bridge:
            def evaluate(self, _):
                return {
                    "ok": True,
                    "taskId": "sess_parent",
                    "sessionId": "sess_parent",
                    "title": "settled",
                    "identity": "企业用户甲",
                    "model": "model",
                    "reasoning": "none",
                }

        class F:
            def command(self, op, seconds, **kw):
                events.append((op, kw))
                return {"facts": {"accepted": True}}

        ns = {
            **M,
            "memory_work_end": M["time"].monotonic() + 5,
            "message_db": "/owned/db",
            "meta": {"modelId": "model"},
            "root": Path("/owned"),
            "workspace": Path("/owned/packaged-workspace"),
            "bridge": Bridge(),
            "f": F(),
            "proof": lambda: {"modelCalls": 5, "own": {"settled": 3}},
            "read_local": lambda request, seconds: {"semanticSha256": "stable"},
            "memory_budget_left": lambda end: end - M["time"].monotonic(),
        }
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                "actual-stage-gate",
                "exec",
            ),
            ns,
        )
        self.assertEqual(ns["stage_proof"]("edit", dom), {"accepted": True})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][1]["phase"], "edit")
        self.assertEqual(events[0][1]["dom"]["title"], "settled")

    def test_actual_stage_slow_positive_returns_after_local_deadline_before_any_next_io(
        self,
    ):
        fn = find_function("stage_proof")
        clock = [0.0]
        calls = []

        class Bridge:
            def evaluate(self, _):
                clock[0] = 6
                return {"ok": True}

        def check(end):
            self.assertGreater(end - clock[0], 0)
            return end - clock[0]

        ns = {
            **M,
            "time": types.SimpleNamespace(
                monotonic=lambda: clock[0], sleep=lambda _: None
            ),
            "memory_work_end": 5,
            "bridge": Bridge(),
            "memory_budget_left": check,
            "proof": lambda: calls.append("forbidden"),
        }
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                "actual-stage-slow",
                "exec",
            ),
            ns,
        )
        with self.assertRaises(AssertionError):
            ns["stage_proof"]("edit", {"taskId": "sess_parent"})
        self.assertEqual(calls, [])

    def test_actual_original_fixture_constructor_env_and_retarget_pass_exact_new_validator(
        self,
    ):
        import io, subprocess, json
        from unittest.mock import patch
        from types import SimpleNamespace

        module = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        launches = []

        def capture(command, **kwargs):
            launches.append((command, kwargs))
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        ns = {
            "NATIVE": {"NODE24": module["NODE24"]},
            "REPO": ROOT,
            "original_popen": capture,
            "derived_launches": [],
        }
        exec(
            compile(
                ast.fix_missing_locations(
                    ast.Module(
                        body=[find_function("owned_fixture_popen")], type_ignores=[]
                    )
                ),
                "actual-retarget-env",
                "exec",
            ),
            ns,
        )
        with patch("subprocess.Popen", ns["owned_fixture_popen"]), patch(
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
        command, kwargs = launches[0]
        self.assertEqual(
            command[-1], "scripts/fixtures/mac-message-edit-fork-derived.mjs"
        )
        code = "import{validateMessageProfile,PROFILE}from'./scripts/fixtures/mac-message-edit-fork-derived.mjs';let s='';for await(const c of process.stdin)s+=c;const e=JSON.parse(s);validateMessageProfile(e.UWORK_NATIVE_FIXTURE_NAME,e);if(e.TSX_TSCONFIG_PATH!==process.cwd()+'/clients/uwork/apps/zcode-cli/tsconfig.test.json')throw Error('config');"
        result = subprocess.run(
            [module["NODE24"], "--input-type=module", "-e", code],
            cwd=ROOT,
            input=json.dumps(kwargs["env"]),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_original_budget_expired_callback_blocks_and_cleanup_has_twenty(self):
        clock = [0]
        budget = M["M"]["MemoryCaseBudget"](now=lambda: clock[0])
        clock[0] = 159

        def slow():
            clock[0] = 161
            return True

        with self.assertRaises(AssertionError):
            budget.call(slow)
        with self.assertRaises(AssertionError):
            budget.call(lambda: None)
        budget.begin_cleanup()
        self.assertEqual(budget.left(), 19)


if __name__ == "__main__":
    unittest.main()
