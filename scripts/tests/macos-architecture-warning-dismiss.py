"""Cancel only one exact owned Rosetta warning; import is pure and never loads AX.

Electron v41.10.7 message_box_mac.mm:32 ignores MessageBoxSettings.title.
Authority is the complete original message/detail and two exact original buttons;
an explicitly visible architecture title must agree. No default/download action.
"""

import math
from pathlib import Path
import runpy
import subprocess
import sys
import time

MAC_TITLE_AUTHORITY = "https://raw.githubusercontent.com/electron/electron/v41.10.7/shell/browser/ui/message_box_mac.mm"


def architecture_warning_text(locale):
    if locale == "zh-CN":
        return {
            "title": "架构不匹配",
            "message": "当前安装的不是适配本机的版本",
            "detail": "你正在运行 x64 版本，但本机是 arm64（Apple 芯片）架构，当前通过系统转译运行，会更慢、更耗电。\n\n建议前往官网下载并安装 arm64 原生版本以获得最佳性能。",
            "downloadButton": "前往下载",
            "dismissButton": "暂不处理",
        }
    assert locale == "en-US"
    return {
        "title": "Architecture Mismatch",
        "message": "The installed build does not match your machine",
        "detail": "You are running the x64 build, but this machine is arm64. It is currently running through system translation, which is slower and less power-efficient.\n\nPlease download and install the native arm64 build for the best performance.",
        "downloadButton": "Download",
        "dismissButton": "Not now",
    }


def _remaining(deadline, now):
    value = deadline - now()
    assert math.isfinite(value) and value > 0, "Owned AX deadline exceeded"
    return value


def _kernel_actor(binding, deadline):
    def run(args):
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=True,
            timeout=min(0.75, _remaining(deadline, time.monotonic)),
        ).stdout

    pid, executable = binding["pid"], binding["executable"]
    assert str(Path(executable).resolve(strict=True)) == executable
    birth = run(["ps", "-p", str(pid), "-o", "lstart="]).strip()
    assert birth == binding["birth"]
    mapped = run(["lsof", "-nP", "-a", "-p", str(pid), "-d", "txt", "-Fn"])
    assert "n" + executable in mapped.splitlines()
    assert run(["ps", "-p", str(pid), "-o", "lstart="]).strip() == birth
    return dict(binding)


def _frame(value):
    assert isinstance(value, dict)
    assert set(value) == {"X", "Y", "Width", "Height"}
    assert all(type(x) in (int, float) and math.isfinite(x) for x in value.values())
    assert value["Width"] > 0 and value["Height"] > 0
    return value


def _normalize(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def _select(rows, pid):
    matches = []
    assert isinstance(rows, list) and len(rows) <= 16
    all_titles = {
        architecture_warning_text(locale)["title"] for locale in ["zh-CN", "en-US"]
    }
    for row in rows:
        assert row["pid"] == pid
        assert row["role"] == "AXSheet" or row.get("subrole") in (
            "AXDialog",
            "AXSystemDialog",
        )
        values = {_normalize(value) for value in row["texts"]}
        titles = ({row.get("title")} | set(row["texts"])) & all_titles
        matched = False
        for locale in ["zh-CN", "en-US"]:
            text = architecture_warning_text(locale)
            message, detail = _normalize(text["message"]), _normalize(text["detail"])
            if (
                message not in values
                and detail not in values
                and text["title"] not in titles
            ):
                continue
            assert (
                message in values and detail in values
            ), "Incomplete architecture warning"
            assert not titles or titles == {
                text["title"]
            }, "Conflicting architecture title"
            buttons = row["buttons"]
            assert len(buttons) == 2
            found = {}
            for button in buttons:
                assert button["pid"] == pid and button["role"] == "AXButton"
                assert button["title"] in (
                    text["downloadButton"],
                    text["dismissButton"],
                )
                assert button["title"] not in found
                assert button["enabled"] is True and "AXPress" in button["actions"]
                box, outer = _frame(button["frame"]), _frame(row["frame"])
                assert box["X"] >= outer["X"] - 2 and box["Y"] >= outer["Y"] - 2
                assert box["X"] + box["Width"] <= outer["X"] + outer["Width"] + 2
                assert box["Y"] + box["Height"] <= outer["Y"] + outer["Height"] + 2
                found[button["title"]] = button
            assert set(found) == {text["downloadButton"], text["dismissButton"]}
            matches.append((row, locale, found[text["dismissButton"]]))
            matched = True
        assert matched or not titles
    assert len(matches) <= 1, "Ambiguous architecture warning"
    return matches[0] if matches else None


class _NativeAx:
    """Existing AX primitives, with exact element PID and finite/full-text reads."""

    def __init__(self, pid, deadline):
        assert sys.platform == "darwin"
        self.pid, self.deadline, self.refs = pid, deadline, []
        self.ax = runpy.run_path(str(Path(__file__).with_name("macos-ax-driver.py")))
        assert self.ax["trusted"](), "Existing Accessibility permission required"
        self.C, self.cf, self.api = self.ax["C"], self.ax["_CF"], self.ax["_AX"]
        self.api.AXUIElementGetPid.argtypes = [
            self.ax["AXUIElementRef"],
            self.C.POINTER(self.C.c_int),
        ]
        self.api.AXUIElementGetPid.restype = self.C.c_int32
        self.api.AXUIElementSetMessagingTimeout.argtypes = [
            self.ax["AXUIElementRef"],
            self.C.c_float,
        ]
        self.api.AXUIElementSetMessagingTimeout.restype = self.C.c_int32

    def _own(self, ref):
        left = _remaining(self.deadline, time.monotonic)
        assert self.api.AXUIElementSetMessagingTimeout(ref, min(0.1, left)) == 0
        actual = self.C.c_int()
        assert (
            self.api.AXUIElementGetPid(ref, self.C.byref(actual)) == 0
            and actual.value == self.pid
        )

    def _raw(self, ref, name):
        self._own(ref)
        out, key = self.ax["CFTypeRef"](), self.ax["_cf_string"](name)
        try:
            code = self.api.AXUIElementCopyAttributeValue(ref, key, self.C.byref(out))
        finally:
            self.cf.CFRelease(key)
        if code != 0:
            if out:
                self.cf.CFRelease(out)
            assert code in (-25205, -25212), "Owned AX attribute failed"
            return None
        return out if out else None

    def _value(self, ref, name):
        out = self._raw(ref, name)
        if not out:
            return None
        try:
            # 原通用attribute只保留200字符，会截断完整英文detail；本次最多4096。
            return self.ax["_python_value"](out, limit=4096)
        finally:
            self.cf.CFRelease(out)

    def _children(self, ref, name="AXChildren"):
        out = self._raw(ref, name)
        if not out:
            return []
        try:
            assert self.cf.CFGetTypeID(out) == self.cf.CFArrayGetTypeID()
            count = self.cf.CFArrayGetCount(out)
            assert count <= 128
            result = []
            for i in range(count):
                _remaining(self.deadline, time.monotonic)
                child = self.cf.CFArrayGetValueAtIndex(out, i)
                assert child
                self.cf.CFRetain(child)
                self.refs.append(child)
                result.append(child)
            return result
        finally:
            self.cf.CFRelease(out)

    def _description(self, ref):
        result = {
            key: self._value(ref, attribute)
            for key, attribute in [
                ("role", "AXRole"),
                ("subrole", "AXSubrole"),
                ("title", "AXTitle"),
                ("value", "AXValue"),
                ("description", "AXDescription"),
                ("enabled", "AXEnabled"),
            ]
        }
        self._own(ref)
        result.update(
            ref=ref,
            pid=self.pid,
            frame=self.ax["frame"](ref),
            actions=self.ax["action_names"](ref),
        )
        _remaining(self.deadline, time.monotonic)
        return result

    def _candidate(self, ref):
        root = self._description(ref)
        queue, seen, texts, buttons = [(ref, 0)], set(), [], []
        while queue:
            current, depth = queue.pop(0)
            if current in seen:
                continue
            seen.add(current)
            assert len(seen) <= 160 and depth <= 10
            info = self._description(current)
            if current != ref:
                assert info["role"] != "AXSheet" and info["subrole"] not in (
                    "AXDialog",
                    "AXSystemDialog",
                ), "Nested native dialogs"
            texts.extend(
                info[key]
                for key in ["title", "value", "description"]
                if isinstance(info[key], str)
            )
            if info["role"] == "AXButton":
                buttons.append(info)
            queue.extend((child, depth + 1) for child in self._children(current))
        return {**root, "texts": texts, "buttons": buttons}

    def candidates(self, pid, deadline):
        assert pid == self.pid and deadline == self.deadline
        application = self.ax["element"](pid)
        assert application
        self.refs.append(application)
        queue = [(ref, 0) for ref in self._children(application, "AXWindows")]
        seen, found = set(), []
        while queue:
            ref, depth = queue.pop(0)
            if ref in seen:
                continue
            seen.add(ref)
            assert len(seen) <= 128 and depth <= 4
            role, subrole = self._value(ref, "AXRole"), self._value(ref, "AXSubrole")
            if role == "AXSheet" or subrole in ("AXDialog", "AXSystemDialog"):
                found.append(self._candidate(ref))
                continue
            if role in ("AXWebArea", "AXScrollArea"):
                continue
            queue.extend(
                (child, depth + 1)
                for child in self._children(ref) + self._children(ref, "AXSheets")
            )
        return found

    def refresh(self, row, _deadline):
        return self._candidate(row["ref"])

    def press(self, ref):
        self._own(ref)
        return self.ax["perform"](ref, self.ax["PRESS"])

    def close(self):
        for ref in reversed(self.refs):
            self.cf.CFRelease(ref)
        self.refs.clear()


def dismiss_owned_architecture_warning(
    *,
    pid,
    birth,
    executable,
    deadline,
    actor_guard,
    ax=None,
    inspect_actor=None,
    now=time.monotonic
):
    """One <=5s exact-PID lookup and at most one cancel; no polling or global input.

    actor_guard must return True for the caller's still-active original Main owner.
    ax/inspect_actor are dependency seams for pure tests, never production overrides.
    """
    assert type(pid) is int and pid > 0
    assert isinstance(birth, str) and 0 < len(birth) <= 100 and "\n" not in birth
    assert (
        isinstance(executable, str)
        and executable.startswith("/")
        and "\0" not in executable
    )
    assert callable(actor_guard) and math.isfinite(deadline)
    end = min(deadline, now() + 5)
    binding = {"pid": pid, "birth": birth, "executable": executable}
    probe = inspect_actor or _kernel_actor

    def guard():
        _remaining(end, now)
        assert actor_guard() is True, "Original Main owner retired"
        # 外部回调可能耗尽期限，返回后先拒绝继续探测或再次调用guard。
        _remaining(end, now)
        assert (
            probe(binding, end) == binding
        ), "Original Main PID/birth/executable changed"
        _remaining(end, now)
        assert actor_guard() is True
        _remaining(end, now)

    guard()
    adapter = ax if ax is not None else _NativeAx(pid, end)
    try:
        selected = _select(adapter.candidates(pid, end), pid)
        guard()
        if not selected:
            return {"status": "not-observed", "pid": pid, "pressed": None}
        row, locale, button = selected
        refreshed = _select([adapter.refresh(row, end)], pid)
        assert (
            refreshed and refreshed[0]["ref"] == row["ref"] and refreshed[1] == locale
        )
        fresh_row, _, fresh_button = refreshed
        assert fresh_button["ref"] == button["ref"]
        assert all(
            abs(fresh_row["frame"][key] - row["frame"][key]) <= 0.5
            for key in row["frame"]
        )
        assert all(
            abs(fresh_button["frame"][key] - button["frame"][key]) <= 0.5
            for key in button["frame"]
        )
        guard()
        assert (
            adapter.press(fresh_button["ref"]) == 0
        ), "Exact original cancel AXPress failed"
        guard()
        return {
            "status": "dismissed",
            "pid": pid,
            "locale": locale,
            "pressed": fresh_button["title"],
            "action": "AXPress",
            "frame": fresh_row["frame"],
        }
    finally:
        adapter.close()
