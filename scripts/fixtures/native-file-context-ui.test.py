import copy
import importlib.util
from pathlib import Path
import unittest
from unittest import mock
import subprocess

spec = importlib.util.spec_from_file_location("native_file_context_ui", Path(__file__).with_name("native-file-context-ui.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT = "/Users/ljp/Desktop/uwork_backend/data/client-native-file-context-finite"


class Ports:
    def __init__(self):
        rect = lambda x: {"x": x, "y": 100, "hit": True, "disabled": False}
        self.state = dict(authenticated=True, composerVisible=True, composerEmpty=True, promptA=False, promptB=False,
                          mentionA=0, mentionB=0, workspaceMatches=True, modelMatches=True, stopPresent=False,
                          replyA=False, replyB=False, taskId=None,
                          controls=dict(composer=rect(1), workspace=rect(2), tree=rect(3), a=rect(4), b=rect(5), add=None, back=None))
        self.events, self.claims, self.expressions = [], set(), []
        self.menu_stage = None

    def js(self, expression):
        self.expressions.append(expression)
        return copy.deepcopy(self.state)

    def cdp(self, method, **params):
        self.events.append((method, params))
        if method == "Input.insertText":
            stage = "a" if params["text"] == module.PROMPTS["a"] else "b"
            self.state["composerEmpty"] = False
            self.state["prompt" + stage.upper()] = True
        if method == "Input.dispatchMouseEvent" and params["type"] == "mouseReleased":
            if params["x"] == 3:
                self.state["controls"].update(a=dict(x=4,y=100,hit=True,disabled=False), b=dict(x=5,y=100,hit=True,disabled=False))
            if params["button"] == "right":
                self.state["authenticated"] = False
                self.state["controls"]["back"] = dict(x=10,y=100,hit=True,disabled=False)
                self.menu_stage = "a" if params["x"] == 4 else "b"
                self.state["controls"]["add"] = dict(x=9, y=100, hit=True, disabled=False)
            elif params["x"] == 9:
                self.state["mention" + self.menu_stage.upper()] = 1
                self.state["controls"]["add"] = None
            elif params["x"] == 10:
                self.state["authenticated"] = True
                self.state["controls"].update(a=None, b=None, back=None)
        if method == "Input.dispatchKeyEvent" and params["type"] == "keyUp":
            self.state.update(composerEmpty=True, promptA=False, promptB=False, mentionA=0, mentionB=0, taskId="public-task-1")

    def claim(self, action):
        if action in self.claims:
            return False
        self.claims.add(action)
        return True

    def actor(self, task_id=None):
        return module.NativeFileContextUi(self.js, self.cdp, lambda: 1, lambda: None, self.claim, ROOT, task_id)


class Contracts(unittest.TestCase):
    def test_definitions_and_projection_reject_extra_private_or_arbitrary_actions(self):
        p = Ports()
        parsed = subprocess.run(["/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node", "--import", "/Users/ljp/Desktop/uwork_backend/evidence/client-native-primary-login-adapter-preparation-20261018/deny-network.mjs", "--input-type=module", "--check"], input=p.actor()._expression, capture_output=True, text=True, timeout=3)
        self.assertEqual(parsed.returncode, 0)
        with self.assertRaisesRegex(ValueError, "FILE_UI_ACTION_REJECTED"):
            p.actor().run("arbitrary_click")
        self.assertEqual(p.events, [])
        p.state["rawToken"] = "SYNTHETIC_PRIVATE"
        with self.assertRaisesRegex(ValueError, "FILE_UI_PROJECTION_REJECTED"):
            p.actor().run("observe")
        self.assertEqual(p.events, [])

    def test_prepare_only_inserts_fixed_prompt_and_requires_owned_public_identity(self):
        p = Ports()
        p.actor().run("prepare_a")
        inserted = [value["text"] for method, value in p.events if method == "Input.insertText"]
        self.assertEqual(inserted, [module.PROMPTS["a"]])
        p = Ports()
        p.state["authenticated"] = False
        with self.assertRaisesRegex(ValueError, "FILE_UI_CONTEXT_REJECTED"):
            p.actor().run("prepare_a")
        self.assertEqual(p.events, [])

    def test_mention_uses_original_right_menu_and_fixed_public_path_without_preview(self):
        p = Ports()
        actor = p.actor()
        actor.run("prepare_a")
        result = actor.run("mention_a")
        self.assertEqual((result["mentionA"], result["mentionB"]), (1, 0))
        self.assertTrue(result["authenticated"])
        self.assertIsNone(result["controls"]["back"])
        self.assertEqual(sum(1 for method, value in p.events if method == "Input.dispatchMouseEvent" and value["type"] == "mousePressed" and value["x"] == 10), 1)
        self.assertEqual(sum(1 for method, value in p.events if method == "Input.dispatchMouseEvent" and value["type"] == "mousePressed" and value["button"] == "right"), 1)
        self.assertTrue(any("workspace-file-tree-row-" + ROOT + "/project-file-context/G07_CONTEXT_A.txt" in value for value in p.expressions))
        for value in p.expressions:
            self.assertNotIn(".click(", value)
            self.assertNotIn("localStorage", value)
            self.assertNotIn("previewText", value)

    def test_returning_from_tree_cannot_promote_a_missing_identity_or_send(self):
        p = Ports()
        original = p.cdp

        def dispatch(method, **params):
            original(method, **params)
            if method == "Input.dispatchMouseEvent" and params["type"] == "mouseReleased" and params["x"] == 10:
                p.state["authenticated"] = False

        p.cdp = dispatch
        actor = p.actor()
        actor.run("prepare_a")
        clock = iter(i * .25 for i in range(1000))
        with mock.patch.object(module.time, "monotonic", side_effect=lambda: next(clock)), mock.patch.object(module.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "FILE_UI_WAIT_REJECTED"):
                actor.run("mention_a")
        with self.assertRaisesRegex(ValueError, "FILE_UI_CONTEXT_REJECTED"):
            actor.run("send_a")
        self.assertNotIn("send_a", p.claims)
        self.assertFalse(any(method == "Input.dispatchKeyEvent" for method, _ in p.events))

    def test_two_fixed_sends_have_cr_once_each_and_b_stays_on_original_task(self):
        p = Ports()
        actor = p.actor()
        for action in ("prepare_a", "mention_a", "send_a"):
            value = actor.run(action)
        self.assertEqual(value["taskId"], "public-task-1")
        # Production ChatEmptyState owns the workspace chip; active SessionPane does not.
        p.state["workspaceMatches"] = False
        before = len(p.events)
        with self.assertRaisesRegex(ValueError, "FILE_UI_TASK_REJECTED"):
            p.actor("wrong-task").run("prepare_b")
        self.assertEqual(len(p.events), before)
        actor = p.actor("public-task-1")
        for action in ("prepare_b", "mention_b", "send_b"):
            value = actor.run(action)
        downs = [value for method, value in p.events if method == "Input.dispatchKeyEvent" and value["type"] == "keyDown"]
        self.assertEqual(len(downs), 2)
        self.assertEqual([value["text"] for value in downs], ["\r", "\r"])
        self.assertEqual(value["taskId"], "public-task-1")
        with self.assertRaisesRegex(ValueError, "FILE_UI_ONCE_REJECTED"):
            p.actor("public-task-1").run("send_b")
        self.assertEqual(len(downs), 2)


if __name__ == "__main__":
    unittest.main()
