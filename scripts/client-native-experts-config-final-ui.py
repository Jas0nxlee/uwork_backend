"""Load in the owned browser-harness session after the formal build is approved."""
from pathlib import Path

FIXTURE = "client-native-experts-config-final-20261017"
exec(Path("scripts/client-native-scenes-fixed-ui.py").read_text())

EXPERT_PROMPTS = {
    "warm": "运行企业专家 EXPERT_CONFIG_FINAL_WARM 请完成受控验证",
    "cold": "运行企业专家 EXPERT_CONFIG_FINAL_COLD 请完成受控验证",
}
DRAFT_TITLE = "专家验收建议"
DRAFT_PROMPT = "EXPERT_CONFIG_FINAL_SCENE 普通建议"
TEMPLATE_TITLE = "专家验收定时"
TEMPLATE_PROMPT = "EXPERT_CONFIG_FINAL_SCHEDULED"


def onboard_expert_profile():
    for step in range(1, 4):
        press("跳过")
        record("expert-onboarding-" + str(step))
    wait_text(DRAFT_TITLE, 30)


def send_enterprise_expert(phase):
    assert phase in EXPERT_PROMPTS
    press("对话")
    press("新建任务")
    prompt = EXPERT_PROMPTS[phase]
    fill("向 UWork 提问，使用 @ 添加上下文，使用 / 选择命令或能力", prompt, replace=True)
    assert_plain_suggestion(prompt)
    record(phase + "-expert-ready-to-send")
    prior = body().count("原生企业资产联动完成。")
    press("发送")
    deadline = time.monotonic() + 60
    complete_samples = 0
    while time.monotonic() < deadline:
        text = body()
        stopped = js("document.querySelector('[data-testid=v4-stop]') === null")
        complete_samples = complete_samples + 1 if stopped and text.count("原生企业资产联动完成。") > prior else 0
        if complete_samples >= 4:
            record(phase + "-expert-ui-completed")
            return
        time.sleep(.1)
    record(phase + "-expert-ui-timeout")
    raise AssertionError("Actual expert UI turn did not complete; model proof is still required")


def verify_expert_scene_navigation(phase):
    assert phase in EXPERT_PROMPTS
    open_automation(TEMPLATE_TITLE)
    record(phase + "-automation-template")
    press_template(TEMPLATE_TITLE)
    values = assert_template_form(TEMPLATE_TITLE, TEMPLATE_PROMPT)
    record(phase + "-automation-form")
    cancel_template()
    press("对话")
    press("新建任务")
    wait_text(DRAFT_TITLE)
    press(DRAFT_TITLE)
    assert_plain_suggestion(DRAFT_PROMPT)
    record(phase + "-scene-draft-filled")
    return values
