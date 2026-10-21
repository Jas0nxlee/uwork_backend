# 编译发布前联动测试进展

> 最新[计划忽略停轮与后续恢复](prepublish-plan-decline-test-2026-10-21.md)：v55原忽略后保持计划状态/无自行改写/无文件；原新用户输入才重启审批，批准B写入，旧拒绝与其他成员保持，最终5笔110Credit。v54夹具识别system-reminder失败保留，未改产品；两轮资源独立闭合。

> 本批最终环境核对：常用3000端口无进程，按原.env启动源码后端后health 200/status ok；没有修改配置/主库或把此现象认定为产品根因。隔离测试进程仍全部关闭，常用后端保留运行。见[恢复收据](../evidence/prepublish-continuation-20261021/local-backend-restored.json)。

> 最新[计划审批与详情](prepublish-plan-approval-test-2026-10-21.md)：v52反馈成为真实steer、修订B原默认批准、实际文件与5笔110Credit具名通过；整体在折叠工作组定位处failed保留。v53仅以最小前置补原工作组/计划卡/侧栏/完成刷新，4笔88Credit通过，未重跑反馈阶段。四轮资源独立闭合，无产品新缺陷；纯计划忽略停turn仍另验。

> 最新[问答忽略与同任务恢复](prepublish-question-dismiss-test-2026-10-21.md)：v49原decline正确入模/CLI error，刷新零重放，同任务新问题可正常回答；5笔110Credit，另一成员保持、资源独立闭合。未重复旧多题/冷启，无产品新缺陷。

> 最新[原结构化问答](prepublish-question-test-2026-10-21.md)：v44多题/中文自定义/待答刷新通过；v46真实发现答案正确入模但历史卡误显示未答，修复结构化摘要并保留旧原文后v47实时/刷新/Main与CLI冷恢复通过；v48空答案自动继续通过。新增12项回归及类型/Lint/架构/正常构建通过，五轮资源独立核对关闭。

> 最新[原审批消费者](prepublish-permission-consumers-test-2026-10-21.md)：v39拒绝一次/后续恢复、v40中文多行反馈、v43项目精确路径授权/真实Main与CLI冷恢复/跨文件仍询问全部通过。原始请求、完整账本、规则和实际Primary PID独立核对；本轮无产品代码变更。

> 最新[文件回滚与冲突恢复](prepublish-edit-file-rewind-test-2026-10-21.md)：v34组合回滚、v35仅重置对话通过；v37真实发现独立文件撤销把accepted误当applied成功，修复后v38完整复测通过。新7回归/3缓存合同、含Main类型、Lint0错误和架构0违例通过；原运行资源全清理。

> 最新[历史编辑→分支→真实后继消费](prepublish-history-edit-fork-test-2026-10-21.md)v33通过：13原动作、4笔88Credit，取消/fork/reload零新增，真实子上下文排除旧分支、继承编辑后问答，另一成员完整账本保持，4端口/进程/根闭合。未重跑旧队列/批删流程；独立文件回滚编辑仍另验。

> 最新[原终端凭据签发及消费](prepublish-admin-device-test-2026-10-21.md)v35通过；[原管理端console门禁](prepublish-admin-console-test-2026-10-21.md)由v36已通过1440/768阶段和v39独立320阶段证明，25页面/11标签每宽度0异常，未重复旧写流程。旧退出退订/Main类型问题经当前源码与历史原始结果核实已修复，不再复跑；下项为原消息编辑重跑后的分支继承和实际后继调用。

> 最新新增见[角色动态权限与320/768视口](prepublish-admin-role-viewport-test-2026-10-21.md)：v32同一原会话角色降级/只读/允许写入/成员无管理消费者通过；v33窄屏原操作通过，v34只补稳定截图。未将HTTP成功替代未采集的console门禁；下一步补原终端凭据UI与console事件。

> 最新原页面CSV下载见[导出报告](prepublish-admin-export-test-2026-10-21.md)：v29实际下载5份筛选CSV，行数2/2/1/1/0，字段/审计/数据不变均通过；本轮企业改名显示问题已修复，新增凭据、分类、企业、观测与留存结果详见下列分项。

> 观测页和实际留存删除新增见[原始验证报告](prepublish-admin-telemetry-test-2026-10-21.md)：v28原按钮清理4类过期行各1，保留近期/其他企业/账本，原页面与3维聚合仍28Credit，重复清理0。

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

## 真实企微早期记录（后续正向已通过）

以下60020是早期失败记录。用户更新可信IP后，真实目录API/两次副本同步/原管理端和Vite页面均已通过，当前状态见[企微与批量删除报告](prepublish-sidebar-batch-and-wecom-2026-10-21.md)、[原管理页面报告](prepublish-real-wecom-admin-test-2026-10-21.md)。不得再把旧60020当当前IP未配置。

本轮 gettoken 成功，但 department/list 和 agent/get 返回60020（可信 IP 拒绝），与旧日期的成功证据不能混为当前通过。在主库备份副本执行真实同步，确认502及可信IP指引、失败无身份数据变动，主库保持原样、副本已清除。正常后台的配置匹配、原授权 URL/state、pending claim、取消、取消后拒领、logout及旧会话401均通过。

当前浏览器已有企微管理会话的可见应用列表不包含配置中的应用（AgentId 1000077）；未修改其中其他应用。此前 OAuth 浏览器 URL 曾被自动操作策略拒绝，本轮未换工具绕过；真实授权回调、成员会话及前端企微登录尚未通过。证据：`client-real-wecom-readonly-v5-20261020`、`client-real-wecom-live-config-v4-20261020`、`client-real-wecom-sync-clone-v3-20261020`（目录沿用原脚本日期约束，实际执行日期2026-10-21）。

## 当前未完成与已关闭旧项

- Main独立83条诊断已由`44371033`修复，默认typecheck已纳入Main；当时完整门禁通过，参见[续测报告](prepublish-integration-continuation-2026-10-21.md)。不把此旧失败重新标为当前阻塞，也不为核对旧报告重跑已通过套件。
- tasks-index退订时序已由`5cab2ccb`修复；当前源码有disposeAllAndWait等待active/迟到ACK退订后再退休协议。原v11结果和feedback-and-cleanup-verification均passed，原告警0。不能沿用此前“仍有退订告警”的过期清单。
- 侧栏重命名/置顶/未读/检索及批量归档删除已在v15/v20通过，置顶重复行由`b52afcc8`修复；基础原assistant Fork已在v20作为合法准备验证，不重复此基础动作的独立验收。
- 原preserve消息编辑取消/确认重跑、从新回复分支并真实后继消费已由v33通过，见上述报告；独立workspace rewind、冲突fallback及文件摘要撤销现分别由v34/v35/v38完成，实际修复晚到冲突的UI误关窗；它们各有单独证据，不由preserve通过推断。按用户范围不重开多系统安装包验收。
- 真实企微OAuth成功→成员身份领取仍未验证，受拒页面/原远端综合探针不换工具绕过；这些路径不阻挡其他本地源码联动。外部MCP、网盘和发布后多系统客户端继续排除。
- 页面加载console门禁现已补25页面/11标签/3宽度；它不自动证明每个写操作的console或所有客户端能力。整个目标仍active。

复跑本轮原 UI：从后端仓库根用全新 `client-native-prepublish-v数字-20261021` profile，运行 `PREPUBLISH_KEYBOARD_CANCEL=1 python3 scripts/tests/prepublish-ui-probe.py <profile>`。当前固定 Node24 与原测试 Electron 沿用已有本机夹具；原页面、生产状态所有者和数据库未替换。
