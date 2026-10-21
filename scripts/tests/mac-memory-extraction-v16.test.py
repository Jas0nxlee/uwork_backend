"""Actual automatic Memory controller contracts; no App/network and no frozen-module mutation."""

import ast, runpy, unittest, json, tempfile
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
M = runpy.run_path(str(ROOT / "scripts/tests/mac-memory-extraction-v16-probe.py"))


class Contract(unittest.TestCase):
    def test_actual_namespace_and_all_nested_globals_and_original_tail(self):
        source = M["deriveAutoMemoryProbe"](M["BASE"].read_text())
        before = set(M["M"]["wait_renderer"].__globals__)
        budget = M["MemoryCaseBudget"]()
        ns = M["create_auto_namespace"](source, budget)
        M["verify_globals"](ns)
        self.assertIs(ns["run"].__globals__, ns)
        self.assertEqual(set(M["M"]["wait_renderer"].__globals__), before)
        self.assertIsNot(ns["wait_renderer"], M["M"]["wait_renderer"])
        self.assertIn("f.command('memberSeat', value=False)", source)
        self.assertEqual(source.count("assert proof() == delivered"), 3)
        self.assertIn("delivered['own']['count']==8", source)
        self.assertNotIn("pty_memory_command(root,memory_file)", source)
        self.assertNotIn("MEMORY_ACTIVE_BUDGET", source)

    def test_actual_budgeted_renderer_callback_clamps_shared_time_without_mutating_old_module(
        self,
    ):
        clock = [159.0]
        budget = M["MemoryCaseBudget"](now=lambda: 0)
        budget.now = lambda: clock[0]
        seen = []

        def process(args, **kwargs):
            seen.append(kwargs["timeout"])
            value = (
                "birth"
                if args[0] == "ps"
                else (
                    "n/owned/UWork Preview.app/Contents/MacOS/UWork Preview"
                    if "-d" in args
                    else "n127.0.0.1:4567"
                )
            )
            return SimpleNamespace(stdout=value, returncode=0)

        def wait(port, prefix, guard, save, seconds, fetch):
            self.assertEqual(seconds, 1)
            self.assertTrue(guard())
            return fetch(port, seconds)

        fake = {
            "wait_owned_renderer": wait,
            "fetch_owned_targets": lambda port, seconds: {
                "id": "owned",
                "seconds": seconds,
            },
        }
        with tempfile.TemporaryDirectory() as folder, patch(
            "time.monotonic", lambda: clock[0]
        ), patch("subprocess.run", process), patch("runpy.run_path", lambda _: fake):
            target = M["make_auto_renderer"](budget)(
                {"pid": 123, "cdpPort": 4567},
                {"packagedRuntime": {"appPath": "/owned/UWork Preview.app"}},
                Path(folder),
            )
            self.assertEqual(target["seconds"], 1)
            self.assertTrue(all(0 < t <= 1 for t in seen))

    def test_actual_renderer_first_missing_listener_waits_without_fetch_then_owned_target(
        self,
    ):
        clock = [0.0]
        budget = M["MemoryCaseBudget"](now=lambda: clock[0])
        listeners = []
        fetches = []
        actual = runpy.run_path(str(ROOT / "scripts/tests/macos-x64-readiness.py"))
        app = "/owned/UWork Preview.app"
        prefix = Path(app + "/Contents/Resources/app.asar").as_uri() + "/"

        def process(args, **kwargs):
            if args[0] == "ps":
                return SimpleNamespace(stdout="birth", returncode=0)
            if "-d" in args:
                return SimpleNamespace(
                    stdout="n" + app + "/Contents/MacOS/UWork Preview", returncode=0
                )
            listeners.append(kwargs.get("check"))
            code = 1 if len(listeners) == 1 else 0
            if code and kwargs.get("check"):
                raise M["subprocess"].CalledProcessError(code, args)
            return SimpleNamespace(
                stdout="" if code else "n127.0.0.1:4567", returncode=code
            )

        def fetch(port, seconds):
            fetches.append(len(listeners))
            return [
                {
                    "id": "owned",
                    "type": "page",
                    "url": prefix + "out/renderer/index.html",
                    "webSocketDebuggerUrl": "ws://127.0.0.1:4567/devtools/page/owned",
                }
            ]

        def wait(*args, **kwargs):
            return actual["wait_owned_renderer"](
                *args,
                **kwargs,
                now=lambda: clock[0],
                sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)
            )

        fake = {"wait_owned_renderer": wait, "fetch_owned_targets": fetch}
        with tempfile.TemporaryDirectory() as folder, patch(
            "time.monotonic", lambda: clock[0]
        ), patch("subprocess.run", process), patch("runpy.run_path", lambda _: fake):
            result = M["make_auto_renderer"](budget)(
                {"pid": 123, "cdpPort": 4567},
                {"packagedRuntime": {"appPath": app}},
                Path(folder),
            )
        self.assertEqual(result["id"], "owned")
        self.assertEqual(fetches, [2])
        self.assertTrue(all(v is not True for v in listeners))

    def test_actual_fixture_env_guard_and_invalid_modes_without_entry_execution(self):
        import io, subprocess

        module = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        captured = []

        def popen(command, **kw):
            captured.append(kw["env"])
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", popen), patch("threading.Thread"):
            module["Fixture"](
                M["PROFILE"],
                Path("/owned/home"),
                Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=Path("/owned/manifest"),
            )
        code = "import assert from'node:assert/strict';import{validateAutoMemoryProfile}from'./scripts/fixtures/mac-memory-extraction-v16-derived.mjs';let s='';for await(const c of process.stdin)s+=c;const env=JSON.parse(s);validateAutoMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);assert.throws(()=>validateAutoMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));assert.throws(()=>validateAutoMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_CONFIGURATION_WITNESS:undefined}));"
        result = subprocess.run(
            [module["NODE24"], "--input-type=module", "-e", code],
            cwd=ROOT,
            input=json.dumps(captured[0]),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
