"""Finite, sequential actual-DOM commands for Root's already-running owned HTTPS fixture."""
import os
from pathlib import Path

library = Path(os.environ["UWORK_NATIVE_ADMIN_HELPERS"])
helpers = library.read_text().partition("\nresult = ")[0]
exec(compile(helpers, str(library), "exec"), globals())

command = os.environ["UWORK_NATIVE_ADMIN_COMMAND"]
tenant_id = os.environ["UWORK_NATIVE_ADMIN_TENANT"]
groups = {
    "core": "核心交互（core）", "settings": "设置（settings）",
    "workbench": "工作台（workbench）", "extensions": "扩展（extensions）",
    "automation": "自动化（automation）", "account": "账号（account）",
}


def scope():
    actual = js("({origin:location.origin,tenantId:document.querySelector('select[aria-label=\"当前组织\"]')?.value,hash:location.hash,kind:document.querySelector('.tabs .active')?.textContent.trim()})")
    assert actual["origin"] == origin and actual["tenantId"] == tenant_id, "owned origin/tenant must remain current"
    return actual


def choose(value):
    scope()
    if js("document.querySelector('.tabs .active')?.textContent.trim()") != labels[value]:
        select_kind(value)
    ready()
    actual = scope()
    assert actual["hash"] == "#configuration" and actual["kind"] == labels[value]


def read_checkbox(label):
    value = js("(" + control(label) + ")?.checked")
    assert isinstance(value, bool)
    return value


def desktop():
    return {
        "desktopContextPrompt": {"enabled": read_checkbox("启用桌面上下文提示段")},
        "rendererActionTrace": {
            "enabled": read_checkbox("启用界面动作追踪"),
            "sampleRatio": js("Number((" + control("采样比例（0–0.2）") + ").value)"),
            "enabledGroups": [key for key, label in groups.items() if read_checkbox(label)],
        },
    }


def configure_desktop(enabled):
    checkbox("启用桌面上下文提示段", enabled)
    checkbox("启用界面动作追踪", enabled)
    fill("采样比例（0–0.2）", "0.2" if enabled else "0")
    for key, label in groups.items():
        checkbox(label, enabled and key == "settings")


result = {"command": command, "actions": []}
if command == "ready":
    new_tab(origin)
    wait_for_load()
    wait_ui("document.querySelector('input[name=email]')!==null", "owned login page")
    fill_expression("document.querySelector('input[name=email]')", os.environ["UWORK_EXPERIENCE_EMAIL"])
    fill_expression("document.querySelector('input[name=password]')", os.environ["UWORK_EXPERIENCE_PASSWORD"])
    click_ax("button", "登录")
    wait_ui("document.querySelector('nav')!==null", "authenticated owned shell")
    select_value("document.querySelector('select[aria-label=\"当前组织\"]')", tenant_id)
    click_css('nav a[href="#configuration"]')
    ready()
    choose("desktop")
elif command in ["desktopDraftOn", "desktopPublish", "desktopOff"]:
    choose("desktop")
    result["before"] = {"meta": meta(), "data": desktop()}
    if command != "desktopPublish":
        configure_desktop(command == "desktopDraftOn")
        result["actions"].append(action("保存草稿"))
    if command in ["desktopPublish", "desktopOff"]:
        result["actions"].append(action("发布"))
elif command in ["sceneDraftTitle", "scenePublish", "sceneDiscard"]:
    choose("scenes")
    result["before"] = {"meta": meta(), "firstDraftTitleCn": js("(" + control("标题 · 中文", "草稿建议 1") + ")?.value")}
    if command == "sceneDraftTitle":
        fill("标题 · 中文", "企业后台更新推荐", "草稿建议 1")
        result["actions"].append(action("保存草稿"))
    else:
        result["actions"].append(action("发布" if command == "scenePublish" else "放弃草稿"))
else:
    raise AssertionError("unsupported finite command")

result["scope"] = scope()
result["after"] = {"meta": meta()}
if command == "ready" or command.startswith("desktop"):
    result["after"]["data"] = desktop()
    if command in ["desktopDraftOn", "desktopOff"]:
        enabled = command == "desktopDraftOn"
        assert result["after"]["data"] == {
            "desktopContextPrompt": {"enabled": enabled},
            "rendererActionTrace": {"enabled": enabled, "sampleRatio": 0.2 if enabled else 0, "enabledGroups": ["settings"] if enabled else []},
        }, "actual saved desktop fields differ from requested values"
else:
    result["after"]["firstDraftTitleCn"] = js("(" + control("标题 · 中文", "草稿建议 1") + ")?.value")
    if command == "sceneDraftTitle":
        assert result["after"]["firstDraftTitleCn"] == "企业后台更新推荐"
result["servedScriptPaths"] = js("[...document.querySelectorAll('script[src]')].map(e=>new URL(e.src).pathname)")
scroll_node("document.querySelector('main h1')")
capture_screenshot(os.path.join(evidence, stage + ".png"))
print("ADMIN_EXPERIENCE_RESULT=" + json.dumps(result, ensure_ascii=False))
