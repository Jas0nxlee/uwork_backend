"""Controlled timing through actual original _own/_raw; never loads native AX."""

import ctypes
import ast
import copy
import json
import runpy
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL = runpy.run_path(
    str(ROOT / "scripts/tests/macos-architecture-warning-dismiss.py")
)
H = runpy.run_path(str(ROOT / "scripts/tests/quit-ax-message-budget-counterfactual.py"))
SOURCE = (ROOT / "scripts/tests/macos-architecture-warning-dismiss.py").read_text()
OWN = H["make_own"](SOURCE)
RAW = H["make_timed_raw"](SOURCE)
AX_PATH = ROOT / "scripts/tests/mac-native-active-quit-ax.py"
DOMAIN = runpy.run_path(str(ROOT / "scripts/tests/quit-native-confirmation-domain.py"))
NS = {"__file__": str(AX_PATH), "__name__": "pure_counterfactual"}
exec(
    compile(
        H["derive_ax_module"](
            DOMAIN["derive_quit_domain_ax_module"](AX_PATH.read_text())
        ),
        "actual-private-counterfactual",
        "exec",
    ),
    NS,
)
T = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-ax.test.py"))


class Message:
    def __init__(self, seconds=0.2):
        self.clock = [0.0]
        self.seconds, self.timeout = seconds, None
        self.pid, self.deadline = 123, 5
        self.C = ctypes
        self.log = []
        self.force_code = None
        self.ignore_timeout = False
        self.actual_pid = self.pid
        self.refs, self.pressed = [], []
        self.ax = {"CFTypeRef": ctypes.c_void_p, "_cf_string": lambda name: name}
        self.ax.update(
            element=lambda pid: 1,
            _python_value=lambda out, limit=4096: (
                "AXSheet" if self.last_name == "AXRole" else None
            ),
            PRESS="AXPress",
            perform=lambda ref, action: self.pressed.append(ref) or 0,
        )
        self.cf = types.SimpleNamespace(
            CFRelease=lambda ref: self.log.append(
                ("release", ref.value if isinstance(ref, ctypes.c_void_p) else ref)
            )
        )
        self.api = types.SimpleNamespace(
            AXUIElementSetMessagingTimeout=self.set_timeout,
            AXUIElementGetPid=self.get_pid,
            AXUIElementCopyAttributeValue=self.copy,
        )

    def set_timeout(self, ref, seconds):
        self.timeout = seconds
        self.log.append(("timeout", ref, seconds))
        return 0

    def get_pid(self, ref, out):
        self.log.append(("pid", ref))
        out._obj.value = self.actual_pid
        return 0

    def copy(self, ref, name, out):
        self.log.append(("copy", ref, name))
        self.last_name = name
        self.clock[0] += (
            self.seconds if self.ignore_timeout else min(self.seconds, self.timeout)
        )
        if self.force_code is not None:
            return self.force_code
        if self.seconds > self.timeout and not self.ignore_timeout:
            return -25204
        out._obj.value = 77
        return 0

    def _children(self, ref, name):
        assert (ref, name) == (1, "AXWindows")
        self.refs.append(2)
        return [2]

    def _candidate(self, ref):
        self.log.append(("candidate", ref))
        row = copy.deepcopy(T["dialog"]())
        row.update(ref=ref, role="AXSheet", subrole=None)
        return row


class Counterfactual(unittest.TestCase):
    def test_controlled_200ms_response_under_same_five_second_operation(self):
        message = Message()
        message._own = types.MethodType(OWN, message)
        with patch("time.monotonic", side_effect=lambda: message.clock[0]):
            result = RAW(message, 9, "AXRole")
        self.assertEqual(result.value, 77)
        self.assertLess(message.clock[0], message.deadline)
        self.assertEqual(message.timeout, 0.5)
        self.assertAlmostEqual(message._owned_copy_timings[0]["elapsedSeconds"], 0.2)

    def test_original_actual_100ms_red_preserved_not_reclassified_as_product_failure(
        self,
    ):
        message = Message()
        message._own = types.MethodType(ORIGINAL["_NativeAx"]._own, message)
        with patch(
            "time.monotonic", side_effect=lambda: message.clock[0]
        ), self.assertRaises(AssertionError):
            ORIGINAL["_NativeAx"]._raw(message, 9, "AXRole")
        self.assertEqual(message.timeout, 0.1)
        self.assertEqual(message.clock[0], 0.1)
        self.assertEqual(sum(row[0] == "copy" for row in message.log), 1)

    def test_original_own_only_cap_and_non_io_metadata_differ_and_remaining_clamps(
        self,
    ):
        source = H["derive_own"](SOURCE)
        inverse = source.replace(
            "min(MESSAGE_CAP_SECONDS, left)", "min(0.1, left)"
        ).replace(
            "    _remaining(self.deadline, time.monotonic)\n    self._owned_message_timeout = min(0.1, left)\n",
            "",
        )
        self.assertEqual(inverse, H["original_own_method"](SOURCE))
        message = Message()
        message.clock[0] = 4.75
        with patch("time.monotonic", side_effect=lambda: message.clock[0]):
            OWN(message, 9)
        self.assertEqual(message.timeout, 0.25)

    def test_pid_guard_late_return_stops_before_starting_attribute_copy(self):
        m = Message()
        get_pid = m.get_pid

        def late(ref, out):
            result = get_pid(ref, out)
            m.clock[0] = 5.1
            return result

        m.api.AXUIElementGetPid = late
        m._own = types.MethodType(OWN, m)
        with patch("time.monotonic", side_effect=lambda: m.clock[0]), self.assertRaises(
            AssertionError
        ):
            RAW(m, 9, "AXRole")
        self.assertFalse(any(row[0] == "copy" for row in m.log))

    def test_two_timing_reads_no_extra_ax_and_original_permitted_codes_remain(self):
        method = H["make_timed_raw"](SOURCE)
        message = Message()
        message._own = types.MethodType(OWN, message)
        reads = []
        method.__globals__["time"] = types.SimpleNamespace(
            monotonic=lambda: reads.append(1) or message.clock[0]
        )
        with patch("time.monotonic", side_effect=lambda: message.clock[0]):
            method(message, 9, "AXRole")
        self.assertEqual(len(reads), 2)
        self.assertEqual(
            [r[0] for r in message.log], ["timeout", "pid", "copy", "release"]
        )
        for code in [-25205, -25212]:
            m = Message(0.01)
            m.force_code = code
            m._own = types.MethodType(OWN, m)
            with patch("time.monotonic", side_effect=lambda: m.clock[0]):
                self.assertIsNone(RAW(m, 9, "AXRole"))

    def test_timing_block_inverse_is_exact_v11_raw_including_allowed_code_assertion(
        self,
    ):
        current = ast.parse(H["derive_timed_raw"](SOURCE)).body[0]
        original = ast.parse(H["RAW_ERROR"]["derive_observed_raw"](SOURCE)).body[0]
        next(n for n in current.body if isinstance(n, ast.Try)).body = next(
            n for n in original.body if isinstance(n, ast.Try)
        ).body
        self.assertEqual(
            ast.dump(current, include_attributes=False),
            ast.dump(original, include_attributes=False),
        )

    def perform(self, message):
        for name in [
            "_own",
            "_raw",
            "_value",
            "candidates",
            "refresh",
            "press",
            "close",
        ]:
            setattr(
                message, name, types.MethodType(getattr(NS["_QuitAx"], name), message)
            )
        with patch("time.monotonic", side_effect=lambda: message.clock[0]):
            return NS["perform_owned_quit_action"](
                T["B"],
                "cancel",
                deadline=5,
                actor_guard=lambda: True,
                ax=message,
                inspect_actor=lambda identity, end: identity,
                now=lambda: message.clock[0],
            )

    def test_actual_original_confirmation_refresh_and_press_still_required(self):
        m = Message()
        result = self.perform(m)
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(m.pressed, ["取消"])
        self.assertEqual(len(result["ownedAxCopyTiming"]["copies"]), 2)
        self.assertEqual(m.refs, [])
        for wrong in ["text", "frame"]:
            m = Message(0.01)
            original = m._candidate

            def candidate(ref):
                row = original(ref)
                if wrong == "text":
                    row["texts"] = ["unrelated"]
                if wrong == "frame" and sum(r[0] == "candidate" for r in m.log) > 1:
                    row["frame"]["X"] += 20
                return row

            m._candidate = candidate
            with self.assertRaises(AssertionError):
                self.perform(m)
            self.assertEqual(m.pressed, [])
            self.assertEqual(m.refs, [])

    def test_overall_five_second_late_success_never_reaches_candidate_or_press(self):
        m = Message(5.1)
        m.ignore_timeout = True
        with self.assertRaises(AssertionError) as caught:
            self.perform(m)
        self.assertEqual(m.pressed, [])
        self.assertFalse(any(row[0] == "candidate" for row in m.log))
        self.assertEqual(m.refs, [])
        receipt = caught.exception.ownedAxCopyTimingReceipt
        self.assertEqual(receipt["copies"][0]["nativeCode"], 0)
        self.assertEqual(receipt["copies"][0]["elapsedSeconds"], 5.1)
        with tempfile.TemporaryDirectory() as folder:
            facts = {}
            H["capture_timings"](caught.exception, Path(folder), facts)
            saved = Path(folder) / "active-quit-ax-copy-timing.json"
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
            self.assertEqual(
                json.loads(saved.read_text())["copies"][0]["elapsedSeconds"], 5.1
            )
            H["capture_timings"](caught.exception, Path(folder), facts)
            self.assertEqual(facts["axCopyTimingObservation"]["status"], "unavailable")

    def test_wrong_owner_and_unknown_code_still_fail_without_retry(self):
        for kind in ["owner", "unknown", "over-message-cap"]:
            m = Message(0.6 if kind == "over-message-cap" else 0.01)
            if kind == "owner":
                m.actual_pid = 999
            if kind == "unknown":
                m.force_code = -25204
            with self.assertRaises(AssertionError):
                self.perform(m)
            self.assertEqual(m.pressed, [])
            self.assertEqual(m.refs, [])
            self.assertEqual(
                sum(row[0] == "copy" for row in m.log), 0 if kind == "owner" else 1
            )

    def test_timing_clock_failure_cannot_replace_original_native_error(self):
        method = H["make_timed_raw"](SOURCE)
        m = Message(0.01)
        m.force_code = -25204
        m._own = types.MethodType(OWN, m)
        method.__globals__["time"] = types.SimpleNamespace(
            monotonic=lambda: (_ for _ in ()).throw(RuntimeError("clock unavailable"))
        )
        with patch("time.monotonic", side_effect=lambda: m.clock[0]), self.assertRaises(
            AssertionError
        ) as caught:
            method(m, 9, "AXRole")
        self.assertEqual(str(caught.exception), "Owned AX attribute failed")
        self.assertEqual(
            caught.exception.ownedAxRawFailureReceipt["nativeCode"], -25204
        )

    def test_before_cleanup_only_original_readonly_poll_and_original_failure_preserved(
        self,
    ):
        B = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))[
            "MemoryCaseBudget"
        ]
        clock = [0]
        budget = B(now=lambda: clock[0])
        calls = []
        fixture = types.SimpleNamespace(
            command=lambda op, seconds, **kw: calls.append((op, seconds, kw))
            or {"facts": {"nativeAlive": True, "nativeExit": None, "modelCalls": 5}}
        )
        with tempfile.TemporaryDirectory() as folder:
            facts = {
                "status": "failed",
                "failure": "original-error",
                "observations": {"activeQuitHeld": {}},
            }
            H["capture_before_cleanup"](fixture, Path(folder), facts, 160, budget)
            self.assertEqual(calls, [("activeQuitSnapshot", 3, {"phase": "poll"})])
            self.assertEqual(facts["failure"], "original-error")
            self.assertEqual(facts["status"], "failed")
            self.assertTrue(
                json.loads(
                    (Path(folder) / "active-quit-before-cleanup.json").read_text()
                )["beforeTestCleanup"]
            )
            self.assertEqual(budget.end, 160)

    def test_before_cleanup_exhausted_or_late_or_error_is_unavailable_not_new_budget(
        self,
    ):
        B = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))[
            "MemoryCaseBudget"
        ]
        for mode in ["expired", "late", "error"]:
            clock = [0]
            budget = B(now=lambda: clock[0])
            clock[0] = 160 if mode == "expired" else 159.8
            calls = []

            def command(*a, **kw):
                calls.append(a)
                if mode == "error":
                    raise RuntimeError("controlled snapshot failure")
                clock[0] = 160.1
                return {"facts": {}}

            facts = {
                "failure": "original-error",
                "observations": {"activeQuitHeld": {}},
            }
            with tempfile.TemporaryDirectory() as folder:
                H["capture_before_cleanup"](
                    types.SimpleNamespace(command=command),
                    Path(folder),
                    facts,
                    160,
                    budget,
                )
                self.assertEqual(
                    facts["beforeCleanupObservation"]["status"], "unavailable"
                )
                self.assertEqual(facts["failure"], "original-error")
                self.assertFalse(
                    (Path(folder) / "active-quit-before-cleanup.json").exists()
                )
                self.assertEqual(len(calls), 0 if mode == "expired" else 1)
                self.assertEqual(budget.end, 160)


if __name__ == "__main__":
    unittest.main()
