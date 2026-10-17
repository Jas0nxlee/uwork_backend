"""Load inside browser-harness from the repository root; controls only the owned Native target."""
import base64
import json
import re
import time
from pathlib import Path

FIXTURE = "client-native-scenes-fixed-20261017"
REPOSITORY = Path.cwd().resolve()
assert (REPOSITORY / "scripts/fixtures/client-native-enterprise.mjs").is_file()
EVIDENCE = REPOSITORY / "evidence" / FIXTURE
METADATA = json.loads((EVIDENCE / "desktop-state.json").read_text())
assert Path(METADATA["root"]) == REPOSITORY / "data" / FIXTURE
PREFIX = Path(METADATA["appRoot"]).as_uri() + "/out/renderer/index.html"


def own():
    value = js("location.href")
    assert value.startswith(PREFIX), "Refusing an unrelated Native/browser target"


def attach_owned_renderer():
    matches = [item for item in cdp("Target.getTargets")["targetInfos"]
               if item.get("type") == "page" and item.get("url", "").startswith(PREFIX)]
    assert len(matches) == 1, "Expected one already-created owned renderer"
    switch_tab(matches[0]["targetId"])
    own()
    return matches[0]["targetId"]


def body():
    own()
    return js("document.body.innerText")


def wait_text(value, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        text = body()
        if value in text:
            return text
        time.sleep(.1)
    raise AssertionError("Missing UI text: " + value)


def ax_nodes(role=None, name=None):
    own()
    return [node for node in cdp("Accessibility.getFullAXTree")["nodes"]
            if not node.get("ignored") and (role is None or node.get("role", {}).get("value") == role)
            and (name is None or node.get("name", {}).get("value") == name)]


def ax(role, name):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        matches = ax_nodes(role, name)
        assert len(matches) < 2, "Ambiguous AX element: " + role + "/" + name
        if matches:
            return matches[0]["backendDOMNodeId"]
        time.sleep(.1)
    raise AssertionError("Missing AX element: " + role + "/" + name)


def activate(role, name):
    node = ax(role, name)
    click_node(node)


def click_node(node):
    own()
    cdp("DOM.scrollIntoViewIfNeeded", backendNodeId=node)
    previous = None
    stable = 0
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        quad = cdp("DOM.getBoxModel", backendNodeId=node)["model"]["content"]
        stable = stable + 1 if previous is not None and max(abs(a-b) for a, b in zip(quad, previous)) < .25 else 0
        if stable >= 3:
            break
        previous = quad
        time.sleep(.1)
    else:
        raise AssertionError("Moving UI target did not settle")
    click_at_xy(sum(quad[0::2]) / 4, sum(quad[1::2]) / 4)


def press(name):
    activate("button", name)


def press_template(title):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        matches = [node for node in ax_nodes("button")
                   if node.get("name", {}).get("value", "").startswith(title)]
        assert len(matches) < 2, "Ambiguous template card: " + title
        if matches:
            click_node(matches[0]["backendDOMNodeId"])
            return
        time.sleep(.1)
    raise AssertionError("Missing template card: " + title)


def key(name, code, modifiers=0, keycode=None):
    own()
    params = dict(key=name, code=code, modifiers=modifiers)
    if keycode is not None:
        params["windowsVirtualKeyCode"] = keycode
    cdp("Input.dispatchKeyEvent", type="keyDown", **params)
    cdp("Input.dispatchKeyEvent", type="keyUp", **params)


def fill(name, value, replace=False):
    cdp("DOM.focus", backendNodeId=ax("textbox", name))
    if replace:
        key("a", "KeyA", 4, 65)
    cdp("Input.insertText", text=value)


def record(name):
    assert re.fullmatch(r"[a-z0-9-]+", name)
    text = body()
    (EVIDENCE / (name + ".txt")).write_text(text)
    (EVIDENCE / (name + "-ax.json")).write_text(json.dumps(cdp("Accessibility.getFullAXTree"), ensure_ascii=False, indent=2))
    (EVIDENCE / (name + ".png")).write_bytes(base64.b64decode(cdp("Page.captureScreenshot", format="png")["data"]))
    fields = js("Array.from(document.querySelectorAll('input,textarea,[contenteditable=true]')).map(e=>({tag:e.tagName,id:e.id,testId:e.dataset.testid,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder'),value:e.value??e.innerText}))")
    (EVIDENCE / (name + "-fields.json")).write_text(json.dumps(fields, ensure_ascii=False, indent=2))
    return text


def assert_plain_suggestion(prompt):
    wait_text(prompt)
    composer = js("Array.from(document.querySelectorAll('[contenteditable=true]')).map(e=>e.innerText).join('')")
    assert composer.strip() == prompt, composer
    assert js("document.querySelectorAll('[data-mention-category=plugins]').length") == 0
    assert "plugin://" not in js("Array.from(document.querySelectorAll('[contenteditable=true]')).map(e=>e.innerHTML).join('')")


def send_draft():
    prior = body().count("原生企业资产联动完成。")
    press("发送")
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        value = body()
        if value.count("原生企业资产联动完成。") > prior and "停止生成" not in value:
            return value
        time.sleep(.1)
    raise AssertionError("Controlled Native draft turn did not complete")


def open_automation(template_title):
    press("自动化")
    wait_text(template_title)
    assert "无可用模板" not in body()


def assert_template_form(title, prompt, frequency="每工作日", time_of_day="09:00"):
    wait_text("新建定时任务")
    values = js("(()=>{const f=document.querySelector('#automation-edit-form');return f?{title:f.querySelector('#automation-title')?.value,prompt:f.querySelector('#automation-prompt')?.value,frequency:f.querySelector('[data-testid=automation-frequency-select]')?.innerText,time:f.querySelector('button[aria-label=调度]')?.innerText}:null})()")
    assert values is not None, "Missing actual automation form"
    assert values["title"] == title, values
    assert values["prompt"] == prompt, values
    assert values["frequency"] == frequency, values
    assert values["time"].strip() == time_of_day, values
    return values


def cancel_template():
    matches = [node for node in ax_nodes("button", "自动化")
               if 'data-testid="settings-breadcrumb-section"' in cdp("DOM.getOuterHTML", backendNodeId=node["backendDOMNodeId"])["outerHTML"]]
    assert len(matches) == 1, "Expected actual automation form back breadcrumb"
    click_node(matches[0]["backendDOMNodeId"])
    wait_text("还没有定时任务")
    assert js("document.querySelector('#automation-edit-form') === null")


def controls():
    return [{"role": node.get("role", {}).get("value"), "name": node.get("name", {}).get("value"), "value": node.get("value", {}).get("value")}
            for node in ax_nodes() if node.get("role", {}).get("value") in ("button", "textbox", "combobox", "spinbutton", "tab", "checkbox")]
