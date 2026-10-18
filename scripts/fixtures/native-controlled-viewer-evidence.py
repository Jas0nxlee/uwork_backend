"""Bind this gate to both root and guest helpers before a Native auth click."""
import os
import re
from urllib.parse import urlsplit

VISIBILITY_EXPRESSION = """(()=>{const box=document.getElementById('auth-box'),link=document.getElementById('authorize'),viewer=document.querySelector('[data-testid=share-viewer]');return{authBoxVisible:!!box&&!box.hidden,authorizeVisible:!!link&&link.getClientRects().length>0,viewerReady:viewer?.dataset.state==='ready'};})()"""
VISIBLE_TEXT_EXPRESSION = """(()=>{const text=id=>document.getElementById(id)?.textContent||'',shown=id=>!!document.getElementById(id)&&!document.getElementById(id).hidden;return{title:text('title'),conversation:text('conversation'),status:text('status-title'),logoutVisible:shown('logout'),revokeVisible:shown('revoke')};})()"""


class ViewerAuthEvidenceGate:
    def __init__(self, js, cdp, environment=None):
        env = os.environ if environment is None else environment
        if env.get("BH_RECORD") != "0" or env.get("BH_TELEMETRY") != "0" or env.get("BH_DEBUG_CLICKS"):
            raise AssertionError("Owned auth requires recording, telemetry and debug screenshots disabled")
        self._js = js
        self._cdp = cdp
        self.pending = False
        self.auth_started = False

    def begin(self):
        if self.pending:
            raise AssertionError("Viewer authentication already pending")
        self.pending = True
        self.auth_started = True

    def visibility(self):
        # Fixed boolean-only DOM projection; no href, state, proof or form values.
        value = self._js(VISIBILITY_EXPRESSION)
        expected = {"authBoxVisible", "authorizeVisible", "viewerReady"}
        if set(value) != expected or not all(type(v) is bool for v in value.values()):
            raise AssertionError("Invalid viewer visibility projection")
        return value

    def finish_if_ready(self):
        value = self.visibility()
        if not value["viewerReady"] or value["authBoxVisible"] or value["authorizeVisible"]:
            raise AssertionError("Viewer authentication evidence remains locked")
        self.pending = False

    def js(self, expression):
        if expression == VISIBILITY_EXPRESSION:
            return self.visibility()
        if self.pending:
            raise AssertionError("Only viewer visibility booleans are allowed while pending")
        if self.auth_started and expression != VISIBLE_TEXT_EXPRESSION:
            raise AssertionError("Stale authorization links forbid raw DOM or href extraction after auth")
        value = self._js(expression)
        if self.auth_started:
            text_keys = {"title", "conversation", "status"}
            bool_keys = {"logoutVisible", "revokeVisible"}
            if set(value) != text_keys | bool_keys or not all(type(value[k]) is str for k in text_keys) or not all(type(value[k]) is bool for k in bool_keys):
                raise AssertionError("Invalid viewer text projection")
        return value

    def cdp(self, method, **parameters):
        if self.pending and method not in {"Input.dispatchMouseEvent", "Input.dispatchKeyEvent"}:
            raise AssertionError("Viewer authentication blocks DOM, AX, screenshots and network evidence")
        if self.auth_started:
            allowed = {"Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "DOM.getBoxModel", "DOM.scrollIntoViewIfNeeded"}
            if method not in allowed:
                raise AssertionError("AX, PNG, raw DOM, network and authority evidence is forbidden after auth")
        return self._cdp(method, **parameters)


def project_network_events(events, origin):
    """Raw BH events stay in RAM; never return query, headers, postData or bodies."""
    if len(events) > 512:
        raise AssertionError("Bounded auth network observation overflow")
    requests = {}
    for event in events:
        method = event.get("method")
        if method == "Network.requestWillBeSent":
            p = event["params"]
            req = p["request"]
            url = urlsplit(req.get("url", ""))
            path = url.path
            same = url.scheme + "://" + url.netloc == origin
            if not same:
                path = "external"
            elif re.fullmatch(r"/api/auth/wecom/attempts/[^/]+/(claim|cancel)", path):
                path = "/api/auth/wecom/attempts/:id/" + path.rsplit("/", 1)[-1]
            elif re.fullmatch(r"/api/auth/shares/[^/]+/context", path):
                path = "/api/auth/shares/:code/context"
            elif re.fullmatch(r"/api/client/shares/[^/]+/preview", path):
                path = "/api/client/shares/:code/preview"
            elif re.fullmatch(r"/(cn/)?share/[a-f0-9]{32}", path):
                path = "/share/:code"
            elif path not in {"/api/auth/wecom/attempts", "/api/auth/wecom/callback", "/api/auth/logout", "/share/assets/viewer.js", "/share/assets/viewer.css", "/favicon.ico"}:
                path = "other-owned"
            requests[p["requestId"]] = {"method": req.get("method"), "path": path, "sameOrigin": same}
        elif method == "Network.responseReceived":
            p = event["params"]
            if p["requestId"] in requests:
                requests[p["requestId"]]["status"] = p["response"]["status"]
        elif method == "Network.loadingFailed":
            if event["params"]["requestId"] in requests:
                requests[event["params"]["requestId"]]["failed"] = True
    return {"requests": list(requests.values()), "count": len(requests)}
