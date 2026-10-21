"""Actual private _raw and original perform composition, with no native frameworks."""

import ast
import ctypes
import json
import runpy
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/tests/macos-architecture-warning-dismiss.py"
O = runpy.run_path(str(ROOT / "scripts/tests/quit-ax-attribute-error-observer.py"))
OLD = runpy.run_path(str(SOURCE))["_NativeAx"]._raw
NEW = O["make_observed_raw"](SOURCE.read_text())
DRIVER = runpy.run_path(
    str(ROOT / "scripts/tests/mac-native-active-quit-v16-raw-error-probe.py")
)


class Fake:
    def __init__(self, code=-9876, value=True, own_fails=False):
        self.log, self.refs = [], []
        self.code, self.value, self.own_fails = code, value, own_fails
        self.C = ctypes
        self.pid, self.deadline = 123, 5
        self.ax = {
            "CFTypeRef": ctypes.c_void_p,
            "_cf_string": lambda name: "original-key:" + name,
            "element": lambda pid: 1,
        }
        self.cf = types.SimpleNamespace(CFRelease=self.release)
        self.api = types.SimpleNamespace(AXUIElementCopyAttributeValue=self.copy)

    def release(self, ref):
        self.log.append(
            ("release", ref.value if isinstance(ref, ctypes.c_void_p) else ref)
        )

    def copy(self, ref, key, out):
        self.log.append(("copy", ref, key))
        if self.value:
            out._obj.value = 77
        return self.code

    def _own(self, ref):
        self.log.append(("own", ref))
        assert not self.own_fails, "controlled original PID guard failure"


class Contract(unittest.TestCase):
    def test_actual_unknown_error_same_io_original_raise_and_both_original_cf_releases(
        self,
    ):
        for value in [False, True]:
            old, new = Fake(value=value), Fake(value=value)
            with self.assertRaises(AssertionError) as red:
                OLD(old, 9, "AXRole")
            self.assertFalse(hasattr(red.exception, "ownedAxRawFailureReceipt"))
            with self.assertRaises(AssertionError) as caught:
                NEW(new, 9, "AXRole")
            self.assertEqual(str(caught.exception), str(red.exception))
            self.assertEqual(old.log, new.log)
            self.assertEqual(sum(row[0] == "copy" for row in new.log), 1)
            self.assertEqual(
                sum(row[0] == "release" for row in new.log), 2 if value else 1
            )
            self.assertEqual(
                caught.exception.ownedAxRawFailureReceipt,
                {
                    "schema": "owned-native-ax-attribute-error-v1",
                    "attribute": "AXRole",
                    "nativeCode": -9876,
                    "returnValuePresent": value,
                    "originalOwnPidGuardCompleted": True,
                    "stage": "original-copy-attribute-error-branch",
                    "extraAxReads": 0,
                },
            )

    def test_allowed_absent_and_success_branches_remain_same_and_have_no_receipt(self):
        for code in [0, -25205, -25212]:
            for value in [False, True]:
                old, new = Fake(code, value), Fake(code, value)
                a, b = OLD(old, 9, "AXSubrole"), NEW(new, 9, "AXSubrole")
                self.assertEqual(a.value if a else None, b.value if b else None)
                self.assertEqual(old.log, new.log)

    def test_failed_original_pid_guard_has_no_attribute_copy_or_observer_receipt(self):
        fake = Fake(own_fails=True)
        with self.assertRaises(AssertionError) as caught:
            NEW(fake, 9, "AXRole")
        self.assertEqual(fake.log, [("own", 9)])
        self.assertFalse(hasattr(caught.exception, "ownedAxRawFailureReceipt"))

    def test_unknown_attribute_is_redacted_and_persistence_is_exclusive_private_and_safe(
        self,
    ):
        fake = Fake()
        with self.assertRaises(AssertionError) as caught:
            NEW(fake, 9, "SYNTHETIC_PRIVATE_ATTRIBUTE")
        with tempfile.TemporaryDirectory() as folder:
            evidence, facts = Path(folder), {}
            O["capture_raw_error"](caught.exception, evidence, facts)
            target = evidence / "active-quit-ax-attribute-error.json"
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("SYNTHETIC_PRIVATE_ATTRIBUTE", target.read_text())
            self.assertEqual(
                json.loads(target.read_text())["attribute"], "other-attribute"
            )
            O["capture_raw_error"](caught.exception, evidence, facts)
            self.assertEqual(
                facts["axAttributeErrorObservation"]["status"], "unavailable"
            )
            self.assertEqual(str(caught.exception), "Owned AX attribute failed")
            caught.exception.ownedAxRawFailureReceipt["body"] = "SYNTHETIC_PRIVATE_BODY"
            O["capture_raw_error"](caught.exception, evidence, facts)
            self.assertNotIn("SYNTHETIC_PRIVATE_BODY", target.read_text())

    def actual_perform_failure(self):
        ns = DRIVER["AX_NAMESPACE"]
        fake = Fake()
        fake._raw = types.MethodType(ns["_QuitAx"]._raw, fake)
        fake._value = types.MethodType(ns["_QuitAx"]._value, fake)
        fake.candidates = types.MethodType(ns["_QuitAx"].candidates, fake)
        fake.close = types.MethodType(ns["_QuitAx"].close, fake)
        fake.pressed = []
        fake.press = lambda ref: fake.pressed.append(ref) or 0

        def children(ref, name):
            self.assertEqual((ref, name), (1, "AXWindows"))
            fake.refs.append(2)
            return [2]

        fake._children = children
        binding = {
            "pid": 123,
            "birth": "controlled-birth",
            "executable": "/owned/app",
            "applicationName": "UWork 联动验证",
        }
        with patch("time.monotonic", return_value=0), self.assertRaises(
            AssertionError
        ) as caught:
            ns["perform_owned_quit_action"](
                binding,
                "cancel",
                deadline=5,
                actor_guard=lambda: True,
                ax=fake,
                inspect_actor=lambda identity, end: identity,
                now=lambda: 0,
            )
        self.assertEqual(fake.pressed, [])
        self.assertEqual(fake.refs, [])
        self.assertEqual(
            [row for row in fake.log if row[0] == "copy"],
            [("copy", 2, "original-key:AXRole")],
        )
        self.assertEqual(
            [row[1] for row in fake.log if row[0] == "release"],
            ["original-key:AXRole", 77, 2, 1],
        )
        return caught.exception

    def test_actual_private_raw_domain_and_original_perform_raise_without_press_or_cf_leak(
        self,
    ):
        error = self.actual_perform_failure()
        self.assertEqual(error.ownedAxRawFailureReceipt["nativeCode"], -9876)

    def test_actual_controller_quit_action_catch_saves_then_reraises_even_if_persistence_fails(
        self,
    ):
        error = self.actual_perform_failure()
        tree = ast.parse(DRIVER["deriveActiveQuitProbe"](DRIVER["BASE"].read_text()))
        fn = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == "quit_action"
        )
        with tempfile.TemporaryDirectory() as folder:
            scope = DRIVER["actual_clock_namespace"]()
            scope.update(
                evidence=Path(folder),
                facts={},
                observations={},
                work_deadline=5,
                binding={},
                actor_guard=lambda: True,
                time=types.SimpleNamespace(monotonic=lambda: 0),
            )

            def fail(*a, **kw):
                raise error

            scope["AX"] = {"perform_owned_quit_action": fail}
            exec(
                compile(
                    ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                    "actual-quit-action-catch",
                    "exec",
                ),
                scope,
            )
            for expected in ["saved", "unavailable"]:
                with self.assertRaises(AssertionError) as caught:
                    scope["quit_action"]("cancel")
                self.assertIs(caught.exception, error)
                self.assertEqual(
                    scope["facts"]["axAttributeErrorObservation"]["status"], expected
                )

            def observer_fails(*a, **kw):
                raise RuntimeError("controlled observer infrastructure failure")

            with patch.dict(DRIVER["V"]["RAW_ERROR"], capture_raw_error=observer_fails):
                with self.assertRaises(AssertionError) as caught:
                    scope["quit_action"]("cancel")
                self.assertIs(caught.exception, error)
                self.assertEqual(
                    scope["facts"]["axAttributeErrorObservation"]["observerErrorType"],
                    "RuntimeError",
                )


if __name__ == "__main__":
    unittest.main()
