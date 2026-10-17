"""Owned Chrome/BH + real management UI; no product response or state replacement."""
import base64
import csv
import io
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

REPO = pathlib.Path(os.environ["UWORK_ADMIN_SLICES_REPO"]) if "cdp" in globals() else pathlib.Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def wait_for(fn, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = fn()
        if result:
            return result
        time.sleep(0.1)
    raise AssertionError("bounded wait failed")


def free_port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def descendants(parents):
    pairs = [line.split() for line in subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True).splitlines()]
    found = set(parents)
    while True:
        more = {int(pid) for pid, ppid in pairs if int(ppid) in found}
        if more <= found:
            return found
        found |= more


def launch():
    import shutil
    run_name = time.strftime("%Y%m%dT%H%M%S")
    evidence = REPO / "evidence/admin-organization-usage-browser-20261017" / run_name
    evidence.mkdir(parents=True, exist_ok=False)
    root = pathlib.Path(tempfile.mkdtemp(prefix="uwork-admin-slices-", dir="/tmp"))
    root.chmod(0o700)
    node = pathlib.Path(os.environ.get("UWORK_ADMIN_SLICES_NODE", "/Users/ljp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"))
    chrome = pathlib.Path(os.environ.get("UWORK_ADMIN_SLICES_CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))
    assert node.is_file() and chrome.is_file()
    backend_port, cdp_port = free_port(), free_port()
    env = {**os.environ, "UWORK_ADMIN_SLICES_REPO": str(REPO), "UWORK_ADMIN_SLICES_ROOT": str(root), "UWORK_ADMIN_SLICES_EVIDENCE": str(evidence), "UWORK_ADMIN_SLICES_PORT": str(backend_port), "BU_NAME": "admin-slices-" + run_name, "BU_CDP_URL": f"http://127.0.0.1:{cdp_port}", "BH_RECORD": "0", "BH_HOME": str(root / "bh-home"), "BH_CONFIG_DIR": str(root / "bh-config"), "BH_RUNTIME_DIR": str(root / "bh-runtime"), "BH_TMP_DIR": str(root / "bh-tmp"), "BH_AGENT_WORKSPACE": str(root / "bh-workspace")}
    processes = []
    known = set()
    exit_code = 1
    cleanup = {"pids": {}, "ports": {}, "rootRemoved": False, "bhRemoved": False}
    try:
        fixture = subprocess.Popen([str(node), "--import", "tsx", "scripts/admin-organization-usage-fixture.ts"], cwd=REPO, env=env, stdout=open(evidence / "fixture.log", "w"), stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(fixture)
        wait_for(lambda: (root / "ready").exists() or fixture.poll() is not None)
        assert fixture.poll() is None, "fixture setup failed; inspect fixture-error.json"
        public = json.loads((evidence / "fixture-public.json").read_text())
        cdp_origin = f"http://127.0.0.1:{cdp_port}"
        browser = subprocess.Popen([str(chrome), "--headless=new", "--disable-gpu", "--remote-debugging-address=127.0.0.1", f"--remote-debugging-port={cdp_port}", f"--user-data-dir={root / 'chrome-profile'}", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "about:blank"], cwd=root, env=env, stdout=open(root / "chrome.log", "w"), stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(browser)
        def chrome_ready():
            try:
                with urllib.request.urlopen(cdp_origin + "/json/version", timeout=0.4):
                    return True
            except OSError:
                return False
        wait_for(chrome_ready)
        write_json(evidence / "process-state.json", {"root": str(root), "fixturePid": fixture.pid, "chromePid": browser.pid, "backendPort": backend_port, "supplierPort": public["supplierPort"], "cdpPort": cdp_port, "node": str(node), "chrome": str(chrome), "browserName": env["BU_NAME"]})
        result = subprocess.run(["browser-harness"], input=pathlib.Path(__file__).read_text(), text=True, cwd=root, env=env, stdout=open(evidence / "browser.log", "w"), stderr=subprocess.STDOUT, timeout=180)
        exit_code = result.returncode
        known = descendants([p.pid for p in processes])
    finally:
        known |= descendants([p.pid for p in processes])
        daemon_file = root / "bh-runtime/bu.pid"
        if daemon_file.exists():
            known.add(int(daemon_file.read_text().strip()))
        for proc in reversed(processes):
            if proc.poll() is None:
                if proc is processes[0] and (root / "ready").exists():
                    (root / "stop").write_text("stop\n")
                else:
                    proc.terminate()
            try:
                proc.wait(timeout=12)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        for pid in known:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for _ in range(30):
            if not any(alive(pid) for pid in known):
                break
            time.sleep(0.1)
        for pid in known:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for proc in processes:
            proc.poll()
        time.sleep(0.2)
        cleanup["pids"] = {str(pid): not alive(pid) for pid in sorted(known)}
        public_file = evidence / "fixture-public.json"
        public = json.loads(public_file.read_text()) if public_file.exists() else {}
        for port in {backend_port, cdp_port, public.get("supplierPort")} - {None}:
            with socket.socket() as connection:
                connection.settimeout(0.3)
                cleanup["ports"][str(port)] = connection.connect_ex(("127.0.0.1", port)) != 0
        shutil.rmtree(root)
        cleanup["rootRemoved"] = not root.exists()
        cleanup["bhRemoved"] = not (root / "bh-runtime").exists()
        write_json(evidence / "cleanup.json", cleanup)
        final_file = evidence / "fixture-final.json"
        complete_evidence = final_file.exists() and final_file.stat().st_size > 0
        passed_cleanup = all(cleanup["pids"].values()) and all(cleanup["ports"].values()) and cleanup["rootRemoved"] and cleanup["bhRemoved"]
        write_json(evidence / "validation.json", {"browserExitCode": exit_code, "fixtureFinalComplete": complete_evidence, "cleanupPassed": passed_cleanup, "evidence": str(evidence)})
        print(json.dumps({"evidence": str(evidence), "browserExitCode": exit_code, "fixtureFinalComplete": complete_evidence, "cleanupPassed": passed_cleanup}))
    return 0 if exit_code == 0 and complete_evidence and passed_cleanup else 1


def browser_test():
    evidence = pathlib.Path(os.environ["UWORK_ADMIN_SLICES_EVIDENCE"])
    metadata = json.loads((evidence / "fixture-public.json").read_text())
    credentials = json.loads((pathlib.Path(metadata["root"]) / "credentials.json").read_text())
    seed = json.loads((evidence / "fixture-seed.json").read_text())
    network = []
    verification_http = []
    checks = []
    target = new_tab(metadata["browserUrl"])
    session = cdp("Target.attachToTarget", targetId=target, flatten=True)["sessionId"]
    def call(method, **args):
        return cdp(method, session_id=session, **args)
    def evaluate(expression):
        result = call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        assert not result.get("exceptionDetails"), "browser expression failed"
        return result.get("result", {}).get("value")
    for domain in ["Page", "Runtime", "Network", "Log"]:
        call(domain + ".enable")
    call("Emulation.setFocusEmulationEnabled", enabled=True)
    def collect():
        for event in drain_events():
            if event.get("session_id") != session:
                continue
            p = event.get("params", {})
            if event.get("method") == "Network.requestWillBeSent":
                req = p.get("request", {})
                url = req.get("url", "")
                if url.startswith(metadata["browserUrl"]):
                    network.append({"kind": "request", "id": p["requestId"], "method": req["method"], "path": url.removeprefix(metadata["browserUrl"].rstrip("/"))})
            elif event.get("method") == "Network.responseReceived":
                res = p.get("response", {})
                url = res.get("url", "")
                if url.startswith(metadata["browserUrl"]):
                    network.append({"kind": "response", "id": p["requestId"], "path": url.removeprefix(metadata["browserUrl"].rstrip("/")), "status": res["status"]})
            elif event.get("method") == "Runtime.exceptionThrown":
                network.append({"kind": "exception", "text": p.get("exceptionDetails", {}).get("text", "unknown")})
        write_json(evidence / "browser-network.json", network)
    def record(name, **facts):
        checks.append({"name": name, "status": "pass", **facts})
        collect()
        write_json(evidence / "browser-report.json", {"checks": checks, "status": "running"})
        print(name, flush=True)
    def nodes(role, name):
        return [n for n in call("Accessibility.getFullAXTree")["nodes"] if not n.get("ignored") and n.get("role", {}).get("value") == role and n.get("name", {}).get("value") == name]
    def named(role, name):
        result = nodes(role, name)
        assert len(result) == 1, "missing or ambiguous field: " + name
        return result[0]
    def click(role, name):
        node = named(role, name)
        call("DOM.scrollIntoViewIfNeeded", backendNodeId=node["backendDOMNodeId"])
        q = call("DOM.getBoxModel", backendNodeId=node["backendDOMNodeId"])["model"]["content"]
        x, y = sum(q[0::2]) / 4, sum(q[1::2]) / 4
        call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y, button="none", buttons=0)
        for kind in ["mousePressed", "mouseReleased"]:
            call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", buttons=1 if kind == "mousePressed" else 0, clickCount=1)
    def fill(name, value):
        call("DOM.focus", backendNodeId=named("textbox", name)["backendDOMNodeId"])
        call("Input.dispatchKeyEvent", type="keyDown", key="a", code="KeyA", modifiers=4, windowsVirtualKeyCode=65, commands=["selectAll"])
        call("Input.dispatchKeyEvent", type="keyUp", key="a", code="KeyA", modifiers=4, windowsVirtualKeyCode=65)
        call("Input.dispatchKeyEvent", type="keyDown", key="Backspace", code="Backspace", windowsVirtualKeyCode=8)
        call("Input.dispatchKeyEvent", type="keyUp", key="Backspace", code="Backspace", windowsVirtualKeyCode=8)
        if value:
            call("Input.insertText", text=value)
    def select(name, value):
        expression = '(()=>{const e=Array.from(document.querySelectorAll("select")).find(e=>e.getAttribute("aria-label")===' + json.dumps(name) + ');return {index:e.selectedIndex,values:Array.from(e.options).map(o=>o.value),labels:Array.from(e.options).map(o=>o.text),activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute("aria-label"),focused:document.hasFocus(),scrollY:window.scrollY}})()'
        state = evaluate(expression)
        trace = {"name": name, "target": value, "before": state}
        target_index = state["values"].index(value)
        call("DOM.focus", backendNodeId=named("combobox", name)["backendDOMNodeId"])
        trace["activated"] = evaluate(expression)
        # Use the native closed-select keyboard type-ahead, avoiding the OS popup on a locked Mac.
        # Characters and Tab are actual CDP input; no DOM value setter or synthetic DOM event.
        for character in state["labels"][target_index]:
            call("Input.dispatchKeyEvent", type="char", text=character, unmodifiedText=character)
        call("Input.dispatchKeyEvent", type="rawKeyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9, modifiers=0)
        call("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
        trace["afterKeys"] = evaluate(expression)
        diagnostic = evidence / "select-diagnostics.json"
        previous = json.loads(diagnostic.read_text()) if diagnostic.exists() else []
        write_json(diagnostic, previous + [trace])
    def response_after(start, path, query=None):
        collect()
        for entry in network[start:]:
            url = urllib.parse.urlparse(entry.get("path", ""))
            if entry["kind"] == "response" and url.path == path and (query is None or all(urllib.parse.parse_qs(url.query, keep_blank_values=True).get(k) == [v] for k, v in query.items())):
                assert entry["status"] == 200
                return True
        return False
    def ready():
        return evaluate('document.querySelector(".table-scroll")?.getAttribute("aria-busy")==="false"')
    def goto(label):
        click("link", label)
        wait_for(lambda: evaluate('document.querySelector("h1")?.innerText') == label)
        wait_for(ready)
    def verify_http(path, tenant):
        request = urllib.request.Request(f'http://127.0.0.1:{metadata["backendPort"]}' + path, headers={"authorization": "Bearer " + credentials["verificationSessions"][tenant]}, method="GET")
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 200
            payload = response.read().decode("utf-8")
            verification_http.append({"method": "GET", "path": path, "status": response.status, "tenant": tenant})
            write_json(evidence / "verification-http.json", verification_http)
            return payload
    def read_json(path, tenant=None):
        return json.loads(verify_http(path, tenant or metadata["tenantA"]))
    def screenshot(name):
        value = call("Page.captureScreenshot", format="png")["data"]
        (evidence / (name + ".png")).write_bytes(base64.b64decode(value))
    def expected(tenant, group, q=""):
        column = {"member": "user_id", "department": "department_id", "application": "application"}[group]
        result = {}
        for row in seed["ledger"]:
            if row["tenant_id"] != tenant or row["status"] != "settled" or q not in row["model_id"]:
                continue
            subject = str(row[column])
            item = result.setdefault(subject, {"subject": subject, "credits": 0, "inputTokens": 0, "outputTokens": 0, "requests": 0})
            for dest, source in [("credits", "amount"), ("inputTokens", "input_tokens"), ("outputTokens", "output_tokens")]:
                item[dest] += int(row[source])
            item["requests"] += 1
        return sorted(result.values(), key=lambda x: x["subject"])
    def table():
        rows = evaluate('Array.from(document.querySelectorAll("tbody tr")).filter(tr=>!tr.querySelector("td[colspan]")).map(tr=>Array.from(tr.querySelectorAll("td")).slice(0,5).map(td=>td.innerText))')
        return sorted([{"subject": r[0], "credits": int(r[1]), "inputTokens": int(r[2]), "outputTokens": int(r[3]), "requests": int(r[4])} for r in rows], key=lambda x: x["subject"])
    def assert_aggregate(group, q, action):
        collect()
        start = len(network)
        action()
        path = f'/api/tenants/{metadata["tenantA"]}/usage/aggregates'
        wait_for(lambda: response_after(start, path, {"q": q, "groupBy": group}))
        want = expected(metadata["tenantA"], group, q)
        wait_for(lambda: ready() and table() == want)
        if not want:
            assert evaluate('document.querySelector("td.empty")?.innerText') == "暂无记录"
        observed = read_json(path + "?" + urllib.parse.urlencode({"groupBy": group, "q": q}))
        assert sorted(observed, key=lambda x: x["subject"]) == want
        record("aggregate-" + group + ("-filtered" if q == metadata["filteredModel"] else "-empty" if q else "-cleared"), rows=want)
    try:
        wait_for(lambda: len(nodes("textbox", "邮箱")) == 1)
        fill("邮箱", credentials["email"])
        # Password AX role is textField without a public textbox role on some Chrome builds.
        password_node = next(n for n in call("Accessibility.getFullAXTree")["nodes"] if n.get("name", {}).get("value") == "密码" and "backendDOMNodeId" in n and n.get("role", {}).get("value") in ("textbox", "textField"))
        call("DOM.focus", backendNodeId=password_node["backendDOMNodeId"])
        call("Input.insertText", text=credentials["password"])
        click("button", "登录")
        wait_for(lambda: len(nodes("combobox", "当前组织")) == 1)
        record("real-form-login")
        for tag, tenant, own, foreign in [("A-first", metadata["tenantA"], "A-ONLY-MEMBER", "B-ONLY-MEMBER"), ("B", metadata["tenantB"], "B-ONLY-MEMBER", "A-ONLY-MEMBER"), ("A-return", metadata["tenantA"], "A-ONLY-MEMBER", "B-ONLY-MEMBER")]:
            current = evaluate('document.querySelector("select[aria-label=当前组织]").value')
            if current != tenant:
                collect()
                start = len(network)
                select("当前组织", tenant)
                wait_for(lambda: response_after(start, "/api/auth/switch"))
                wait_for(lambda: response_after(start, "/api/auth/me"))
            wait_for(lambda: evaluate('document.querySelector("select[aria-label=当前组织]").value') == tenant)
            assert read_json("/api/auth/me", tenant)["tenant"]["id"] == tenant
            goto("成员与席位")
            wait_for(lambda: own in evaluate('document.querySelector("tbody").innerText'))
            assert foreign not in evaluate('document.querySelector("tbody").innerText')
            goto("用量明细")
            href = evaluate('Array.from(document.querySelectorAll("a")).find(a=>a.textContent.includes("导出"))?.getAttribute("href")')
            assert href.startswith(f"/api/tenants/{tenant}/usage?")
            payload = verify_http(href, tenant)
            data = list(csv.DictReader(io.StringIO(payload.lstrip("\ufeff"))))
            assert {r["id"] for r in data} == {r["id"] for r in seed["ledger"] if r["tenant_id"] == tenant}
            (evidence / ("usage-" + tag + ".csv")).write_text(payload)
            record("organization-" + tag + "-members-and-usage-isolated", tenant=tenant, usageRows=len(data))
            screenshot("organization-" + tag)
        goto("用量聚合")
        def search(q):
            fill("搜索", q)
            click("button", "查询")
        assert_aggregate("member", metadata["filteredModel"], lambda: search(metadata["filteredModel"]))
        assert_aggregate("department", metadata["filteredModel"], lambda: select("聚合维度", "department"))
        assert_aggregate("application", metadata["filteredModel"], lambda: select("聚合维度", "application"))
        screenshot("aggregate-filtered-application")
        assert_aggregate("application", "", lambda: search(""))
        assert_aggregate("member", "", lambda: select("聚合维度", "member"))
        assert_aggregate("member", "no-owned-model-match", lambda: search("no-owned-model-match"))
        assert_aggregate("member", metadata["filteredModel"], lambda: search(metadata["filteredModel"]))
        screenshot("aggregate-restored-members")
        collect()
        assert not [e for e in network if e["kind"] == "exception"]
        record("no-unhandled-browser-exceptions")
        click("button", "退出登录")
        wait_for(lambda: len(nodes("button", "登录")) == 1)
        record("real-ui-logout")
        write_json(evidence / "browser-report.json", {"checks": checks, "status": "passed", "boundary": "Only two added admin UI slices; existing CRUD/platform/Native/remote acceptance not repeated"})
    except Exception as error:
        collect()
        write_json(evidence / "browser-report.json", {"checks": checks, "status": "failed", "error": str(error)})
        # Never capture the login form or its populated password.
        if evaluate('document.querySelector("nav")!==null'):
            screenshot("failure-after-authentication")
        raise
    finally:
        call("Emulation.setFocusEmulationEnabled", enabled=False)
        close_tab(target)


if "cdp" in globals():
    browser_test()
elif __name__ == "__main__":
    raise SystemExit(launch())
