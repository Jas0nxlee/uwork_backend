"""Pure original-menu/confirmation contracts, no native AX libraries or App."""

import copy, ctypes, runpy, types, unittest
from pathlib import Path

M = runpy.run_path(str(Path(__file__).with_name("mac-native-active-quit-ax.py")))
B = {
    "pid": 123,
    "birth": "owned",
    "executable": "/owned/App/MacOS/Own",
    "applicationName": "UWork 联动验证",
}
F = {"X": 0, "Y": 0, "Width": 500, "Height": 250}


def dialog():
    return {
        "ref": "sheet",
        "pid": 123,
        "role": "AXSheet",
        "frame": F,
        "texts": ["确认退出 UWork?", "正在进行的会话：1 个，退出后会被中断。"],
        "buttons": [
            {
                "ref": x,
                "pid": 123,
                "role": "AXButton",
                "title": x,
                "enabled": True,
                "actions": ["AXPress"],
                "frame": {"X": 10 + i * 120, "Y": 190, "Width": 100, "Height": 30},
            }
            for i, x in enumerate(["退出", "取消"])
        ],
    }


class AX:
    def __init__(self):
        self.pressed = []
        self.closed = False
        self.rows = [dialog()]
        self.item = {
            "ref": "menuquit",
            "pid": 123,
            "role": "AXMenuItem",
            "title": "退出 UWork 联动验证",
            "enabled": True,
            "actions": ["AXPress"],
            "frame": F,
        }

    def menu_item(self, *_):
        return self.item

    def candidates(self, *_):
        return self.rows

    def refresh(self, row, *_):
        return row

    def describe(self, ref):
        return self.item

    def press(self, ref):
        self.pressed.append(ref)
        return 0

    def close(self):
        self.closed = True


class Contracts(unittest.TestCase):
    def foreground_adapter(self, *, settable=True, set_code=0, readback=True):
        obj = M["_QuitAx"].__new__(M["_QuitAx"])
        obj.pid = 123
        obj.deadline = 5
        state = {"frontmost": False, "set": [], "queried": [], "released": []}
        obj.C = ctypes
        obj.trueBoolean = object()

        def own(ref):
            self.assertEqual(ref, "owned-application")

        obj._own = own
        obj._value = lambda ref, key: (own(ref) or state["frontmost"])

        def query(ref, key, out):
            own(ref)
            self.assertEqual(key, "frontmost-key")
            state["queried"].append(ref)
            ctypes.cast(out, ctypes.POINTER(ctypes.c_ubyte))[0] = settable
            return 0

        def activate(ref, key, value):
            own(ref)
            self.assertEqual(key, "frontmost-key")
            self.assertIs(value, obj.trueBoolean)
            state["set"].append(ref)
            if set_code == 0:
                state["frontmost"] = readback
            return set_code

        obj.api = types.SimpleNamespace(
            AXUIElementIsAttributeSettable=query, AXUIElementSetAttributeValue=activate
        )
        obj.cf = types.SimpleNamespace(
            CFRelease=lambda key: state["released"].append(key)
        )
        obj.ax = {
            "_cf_string": lambda name: (
                "frontmost-key"
                if name == "AXFrontmost"
                else self.fail("Only AXFrontmost")
            )
        }
        return obj, state

    def test_foreground_only_exact_owned_application_settable_and_readback(self):
        obj, state = self.foreground_adapter()
        proof = obj.foreground_owned("owned-application", lambda: None, now=lambda: 0)
        self.assertEqual(state["set"], ["owned-application"])
        self.assertTrue(proof["readbackFrontmost"])
        self.assertTrue(proof["activationAttempted"])
        self.assertEqual(state["released"], ["frontmost-key"])

    def test_foreground_not_settable_bad_result_or_false_readback_fail_without_fallback(
        self,
    ):
        for config in [{"settable": False}, {"set_code": -25202}, {"readback": False}]:
            obj, state = self.foreground_adapter(**config)
            clock = [0]

            def pause(seconds):
                clock[0] += seconds

            with self.subTest(config=config), self.assertRaises(AssertionError):
                obj.foreground_owned(
                    "owned-application", lambda: None, now=lambda: clock[0], pause=pause
                )
            self.assertEqual(
                len(state["set"]), 0 if config.get("settable") is False else 1
            )

    def test_foreground_guard_owner_or_deadline_before_set_or_after_set_is_failclosed(
        self,
    ):
        for fail_at in [1, 2, 3]:
            obj, state = self.foreground_adapter()
            calls = []

            def guard():
                calls.append(1)
                if len(calls) == fail_at:
                    raise AssertionError("Owner/deadline changed")

            with self.subTest(fail_at=fail_at), self.assertRaises(AssertionError):
                obj.foreground_owned("owned-application", guard, now=lambda: 0)
            self.assertEqual(len(state["set"]), 1 if fail_at == 3 else 0)
        obj, state = self.foreground_adapter()
        clock = [0]
        calls = []

        def slow_guard():
            calls.append(1)
            clock[0] = 6

        with self.assertRaises(AssertionError):
            obj.foreground_owned("owned-application", slow_guard, now=lambda: clock[0])
        self.assertEqual(calls, [1])
        self.assertEqual(state["set"], [])
        self.assertEqual(state["queried"], [])

    def test_actual_foreground_async_readback_false_then_true_sets_only_once(self):
        obj, state = self.foreground_adapter(readback=False)
        reads = []

        def value(ref, key):
            obj._own(ref)
            reads.append(1)
            return len(reads) >= 4

        obj._value = value
        proof = obj.foreground_owned("owned-application", lambda: None, now=lambda: 0)
        self.assertEqual(state["set"], ["owned-application"])
        self.assertEqual(
            [s["frontmost"] for s in proof["readbackSamples"]], [False, False, True]
        )
        self.assertEqual(proof["setCode"], 0)

    def test_actual_foreground_failed_poll_retains_safe_receipt_and_owner_change_stops(
        self,
    ):
        obj, state = self.foreground_adapter(readback=False)
        clock = [0]

        def pause(seconds):
            clock[0] += seconds

        with self.assertRaises(AssertionError) as caught:
            obj.foreground_owned(
                "owned-application", lambda: None, now=lambda: clock[0], pause=pause
            )
        receipt = caught.exception.ownedForegroundReceipt
        self.assertEqual(
            set(receipt), {"pid", "wasFrontmost", "setCode", "readbackSamples"}
        )
        self.assertEqual(state["set"], ["owned-application"])
        self.assertEqual(receipt["setCode"], 0)
        self.assertTrue(receipt["readbackSamples"])
        self.assertTrue(
            all(s["frontmost"] is False for s in receipt["readbackSamples"])
        )
        self.assertLessEqual(clock[0], 5)
        obj, state = self.foreground_adapter(readback=False)
        calls = []

        def guard():
            calls.append(1)
            if len(calls) == 5:
                raise AssertionError("Owner changed during poll")

        with self.assertRaises(AssertionError) as caught:
            obj.foreground_owned(
                "owned-application", guard, now=lambda: 0, pause=lambda _: None
            )
        self.assertEqual(state["set"], ["owned-application"])
        self.assertEqual(len(calls), 5)
        self.assertEqual(
            len(caught.exception.ownedForegroundReceipt["readbackSamples"]), 1
        )

    def call(self, op, ax, **kw):
        return M["perform_owned_quit_action"](
            B,
            op,
            deadline=20,
            actor_guard=lambda: True,
            ax=ax,
            inspect_actor=lambda binding, _: binding,
            now=lambda: 0,
            **kw
        )

    def test_menu_only_exact_original_quit_item_and_cancel_only_original_button(self):
        ax = AX()
        self.assertEqual(self.call("menu", ax)["status"], "menu-action-sent")
        self.assertEqual(ax.pressed, ["menuquit"])
        ax = AX()
        self.assertEqual(self.call("cancel", ax)["pressed"], "取消")
        self.assertEqual(ax.pressed, ["取消"])
        self.assertTrue(ax.closed)

    def test_allow_records_attempt_without_requiring_exiting_main_remain_alive(self):
        ax = AX()
        calls = []

        def probe(b, _):
            calls.append(1)
            return b

        result = M["perform_owned_quit_action"](
            B,
            "allow",
            deadline=20,
            actor_guard=lambda: True,
            ax=ax,
            inspect_actor=probe,
            now=lambda: 0,
        )
        self.assertEqual(result["status"], "allow-action-attempted")
        self.assertEqual(ax.pressed, ["退出"])
        self.assertTrue(result["requiresOriginalChildExitReceipt"])

    def test_wrong_menu_pid_label_disabled_action_and_dialog_partial_or_multiple_never_press(
        self,
    ):
        for key, value in [
            ("pid", 999),
            ("title", "Quit Another App"),
            ("enabled", False),
            ("actions", []),
        ]:
            ax = AX()
            ax.item[key] = value
            with self.assertRaises(AssertionError):
                self.call("menu", ax)
            self.assertEqual(ax.pressed, [])
        for modify in [
            lambda a: a.rows[0].update(pid=999),
            lambda a: a.rows[0].update(texts=["Open this folder in UWork?"]),
            lambda a: a.rows.append({**dialog(), "ref": "other"}),
            lambda a: a.rows[0]["buttons"][1].update(title="打开文件夹"),
        ]:
            ax = AX()
            modify(ax)
            with self.assertRaises(AssertionError):
                self.call("cancel", ax)
            self.assertEqual(ax.pressed, [])

    def test_menu_unknown_action_result_never_represses_or_claims_effect(self):
        ax = AX()
        ax.press = lambda ref: (ax.pressed.append(ref) or -25204)
        r = self.call("menu", ax)
        self.assertEqual(r["actionCode"], -25204)
        self.assertEqual(ax.pressed, ["menuquit"])
        self.assertTrue(r["requiresExactConfirmation"])

    def test_deadline_after_external_guard_prevents_second_guard_probe_or_ax(self):
        clock = [0]
        guards = []
        probes = []
        ax = AX()

        def guard():
            guards.append(1)
            clock[0] += 6
            return True

        with self.assertRaises(AssertionError):
            M["perform_owned_quit_action"](
                B,
                "menu",
                deadline=20,
                actor_guard=guard,
                ax=ax,
                inspect_actor=lambda *_: probes.append(1),
                now=lambda: clock[0],
            )
        self.assertEqual(guards, [1])
        self.assertEqual(probes, [])
        self.assertEqual(ax.pressed, [])

    def test_menu_and_allow_unknown_codes_are_receipts_not_exit_success(self):
        ax = AX()
        ax.press = lambda _: -25202
        self.assertTrue(self.call("allow", ax)["requiresOriginalChildExitReceipt"])
        ax = AX()
        ax.press = lambda _: -25202
        with self.assertRaises(AssertionError):
            self.call("cancel", ax)


if __name__ == "__main__":
    unittest.main()
