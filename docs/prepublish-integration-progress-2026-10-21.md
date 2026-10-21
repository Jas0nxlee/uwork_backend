# 编译发布前联动测试进展

> 最新新增见[凭据、分类与企业信息](prepublish-credentials-categories-enterprise-test-2026-10-21.md)：v22/v23新增真实生命周期通过；v24复现企业改名后顶部组织标签陈旧，修复当前身份视图的同组织元数据同步后v25通过。新3条逻辑测试、类型/Lint/build通过。

> 最新状态见[部门/成员席位/额度与设置晚读修复](prepublish-directory-limits-read-order-test-2026-10-21.md)：v16/v17新增原页面生命周期通过；v19真实发现旧读取回灌已删除规则，原Settings加当前代交付保护后v20通过，并以v21仅回归受影响正常限量流程。类型/Lint/build通过，原晚成功真实送达、自有资源关闭；未宣称全部功能覆盖。

本轮按用户最新范围运行仓库内共享 UI、未打包 Electron/Main/Host/CLI 和真实后台 HTTP/SQLite，不测试发布后的多系统客户端。外部 MCP、网盘不测；受控供应商只证明传输、调度与计量链路，不等于真实外部模型质量或供应商账单。

## 新增真实联动与修复

| 场景             | 实测结果                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 忙任务队列       | 原 Composer 发送 A；供应商暂挂 A；B 入队后原按钮删除；C 入队；释放 A 后只执行 C。B 从未进入实际供应商请求。当前成员 3 笔 settled / 66 Credit（A、标题、C），另一成员两笔基线逐行保持。                                                                              |
| 归档单任务删除   | 原 UI 归档、删除取消、删除确认、reload；tasks-index 的 archived/deleted 依次为 0/0、1/0、1/0、1/1、1/1。保留的 CLI 四条消息及 parts 摘要不变；全部阶段请求、账本逐字不变。                                                                                          |
| 取消按钮按 Enter | 修复前 v4 已确认焦点为「取消」BUTTON，但 Enter 触发删除，实际失败。`ConfirmDialogHost` 原 window capture 仅对带复选框弹框尊重控件焦点；移除此限制，普通弹框也保留原按钮语义。v8/v9 真实键盘取消、后续鼠标确认及 reload 均通过。                                     |
| 关闭时主帧退休   | v3 等真实退出日志出现 `Render frame was disposed before WebFrameMain could be accessed`。`databaseStartupRelay` 增加当前主帧 destroyed/detached 准入，仍保存最新 Host 状态。源码两项 RED→3 项 GREEN；含关联窗口回归共13项通过；v9 原完整 UI 运行和退出中该错误为0。 |

最终具名结果：[v9](../evidence/client-native-prepublish-v9-20261021/result.json)、[逐状态与资源复核](../evidence/prepublish-integration-20261021/final-ui-verification.json)。原实例自然 exit 0，四个自有端口均已拒连，专属测试数据根已移除，browser-harness 自有 daemon/socket 已关闭。正常本机后端恢复在 127.0.0.1:3000，health 实测正常；没有修改主库人员配置、调用主库真实模型或发送企微消息。

v2 的失败来自测试选择器将「取消 + esc」整体当按钮文字；v5/v7 是 browser-harness 5 秒 IPC 超时；v6 的 Enter 驱动缺少原生字符文本。均保留原失败。驱动随后使用完整原生 Enter 输入，将工具传输等待显式设为15秒，仍保留原35秒子进程和240秒总预算，不重试可能已生效的输入，不修改产品等待或业务断言。v4 的产品误删失败与这些设施失败分列。

## 本轮门禁

| 命令/组                      |    通过数 |
| ---------------------------- | --------: |
| 后端 `npm test`              |       306 |
| 客户端 enterprise-policy     | 225 + 316 |
| enterprise-workflow          |        22 |
| enterprise-provider-settings |        21 |
| enterprise-gateway-catalog   |     9 + 6 |
| enterprise-sharing           |    44 + 5 |
| enterprise-console           |         9 |
| enterprise-assets            |        43 |
| 新状态中继及关联窗口回归     |        13 |

这些命令存在重复覆盖，不相加称为独立功能数。前后端默认类型检查通过，Lint 为后端无错误、客户端114条既有警告/0错误；架构0违例，改动文件格式检查通过。正常未打包 Desktop bundle 构建通过；未生成或发布安装包。

## 真实企微

本轮 gettoken 成功，但 department/list 和 agent/get 返回60020（可信 IP 拒绝），与旧日期的成功证据不能混为当前通过。在主库备份副本执行真实同步，确认502及可信IP指引、失败无身份数据变动，主库保持原样、副本已清除。正常后台的配置匹配、原授权 URL/state、pending claim、取消、取消后拒领、logout及旧会话401均通过。

当前浏览器已有企微管理会话的可见应用列表不包含配置中的应用（AgentId 1000077）；未修改其中其他应用。此前 OAuth 浏览器 URL 曾被自动操作策略拒绝，本轮未换工具绕过；真实授权回调、成员会话及前端企微登录尚未通过。证据：`client-real-wecom-readonly-v5-20261020`、`client-real-wecom-live-config-v4-20261020`、`client-real-wecom-sync-clone-v3-20261020`（目录沿用原脚本日期约束，实际执行日期2026-10-21）。

## 保持开放的工作

- Desktop Main 独立 `tsc -p packages/desktop/tsconfig.main.json --noEmit` 实际发现83条错误，涉及24个文件；默认根 typecheck 未包含 Main。原日志保留；保留当前工作树，仅在编译器内存中替换本轮 relay 修改前源码的同配置对照为83→83、新增0。下一步按同一基线逐类修复，不能把默认门禁通过当整个源码检查通过。
- 真实关闭仍有 tasks-index 退订晚于协议销毁的警告。源码已定位：syncer 的 `disposeAll()` 发起异步退订但不等待，adapter 随后销毁 Agent。需要补充退订完成/迟到 ACK/幂等关闭回归，再修复所有者顺序；不能仅降日志等级。
- 真实企微可信IP、受策略限制的OAuth成功链路仍开放；旧受拒远程Provider路径不绕过。不存在产品消费者的云/移动能力不伪造为通过。
- 旧打包平台未完成项已移出本轮验收，历史记录保留。整个自动测试目标仍 active，未宣称全覆盖。

复跑本轮原 UI：从后端仓库根用全新 `client-native-prepublish-v数字-20261021` profile，运行 `PREPUBLISH_KEYBOARD_CANCEL=1 python3 scripts/tests/prepublish-ui-probe.py <profile>`。当前固定 Node24 与原测试 Electron 沿用已有本机夹具；原页面、生产状态所有者和数据库未替换。
