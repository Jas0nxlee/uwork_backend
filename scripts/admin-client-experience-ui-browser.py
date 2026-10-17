"""Only run in this task's explicit CDP/BH profile; JS is read-only DOM inspection."""
import json
import os
import time
from urllib.parse import urlparse

stage = os.environ["UWORK_EXPERIENCE_STAGE"]
origin = os.environ["UWORK_EXPERIENCE_ORIGIN"]
phase = os.environ["UWORK_EXPERIENCE_PHASE"]
evidence = os.environ["UWORK_EXPERIENCE_EVIDENCE"]
kind = os.environ.get("UWORK_EXPERIENCE_KIND", "")
labels = {"scenes": "场景模板", "help": "帮助与反馈", "desktop": "桌面行为", "plugin-store": "插件排序"}
assert os.environ["BH_RECORD"] == "0" and os.environ["BH_TELEMETRY"] == "0"
assert urlparse(origin).hostname == "127.0.0.1" and urlparse(origin).port != 3000


def wait_ui(expression, label):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if js(expression):
            return
        time.sleep(0.08)
    diagnostic = js("""({hash:location.hash,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),
      buttons:[...document.querySelectorAll('button')].map(e=>({text:e.textContent.trim(),disabled:e.matches(':disabled')})),
      active:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),name:document.activeElement?.getAttribute('name')},
      errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})""")
    print("ADMIN_EXPERIENCE_DIAGNOSTIC=" + json.dumps(diagnostic, ensure_ascii=False))
    raise AssertionError("UI wait failed: " + label)


def click_node(expression):
    cdp("DOM.getDocument", depth=0)
    remote = cdp("Runtime.evaluate", expression=expression, returnByValue=False)["result"]
    assert remote.get("objectId"), "DOM target missing"
    try:
        node_id = cdp("DOM.requestNode", objectId=remote["objectId"])["nodeId"]
        cdp("DOM.scrollIntoViewIfNeeded", nodeId=node_id)
        q = cdp("DOM.getBoxModel", nodeId=node_id)["model"]["content"]
        click_at_xy(sum(q[0::2]) / 4, sum(q[1::2]) / 4)
    finally:
        cdp("Runtime.releaseObject", objectId=remote["objectId"])


def click_css(selector):
    click_node("document.querySelector(" + json.dumps(selector) + ")")


def focus_node(expression):
    cdp("DOM.getDocument", depth=0)
    remote = cdp("Runtime.evaluate", expression=expression, returnByValue=False)["result"]
    assert remote.get("objectId"), "focus target missing"
    try:
        node_id = cdp("DOM.requestNode", objectId=remote["objectId"])["nodeId"]
        cdp("DOM.focus", nodeId=node_id)
    finally:
        cdp("Runtime.releaseObject", objectId=remote["objectId"])
    wait_ui("document.activeElement===(" + expression + ")", "native field focus")


def scroll_node(expression):
    cdp("DOM.getDocument", depth=0)
    remote = cdp("Runtime.evaluate", expression=expression, returnByValue=False)["result"]
    assert remote.get("objectId"), "scroll target missing"
    try:
        node_id = cdp("DOM.requestNode", objectId=remote["objectId"])["nodeId"]
        cdp("DOM.scrollIntoViewIfNeeded", nodeId=node_id)
    finally:
        cdp("Runtime.releaseObject", objectId=remote["objectId"])


def click_ax(role, name):
    nodes = cdp("Accessibility.getFullAXTree")["nodes"]
    found = [node for node in nodes if not node.get("ignored")
             and node.get("role", {}).get("value") == role
             and node.get("name", {}).get("value") == name]
    assert len(found) == 1, "AX target must be unique: " + name
    node_id = found[0]["backendDOMNodeId"]
    cdp("DOM.scrollIntoViewIfNeeded", backendNodeId=node_id)
    q = cdp("DOM.getBoxModel", backendNodeId=node_id)["model"]["content"]
    click_at_xy(sum(q[0::2]) / 4, sum(q[1::2]) / 4)


def control(label, group=None):
    root = "document"
    if group:
        root = "[...document.querySelectorAll('fieldset')].find(e=>e.querySelector(':scope > legend')?.textContent.trim()===" + json.dumps(group) + ")"
    return """(()=>{const root=%s;if(!root)return null;const label=[...root.querySelectorAll('label')].find(e=>
      e.querySelector(':scope > span')?.textContent.trim()===%s||e.textContent.trim()===%s);
      return label?.querySelector('input,textarea,select')||null})()""" % (root, json.dumps(label), json.dumps(label))


def fill_expression(expression, value):
    assert js("(()=>{const e=" + expression + ";return !!e&&!e.matches(':disabled')})()"), "field must be writable"
    click_node(expression)
    focus_node(expression)
    cdp("Input.dispatchKeyEvent", type="keyDown", key="a", code="KeyA", modifiers=4, windowsVirtualKeyCode=65, commands=["selectAll"])
    cdp("Input.dispatchKeyEvent", type="keyUp", key="a", code="KeyA", modifiers=4, windowsVirtualKeyCode=65)
    if value:
        type_text(value)
    else:
        press_key("Backspace")
    if not js("(" + expression + ")?.type==='password'"):
        if value:
            wait_ui("(" + expression + ")?.value===" + json.dumps(value), "native field replacement")
        else:
            wait_ui("! (" + expression + ")||(" + expression + ").value===''", "native field cleared or closed")


def fill(label, value, group=None):
    fill_expression(control(label, group), value)


def checkbox(label, value, group=None):
    expression = control(label, group)
    current = js("(" + expression + ")?.checked")
    assert isinstance(current, bool), "checkbox missing: " + label
    if current != value:
        click_node(expression)
    wait_ui("(" + expression + ")?.checked===" + str(value).lower(), label)


def select_value(expression, value):
    state = js("(()=>{const e=" + expression + ";return {index:e.selectedIndex,values:[...e.options].map(o=>o.value),labels:[...e.options].map(o=>o.text)}})()")
    index = state["values"].index(value)
    if index == state["index"]:
        return
    prefix = state["labels"][index][0]
    assert sum(label.casefold().startswith(prefix.casefold()) for label in state["labels"]) == 1, "native select requires a unique initial character"
    cdp("DOM.getDocument", depth=0)
    remote = cdp("Runtime.evaluate", expression=expression, returnByValue=False)["result"]
    assert remote.get("objectId")
    try:
        node_id = cdp("DOM.requestNode", objectId=remote["objectId"])["nodeId"]
        cdp("DOM.focus", nodeId=node_id)
        cdp("Input.dispatchKeyEvent", type="char", text=prefix, unmodifiedText=prefix)
        cdp("Input.dispatchKeyEvent", type="rawKeyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9, modifiers=0)
        cdp("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
    finally:
        cdp("Runtime.releaseObject", objectId=remote["objectId"])
    wait_ui("(" + expression + ")?.value===" + json.dumps(value), "native select value")


def meta():
    return js(r"""(()=>{const t=document.querySelector('main .section-heading > span')?.textContent||'';
      const m=t.match(/发布版本 (\d+).*草稿修订 (\d+)/);return m?{version:Number(m[1]),revision:Number(m[2])}:null})()""")


def ready():
    wait_ui(r"""(()=>{const t=document.querySelector('main .section-heading > span')?.textContent||'';
      return /发布版本 \d+.*草稿修订 \d+/.test(t)&&![...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('正在加载当前组织'))})()""", "current configuration loaded")


def action(name):
    before = meta()
    assert before is not None
    click_ax("button", name)
    wait_ui(r"""(()=>{const t=document.querySelector('main .section-heading > span')?.textContent||'';
      const m=t.match(/发布版本 (\d+).*草稿修订 (\d+)/);return !!m&&Number(m[2])>%d})()""" % before["revision"], name + " revision")
    ready()
    wait_for_network_idle(timeout=10, idle_ms=300)
    after = meta()
    assert after["version"] == before["version"] + (1 if name == "发布" else 0)
    return {"before": before, "after": after}


def save_disabled():
    return js("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='保存草稿')?.matches(':disabled')")


def select_kind(value):
    # A horizontally clipped native tab can be absent from the AX tree after
    # clearing viewport emulation. Resolve only the current tabs' DOM button,
    # then scroll/click through native CDP rather than changing application state.
    expression = "[...document.querySelectorAll('.tabs button')].find(e=>e.textContent.trim()===" + json.dumps(labels[value]) + ")"
    wait_ui("(" + expression + ")!==undefined", "current configuration tab")
    click_node(expression)
    ready()


def welcome():
    return js("(" + control("欢迎语") + ")?.value")


result = {"stage": stage, "phase": phase}
if stage == "race-start":
    new_tab(origin)
    wait_for_load()
    wait_ui("document.querySelector('input[name=email]')!==null", "real login")
    fill_expression("document.querySelector('input[name=email]')", os.environ["UWORK_EXPERIENCE_EMAIL"])
    fill_expression("document.querySelector('input[name=password]')", os.environ["UWORK_EXPERIENCE_PASSWORD"])
    click_ax("button", "登录")
    wait_ui("document.querySelector('nav')!==null", "authenticated shell")
    select_value("document.querySelector('select[aria-label=\"当前组织\"]')", os.environ["UWORK_EXPERIENCE_TENANT_A"])
    click_css('nav a[href="#configuration"]')
    ready()
    click_ax("button", "新对话")
    wait_ui("document.querySelector('.tabs .active')?.textContent.trim()==='新对话'", "new chat selected")
    result["pendingWritesDisabled"] = save_disabled()
elif stage == "race-switch-b":
    select_value("document.querySelector('select[aria-label=\"当前组织\"]')", os.environ["UWORK_EXPERIENCE_TENANT_B"])
    wait_ui("(" + control("欢迎语") + ")?.value===" + json.dumps(os.environ["UWORK_EXPERIENCE_MARKER_B"]), "B current draft loaded before release")
    result.update({"headerTenant": js("document.querySelector('select[aria-label=\"当前组织\"]').value"), "welcome": welcome(), "meta": meta()})
elif stage == "race-observe-save":
    wait_for_network_idle(timeout=10, idle_ms=500)
    expected = os.environ["UWORK_EXPERIENCE_MARKER_A" if phase == "red" else "UWORK_EXPERIENCE_MARKER_B"]
    wait_ui("(" + control("欢迎语") + ")?.value===" + json.dumps(expected), "released A result applied or rejected")
    result.update({"headerTenant": js("document.querySelector('select[aria-label=\"当前组织\"]').value"), "welcome": welcome(), "saveEnabled": not save_disabled()})
    capture_screenshot(os.path.join(evidence, phase + "-same-kind-race.png"))
    result["save"] = action("保存草稿")
elif stage.endswith("-draft"):
    select_kind(kind)
    invalid = {}
    if kind == "scenes":
        click_ax("button", "添加草稿建议")
        fill("模板 ID", "draft-browser", "草稿建议 1")
        fill("标题 · 中文", "浏览器草稿建议", "草稿建议 1")
        fill("标题 · English", "Browser suggestion", "草稿建议 1")
        fill("提示词 · 中文", "生成受控工作摘要", "草稿建议 1")
        fill("提示词 · English", "Summarize the owned fixture", "草稿建议 1")
        fill("图标（可选）", "sparkles", "草稿建议 1")
        fill("插件稳定 ID（可选）", "fixture.existing-plugin", "草稿建议 1")
        checkbox("打开自动化", True, "草稿建议 1")
        click_ax("button", "添加草稿建议")
        click_ax("button", "移除草稿建议 2")
        click_ax("button", "添加定时模板")
        fill("模板 ID", "scheduled-browser", "定时模板 1")
        fill("标题 · 中文", "浏览器定时模板", "定时模板 1")
        fill("标题 · English", "Browser schedule", "定时模板 1")
        fill("提示词 · 中文", "整理受控日报", "定时模板 1")
        fill("提示词 · English", "Prepare an owned daily report", "定时模板 1")
        fill("Cron 表达式", "0 09 * * *", "定时模板 1")
        invalid["cronWriteDisabled"] = save_disabled()
        assert invalid["cronWriteDisabled"]
        fill("Cron 表达式", "0 9 * * 1-5", "定时模板 1")
        click_ax("button", "添加错峰模板")
        fill("模板 ID", "item_customize", "错峰模板 1")
        fill("标题 · 中文", "浏览器错峰模板", "错峰模板 1")
        fill("标题 · English", "Browser off peak", "错峰模板 1")
        fill("提示词 · 中文", "检查受控示例", "错峰模板 1")
        fill("提示词 · English", "Inspect the owned example", "错峰模板 1")
        fill("说明 · 中文", "受控夜间示例", "错峰模板 1")
        fill("说明 · English", "Owned overnight example", "错峰模板 1")
        invalid["reservedIdWriteDisabled"] = save_disabled()
        assert invalid["reservedIdWriteDisabled"]
        fill("模板 ID", "offpeak-browser", "错峰模板 1")
    elif kind == "help":
        checkbox("启用中文社区", True)
        fill("中文社区 HTTPS 地址", "http://community.example.test")
        invalid["httpWriteDisabled"] = save_disabled()
        assert invalid["httpWriteDisabled"]
        fill("中文社区 HTTPS 地址", "https://community.example.test/zh-cn")
        checkbox("启用English community", True)
        fill("English community HTTPS 地址", "https://community.example.test/en-us")
        select_value(control("反馈模式"), "external")
        fill("反馈 HTTPS 地址", "https://feedback.example.test/form")
    elif kind == "desktop":
        checkbox("启用桌面上下文提示段", True)
        checkbox("启用界面动作追踪", True)
        fill("采样比例（0–0.2）", "0.21")
        invalid["ratioWriteDisabled"] = save_disabled()
        assert invalid["ratioWriteDisabled"]
        fill("采样比例（0–0.2）", "0.1")
        checkbox("核心交互（core）", True)
        checkbox("设置（settings）", True)
    elif kind == "plugin-store":
        checkbox("启用自定义插件排序", True)
        checkbox("配置Code 模式", True)
        checkbox("自定义Code 模式分类顺序", True)
        click_ax("button", "添加Code 模式分类")
        fill_expression("document.querySelector('input[aria-label=\"Code 模式分类 1 ID\"]')", "category-b")
        click_ax("button", "添加Code 模式分类")
        fill_expression("document.querySelector('input[aria-label=\"Code 模式分类 2 ID\"]')", "category-a")
        click_ax("button", "上移Code 模式分类 2")
        fill("Code 模式新增分类 ID", "category-a")
        click_ax("button", "添加Code 模式插件分类")
        for index, value in enumerate(["plugin/two", "plugin/one"], 1):
            click_ax("button", "添加Code 模式 category-a 插件")
            fill_expression("document.querySelector(" + json.dumps('input[aria-label="Code 模式 category-a 插件 %d ID"]' % index) + ")", value)
        click_ax("button", "上移Code 模式 category-a 插件 2")
        fill("Code 模式新增分类 ID", "__proto__")
        click_ax("button", "添加Code 模式插件分类")
        invalid["prototypeKeyWriteDisabled"] = save_disabled()
        assert invalid["prototypeKeyWriteDisabled"]
        click_ax("button", "移除分类 __proto__")
        checkbox("配置Work 模式", True)
        checkbox("自定义Work 模式分类顺序", True)
        click_ax("button", "添加Work 模式分类")
        fill_expression("document.querySelector('input[aria-label=\"Work 模式分类 1 ID\"]')", "work-category")
        fill("Work 模式新增分类 ID", "work-category")
        click_ax("button", "添加Work 模式插件分类")
        click_ax("button", "添加Work 模式 work-category 插件")
        fill_expression("document.querySelector('input[aria-label=\"Work 模式 work-category 插件 1 ID\"]')", "work/plugin")
    assert not save_disabled(), "valid structured draft should be writable"
    result.update({"kind": kind, "invalidInputs": invalid, "save": action("保存草稿")})
elif stage.endswith("-publish"):
    result.update({"kind": kind, "publish": action("发布")})
elif stage.endswith("-edit"):
    if kind == "scenes":
        fill("标题 · 中文", "未发布的场景修改", "草稿建议 1")
    elif kind == "help":
        fill("中文社区 HTTPS 地址", "")
        fill("反馈 HTTPS 地址", "")
    elif kind == "desktop":
        fill("采样比例（0–0.2）", "0.2")
    elif kind == "plugin-store":
        checkbox("启用自定义插件排序", False)
    result.update({"kind": kind, "save": action("保存草稿")})
elif stage.endswith("-discard"):
    result.update({"kind": kind, "discard": action("放弃草稿")})
elif stage.startswith("layout-"):
    select_kind(kind)
    layouts = []
    for width in [320, 768, 1024, 1440]:
        cdp("Emulation.setDeviceMetricsOverride", width=width, height=900, deviceScaleFactor=1, mobile=False)
        wait_ui("innerWidth===" + str(width), "requested viewport width")
        if width <= 700:
            wait_ui("document.querySelector('aside').getBoundingClientRect().right<=1", "closed mobile drawer transition finished")
        scroll_node("document.querySelector('.tabs .active')")
        scroll_node("document.querySelector('main h1')")
        state = js("({width:innerWidth,documentWidth:document.documentElement.scrollWidth,hash:location.hash,kind:document.querySelector('.tabs .active')?.textContent.trim(),sidebarRight:document.querySelector('aside').getBoundingClientRect().right})")
        assert state["hash"] == "#configuration" and state["kind"] == labels[kind], "requested configuration must remain current at every viewport"
        assert state["documentWidth"] <= state["width"], "document overflow at %d" % width
        capture_screenshot(os.path.join(evidence, "layout-%s-%d.png" % (kind, width)))
        layouts.append(state)
    cdp("Emulation.clearDeviceMetricsOverride")
    result.update({"kind": kind, "layouts": layouts})
else:
    raise AssertionError("unknown browser stage")

print("ADMIN_EXPERIENCE_RESULT=" + json.dumps(result, ensure_ascii=False))
