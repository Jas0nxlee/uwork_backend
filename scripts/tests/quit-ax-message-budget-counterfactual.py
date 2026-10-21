"""Private AX message sub-budget counterfactual. No native calls on import."""

import ast
import json
import math
import os
import runpy
import time
from pathlib import Path

MESSAGE_CAP_SECONDS = 0.5
TIMING_LIMIT = 64
RAW_ERROR = runpy.run_path(
    str(Path(__file__).with_name("quit-ax-attribute-error-observer.py"))
)


def original_own_method(source):
    tree = ast.parse(source)
    cls = next(
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "_NativeAx"
    )
    fn = next(
        n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "_own"
    )
    return (
        "\n".join(
            line[4:] for line in source.splitlines()[fn.lineno - 1 : fn.end_lineno]
        )
        + "\n"
    )


def derive_own(source):
    original = original_own_method(source)
    anchor = "min(0.1, left)"
    assert original.count(anchor) == 1
    return (
        original.replace(anchor, "min(MESSAGE_CAP_SECONDS, left)")
        + "    _remaining(self.deadline, time.monotonic)\n    self._owned_message_timeout = min(MESSAGE_CAP_SECONDS, left)\n"
    )


def make_own(source):
    original = runpy.run_path(
        str(Path(__file__).with_name("macos-architecture-warning-dismiss.py"))
    )
    ns = {
        "time": time,
        "_remaining": original["_remaining"],
        "MESSAGE_CAP_SECONDS": MESSAGE_CAP_SECONDS,
    }
    exec(compile(derive_own(source), "private-owned-message-sub-budget", "exec"), ns)
    return ns["_own"]


def record_copy(adapter, name, code, out, started, finished):
    try:
        elapsed = finished - started
        assert math.isfinite(elapsed) and elapsed >= 0
        rows = getattr(adapter, "_owned_copy_timings", [])
        rows.append(
            {
                "attribute": (
                    name if name in RAW_ERROR["ATTRIBUTES"] else "other-attribute"
                ),
                "nativeCode": code if type(code) is int else None,
                "returnValuePresent": bool(out),
                "elapsedSeconds": elapsed,
                "messageTimeoutSeconds": getattr(
                    adapter, "_owned_message_timeout", None
                ),
            }
        )
        if len(rows) > TIMING_LIMIT:
            rows = rows[-TIMING_LIMIT:]
            adapter._owned_copy_timings_truncated = True
        adapter._owned_copy_timings = rows
    except BaseException:
        adapter._owned_copy_timing_unavailable = True


def derive_timed_raw(source):
    original = RAW_ERROR["derive_observed_raw"](source)
    anchor = "        code = self.api.AXUIElementCopyAttributeValue(ref, key, self.C.byref(out))"
    assert original.count(anchor) == 1
    return original.replace(
        anchor,
        """        try:
            _copy_started = time.monotonic()
        except BaseException:
            _copy_started = None
        _copy_code = None
        try:
            code = self.api.AXUIElementCopyAttributeValue(ref, key, self.C.byref(out))
            _copy_code = code
        finally:
            try:
                _copy_finished = time.monotonic()
            except BaseException:
                _copy_finished = None
            record_copy(self, name, _copy_code, out, _copy_started, _copy_finished)""",
    )


def make_timed_raw(source):
    ns = {
        "time": time,
        "record_copy": record_copy,
        "ATTRIBUTES": RAW_ERROR["ATTRIBUTES"],
    }
    exec(compile(derive_timed_raw(source), "private-timed-original-raw", "exec"), ns)
    return ns["_raw"]


def timing_receipt(adapter):
    return {
        "schema": "owned-ax-copy-timing-counterfactual-v1",
        "perObjectMessageCapSeconds": MESSAGE_CAP_SECONDS,
        "sameOriginalOperationDeadline": True,
        "copies": [dict(row) for row in getattr(adapter, "_owned_copy_timings", [])],
        "truncated": getattr(adapter, "_owned_copy_timings_truncated", False),
        "timingUnavailable": getattr(adapter, "_owned_copy_timing_unavailable", False),
        "extraAxReads": 0,
        "counterfactualNotTimeoutRootCause": True,
    }


def attach_timings(result, adapter):
    try:
        result["ownedAxCopyTiming"] = timing_receipt(adapter)
    except BaseException:
        pass
    return result


def attach_failure_timings(error, adapter):
    try:
        error.ownedAxCopyTimingReceipt = timing_receipt(adapter)
    except BaseException:
        pass


def derive_ax_module(domain_source):
    source = RAW_ERROR["derive_raw_error_ax_module"](domain_source)
    tree = ast.parse(source)
    fn = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "perform_owned_quit_action"
    )
    result = next(n for n in ast.walk(fn) if isinstance(n, ast.Return))
    lines = source.splitlines(keepends=True)
    text = "".join(lines[result.lineno - 1 : result.end_lineno])
    assert text.lstrip().startswith("return {") and text.rstrip().endswith("}")
    wrapped = (
        text.replace(
            "return {", "return _MESSAGE_BUDGET['attach_timings']({", 1
        ).rstrip()[:-1]
        + "}, adapter)\n"
    )
    lines[result.lineno - 1 : result.end_lineno] = [wrapped]
    source = "".join(lines)
    anchor = "    finally:\n        adapter.close()"
    assert source.count(anchor) == 1
    source = source.replace(
        anchor,
        "    except BaseException as error:\n        _MESSAGE_BUDGET['attach_failure_timings'](error,adapter)\n        raise\n"
        + anchor,
    )
    source += "\n_MESSAGE_BUDGET=runpy.run_path(str(Path(__file__).with_name('quit-ax-message-budget-counterfactual.py')))\n_QuitAx._own=_MESSAGE_BUDGET['make_own'](Path(__file__).with_name('macos-architecture-warning-dismiss.py').read_text())\n_QuitAx._raw=_MESSAGE_BUDGET['make_timed_raw'](Path(__file__).with_name('macos-architecture-warning-dismiss.py').read_text())\n"
    compile(source, "private-message-budget-counterfactual", "exec")
    return source


def save_receipt(target, payload, limit):
    value = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    assert len(value.encode()) <= limit
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(value)


def capture_timings(error, evidence, facts):
    try:
        payload = getattr(error, "ownedAxCopyTimingReceipt", None)
        if payload is None:
            return
        assert payload["schema"] == "owned-ax-copy-timing-counterfactual-v1"
        assert len(payload["copies"]) <= TIMING_LIMIT
        target = evidence / "active-quit-ax-copy-timing.json"
        save_receipt(target, payload, 32768)
        facts["axCopyTimingObservation"] = {"status": "saved", "file": target.name}
    except BaseException as error:
        facts["axCopyTimingObservation"] = {
            "status": "unavailable",
            "observerErrorType": type(error).__name__[:80],
        }


def capture_before_cleanup(fixture, evidence, facts, deadline, budget):
    """Original readonly snapshot, only after failure/hold and within existing work budget."""
    try:
        if (
            fixture is None
            or "failure" not in facts
            or "activeQuitHeld" not in facts.get("observations", {})
        ):
            facts["beforeCleanupObservation"] = {"status": "not-applicable"}
            return
        left = min(deadline - budget.now(), budget.left())
        assert left > 0
        payload = fixture.command("activeQuitSnapshot", min(3, left), phase="poll")[
            "facts"
        ]
        assert deadline - budget.now() > 0
        budget.left()
        target = evidence / "active-quit-before-cleanup.json"
        save_receipt(
            target,
            {"afterOriginalFailure": True, "beforeTestCleanup": True, "facts": payload},
            131072,
        )
        budget.left()
        facts["beforeCleanupObservation"] = {
            "status": "saved",
            "file": target.name,
            "notBusinessSuccess": True,
        }
    except BaseException as error:
        try:
            facts["beforeCleanupObservation"] = {
                "status": "unavailable",
                "observerErrorType": type(error).__name__[:80],
            }
        except BaseException:
            pass
