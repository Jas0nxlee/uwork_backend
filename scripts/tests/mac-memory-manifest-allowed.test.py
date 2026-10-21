"""Actual namespace/env/phase and original frozen seed+finally; no server/App."""

import ast, io, json, pathlib, runpy, subprocess, types, unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
NODE = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"


class Contract(unittest.TestCase):
    def module(self):
        return runpy.run_path(
            str(ROOT / "scripts/tests/mac-memory-manifest-allowed-probe.py")
        )

    def test_actual_namespace_budget_seed_and_single_allowed_stage(self):
        m = self.module()
        runpy.run_path(str(ROOT / "scripts/tests/macos-clock-profile.test.py"))[
            "check"
        ](m["PROFILE"])
        s = m["deriveAllowedManifestProbe"](m["BASE"].read_text())
        ns = m["create_allowed_namespace"](s, m["MemoryCaseBudget"]())
        m["verify_globals"](ns)
        self.assertIs(ns["run"].__globals__, ns)
        self.assertEqual(ns["DENIED_LABEL"], m["N"]["MANIFEST_PROMPT"])
        self.assertIn("updated['modelCalls']==7", s)
        self.assertIn(
            "{'count':5,'settled':5,'amount':110,'inputTokens':60,'outputTokens':50}", s
        )
        self.assertIn("safe_native_cleanup(f=f,bridge=bridge,guard=guard", s)
        self.assertIn("text=manifest_seed_command(root,memory_file)", s)
        self.assertNotIn("updated['modelCalls']==6", s)

    def test_actual_constructor_env_derive_and_original_reply_unchanged(self):
        m = self.module()
        native = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        env = []

        def popen(*a, **kw):
            env.append(kw["env"])
            return types.SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", popen), patch("threading.Thread"):
            native["Fixture"](
                m["PROFILE"],
                pathlib.Path("/owned/home"),
                pathlib.Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=pathlib.Path("/owned/manifest"),
            )
        code = """import assert from'node:assert/strict';import fs from'node:fs';import{deriveAllowedManifestFixture,validateAllowedManifestProfile}from'./scripts/fixtures/mac-memory-manifest-allowed-derived.mjs';let s='';for await(const x of process.stdin)s+=x;const env=JSON.parse(s);validateAllowedManifestProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);assert.throws(()=>validateAllowedManifestProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_FILE_CONTEXT:'controlled'}));const old=fs.readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'),out=deriveAllowedManifestFixture(old);assert(out.includes(\"await configure('security',{allowFilesystem:true})\"));assert(!out.includes('copyNativeOutSnapshot({'));assert(!out.includes('mac-memory-manifest-admission-derived'));const a=old.indexOf('  const toolTurn = fileReply'),b=old.indexOf('const tls',a);assert(a>0);assert(out.includes(old.slice(a,b>0?b:old.indexOf('const app =',a))));console.log(out);"""
        r = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            input=json.dumps(env[0]),
            capture_output=True,
            text=True,
            cwd=ROOT,
            timeout=12,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        c = subprocess.run(
            [NODE, "--check", "--input-type=module"],
            input=r.stdout,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(c.returncode, 0, c.stderr)

    def test_original_actual_seed_hash_and_bounded_safe_finally_contracts(self):
        cls = runpy.run_path(
            str(ROOT / "scripts/tests/mac-memory-manifest-v16-denied.test.py")
        )["Contract"]
        for n in [
            "test_actual_terminal_insert_and_file_validation_use_single_line_transport",
            "test_actual_manifest_finally_original180_escapes_new160_and180_persist",
        ]:
            getattr(cls(n), n)()


if __name__ == "__main__":
    unittest.main()
