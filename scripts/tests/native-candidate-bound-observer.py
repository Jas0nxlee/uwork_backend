"""Pure preparation for one owned AX candidate bound. No App/AX access on import."""

import ast, ctypes, time
from pathlib import Path

_ROLES = frozenset(
    [
        "AXApplication",
        "AXWindow",
        "AXSheet",
        "AXDialog",
        "AXSystemDialog",
        "AXStandardWindow",
        "AXGroup",
        "AXWebArea",
        "AXScrollArea",
        "AXButton",
        "AXMenu",
        "AXMenuBar",
        "AXMenuItem",
        "AXMenuBarItem",
        "AXToolbar",
        "AXStaticText",
        "AXTextField",
        "AXTextArea",
        "AXCheckBox",
        "AXSplitGroup",
        "AXTabGroup",
        "AXTable",
        "AXRow",
        "AXCell",
        "AXUnknown",
    ]
)


def _role(value):
    return value if isinstance(value, str) and value in _ROLES else None


class CandidateObservation:
    """Only existing topology metadata; at the original failure optionally compares <=3 refs."""

    def __init__(self, adapter, application):
        self.adapter = adapter
        self.application = application
        self.recent = []
        self.edges = {}
        self.ordinals = {application: 1}
        self.next_ordinal = 2
        self.edge_dropped = False

    def ordinal(self, ref):
        if ref in self.ordinals:
            return self.ordinals[ref]
        if len(self.ordinals) >= 256:
            return None
        value = self.next_ordinal
        self.next_ordinal += 1
        self.ordinals[ref] = value
        return value

    def children(self, ref, name=None):
        values = (
            self.adapter._children(ref)
            if name is None
            else self.adapter._children(ref, name)
        )
        label = "AXChildren" if name is None else name
        for child in values:
            key = (child, ref, label)
            if len(self.edges) < 256:
                self.edges[key] = {
                    "from": self.ordinal(ref),
                    "to": self.ordinal(child),
                    "attribute": label,
                }
            else:
                self.edge_dropped = True
        return values

    def visited(self, ref, depth, role, subrole):
        self.recent.append(
            {
                "ref": ref,
                "ordinal": self.ordinal(ref),
                "depth": depth,
                "role": _role(role),
                "subrole": _role(subrole),
            }
        )
        self.recent = self.recent[-8:]

    def limit(self, ref, depth, seen, queue, found):
        reasons = []
        if len(seen) > 128:
            reasons.append("seen-count")
        if depth > 4:
            reasons.append("depth")
        receipt = {
            "schema": "owned-native-candidate-bound-v1",
            "limits": {"seen": 128, "depth": 4},
            "reasons": reasons,
            "seenCount": len(seen),
            "depth": depth,
            "pendingCount": len(queue),
            "foundCount": len(found),
            "currentRefOrdinal": self.ordinal(ref),
            "currentRoleNotReadPastBound": True,
            "recent": [
                {k: v for k, v in row.items() if k != "ref"} for row in self.recent
            ],
            "edges": list(self.edges.values())[-16:],
            "edgeHistoryTruncated": self.edge_dropped,
            "comparisons": [],
            "textsCaptured": False,
            "actionsPerformed": False,
        }
        self.adapter.candidateBoundDiagnostic = receipt
        try:
            guard = getattr(self.adapter, "_candidate_diag_owner_guard", None)
            assert callable(guard), "Original owner guard required"
            targets = [("application", self.application)] + [
                ("recent", r["ref"]) for r in self.recent[-2:]
            ]
            for kind, target in targets:
                guard()
                self.adapter._own(ref)
                self.adapter._own(target)
                guard()
                assert time.monotonic() < self.adapter.deadline
                cf = self.adapter.cf
                cf.CFEqual.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
                cf.CFEqual.restype = ctypes.c_bool
                equal = bool(cf.CFEqual(ref, target))
                guard()
                assert time.monotonic() < self.adapter.deadline
                receipt["comparisons"].append(
                    {
                        "leftOrdinal": self.ordinal(ref),
                        "rightOrdinal": self.ordinal(target),
                        "target": kind,
                        "cfEqual": equal,
                        "bothExactPidChecked": True,
                    }
                )
            receipt["comparisonStatus"] = "bounded-read-complete"
        except BaseException as error:
            receipt["comparisonStatus"] = "unavailable"
            receipt["comparisonErrorType"] = type(error).__name__[:80]


def derive_candidate_method(source):
    tree = ast.parse(source)
    cls = next(
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "_NativeAx"
    )
    fn = next(
        n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "candidates"
    )
    lines = source.splitlines()
    text = "\n".join(line[4:] for line in lines[fn.lineno - 1 : fn.end_lineno]) + "\n"

    def once(a, b):
        nonlocal text
        assert text.count(a) == 1, a
        text = text.replace(a, b)

    once(
        '    queue = [(ref, 0) for ref in self._children(application, "AXWindows")]',
        '    observation=CandidateObservation(self,application)\n    queue = [(ref, 0) for ref in observation.children(application, "AXWindows")]',
    )
    once(
        "        assert len(seen) <= 128 and depth <= 4",
        "        if not (len(seen)<=128 and depth<=4):\n            try: observation.limit(ref,depth,seen,queue,found)\n            except BaseException: pass\n        assert len(seen) <= 128 and depth <= 4",
    )
    once(
        '        role, subrole = self._value(ref, "AXRole"), self._value(ref, "AXSubrole")',
        '        role, subrole = self._value(ref, "AXRole"), self._value(ref, "AXSubrole")\n        observation.visited(ref,depth,role,subrole)',
    )
    once(
        'for child in self._children(ref) + self._children(ref, "AXSheets")',
        'for child in observation.children(ref) + observation.children(ref, "AXSheets")',
    )
    compile(text, "actual-bounded-candidate-diagnostic", "exec")
    return text


def make_candidate_method(source):
    ns = {"CandidateObservation": CandidateObservation}
    exec(
        compile(
            derive_candidate_method(source),
            "actual-bounded-candidate-diagnostic",
            "exec",
        ),
        ns,
    )
    return ns["candidates"]


def derive_candidate_ax_module(original):
    # New namespace only: never changes the original shared helper or global AX adapter.
    source = original
    anchor = '    adapter = ax if ax is not None else _QuitAx(binding["pid"], end)'
    assert source.count(anchor) == 1
    source = source.replace(
        anchor, anchor + "\n    adapter._candidate_diag_owner_guard=guard"
    )
    anchor = "    finally:\n        adapter.close()"
    assert source.count(anchor) == 1
    source = source.replace(
        anchor,
        "    except BaseException as error:\n        try: error.ownedCandidateBoundReceipt=adapter.candidateBoundDiagnostic\n        except BaseException: pass\n        raise\n"
        + anchor,
    )
    source += "\n_CANDIDATE_DIAG=runpy.run_path(str(Path(__file__).with_name('native-candidate-bound-observer.py')))\n_QuitAx.candidates=_CANDIDATE_DIAG['make_candidate_method'](Path(__file__).with_name('macos-architecture-warning-dismiss.py').read_text())\n"
    compile(source, "new-owned-quit-candidate-observer", "exec")
    return source
