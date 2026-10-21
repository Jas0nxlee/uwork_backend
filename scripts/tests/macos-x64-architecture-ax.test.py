"""Pure contracts: no framework load, HTTP, App or AX calls."""

import runpy
import unittest
from pathlib import Path

PATH = Path(__file__).with_name("macos-x64-architecture-ax-reader.py")
M = runpy.run_path(str(PATH))


class Fake:
    def __init__(self):
        self.time = 0.0
        self.calls = []
        self.closed = False

    def now(self):
        return self.time

    def guard(self):
        self.time += 0.001
        return True

    def read(self, ref, attr, timeout):
        self.calls.append((ref, attr, timeout))
        self.time += 0.01
        return {
            "code": -25204,
            "ownPid": 42,
            "ownPidCode": 0,
            "messagingTimeoutCode": 0,
            "elapsedMs": 10,
            "value": None,
        }

    def close(self):
        self.closed = True


class ReadonlyAX(unittest.TestCase):
    def test_unknown_code_is_receipt_and_both_timeouts_are_observed(self):
        fake = Fake()
        result = M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertTrue(fake.closed)
        self.assertEqual(
            {r["methodTimeoutSeconds"] for r in result["reads"]}, {0.1, 0.75}
        )
        self.assertTrue(all(r["code"] == -25204 for r in result["reads"]))
        self.assertTrue(all(r["ownPid"] == 42 for r in result["reads"]))
        self.assertEqual(result["status"], "observed-readonly")
        self.assertFalse(result["architectureWarningConfirmed"])

    def test_private_text_only_digest_and_foreign_element_fails_closed(self):
        fake = Fake()

        def read(ref, attr, timeout):
            result = Fake.read(fake, ref, attr, timeout)
            result.update(code=0, value="private unknown title")
            return result

        fake.read = read
        result = M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertNotIn("private unknown title", str(result))
        self.assertIn("sha256", str(result))
        fake = Fake()
        old = fake.read

        def foreign(*args):
            result = old(*args)
            result["ownPid"] = 99
            return result

        fake.read = foreign
        with self.assertRaisesRegex(AssertionError, "AX element PID"):
            M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertTrue(fake.closed)

    def test_callback_exception_closes_and_is_not_converted_to_empty_ui(self):
        fake = Fake()
        sentinel = OSError("controlled")

        def fail(*args):
            raise sentinel

        fake.read = fail
        with self.assertRaises(OSError) as caught:
            M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertIs(caught.exception, sentinel)
        self.assertTrue(fake.closed)

    def test_deadline_stops_readonly_calls_after_slow_callback(self):
        fake = Fake()
        old = fake.read

        def slow(*args):
            result = old(*args)
            fake.time += 5
            return result

        fake.read = slow
        result = M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertEqual(len(fake.calls), 1)
        self.assertTrue(result["budgetExhausted"])
        self.assertTrue(fake.closed)

    def test_owner_change_blocks_before_any_native_read(self):
        fake = Fake()
        with self.assertRaisesRegex(AssertionError, "Owned Main"):
            M["observe_architecture_ax"](42, fake, lambda: False, now=fake.now)
        self.assertEqual(fake.calls, [])
        self.assertTrue(fake.closed)

    def test_actual_native_adapter_will_not_copy_attribute_of_foreign_pid(self):
        from types import SimpleNamespace

        calls = []

        class AX:
            def AXUIElementSetMessagingTimeout(self, ref, timeout):
                return 0

            def AXUIElementGetPid(self, ref, out):
                out._obj.value = 99
                return 0

            def AXUIElementCopyAttributeValue(self, *args):
                calls.append(args)
                raise AssertionError("foreign read")

        reader = M["NativeOwnedReader"].__new__(M["NativeOwnedReader"])
        reader.m = {
            "_AX": AX(),
            "_CF": SimpleNamespace(
                CFGetTypeID=lambda ref: 9, CFEqual=lambda a, b: a == b
            ),
        }
        reader.app = 100
        reader.ax_type = 9
        reader.identity_ordinals = {100: 1}
        reader.pid = 42
        row = reader.read("application", "AXWindows", 0.1)
        self.assertEqual(row["ownPid"], 99)
        self.assertEqual(calls, [])

    def test_actual_adapter_records_local_ref_identity_and_checks_window_type(self):
        import ctypes as C

        retained = []
        released = []
        copies = []

        class CF:
            def CFGetTypeID(self, ref):
                return (
                    8
                    if isinstance(ref, C.c_void_p)
                    else (9 if ref in (101, 202) else 77)
                )

            def CFArrayGetTypeID(self):
                return 8

            def CFArrayGetCount(self, ref):
                return 2

            def CFArrayGetValueAtIndex(self, ref, index):
                return [202, 303][index]

            def CFEqual(self, left, right):
                return left == right

            def CFRetain(self, ref):
                retained.append(ref)
                return ref

            def CFRelease(self, ref):
                released.append(ref)

        class AX:
            def AXUIElementSetMessagingTimeout(self, ref, timeout):
                return 0

            def AXUIElementGetPid(self, ref, out):
                out._obj.value = 42
                return 0

            def AXUIElementCopyAttributeValue(self, ref, key, out):
                copies.append((ref, key))
                out._obj.value = 600 if key == "AXRole" else 500
                return 0

        reader = M["NativeOwnedReader"].__new__(M["NativeOwnedReader"])
        reader.m = {
            "_AX": AX(),
            "_CF": CF(),
            "_cf_string": lambda x: x,
            "CFTypeRef": C.c_void_p,
            "_python_value": lambda ref, limit: "AXWindow",
        }
        reader.app = 101
        reader.pid = 42
        reader.refs = [101]
        reader.ax_type = 9
        reader.identity_ordinals = {101: 1}
        row = reader.read("application", "AXWindows", 0.1)
        self.assertEqual(row["refOrdinal"], 1)
        self.assertTrue(row["isAXUIElement"])
        self.assertTrue(row["equalsApplication"])
        self.assertEqual(row["children"], [202])
        self.assertEqual(retained, [202])
        self.assertEqual(
            row["childIdentities"],
            [
                {"refOrdinal": 2, "isAXUIElement": True, "equalsApplication": False},
                {"refOrdinal": 3, "isAXUIElement": False, "equalsApplication": False},
            ],
        )
        child = reader.read(202, "AXRole", 0.75)
        self.assertEqual(child["refOrdinal"], 2)
        self.assertTrue(child["isAXUIElement"])
        self.assertFalse(child["equalsApplication"])
        self.assertEqual(child["value"], "AXWindow")
        self.assertEqual(copies, [(101, "AXWindows"), (202, "AXRole")])
        self.assertNotIn("303", str(row))

    def test_child_application_role_remains_explicitly_unresolved(self):
        fake = Fake()
        old = fake.read

        def read(ref, attr, timeout):
            row = old(ref, attr, timeout)
            row["code"] = 0
            if attr == "AXWindows":
                row["children"] = [202]
                row["childIdentities"] = [
                    {"refOrdinal": 2, "isAXUIElement": True, "equalsApplication": False}
                ]
            if attr == "AXRole":
                row["value"] = "AXApplication"
            return row

        fake.read = read
        result = M["observe_architecture_ax"](42, fake, fake.guard, now=fake.now)
        self.assertEqual(
            result["windowReferenceStatus"], "unresolved-child-application-role"
        )
        self.assertFalse(result["architectureWarningAbsentEstablished"])
        self.assertEqual(
            [x for x in fake.calls if x[0] == 202], [(202, "AXRole", 0.75)]
        )

    def test_actual_derivations_are_pure_exact_profile_no_secondary_or_bh(self):
        import subprocess

        root = PATH.resolve().parents[2]
        probe = runpy.run_path(
            str(PATH.with_name("macos-x64-architecture-ax-probe.py"))
        )
        source = probe["deriveArchitectureAXProbe"](
            (root / "scripts/tests/macos-x64-secondary-probe.py").read_text()
        )
        compile(source, "actual-readonly-AX", "exec")
        self.assertNotIn("f.command('openWorkspace'", source)
        self.assertNotIn("bh(", source)
        self.assertIn("deadline=started+90", source)
        self.assertIn("actor_deadline=min(work_deadline,ax_started+5)", source)
        self.assertIn("zero_delta(before,after)", source)
        code = """
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{deriveArchitectureAXFixture,validateArchitectureAXProfile,PROFILE}from'./scripts/fixtures/macos-x64-architecture-ax-derived.mjs';
const env={UWORK_NATIVE_CLIENT_EXPERIENCE:'enabled',UWORK_NATIVE_CONFIGURATION_WITNESS:'enabled',UWORK_NATIVE_PACKAGED_MANIFEST:'owned'};validateArchitectureAXProfile(PROFILE,env);assert.throws(()=>validateArchitectureAXProfile(PROFILE+'x',env));assert.throws(()=>validateArchitectureAXProfile(PROFILE,{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));
const old=readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8');const s=deriveArchitectureAXFixture(old);assert(s.includes('native-packaged-macos-x64-asar-integrity-runtime.mjs'));assert(!s.includes('--inspect'));assert.throws(()=>deriveArchitectureAXFixture(old+old));
"""
        result = subprocess.run(
            [
                "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node",
                "--input-type=module",
                "-e",
                code,
            ],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_fixture_launch_env_admits_only_original_witness_enabled(self):
        import io
        import json
        import subprocess
        from types import SimpleNamespace
        from unittest.mock import patch

        root = PATH.resolve().parents[2]
        module = runpy.run_path(str(root / "scripts/tests/native-g04k-cdp-probe.py"))
        profile = runpy.run_path(
            str(PATH.with_name("macos-x64-architecture-ax-probe.py"))
        )["PROFILE"]
        launches = []

        def capture(command, **kwargs):
            launches.append((command, kwargs))
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", capture), patch("threading.Thread"):
            module["Fixture"](
                profile,
                Path("/private/owned-home"),
                Path("/private/owned-tmp"),
                mode="experience",
                packaged_manifest=Path("/private/owned-manifest.json"),
            )
        self.assertEqual(len(launches), 1)
        command, options = launches[0]
        self.assertEqual(
            command,
            [
                module["NODE24"],
                "--import",
                "tsx",
                "scripts/fixtures/client-native-enterprise.mjs",
            ],
        )
        self.assertEqual(
            options["env"]["UWORK_NATIVE_CONFIGURATION_WITNESS"], "enabled"
        )
        code = """
import assert from'node:assert/strict';import{validateArchitectureAXProfile}from'./scripts/fixtures/macos-x64-architecture-ax-derived.mjs';
const env=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>resolve(s));}));
validateArchitectureAXProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);
for(const witness of[undefined,'disabled','controlled','other'])assert.throws(()=>validateArchitectureAXProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_CONFIGURATION_WITNESS:witness}));
assert.throws(()=>validateArchitectureAXProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));
"""
        result = subprocess.run(
            [module["NODE24"], "--input-type=module", "-e", code],
            cwd=root,
            input=json.dumps(options["env"]),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
