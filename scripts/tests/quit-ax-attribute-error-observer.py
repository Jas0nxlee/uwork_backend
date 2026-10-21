"""Private original AX _raw assertion observation. Pure import, no native calls."""

import ast
import json
import os

ATTRIBUTES = (
    "AXRole",
    "AXSubrole",
    "AXWindows",
    "AXSheets",
    "AXChildren",
    "AXFrontmost",
    "AXMenuBar",
    "AXEnabled",
    "AXTitle",
    "AXValue",
    "AXDescription",
)


def original_raw_method(source):
    tree = ast.parse(source)
    cls = next(
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "_NativeAx"
    )
    fn = next(
        n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "_raw"
    )
    return (
        "\n".join(
            line[4:] for line in source.splitlines()[fn.lineno - 1 : fn.end_lineno]
        )
        + "\n"
    )


def derive_observed_raw(source):
    original = original_raw_method(source)
    anchor = '        assert code in (-25205, -25212), "Owned AX attribute failed"'
    assert original.count(anchor) == 1
    observed = """        try:
            assert code in (-25205, -25212), "Owned AX attribute failed"
        except AssertionError as error:
            try:
                error.ownedAxRawFailureReceipt = {
                    "schema": "owned-native-ax-attribute-error-v1",
                    "attribute": name if name in ATTRIBUTES else "other-attribute",
                    "nativeCode": code if type(code) is int and -(2**31) <= code < 2**31 else None,
                    "returnValuePresent": bool(out),
                    "originalOwnPidGuardCompleted": True,
                    "stage": "original-copy-attribute-error-branch",
                    "extraAxReads": 0,
                }
            except BaseException:
                pass
            raise"""
    result = original.replace(anchor, observed)
    assert result.replace(observed, anchor) == original
    compile(result, "owned-raw-attribute-error-observation", "exec")
    return result


def make_observed_raw(source):
    ns = {"ATTRIBUTES": ATTRIBUTES}
    exec(
        compile(
            derive_observed_raw(source), "owned-raw-attribute-error-observation", "exec"
        ),
        ns,
    )
    return ns["_raw"]


def derive_raw_error_ax_module(domain_source):
    assert (
        domain_source.count(
            '_QuitAx.candidates=_QUIT_DOMAIN["collect_quit_native_candidates"]'
        )
        == 1
    )
    result = (
        domain_source
        + "\n_RAW_ERROR=runpy.run_path(str(Path(__file__).with_name('quit-ax-attribute-error-observer.py')))\n_QuitAx._raw=_RAW_ERROR['make_observed_raw'](Path(__file__).with_name('macos-architecture-warning-dismiss.py').read_text())\n"
    )
    compile(result, "private-quit-raw-error-observer", "exec")
    return result


def capture_raw_error(error, evidence, facts):
    """Only a fixed safe receipt. Persistence failure never replaces the original error."""
    try:
        receipt = getattr(error, "ownedAxRawFailureReceipt", None)
        if receipt is None:
            return
        assert set(receipt) == {
            "schema",
            "attribute",
            "nativeCode",
            "returnValuePresent",
            "originalOwnPidGuardCompleted",
            "stage",
            "extraAxReads",
        }
        assert receipt["schema"] == "owned-native-ax-attribute-error-v1"
        assert receipt["attribute"] in (*ATTRIBUTES, "other-attribute")
        assert (
            type(receipt["nativeCode"]) is int
            and -(2**31) <= receipt["nativeCode"] < 2**31
        )
        assert type(receipt["returnValuePresent"]) is bool
        assert receipt["originalOwnPidGuardCompleted"] is True
        assert receipt["stage"] == "original-copy-attribute-error-branch"
        assert type(receipt["extraAxReads"]) is int and receipt["extraAxReads"] == 0
        serialized = json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
        assert len(serialized.encode()) <= 4096
        target = evidence / "active-quit-ax-attribute-error.json"
        fd = os.open(
            target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(fd, "w") as stream:
            stream.write(serialized)
        facts["axAttributeErrorObservation"] = {"status": "saved", "file": target.name}
    except BaseException as observer_error:
        try:
            facts["axAttributeErrorObservation"] = {
                "status": "unavailable",
                "observerErrorType": type(observer_error).__name__[:80],
            }
        except BaseException:
            pass
