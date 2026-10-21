"""Pure owned AX contracts: no Accessibility libraries, app, GUI or network."""

import copy
from pathlib import Path
import runpy
import subprocess
import unittest

MODULE = Path(__file__).with_name("macos-architecture-warning-dismiss.py")
M = runpy.run_path(str(MODULE))
BINDING = {
    "pid": 321,
    "birth": "owned birth",
    "executable": "/owned/UWork.app/Contents/MacOS/UWork",
}


def candidate(locale="zh-CN"):
    text = M["architecture_warning_text"](locale)
    return {
        "ref": "dialog",
        "pid": 321,
        "role": "AXSheet",
        "subrole": None,
        "frame": {"X": 10, "Y": 10, "Width": 600, "Height": 300},
        "title": "UWork Preview",
        "texts": [text["message"], text["detail"]],
        "buttons": [
            {
                "ref": label,
                "pid": 321,
                "role": "AXButton",
                "title": label,
                "enabled": True,
                "actions": ["AXPress"],
                "frame": {"X": 20 + index * 160, "Y": 240, "Width": 150, "Height": 30},
            }
            for index, label in enumerate(
                [text["downloadButton"], text["dismissButton"]]
            )
        ],
    }


class Ax:
    def __init__(self, rows):
        self.rows, self.pressed, self.closed = rows, [], False

    def candidates(self, _pid, _deadline):
        return self.rows

    def refresh(self, row, _deadline):
        return row

    def press(self, reference):
        self.pressed.append(reference)
        return 0

    def close(self):
        self.closed = True


class Contract(unittest.TestCase):
    def run_owned(self, rows, **extra):
        ax = Ax(rows)
        arguments = {
            **BINDING,
            "deadline": 10,
            "now": lambda: 0,
            "actor_guard": lambda: True,
            "inspect_actor": lambda *_: BINDING,
            "ax": ax,
            **extra,
        }
        return ax, lambda: M["dismiss_owned_architecture_warning"](**arguments)

    def test_exact_zh_and_en_cancel_once_without_download(self):
        for locale in ["zh-CN", "en-US"]:
            ax, call = self.run_owned([candidate(locale)])
            receipt = call()
            self.assertEqual(receipt["status"], "dismissed")
            self.assertEqual(
                ax.pressed, [M["architecture_warning_text"](locale)["dismissButton"]]
            )
            self.assertTrue(ax.closed)

    def test_mac_title_is_ignored_but_conflicting_visible_architecture_title_rejects(
        self,
    ):
        row = candidate()
        row["title"] = "Architecture Mismatch"
        ax, call = self.run_owned([row])
        with self.assertRaises(AssertionError):
            call()
        self.assertEqual(ax.pressed, [])

    def test_missing_warning_and_workspace_confirmation_are_not_dismissed(self):
        row = candidate()
        row["texts"] = ["Open this folder in UWork?", "/owned/project"]
        row["buttons"] = []
        for rows in [[], [row]]:
            ax, call = self.run_owned(rows)
            self.assertEqual(call()["status"], "not-observed")
            self.assertEqual(ax.pressed, [])

    def test_wrong_pid_message_full_detail_button_or_ambiguity_never_press(self):
        cases = []
        for field, value in [
            ("pid", 999),
            ("texts", ["wrong", candidate()["texts"][1]]),
        ]:
            row = candidate()
            row[field] = value
            cases.append([row])
        row = candidate()
        row["texts"][1] = row["texts"][1][:-8]
        cases.append([row])
        for key, value in [
            ("title", "取消"),
            ("pid", 999),
            ("enabled", False),
            ("actions", []),
            ("frame", None),
        ]:
            row = candidate()
            row["buttons"][1][key] = value
            cases.append([row])
        row = candidate()
        row["buttons"].append(copy.deepcopy(row["buttons"][1]))
        cases.append([row])
        cases.append([candidate(), {**candidate(), "ref": "another-dialog"}])
        for rows in cases:
            ax, call = self.run_owned(rows)
            with self.assertRaises(AssertionError):
                call()
            self.assertEqual(ax.pressed, [])
            self.assertTrue(ax.closed)

    def test_actor_change_before_press_rejects_and_releases_references(self):
        count = [0]

        def inspect(*_):
            count[0] += 1
            return {**BINDING, "birth": "changed"} if count[0] >= 3 else BINDING

        ax, call = self.run_owned([candidate()], inspect_actor=inspect)
        with self.assertRaises(AssertionError):
            call()
        self.assertEqual(ax.pressed, [])
        self.assertTrue(ax.closed)

    def test_expired_and_guard_false_never_query_ax(self):
        for extra in [{"deadline": -1}, {"actor_guard": lambda: False}]:
            ax, call = self.run_owned([candidate()], **extra)
            with self.assertRaises(AssertionError):
                call()
            self.assertEqual(ax.pressed, [])

    def test_frame_change_after_snapshot_or_press_failure_fails_closed(self):
        ax, call = self.run_owned([candidate()])
        ax.refresh = lambda row, _: {**row, "frame": {**row["frame"], "X": 50}}
        with self.assertRaises(AssertionError):
            call()
        self.assertEqual(ax.pressed, [])
        ax, call = self.run_owned([candidate()])
        ax.press = lambda _: -25202
        with self.assertRaises(AssertionError):
            call()

    def test_text_matches_actual_product_formatter_and_mac_ignores_title(self):
        repo = MODULE.parents[2]
        code = r"""
import {readFileSync}from'node:fs';import{createRequire}from'node:module';import vm from'node:vm';
const require=createRequire(process.cwd()+'/clients/uwork/package.json');
const {transformSync}=require('esbuild');
const input=readFileSync('clients/uwork/packages/desktop/src/main/desktopArchitectureGuard.ts','utf8')+'\nexport {formatArchitectureMismatchDialogText};';
const code=transformSync(input,{loader:'ts',format:'cjs'}).code;
const module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require(name){if(name!=='@zcode/shared')throw Error('Unexpected dependency');return{};}});
console.log(JSON.stringify(Object.fromEntries(['zh-CN','en-US'].map(locale=>[locale,module.exports.formatArchitectureMismatchDialogText({binaryArch:'x64',nativeArch:'arm64'},locale)]))));
"""
        node = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"
        output = subprocess.run(
            [node, "--input-type=module", "-e", code],
            cwd=repo,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        import json

        actual = json.loads(output.stdout)
        for locale in ["zh-CN", "en-US"]:
            self.assertEqual(M["architecture_warning_text"](locale), actual[locale])
        self.assertIn(
            "v41.10.7/shell/browser/ui/message_box_mac.mm", M["MAC_TITLE_AUTHORITY"]
        )

    def test_full_text_ax_read_exceeds_old_200_character_limit_and_releases_value(self):
        from types import SimpleNamespace

        native = object.__new__(M["_NativeAx"])
        released, limits = [], []
        native._raw = lambda *_: 123
        native.cf = SimpleNamespace(CFRelease=released.append)
        native.ax = {
            "_python_value": lambda _, limit: limits.append(limit) or "x" * 250
        }
        self.assertEqual(len(native._value(123, "AXValue")), 250)
        self.assertEqual(limits, [4096])
        self.assertEqual(released, [123])

    def test_external_callback_spending_six_seconds_stops_before_any_next_step(self):
        for slow_at, expected_guards, expected_probes in [
            ("first-guard", 1, 0),
            ("probe", 1, 1),
            ("second-guard", 2, 1),
        ]:
            with self.subTest(slow_at=slow_at):
                clock, guards, probes, queries = [0.0], [], [], []

                def guard():
                    guards.append(1)
                    if slow_at == (
                        "first-guard" if len(guards) == 1 else "second-guard"
                    ):
                        clock[0] += 6
                    return True

                def probe(*_):
                    probes.append(1)
                    if slow_at == "probe":
                        clock[0] += 6
                    return BINDING

                ax, call = self.run_owned(
                    [candidate()],
                    actor_guard=guard,
                    inspect_actor=probe,
                    now=lambda: clock[0],
                    deadline=100,
                )
                ax.candidates = lambda *_: queries.append(1) or [candidate()]
                with self.assertRaisesRegex(AssertionError, "deadline"):
                    call()
                self.assertEqual(len(guards), expected_guards)
                self.assertEqual(len(probes), expected_probes)
                self.assertEqual(queries, [])
                self.assertEqual(ax.pressed, [])


if __name__ == "__main__":
    unittest.main()
