"""One owned application menu Quit or exact active-session confirmation action.

Pure import. Only the bound application's AXFrontmost may be set; no global keys,
other application activation, default-button action or retry.
An allow AX result is only an attempt; the original child exit is the authority.
"""

import math
from pathlib import Path
import re
import runpy
import time

BASE = runpy.run_path(
    str(Path(__file__).with_name("macos-architecture-warning-dismiss.py"))
)


class _QuitAx(BASE["_NativeAx"]):
    def __init__(self, pid, deadline):
        super().__init__(pid, deadline)
        self.api.AXUIElementIsAttributeSettable.argtypes = [
            self.ax["AXUIElementRef"],
            self.ax["CFTypeRef"],
            self.C.POINTER(self.C.c_ubyte),
        ]
        self.api.AXUIElementIsAttributeSettable.restype = self.C.c_int32
        self.api.AXUIElementSetAttributeValue.argtypes = [
            self.ax["AXUIElementRef"],
            self.ax["CFTypeRef"],
            self.ax["CFTypeRef"],
        ]
        self.api.AXUIElementSetAttributeValue.restype = self.C.c_int32
        self.trueBoolean = self.C.c_void_p.in_dll(self.cf, "kCFBooleanTrue")

    def foreground_owned(
        self, application, guard, *, now=time.monotonic, pause=time.sleep
    ):
        started = now()
        receipt = {
            "pid": self.pid,
            "wasFrontmost": None,
            "setCode": None,
            "readbackSamples": [],
        }

        def check():
            BASE["_remaining"](self.deadline, now)
            guard()
            BASE["_remaining"](self.deadline, now)

        try:
            check()
            self._own(application)
            before = self._value(application, "AXFrontmost")
            BASE["_remaining"](self.deadline, now)
            assert type(before) is bool, "Owned application AXFrontmost is unavailable"
            receipt["wasFrontmost"] = before
            if not before:
                key = self.ax["_cf_string"]("AXFrontmost")
                try:
                    writable = self.C.c_ubyte()
                    assert (
                        self.api.AXUIElementIsAttributeSettable(
                            application, key, self.C.byref(writable)
                        )
                        == 0
                        and writable.value == 1
                    ), "Owned AXFrontmost is not settable; no fallback"
                    check()
                    self._own(application)
                    receipt["setCode"] = self.api.AXUIElementSetAttributeValue(
                        application, key, self.trueBoolean
                    )
                    assert (
                        receipt["setCode"] == 0
                    ), "Owned foreground action failed; no retry"
                finally:
                    self.cf.CFRelease(key)
                check()
            while True:
                check()
                after = self._value(application, "AXFrontmost")
                BASE["_remaining"](self.deadline, now)
                assert len(receipt["readbackSamples"]) < 128
                receipt["readbackSamples"].append(
                    {
                        "elapsedMs": round((now() - started) * 1000, 3),
                        "frontmost": after if type(after) is bool else None,
                    }
                )
                assert type(after) is bool, "Owned foreground readback is unavailable"
                if after:
                    check()
                    return {
                        **receipt,
                        "attribute": "AXFrontmost",
                        "activationAttempted": not before,
                        "readbackFrontmost": True,
                        "otherApplicationsEnumerated": False,
                    }
                pause(min(0.05, BASE["_remaining"](self.deadline, now)))
        except BaseException as error:
            try:
                error.ownedForegroundReceipt = {
                    **receipt,
                    "readbackSamples": list(receipt["readbackSamples"]),
                }
            except BaseException:
                pass
            raise

    def describe(self, ref):
        return self._description(ref)

    def menu_item(self, application_name, deadline, guard):
        application = self.ax["element"](self.pid)
        assert application
        self.refs.append(application)
        self._own(application)
        self.foregroundReceipt = self.foreground_owned(application, guard)
        bar = self._raw(application, "AXMenuBar")
        assert bar
        self.refs.append(bar)
        assert self._value(bar, "AXRole") == "AXMenuBar"
        items = [self._description(x) for x in self._children(bar)]
        matches = [
            x
            for x in items
            if x["role"] == "AXMenuBarItem" and x["title"] == application_name
        ]
        assert len(matches) == 1, "Unique original application menu required"
        parent = matches[0]
        assert parent["pid"] == self.pid and parent["enabled"] is True
        action = "AXPress" if "AXPress" in parent["actions"] else "AXShowMenu"
        assert action in parent["actions"]
        assert (
            self.ax["perform"](parent["ref"], action) == 0
        ), "Application menu open failed; never retry"
        while True:
            BASE["_remaining"](deadline, time.monotonic)
            children = self._children(parent["ref"])
            menus = [x for x in children if self._value(x, "AXRole") == "AXMenu"]
            assert len(menus) <= 1
            if menus:
                rows = [self._description(x) for x in self._children(menus[0])]
                found = [
                    x
                    for x in rows
                    if x["role"] == "AXMenuItem"
                    and x["title"]
                    in ("退出 " + application_name, "Quit " + application_name)
                ]
                assert len(found) == 1, "Unique original Quit menu item required"
                return found[0]
            time.sleep(min(0.05, BASE["_remaining"](deadline, time.monotonic)))


def _menu(row, binding):
    assert row["pid"] == binding["pid"] and row["role"] == "AXMenuItem"
    assert row["title"] in (
        "退出 " + binding["applicationName"],
        "Quit " + binding["applicationName"],
    )
    assert row["enabled"] is True and "AXPress" in row["actions"]
    BASE["_frame"](row["frame"])
    return row


def _confirmation(rows, pid, operation):
    assert isinstance(rows, list) and len(rows) <= 16
    found = []
    for row in rows:
        assert row["pid"] == pid
        assert row["role"] == "AXSheet" or row.get("subrole") in (
            "AXDialog",
            "AXSystemDialog",
        )
        values = {BASE["_normalize"](s) for s in row["texts"]}
        for message, pattern, allow, cancel in (
            (
                "确认退出 UWork?",
                r"正在进行的会话：([1-9][0-9]?) 个，退出后会被中断。",
                "退出",
                "取消",
            ),
            (
                "Quit UWork?",
                r"In-progress sessions: ([1-9][0-9]?). They will be interrupted after quitting\.",
                "Quit",
                "Cancel",
            ),
        ):
            if message not in values:
                continue
            counts = [
                int(m[1]) for text in values if (m := re.fullmatch(pattern, text))
            ]
            assert (
                len(counts) == 1 and counts[0] <= 64
            ), "Complete active-session confirmation detail required"
            assert len(row["buttons"]) == 2
            buttons = {}
            outer = BASE["_frame"](row["frame"])
            for button in row["buttons"]:
                assert button["pid"] == pid and button["role"] == "AXButton"
                assert (
                    button["title"] in (allow, cancel)
                    and button["title"] not in buttons
                )
                assert button["enabled"] is True and "AXPress" in button["actions"]
                box = BASE["_frame"](button["frame"])
                assert box["X"] >= outer["X"] - 2 and box["Y"] >= outer["Y"] - 2
                assert box["X"] + box["Width"] <= outer["X"] + outer["Width"] + 2
                assert box["Y"] + box["Height"] <= outer["Y"] + outer["Height"] + 2
                buttons[button["title"]] = button
            found.append(
                (row, buttons[cancel if operation == "cancel" else allow], counts[0])
            )
    assert len(found) == 1, "Unique complete original Quit confirmation required"
    return found[0]


def perform_owned_quit_action(
    binding,
    operation,
    *,
    deadline,
    actor_guard,
    ax=None,
    inspect_actor=None,
    now=time.monotonic,
):
    assert operation in ("menu", "cancel", "allow")
    assert set(binding) == {"pid", "birth", "executable", "applicationName"}
    assert type(binding["pid"]) is int and binding["pid"] > 0
    assert (
        isinstance(binding["birth"], str)
        and 0 < len(binding["birth"]) <= 100
        and "\n" not in binding["birth"]
    )
    assert (
        isinstance(binding["executable"], str)
        and binding["executable"].startswith("/")
        and "\0" not in binding["executable"]
    )
    assert binding["applicationName"] == "UWork 联动验证"
    assert callable(actor_guard) and math.isfinite(deadline)
    end = min(deadline, now() + 5)
    identity = {k: binding[k] for k in ("pid", "birth", "executable")}
    probe = inspect_actor or BASE["_kernel_actor"]

    def guard():
        BASE["_remaining"](end, now)
        assert actor_guard() is True
        BASE["_remaining"](end, now)
        assert probe(identity, end) == identity
        BASE["_remaining"](end, now)
        assert actor_guard() is True
        BASE["_remaining"](end, now)

    guard()
    adapter = ax if ax is not None else _QuitAx(binding["pid"], end)
    try:
        if operation == "menu":
            selected = _menu(
                adapter.menu_item(binding["applicationName"], end, guard), binding
            )
            guard()
            fresh = _menu(adapter.describe(selected["ref"]), binding)
            count = None
        else:
            row, selected, count = _confirmation(
                adapter.candidates(binding["pid"], end), binding["pid"], operation
            )
            guard()
            fresh_row, fresh, fresh_count = _confirmation(
                [adapter.refresh(row, end)], binding["pid"], operation
            )
            assert fresh_row["ref"] == row["ref"] and fresh_count == count
            assert all(
                abs(fresh_row["frame"][k] - row["frame"][k]) <= 0.5
                for k in row["frame"]
            )
        assert fresh["ref"] == selected["ref"] and fresh["title"] == selected["title"]
        assert all(
            abs(fresh["frame"][k] - selected["frame"][k]) <= 0.5
            for k in selected["frame"]
        )
        guard()
        code = adapter.press(fresh["ref"])
        # 菜单动作可能等待NSAlert响应；只留一次尝试，效果由实际确认框另证。
        if operation == "cancel":
            assert code == 0, "Original Cancel AXPress failed"
            guard()
        else:
            assert code in (0, -25202, -25204), "Original AXPress failed"
            BASE["_remaining"](end, now)
        return {
            "status": {
                "menu": "menu-action-sent",
                "cancel": "cancelled",
                "allow": "allow-action-attempted",
            }[operation],
            "pid": binding["pid"],
            "pressed": fresh["title"],
            "actionCode": code,
            "activeSessionCount": count,
            "requiresExactConfirmation": operation == "menu",
            "requiresOriginalChildExitReceipt": operation == "allow",
            "ownedApplicationForeground": (
                getattr(adapter, "foregroundReceipt", None)
                if operation == "menu"
                else None
            ),
        }
    finally:
        adapter.close()
