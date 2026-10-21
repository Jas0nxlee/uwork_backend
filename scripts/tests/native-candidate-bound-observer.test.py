"""Actual bounded collector method with controlled graph/CF functions; no native libraries/App."""

import ast, json, runpy, types, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
M = runpy.run_path(str(ROOT / "scripts/tests/native-candidate-bound-observer.py"))
BASE = ROOT / "scripts/tests/macos-architecture-warning-dismiss.py"
OLD = runpy.run_path(str(BASE))["_NativeAx"].candidates
NEW = M["make_candidate_method"](BASE.read_text())


class Fake:
    pid = 42
    deadline = 10

    def __init__(self, kind="alias", guard=True):
        self.refs = []
        self.calls = []
        self.next = 2
        self.kind = kind
        self.logical = {1: "app"}
        self.ax = {"element": lambda _: 1}
        self.candidateBoundDiagnostic = None

        def cf_equal(a, b):
            self.calls.append(("CFEqual", a, b))
            return self.logical.get(a) == self.logical.get(b)

        self.cf = types.SimpleNamespace(CFEqual=cf_equal)
        self._candidate_diag_owner_guard = lambda: (
            self.calls.append(("owner-guard",))
            if guard
            else (_ for _ in ()).throw(AssertionError("owner changed"))
        )

    def new(self, logical):
        r = self.next
        self.next += 1
        self.logical[r] = logical
        return r

    def _children(self, ref, name="AXChildren"):
        self.calls.append(("children", ref, name))
        if name == "AXWindows":
            if self.kind == "wide":
                return [self.new("window" + str(i)) for i in range(128)]
            return [self.new("sheet" if self.kind == "sheet" else "app")]
        if name == "AXSheets":
            return []
        if self.kind == "alias":
            return [self.new("app")]
        if self.kind == "wide" and str(self.logical[ref]).startswith("window"):
            return [self.new("leaf")]
        return []

    def _value(self, ref, name):
        self.calls.append(("value", ref, name))
        return (
            ("AXSheet" if self.kind == "sheet" else "AXWindow")
            if name == "AXRole"
            else "AXStandardWindow"
        )

    def _candidate(self, ref):
        self.calls.append(("candidate", ref))
        return {"ref": ref, "pid": 42}

    def _own(self, ref):
        self.calls.append(("own", ref))
        assert ref in self.logical


class Contract(unittest.TestCase):
    def test_actual_old_depth_bound_still_raises_and_new_only_adds_safe_metadata_and_three_comparisons(
        self,
    ):
        old = Fake()
        new = Fake()
        with self.assertRaises(AssertionError):
            OLD(old, 42, 10)
        with patch.object(M["time"], "monotonic", return_value=0), self.assertRaises(
            AssertionError
        ):
            NEW(new, 42, 10)
        before = [c for c in old.calls if c[0] in ("children", "value", "candidate")]
        after = [c for c in new.calls if c[0] in ("children", "value", "candidate")]
        self.assertEqual(before, after)
        receipt = new.candidateBoundDiagnostic
        self.assertEqual(receipt["depth"], 5)
        self.assertEqual(receipt["reasons"], ["depth"])
        self.assertEqual(receipt["limits"], {"seen": 128, "depth": 4})
        self.assertEqual(len(receipt["comparisons"]), 3)
        self.assertTrue(all(row["cfEqual"] for row in receipt["comparisons"]))
        self.assertFalse(receipt["textsCaptured"])
        self.assertFalse(receipt["actionsPerformed"])
        self.assertNotIn("ref", json.dumps(receipt["recent"]))

    def test_seen_129_bound_remains_no_role_read_for_exceeding_ref(self):
        fake = Fake("wide")
        with patch.object(M["time"], "monotonic", return_value=0), self.assertRaises(
            AssertionError
        ):
            NEW(fake, 42, 10)
        receipt = fake.candidateBoundDiagnostic
        self.assertEqual(receipt["seenCount"], 129)
        self.assertEqual(receipt["depth"], 1)
        self.assertEqual(receipt["reasons"], ["seen-count"])
        self.assertLessEqual(len(receipt["recent"]), 8)
        self.assertLessEqual(len(receipt["edges"]), 16)

    def test_owner_guard_failure_performs_no_cf_comparison_and_preserves_original_assert(
        self,
    ):
        fake = Fake(guard=False)
        with patch.object(M["time"], "monotonic", return_value=0), self.assertRaises(
            AssertionError
        ) as caught:
            NEW(fake, 42, 10)
        self.assertEqual(str(caught.exception), "")
        self.assertEqual(
            fake.candidateBoundDiagnostic["comparisonStatus"], "unavailable"
        )
        self.assertFalse(any(c[0] == "CFEqual" for c in fake.calls))

    def test_normal_sheet_path_has_identical_reads_and_return_no_extra_cf_or_cap_observer(
        self,
    ):
        old = Fake("sheet")
        new = Fake("sheet")
        self.assertEqual(OLD(old, 42, 10), NEW(new, 42, 10))
        self.assertEqual(old.calls, new.calls)
        self.assertIsNone(new.candidateBoundDiagnostic)

    def test_new_ax_namespace_source_does_not_change_original_actions_or_thresholds(
        self,
    ):
        original = (ROOT / "scripts/tests/mac-native-active-quit-ax.py").read_text()
        derived = M["derive_candidate_ax_module"](original)
        compile(derived, "new-only-ax-namespace", "exec")
        self.assertIn("adapter._candidate_diag_owner_guard=guard", derived)
        self.assertIn(
            "error.ownedCandidateBoundReceipt=adapter.candidateBoundDiagnostic", derived
        )
        self.assertEqual(
            derived.count('code = adapter.press(fresh["ref"])'),
            original.count('code = adapter.press(fresh["ref"])'),
        )
        method = M["derive_candidate_method"](BASE.read_text())
        self.assertIn("assert len(seen) <= 128 and depth <= 4", method)
        self.assertIn('if role in ("AXWebArea", "AXScrollArea"):', method)


if __name__ == "__main__":
    unittest.main()
