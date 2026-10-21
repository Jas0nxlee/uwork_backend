"""Actual derived source, shared budget and terminal-command contracts only; no App/GUI."""

import ast, json, runpy, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
M = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))


class Contract(unittest.TestCase):
    def test_actual_source_compiles_preserves_seat_logout_and_every_input_has_budget(
        self,
    ):
        source = M["deriveMemoryProbe"](M["BASE"].read_text())
        code = compile(source, "actual-memory", "exec")
        tree = ast.parse(source)
        run = next(
            c for c in code.co_consts if hasattr(c, "co_name") and c.co_name == "run"
        )
        self.assertNotIn(
            "memory_budget_left", set(run.co_varnames) | set(run.co_cellvars)
        )
        self.assertIn("assert proof() == delivered", source)
        self.assertIn("f.command('memberSeat', value=False)", source)
        self.assertIn("same-profile cold launch without bootstrap", source)
        self.assertIn("delivered['own']['count']==8", source)
        self.assertIn("delivered['modelCalls']==10", source)
        for node in ast.walk(tree):
            if not hasattr(node, "body") or not isinstance(node.body, list):
                continue
            for i, statement in enumerate(node.body):
                if (
                    isinstance(statement, ast.Expr)
                    and isinstance(statement.value, ast.Call)
                    and isinstance(statement.value.func, ast.Attribute)
                    and statement.value.func.attr == "raw_cdp"
                    and statement.value.args
                    and isinstance(statement.value.args[0], ast.Constant)
                    and str(statement.value.args[0].value).startswith("Input.")
                ):
                    previous = node.body[i - 1]
                    self.assertIsInstance(previous, ast.Expr)
                    self.assertIsInstance(previous.value, ast.Call)
                    self.assertEqual(previous.value.func.id, "memory_budget_left")

    def test_until_slow_positive_does_not_return_after_deadline(self):
        source = M["deriveMemoryProbe"](M["BASE"].read_text())
        tree = ast.parse(source)
        outer = next(
            n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
        )
        fn = next(
            n
            for n in outer.body
            if isinstance(n, ast.FunctionDef) and n.name == "until"
        )
        clock = [0]

        class Bridge:
            def evaluate(self, _):
                clock[0] += 6
                return {"ok": True}

        ns = {
            "time": type(
                "T", (), {"monotonic": lambda: clock[0], "sleep": lambda s: None}
            ),
            "bridge": Bridge(),
            "memory_work_end": 5,
            "memory_budget_left": lambda deadline: self.assertGreater(
                deadline - clock[0], 0
            ),
            "observations": {},
            "root": Path("/owned"),
        }
        exec(
            compile(
                ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                "actual-until",
                "exec",
            ),
            ns,
        )
        with self.assertRaises(AssertionError):
            ns["until"]("x", "late", 5)

    def test_single_word_labels_and_original_terminal_writer_guards(self):
        self.assertEqual(len(M["LABELS"]), 3)
        self.assertTrue(all(len(v.split()) == 1 for v in M["LABELS"]))
        command = M["pty_memory_command"](
            Path("/owned"),
            Path("/owned/data/.uwork/cli/memories/projects/key/memory/MEMORY.md"),
        )
        self.assertIn("openSync", command)
        self.assertIn("wx", command)
        self.assertIn("isSymbolicLink", command)
        self.assertIn("realpathSync", command)
        self.assertNotIn(".codex", command)

    def test_actual_fixture_bridge_and_callback_interfaces_share_work_and_cleanup_budget(
        self,
    ):
        from types import SimpleNamespace

        clock = [0.0]
        calls = []
        budget = M["MemoryCaseBudget"](now=lambda: clock[0])
        child = SimpleNamespace(
            wait=lambda timeout=None: calls.append(("wait", timeout))
        )
        fixture = SimpleNamespace(
            child=child,
            command=lambda op, seconds, **extra: calls.append(("command", op, seconds)),
            wait_event=lambda predicate, seconds, label: calls.append(
                ("event", seconds)
            ),
            send=lambda value: calls.append(("send", value)),
        )
        bridge = SimpleNamespace(
            raw_cdp=lambda *a, **k: calls.append(("input", a[0])),
            evaluate=lambda *a, **k: {"ok": True},
            kill=lambda: calls.append(("bridge-close",)),
        )
        budget.bind_fixture(fixture)
        budget.bind_bridge(bridge)
        callback = bridge.raw_cdp
        clock[0] = 159
        fixture.command("proof", 30)
        fixture.wait_event(lambda _: True, 30, "ready")
        child.wait(30)
        self.assertEqual(
            calls[:3], [("command", "proof", 1), ("event", 1), ("wait", 1)]
        )
        clock[0] = 160
        for action in [
            lambda: fixture.send({"op": "launch"}),
            lambda: callback("Input.insertText", text="late"),
            lambda: bridge.evaluate("late"),
        ]:
            with self.assertRaises(AssertionError):
                action()
        self.assertEqual(len(calls), 3)
        budget.begin_cleanup()
        clock[0] = 161
        fixture.command("stopNative", 25)
        bridge.kill()
        self.assertEqual(calls[-2:], [("command", "stopNative", 19), ("bridge-close",)])

    def test_actual_slow_callback_and_io_timeout_do_not_allow_next_action(self):
        clock = [159.0]
        budget = M["MemoryCaseBudget"](now=lambda: 0)
        budget.now = lambda: clock[0]
        calls = []

        def slow(*args, **kwargs):
            calls.append(kwargs.get("timeout"))
            clock[0] = 161
            return {"ok": True}

        with self.assertRaises(AssertionError):
            budget.subprocess(slow, ["owned"], timeout=35)
        self.assertEqual(calls, [1])
        with self.assertRaises(AssertionError):
            budget.call(lambda: calls.append("late"))
        self.assertEqual(calls, [1])

    def test_actual_fixture_constructor_env_matches_exact_memory_mode_without_spawn(
        self,
    ):
        import io, subprocess
        from types import SimpleNamespace

        module = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        launches = []

        def capture(command, **kw):
            launches.append((command, kw))
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", capture), patch("threading.Thread"):
            module["Fixture"](
                M["PROFILE"],
                Path("/owned/home"),
                Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=Path("/owned/manifest"),
            )
        self.assertEqual(len(launches), 1)
        env = launches[0][1]["env"]
        code = "import assert from'node:assert/strict';import{validateMemoryProfile}from'./scripts/fixtures/mac-arm64-memory-derived.mjs';let s='';for await(const c of process.stdin)s+=c;const env=JSON.parse(s);validateMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);for(const flag of ['UWORK_NATIVE_PRIMARY_LOGIN','UWORK_NATIVE_GATEWAY_USAGE_HOLD'])assert.throws(()=>validateMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,[flag]:'controlled'}));assert.throws(()=>validateMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_CONFIGURATION_WITNESS:undefined}));assert.throws(()=>validateMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME+'x',env));"
        result = subprocess.run(
            [module["NODE24"], "--input-type=module", "-e", code],
            cwd=ROOT,
            input=json.dumps(env),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_terminal_writer_in_private_temporary_root(self):
        import tempfile, subprocess

        with tempfile.TemporaryDirectory(prefix="memory-terminal-") as folder:
            root = Path(folder).resolve()
            target = root / "data/.uwork/cli/memories/projects/key/memory/MEMORY.md"
            command = M["pty_memory_command"](root, target)
            result = subprocess.run(
                M["shlex"].split(command), capture_output=True, text=True, timeout=5
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.read_bytes(), (M["BODY"] + "\n").encode())
            second = subprocess.run(
                M["shlex"].split(command), capture_output=True, text=True, timeout=5
            )
            self.assertNotEqual(second.returncode, 0)

    def test_actual_derived_terminal_written_file_hashing_block_has_real_module_bindings(
        self,
    ):
        import tempfile, hashlib, subprocess

        source = M["deriveMemoryProbe"](M["BASE"].read_text())
        tree = ast.parse(source)
        imports = [
            node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
        ]
        run = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "run"
        )
        attempt = next(node for node in run.body if isinstance(node, ast.Try))
        start = next(
            i
            for i, node in enumerate(attempt.body)
            if isinstance(node, ast.Assign)
            and any(
                isinstance(t, ast.Name) and t.id == "written_end" for t in node.targets
            )
        )
        end = next(
            i
            for i, node in enumerate(attempt.body)
            if isinstance(node, ast.Assign)
            and any(
                isinstance(t, ast.Name) and t.id == "file_sha" for t in node.targets
            )
        )
        actual = ast.Module(body=attempt.body[start : end + 1], type_ignores=[])
        with tempfile.TemporaryDirectory(prefix="memory-actual-hash-") as folder:
            root = Path(folder).resolve()
            file = root / "data/.uwork/cli/memories/projects/key/memory/MEMORY.md"
            writer = M["pty_memory_command"](root, file)
            result = subprocess.run(
                M["shlex"].split(writer), capture_output=True, text=True, timeout=5
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            budget = M["MemoryCaseBudget"]()
            old_source = source.replace("import hashlib\n", "", 1)
            self.assertEqual(
                hashlib.sha256(old_source.encode()).hexdigest(),
                "25ac14df4d135bf141a954d6b9c6eb229e9d7943439ac342e3836f8d102f68f3",
            )
            old_ns = M["create_memory_namespace"](old_source, budget)
            old_ns.update(memory_work_end=M["time"].monotonic() + 5, memory_file=file)
            with self.assertRaises(NameError):
                exec(
                    compile(
                        ast.fix_missing_locations(actual),
                        "old-actual-terminal-hash",
                        "exec",
                    ),
                    old_ns,
                )
            ns = M["create_memory_namespace"](source, budget)
            ns.update(memory_work_end=M["time"].monotonic() + 5, memory_file=file)
            exec(
                compile(
                    ast.fix_missing_locations(actual),
                    "actual-derived-terminal-hash-block",
                    "exec",
                ),
                ns,
            )
            self.assertEqual(
                ns["file_sha"], hashlib.sha256((M["BODY"] + "\n").encode()).hexdigest()
            )

    def test_actual_compiled_derived_run_and_nested_code_have_no_unresolved_globals(
        self,
    ):
        import dis, builtins, types

        source = M["deriveMemoryProbe"](M["BASE"].read_text())
        ns = M["create_memory_namespace"](source, M["MemoryCaseBudget"]())
        missing = set()

        def inspect(code):
            for instruction in dis.get_instructions(code):
                if (
                    instruction.opname == "LOAD_GLOBAL"
                    and instruction.argval not in ns
                    and not hasattr(builtins, instruction.argval)
                ):
                    missing.add(instruction.argval)
            for value in code.co_consts:
                if isinstance(value, types.CodeType):
                    inspect(value)

        inspect(ns["run"].__code__)
        self.assertEqual(missing, set())


if __name__ == "__main__":
    unittest.main()
