"""Owned browser-harness profile only; never print or capture the issued token."""
import json
import os
import time
from urllib.parse import urlparse

origin = os.environ["UWORK_DEVICE_UI_ORIGIN"]
stage = os.environ["UWORK_DEVICE_UI_STAGE"]
evidence = os.environ["UWORK_DEVICE_UI_EVIDENCE"]
assert os.environ.get("BH_RECORD") == "0"
assert os.environ.get("BH_TELEMETRY") == "0"
assert urlparse(origin).hostname == "127.0.0.1"
assert urlparse(origin).port != 3000


def wait_ui(expression, label):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if js(expression):
            return
        time.sleep(0.1)
    diagnostic = js("""({hash:location.hash,
      headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),
      buttons:[...document.querySelectorAll('button')].map(e=>e.textContent.trim())})""")
    print("DEVICE_UI_DIAGNOSTIC=" + json.dumps(diagnostic, ensure_ascii=False))
    raise AssertionError("UI wait failed: " + label)


def click_css(selector):
    # Read DOM geometry only; the click itself is native CDP input.
    document_id = cdp("DOM.getDocument")["root"]["nodeId"]
    node_id = cdp("DOM.querySelector", nodeId=document_id, selector=selector)["nodeId"]
    assert node_id, "DOM target missing"
    cdp("DOM.scrollIntoViewIfNeeded", nodeId=node_id)
    quoted = json.dumps(selector)
    box = js("""(()=>{const e=document.querySelector(%s);if(!e)return null;
      const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,
      visible:r.width>0&&r.height>0}})()""" % quoted)
    assert box and box["visible"], "visible target missing"
    click_at_xy(box["x"], box["y"])


def click_ax(role, name):
    # This helper is never called while the one-time token result is open.
    nodes = cdp("Accessibility.getFullAXTree")["nodes"]
    matches = [n for n in nodes if not n.get("ignored")
               and n.get("role", {}).get("value") == role
               and n.get("name", {}).get("value") == name]
    assert len(matches) == 1, "AX target must be unique: " + name
    node_id = matches[0]["backendDOMNodeId"]
    cdp("DOM.scrollIntoViewIfNeeded", backendNodeId=node_id)
    q = cdp("DOM.getBoxModel", backendNodeId=node_id)["model"]["content"]
    click_at_xy(sum(q[0::2]) / 4, sum(q[1::2]) / 4)


def close_result():
    # Avoid an AX tree, page text dump or screenshot while the token is visible.
    click_css('dialog[open] button[aria-label="关闭"]')
    wait_ui("document.querySelector('dialog[open]')===null", "result closed")


if stage == "issue":
    new_tab(origin)
    wait_for_load()
    wait_ui("document.querySelector('input[name=email]')!==null", "login form")
    click_css("input[name=email]")
    type_text(os.environ["UWORK_DEVICE_UI_EMAIL"])
    click_css("input[name=password]")
    type_text(os.environ["UWORK_DEVICE_UI_PASSWORD"])
    click_ax("button", "登录")
    wait_ui("document.querySelector('nav')!==null", "signed in")
    click_css('nav a[href="#enterprise"]')
    wait_ui("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='签发凭据')", "device settings")
    actions = js("[...document.querySelectorAll('.settings-section')].find(s=>s.querySelector('h2')?.textContent==='终端凭据')?.querySelector('.actions')?.textContent")
    assert "签发凭据" in actions and "查看我的终端凭据" in actions
    assert "吊销" not in actions, "record actual UI revoke availability"
    click_ax("button", "签发凭据")
    wait_ui("document.querySelector('dialog[open] input[type=number]')!==null", "TTL form")
    click_css("dialog[open] input[type=number]")
    cdp("Input.dispatchKeyEvent", type="keyDown", key="a", code="KeyA",
        modifiers=4, windowsVirtualKeyCode=65, nativeVirtualKeyCode=65,
        commands=["selectAll"])
    cdp("Input.dispatchKeyEvent", type="keyUp", key="a", code="KeyA",
        modifiers=4, windowsVirtualKeyCode=65, nativeVirtualKeyCode=65)
    press_key("Backspace")
    type_text("2")
    assert js("document.querySelector('dialog[open] input[type=number]').value") == "2"
    click_ax("button", "保存")
    wait_ui("""(()=>{try{const d=JSON.parse(document.querySelector('dialog[open] pre.detail')?.textContent||'null');
      return !!d&&typeof d.token==='string'&&d.token.length>20}catch{return false}})()""", "one-time issue result")
    issued = js("""(()=>{const d=JSON.parse(document.querySelector('dialog[open] pre.detail').textContent);
      return {keys:Object.keys(d).sort(),tokenPresent:typeof d.token==='string'&&d.token.length>20,
      idIsHash:typeof d.id==='string'&&/^[a-f0-9]{64}$/.test(d.id),expiresAt:d.expiresAt,
      requestedHours:2}})()""")
    assert issued["tokenPresent"] and issued["idIsHash"]
    close_result()
    click_ax("button", "查看我的终端凭据")
    wait_ui("""(()=>{try{const d=JSON.parse(document.querySelector('dialog[open] pre.detail')?.textContent||'null');
      return Array.isArray(d)&&d.length===1}catch{return false}})()""", "metadata list")
    metadata = js("""(()=>{const rows=JSON.parse(document.querySelector('dialog[open] pre.detail').textContent);
      return {count:rows.length,keys:rows.map(r=>Object.keys(r).sort()),
      noTokenField:rows.every(r=>!Object.hasOwn(r,'token')),
      onlyHashIds:rows.every(r=>/^[a-f0-9]{64}$/.test(r.id)),
      idMask:rows.map(r=>r.id.slice(0,4)+'…'+r.id.slice(-4)),
      timestampsOnly:rows.every(r=>typeof r.expires_at==='number'&&typeof r.created_at==='number')}})()""")
    assert metadata["noTokenField"] and metadata["onlyHashIds"] and metadata["timestampsOnly"]
    assert metadata["keys"] == [["created_at", "expires_at", "id"]]
    close_result()
    capture_screenshot(os.path.join(evidence, "issued-metadata-closed.png"))
    result = {"stage": stage, "domLogin": True, "domIssued": issued,
              "metadata": metadata, "uiRevokeButton": False,
              "screenshotHasNoResultDialog": True}
elif stage == "revoked":
    assert urlparse(js("location.href")).netloc == urlparse(origin).netloc
    click_ax("button", "查看我的终端凭据")
    wait_ui("document.querySelector('dialog[open] pre.detail')?.textContent.trim()==='[]'", "revoked metadata empty")
    empty = js("JSON.parse(document.querySelector('dialog[open] pre.detail').textContent).length")
    assert empty == 0
    close_result()
    capture_screenshot(os.path.join(evidence, "revoked-metadata-closed.png"))
    result = {"stage": stage, "metadataCount": empty,
              "screenshotHasNoResultDialog": True}
else:
    raise AssertionError("unknown verification stage")

print("DEVICE_UI_RESULT=" + json.dumps(result, ensure_ascii=False))
