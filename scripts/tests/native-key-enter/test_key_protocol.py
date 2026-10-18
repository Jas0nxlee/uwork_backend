"""Pure protocol contract; extracts the actual shared helper without loading BH."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[3] / "scripts/client-native-scenes-fixed-ui.py"


def actual_key():
    tree = ast.parse(SOURCE.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "key")
    calls = []
    checked = []
    namespace = {"own": lambda: checked.append(True), "cdp": lambda method, **params: calls.append((method, params))}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace["key"], calls, checked


class KeyProtocol(unittest.TestCase):
    def test_plain_enter_has_cr_on_down_only(self):
        for keycode in (None, 13):
            with self.subTest(keycode=keycode):
                key, calls, checked = actual_key()
                key("Enter", "Enter", 0, keycode)
                self.assertEqual(len(calls), 2)
                self.assertEqual(checked, [True])
                self.assertEqual(calls[0][1].get("text"), "\r")
                self.assertEqual(calls[0][1].get("unmodifiedText"), "\r")
                self.assertEqual(calls[0][1]["type"], "keyDown")
                self.assertEqual(calls[1][1]["type"], "keyUp")
                self.assertNotIn("text", calls[1][1])
                self.assertNotIn("unmodifiedText", calls[1][1])

    def test_modified_enter_preserves_shortcut_protocol(self):
        for modifiers in (1, 2, 4, 8):
            with self.subTest(modifiers=modifiers):
                key, calls, _ = actual_key()
                key("Enter", "Enter", modifiers, 13)
                self.assertEqual([params for _, params in calls], [
                    {"type": phase, "key": "Enter", "code": "Enter", "modifiers": modifiers, "windowsVirtualKeyCode": 13}
                    for phase in ("keyDown", "keyUp")
                ])

    def test_other_keys_preserve_existing_protocol(self):
        for name, code, modifiers, keycode in [("a", "KeyA", 4, 65), ("ArrowDown", "ArrowDown", 0, 40), ("Enter", "NumpadEnter", 0, 13)]:
            key, calls, _ = actual_key()
            key(name, code, modifiers, keycode)
            self.assertEqual([params for _, params in calls], [
                {"type": phase, "key": name, "code": code, "modifiers": modifiers, "windowsVirtualKeyCode": keycode}
                for phase in ("keyDown", "keyUp")
            ])

    def test_target_guard_precedes_input(self):
        key, calls, _ = actual_key()
        def fail():
            raise AssertionError("unrelated target")
        key.__globals__["own"] = fail
        with self.assertRaises(AssertionError):
            key("Enter", "Enter", 0, 13)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
