"""Owned Main AX read-only diagnostic. Import is pure; native libraries load only on use."""

import ctypes as C
import hashlib
from pathlib import Path
import runpy
import time

ROOT = Path(__file__).resolve().parents[2]
TEXT = runpy.run_path(str(ROOT / "scripts/tests/macos-architecture-warning-dismiss.py"))
KNOWN = {
    value
    for locale in ("zh-CN", "en-US")
    for value in TEXT["architecture_warning_text"](locale).values()
}
ROLES = {
    "AXApplication",
    "AXWindow",
    "AXSheet",
    "AXDialog",
    "AXSystemDialog",
    "AXButton",
    "AXStaticText",
    "AXGroup",
    "AXWebArea",
    "AXScrollArea",
}


def project(value):
    if isinstance(value, str):
        raw = value.encode("utf-8")
        result = {"utf8Bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if value in KNOWN:
            result["knownArchitectureText"] = value
        elif value in ROLES:
            result["role"] = value
        return result
    if isinstance(value, bool) or value is None:
        return value
    return {"unsupportedValueType": type(value).__name__}


def observe_architecture_ax(
    pid, reader, actor_owned, *, now=time.monotonic, started_at=None
):
    """One shared5s window. Unknown AX codes are observations, never empty success."""
    assert type(pid) is int and pid > 1
    started = now() if started_at is None else started_at
    deadline = started + 5
    reads = []
    known = set()
    last_values = {}
    windows = []
    facts = {
        "status": "observing",
        "readOnly": True,
        "budgetSeconds": 5,
        "ownedPid": pid,
        "reads": reads,
        "actions": 0,
    }

    def read(ref, attr, timeout):
        nonlocal windows
        if now() >= deadline or len(reads) >= 96:
            return None
        assert actor_owned(), "Owned Main identity changed"
        if now() >= deadline:
            return None
        left = deadline - now()
        used = min(timeout, left / 3)
        result = reader.read(ref, attr, used)
        assert (
            result["ownPidCode"] != 0 or result["ownPid"] == pid
        ), "AX element PID differs"
        row = {
            key: result[key]
            for key in (
                "code",
                "ownPid",
                "ownPidCode",
                "messagingTimeoutCode",
                "elapsedMs",
            )
        }
        row.update(
            attribute=attr,
            methodTimeoutSeconds=timeout,
            effectiveTimeoutSeconds=used,
            value=project(result.get("value")),
        )
        for key in (
            "refOrdinal",
            "isAXUIElement",
            "equalsApplication",
            "childIdentities",
        ):
            if key in result:
                row[key] = result[key]
        children = result.get("children", [])
        if children:
            row["ownedChildCount"] = len(children)
        reads.append(row)
        if result["code"] == 0 and result["ownPidCode"] == 0:
            value = result.get("value")
            if isinstance(value, str) and value in KNOWN:
                known.add(value)
            last_values[(ref, attr)] = value
            if attr == "AXWindows":
                windows = children
        if now() < deadline:
            assert actor_owned(), "Owned Main identity changed"
        return result

    try:
        # Compare the same root attributes first, before any optional dialog traversal.
        for timeout in (0.1, 0.75):
            for attr in ("AXRole", "AXWindows"):
                read("application", attr, timeout)
        # Ref-only followup: inspect at most the first non-root AX element from the last successful array.
        identities = [
            item
            for row in reads
            if row["attribute"] == "AXWindows"
            for item in row.get("childIdentities", [])
        ]
        facts["windowReferenceStatus"] = "unresolved-no-child-observed"
        if any(not item["isAXUIElement"] for item in identities):
            facts["windowReferenceStatus"] = "unresolved-non-AX-array-element"
        elif any(item["equalsApplication"] for item in identities):
            facts["windowReferenceStatus"] = "unresolved-array-contains-application"
        if windows:
            child = read(windows[0], "AXRole", 0.75)
            value = (child or {}).get("value")
            if value == "AXApplication":
                facts["windowReferenceStatus"] = "unresolved-child-application-role"
            elif value == "AXWindow":
                facts["windowReferenceStatus"] = "owned-window-reference-observed"
            else:
                facts["windowReferenceStatus"] = "unresolved-child-role"
        facts["architectureWarningConfirmed"] = False
        facts["architectureWarningAbsentEstablished"] = False
        facts["interpretation"] = (
            "local ref diagnostic only; no dialog absence or successful dismissal established"
        )
        facts.update(
            status="observed-readonly",
            budgetExhausted=now() >= deadline,
            elapsedMs=(now() - started) * 1000,
        )
        return facts
    except BaseException as error:
        facts.update(
            status="failed-readonly",
            failureType=type(error).__name__,
            elapsedMs=(now() - started) * 1000,
        )
        error.architectureAXReceipt = facts
        raise
    finally:
        reader.close()


class NativeOwnedReader:
    """No action/set-value/global application API. Only owned application element reads."""

    def __init__(self, pid):
        self.m = runpy.run_path(str(ROOT / "scripts/tests/macos-ax-driver.py"))
        assert self.m["trusted"](), "Accessibility unavailable (no permission prompt)"
        ax = self.m["_AX"]
        ax.AXUIElementGetPid.argtypes = [C.c_void_p, C.POINTER(C.c_int)]
        ax.AXUIElementGetPid.restype = C.c_int32
        ax.AXUIElementSetMessagingTimeout.argtypes = [C.c_void_p, C.c_float]
        ax.AXUIElementSetMessagingTimeout.restype = C.c_int32
        ax.AXUIElementGetTypeID.argtypes = []
        ax.AXUIElementGetTypeID.restype = C.c_ulong
        self.m["_CF"].CFEqual.argtypes = [C.c_void_p, C.c_void_p]
        self.m["_CF"].CFEqual.restype = C.c_bool
        self.ax_type = int(ax.AXUIElementGetTypeID())
        self.pid = pid
        self.app = self.m["element"](pid)
        assert self.app
        self.refs = [self.app]
        self.identity_ordinals = {self.app: 1}
        assert (
            self.m["_CF"].CFGetTypeID(self.app) == self.ax_type
        ), "Owned root is not AXUIElement"

    def _identity(self, ref):
        if ref not in self.identity_ordinals:
            self.identity_ordinals[ref] = len(self.identity_ordinals) + 1
        return {
            "refOrdinal": self.identity_ordinals[ref],
            "isAXUIElement": self.m["_CF"].CFGetTypeID(ref) == self.ax_type,
            "equalsApplication": bool(self.m["_CF"].CFEqual(ref, self.app)),
        }

    def read(self, ref, attr, timeout):
        ref = self.app if ref == "application" else ref
        ax, cf = self.m["_AX"], self.m["_CF"]
        started = time.monotonic()
        timeout_code = ax.AXUIElementSetMessagingTimeout(ref, timeout)
        owner = C.c_int(0)
        own_code = (
            ax.AXUIElementGetPid(ref, C.byref(owner))
            if timeout_code == 0
            else timeout_code
        )
        result = {
            "messagingTimeoutCode": int(timeout_code),
            "ownPidCode": int(own_code),
            "ownPid": owner.value,
            "code": int(own_code),
            "value": None,
        }
        result.update(self._identity(ref))
        if own_code == 0 and owner.value == self.pid:
            key = self.m["_cf_string"](attr)
            out = self.m["CFTypeRef"]()
            try:
                result["code"] = int(
                    ax.AXUIElementCopyAttributeValue(ref, key, C.byref(out))
                )
                if result["code"] == 0 and out:
                    if attr in ("AXWindows", "AXSheets", "AXChildren"):
                        assert (
                            cf.CFGetTypeID(out) == cf.CFArrayGetTypeID()
                        ), "AX array expected"
                        count = cf.CFArrayGetCount(out)
                        assert 0 <= count <= 16, "Owned AX array bound"
                        children = []
                        identities = []
                        for index in range(count):
                            borrowed = cf.CFArrayGetValueAtIndex(out, index)
                            identity = self._identity(borrowed)
                            identities.append(identity)
                            if (
                                identity["isAXUIElement"]
                                and not identity["equalsApplication"]
                            ):
                                child = cf.CFRetain(borrowed)
                                self.refs.append(child)
                                children.append(child)
                        result["children"] = children
                        result["childIdentities"] = identities
                    else:
                        result["value"] = self.m["_python_value"](out, 4096)
            finally:
                if out:
                    cf.CFRelease(out)
                cf.CFRelease(key)
        result["elapsedMs"] = (time.monotonic() - started) * 1000
        return result

    def close(self):
        for ref in reversed(self.refs):
            self.m["release"](ref)
        self.refs = []
