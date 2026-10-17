# SWR 场景生命周期修复后的独占 Native 复测

本轮只补同一 owner 的场景跨页面/冷恢复验收。Root 先结束旧 profile，再正式 Desktop-only 构建；收到其新 manifest 后才能复制 out 或启动 Native。CLI 与 staged CLI 必须保持 `39175fd59577db9c2e80519170ab33e96e622f22c8cb86f18bf3241e2507d43c`。此前 d86/355 的真实无模板 RED、所有旧 SHA 与证据保持原样。

## 独占边界与准备

- 使用现有公共夹具，Node 24.14.0，tty 模式；`UWORK_NATIVE_FIXTURE_NAME=client-native-scenes-fixed-20261017`、`UWORK_NATIVE_CLIENT_EXPERIENCE=enabled`。不修改产品 hook、协议或公共夹具。
- 通过原 `configure` 命令调用真实后台草稿/发布 API，发布 scenes 的 draft/scheduled/offPeak 三组初值。推荐携带一个明确未安装的 opaque pluginStableId；没有真实市场、MCP、企微或网盘调用。
- BH 使用 `BU_NAME=default`、独占 BH_HOME 与准确 CDP URL。仅绑定 metadata.appRoot 下已有 renderer target，不调用 new_tab/Target.createTarget，不控制 Root 当前 Native/Chrome，不注入 React/store/业务 RPC。
- 使用真实 DOM/AX 输入。驱动每次动作先核对 renderer URL 与本次 appRoot，并等待目标盒连续稳定后再取坐标，输出仅写本轮 evidence。目录选择器不在本轮验收范围。

## 必需正向

1. 核对新正式 Main/Host/Renderer/CLI/stage SHA、完整快照与真实 appPath/isPackaged=false；通过现有三步 onboarding 的“跳过”。
2. 新草稿显示发布的建议卡。实际点击后 composer 包含准确 prompt，DOM 中没有 plugins mention；真实发送并等待受控供应商回复完成。
3. 点击“自动化”，实际显示定时模板而非“无可用模板”。点击模板后，读取真正表单的标题、prompt 和 cron/builder 字段，验证与已发布值一致；通过表单的“自动化”面包屑返回取消，不创建或执行定时任务。
4. 返回对话、新建草稿，确认建议再次出现；重复建议选择与自动化模板导航，防止同 owner 共享数据在卸载/重挂时丢失。
5. 先保存完整日志与运行信息，再仅 stopNative 并冷启动同 profile；保留后台、身份资料和发布版本。重新打开草稿/自动化模板并验证。新 Main 的 app.isPackaged 边界和 PID 单独记录。

## 可安全追加与验收边界

必需正向通过后，可由原后台 API 发布 version 2，在现有 UI 轮询/正常导航后验证新标题与 prompt；配置暂停仅用现有 pauseConfiguration/resumeConfiguration，记录不可用清旧与恢复，保持有界等待。不在配置暂停期间发送模型请求，不隐藏既有账本状态。

如果正式旧 CodingPlan 未开放 offPeak 入口，则只证明后台发布数据和可到达的 UI，offPeak 仍未验收；禁止造入口。未安装插件回退只检验真实建议路径，不进入插件商店触发默认外部目录刷新。

## 证据与清理

每个关键阶段保存正文、AX、截图、真实表单 DOM 值，以及原 experienceSnapshot 的已发布配置、实际模型正文/HTTP 请求和账本。实际 UI、受控供应商与源码测试分别记录。两次 launch 的日志在 stop/冷启动前分别归档，不能让现有夹具的非追加日志覆盖前一阶段。

结束使用原 close，核对自有所有已知 Main/Host/CLI/helper/fixture PID、HTTPS/backend/supplier/CDP 端口、BH daemon 和 owned root 已实际清理。主实例 PID 37266、主 .env/DB/Vault 和其他 profile 不接触。新正式产物与旧候选不得混写。
