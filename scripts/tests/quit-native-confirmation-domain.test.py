"""Actual collector and original perform/confirmation combination; no native libraries/App."""

import copy, runpy, types, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OLD = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-ax.py"))
T = runpy.run_path(str(ROOT / "scripts/tests/mac-native-active-quit-ax.test.py"))
NEW_PATH = ROOT / "scripts/tests/quit-native-confirmation-domain.py"


class Graph:
    pid = 123
    deadline = 5

    def __init__(self, kind="deep", appear=0):
        self.refs = []
        self.released = []
        self.calls = []
        self.kind = kind
        self.appear = appear
        self.round = 0
        self.cf = types.SimpleNamespace(CFRelease=self.released.append)
        self.ax = {"element": lambda pid: 1}
        self.roles = {
            1: ("AXApplication", None),
            2: ("AXWindow", "AXStandardWindow"),
            3: ("AXGroup", None),
            4: ("AXGroup", None),
            5: ("AXGroup", None),
            6: ("AXGroup", None),
            7: ("AXGroup", None),
            8: ("AXSheet", None),
            9: ("AXWindow", "AXDialog"),
            10: ("AXSheet", None),
        }
        self._quit_native_guard = lambda: None

    def _own(self, ref):
        self.calls.append(("own", ref))
        assert self.kind != "foreign"

    def _value(self, ref, key):
        self.calls.append(("value", ref, key))
        return self.roles[ref][key == "AXSubrole"]

    def _children(self, ref, name="AXChildren"):
        self.calls.append(("children", ref, name))
        if name == "AXWindows":
            self.round += 1
            out = [2]
        elif ref == 2 and name == "AXSheets":
            out = (
                [8]
                if self.kind in ("sheet", "both", "duplicate")
                and self.round > self.appear
                else []
            )
        elif ref == 2 and name == "AXChildren":
            out = (
                [8]
                if self.kind in ("child", "both") and self.round > self.appear
                else (
                    [9]
                    if self.kind == "dialog"
                    else [10] if self.kind == "duplicate" else [3]
                )
            )
        elif self.kind == "deep" and name == "AXChildren" and 3 <= ref < 7:
            out = [ref + 1]
        else:
            out = []
        if self.kind == "malformed" and name == "AXWindows":
            out = "not-array"
        if self.kind == "cap" and name == "AXWindows":
            out = [2] * 129
        if isinstance(out, list):
            self.refs.extend(out)
        return out

    def _candidate(self, ref):
        self.calls.append(("candidate", ref))
        r = copy.deepcopy(T["dialog"]())
        r.update(ref=ref, role=self.roles[ref][0], subrole=self.roles[ref][1])
        return r


class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = runpy.run_path(str(NEW_PATH))
        Graph.candidates = cls.m["collect_quit_native_candidates"]

    def collect(self, g):
        with patch.object(self.m["time"], "monotonic", return_value=0):
            return self.m["collect_quit_native_candidates"](g, 123, 5)

    def test_old_actual_deep_group_red_new_domain_does_not_traverse(self):
        with self.assertRaises(AssertionError):
            OLD["_QuitAx"].candidates(Graph(), 123, 5)
        g = Graph()
        self.assertEqual(self.collect(g), [])
        self.assertFalse(any(c[:2] == ("children", 3) for c in g.calls))

    def test_direct_sheet_child_dialog_and_same_ref_duplicate_attributes(self):
        for kind in ["sheet", "child", "dialog", "both"]:
            g = Graph(kind)
            self.assertEqual(len(self.collect(g)), 1)
            self.assertEqual(sum(c[0] == "candidate" for c in g.calls), 1)

    def test_wrong_owner_malformed_and_cap_fail_closed(self):
        for kind in ["foreign", "malformed", "cap"]:
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                self.collect(Graph(kind))

    def test_zero_then_sheet_with_original_deadline_and_round_ref_release(self):
        g = Graph("sheet", appear=2)
        clock = [0]
        with patch.object(
            self.m["time"], "monotonic", side_effect=lambda: clock[0]
        ), patch.object(
            self.m["time"],
            "sleep",
            side_effect=lambda s: clock.__setitem__(0, clock[0] + s),
        ):
            rows = self.m["wait_quit_candidates"](g, 123, 5, lambda: None)
        self.assertEqual(len(rows), 1)
        self.assertEqual(g.round, 3)
        self.assertEqual(len(g.released), 6)
        self.assertLess(clock[0], 5)

    def test_timeout_releases_round_refs_and_never_creates_new_deadline(self):
        g = Graph()
        clock = [0]
        with patch.object(
            self.m["time"], "monotonic", side_effect=lambda: clock[0]
        ), patch.object(
            self.m["time"],
            "sleep",
            side_effect=lambda s: clock.__setitem__(0, clock[0] + s),
        ), self.assertRaises(
            AssertionError
        ):
            self.m["wait_quit_candidates"](g, 123, 5, lambda: None)
        self.assertEqual(clock[0], 5)
        self.assertEqual(g.refs, [])

    def test_owner_change_or_deadline_during_probe_stops_before_more_reads(self):
        for late in [False, True]:
            g = Graph("sheet")
            clock = [0]
            calls = []

            def guard():
                calls.append(1)
                if late:
                    clock[0] = 6
                else:
                    raise AssertionError("owner changed")

            g._quit_native_guard = guard
            with patch.object(
                self.m["time"], "monotonic", side_effect=lambda: clock[0]
            ), self.assertRaises(AssertionError):
                self.m["collect_quit_native_candidates"](g, 123, 5)
            self.assertEqual(g.calls, [])

    def test_application_created_before_guard_failure_is_released_by_actual_wait(self):
        g = Graph()
        calls = []

        def guard():
            calls.append(1)
            if len(calls) == 3:
                raise AssertionError("post-create guard exhausted")

        with patch.object(
            self.m["time"], "monotonic", return_value=0
        ), self.assertRaises(AssertionError):
            self.m["wait_quit_candidates"](g, 123, 5, guard)
        self.assertEqual(g.released, [1])
        self.assertEqual(g.refs, [])
        self.assertFalse(any(c[0] == "candidate" for c in g.calls))
        self.assertFalse(any(c[0] == "children" for c in g.calls))

    def test_malformed_sheet_property_fails_not_empty_retry(self):
        g = Graph()
        old = g._children

        def children(ref, name="AXChildren"):
            return [3] if name == "AXSheets" else old(ref, name)

        g._children = children
        with self.assertRaises(AssertionError):
            self.collect(g)

    def perform(self, g):
        ns = {
            "__file__": str(ROOT / "scripts/tests/mac-native-active-quit-ax.py"),
            "__name__": "pure_quit_domain",
        }
        exec(
            compile(
                self.m["derive_quit_domain_ax_module"](
                    (ROOT / "scripts/tests/mac-native-active-quit-ax.py").read_text()
                ),
                "actual-domain-perform",
                "exec",
            ),
            ns,
        )
        clock = [0]
        g.candidates = types.MethodType(self.m["collect_quit_native_candidates"], g)
        g.pressed = []
        g.closed = False
        g.refresh = getattr(g, "refresh_override", lambda row, end: row)
        g.press = lambda ref: g.pressed.append(ref) or 0
        g.close = lambda: setattr(g, "closed", True)
        with patch.object(
            self.m["time"], "monotonic", side_effect=lambda: clock[0]
        ), patch.object(
            self.m["time"],
            "sleep",
            side_effect=lambda s: clock.__setitem__(0, clock[0] + s),
        ):
            return ns["perform_owned_quit_action"](
                T["B"],
                "cancel",
                deadline=5,
                actor_guard=lambda: True,
                ax=g,
                inspect_actor=lambda identity, end: identity,
                now=lambda: clock[0],
            )

    def test_original_perform_confirmation_refresh_and_press_combined(self):
        g = Graph("sheet", appear=1)
        self.assertEqual(self.perform(g)["status"], "cancelled")
        self.assertEqual(g.pressed, ["取消"])
        self.assertTrue(g.closed)

    def test_original_refresh_frame_mismatch_never_press(self):
        g = Graph("sheet")
        g.refresh_override = lambda row, end: {
            **row,
            "frame": {**row["frame"], "X": 20},
        }
        with self.assertRaises(AssertionError):
            self.perform(g)
        self.assertEqual(g.pressed, [])
        self.assertTrue(g.closed)

    def test_duplicate_dialog_or_wrong_confirmation_never_press(self):
        for kind in ["duplicate", "sheet"]:
            g = Graph(kind)
            if kind == "sheet":
                actual = g._candidate

                def wrong(ref):
                    row = actual(ref)
                    row["texts"] = ["unrelated"]
                    return row

                g._candidate = wrong
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                self.perform(g)
            self.assertEqual(g.pressed, [])
            self.assertTrue(g.closed)


if __name__ == "__main__":
    unittest.main()
