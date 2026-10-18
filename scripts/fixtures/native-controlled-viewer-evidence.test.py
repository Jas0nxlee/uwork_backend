import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).with_name("native-controlled-viewer-evidence.py")
spec = importlib.util.spec_from_file_location("owned_viewer_gate", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EvidenceGate(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict("os.environ", {"BH_RECORD": "0", "BH_TELEMETRY": "0", "BH_DEBUG_CLICKS": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_raw_network_authority_and_query_never_enter_projection(self):
        class Request(dict):
            def get(self, key, default=None):
                if key in {"headers", "postData", "body"}:raise AssertionError("must not inspect authority")
                return super().get(key, default)
        result = module.project_network_events([
            {"method": "Network.requestWillBeSent", "params": {"requestId": "r", "request": Request(url="https://127.0.0.1:50101/api/auth/wecom/attempts/private-state/claim?state=DO_NOT_PERSIST", method="POST", headers="DO_NOT_PERSIST", postData="DO_NOT_PERSIST")}},
            {"method": "Network.responseReceived", "params": {"requestId": "r", "response": {"status": 200, "headers": "DO_NOT_PERSIST"}}},
        ], "https://127.0.0.1:50101")
        self.assertNotIn("DO_NOT_PERSIST", repr(result));self.assertNotIn("private-state", repr(result))
        self.assertEqual(result["requests"][0]["path"], "/api/auth/wecom/attempts/:id/claim")

    def test_ready_stale_authorize_href_still_cannot_escape_as_raw_dom_or_ax(self):
        flags = {"authBoxVisible": False, "authorizeVisible": False, "viewerReady": True}
        raw = {"nodes": [{"role": {"value": "link"}, "name": {"value": "hidden auth"}, "ignored": True, "properties": [{"url": "state=DO_NOT_PERSIST"}]}, {"role": {"value": "button"}, "name": {"value": "退出登录"}, "ignored": False, "backendDOMNodeId": 7, "properties": [{"url": "state=DO_NOT_PERSIST"}]}]}
        gate = module.ViewerAuthEvidenceGate(lambda _: flags, lambda *a, **k: raw)
        gate.begin(); gate.finish_if_ready()
        for method in ["DOM.getOuterHTML", "DOM.getDocument", "Network.getResponseBody", "Runtime.evaluate", "Page.captureScreenshot", "Accessibility.getFullAXTree", "Accessibility.getPartialAXTree"]:
            with self.assertRaises(AssertionError):gate.cdp(method)
        with self.assertRaises(AssertionError):gate.js("document.getElementById('authorize').href")

    def test_recording_telemetry_or_debug_screenshot_configuration_is_rejected(self):
        for env in [{}, {"BH_RECORD": "1", "BH_TELEMETRY": "0"}, {"BH_RECORD": "0", "BH_TELEMETRY": "1"}, {"BH_RECORD": "0", "BH_TELEMETRY": "0", "BH_DEBUG_CLICKS": "1"}]:
            with self.assertRaises(AssertionError):module.ViewerAuthEvidenceGate(lambda _: None, lambda *a: None, environment=env)

    def test_pending_blocks_actual_ax_png_dom_and_raw_network_delegates(self):
        calls = []
        gate = module.ViewerAuthEvidenceGate(lambda _: None, lambda *a, **k: calls.append(a))
        gate.begin()
        for method in ["Accessibility.getFullAXTree", "Accessibility.getPartialAXTree", "Page.captureScreenshot", "DOM.getOuterHTML", "Network.getResponseBody", "Runtime.evaluate"]:
            with self.assertRaises(AssertionError):
                gate.cdp(method)
        with self.assertRaises(AssertionError):
            gate.js("document.body.innerHTML")
        self.assertEqual(calls, [])

    def test_fixed_visibility_and_input_are_the_only_pending_observations(self):
        calls = []
        flags = {"authBoxVisible": True, "authorizeVisible": True, "viewerReady": False}
        gate = module.ViewerAuthEvidenceGate(lambda expression: calls.append(expression) or flags, lambda *a, **k: None)
        gate.begin()
        self.assertEqual(gate.visibility(), flags)
        gate.cdp("Input.dispatchMouseEvent", type="mousePressed")
        self.assertEqual(calls, [module.VISIBILITY_EXPRESSION])
        for forbidden in ["href", "proof", "token", "cookie", "innerHTML", "innerText"]:
            self.assertNotIn(forbidden, module.VISIBILITY_EXPRESSION)

    def test_failure_or_visible_auth_box_cannot_unlock_capture(self):
        for flags in [{"authBoxVisible": False, "authorizeVisible": False, "viewerReady": False}, {"authBoxVisible": True, "authorizeVisible": False, "viewerReady": True}]:
            gate = module.ViewerAuthEvidenceGate(lambda _: flags, lambda *a, **k: self.fail("must not capture"))
            gate.begin()
            with self.assertRaises(AssertionError):
                gate.finish_if_ready()
            self.assertTrue(gate.pending)

    def test_actual_ready_and_hidden_auth_box_allows_only_visible_text_and_input(self):
        calls = []
        flags = {"authBoxVisible": False, "authorizeVisible": False, "viewerReady": True}
        text = {"title": "owned", "conversation": "owned answer", "status": "ready", "logoutVisible": True, "revokeVisible": False}
        gate = module.ViewerAuthEvidenceGate(lambda expression: flags if expression == module.VISIBILITY_EXPRESSION else text, lambda *a, **k: calls.append(a))
        gate.begin()
        gate.finish_if_ready()
        self.assertEqual(gate.js(module.VISIBLE_TEXT_EXPRESSION), text)
        gate.cdp("Input.dispatchMouseEvent", type="mousePressed")
        self.assertEqual(len(calls), 1)
        for method in ["Page.captureScreenshot", "Accessibility.getFullAXTree"]:
            with self.assertRaises(AssertionError): gate.cdp(method)

    def test_text_projection_rejects_extra_authority_fields_or_non_text_values(self):
        for value in [{"href": "DO_NOT_PERSIST"}, {"title": {}, "conversation": "owned", "status": "ready", "logoutVisible": True, "revokeVisible": False}]:
            gate = module.ViewerAuthEvidenceGate(lambda expression: {"authBoxVisible": False, "authorizeVisible": False, "viewerReady": True} if expression == module.VISIBILITY_EXPRESSION else value, lambda *a, **k: None)
            gate.begin(); gate.finish_if_ready()
            with self.assertRaises(AssertionError): gate.js(module.VISIBLE_TEXT_EXPRESSION)


if __name__ == "__main__":
    unittest.main()
