# 企业专家首次启动与自有配置 Native 最终联测

2026-10-17。已修复 Native 后台预热与首次 Agent 目录读取互相推进 selection revision 的问题，并在同版正式 Desktop 产物上完成首启、同 profile 冷启、企业专家及场景回归。旧 CAS 失败记录保留；本轮以供应商实际收到的父、子正文和后台账本验收，不从父模型回复推断专家成功。

## 修复与候选

同一 Host 的同一个资产 store 对整个 catalog 事务排 FIFO。原私有身份 scope 在等待后重新核验；取消先让调用方返回，内部事务仍按序退出。dispose 等待真实尾链。没有缓存允许结果、重试 CAS，或放宽不同 Host 的磁盘 CAS。实现和真实 RED/GREEN 见 [修复报告](client-assets-catalog-queue-test-2026-10-17.md)。

源码提交 `5efaae1`，CLI 与 staged CLI 均保持 `39175fd…d43c`；新 Main 为 `c3d27b…1a7b`、Host 为 `9afc1a…3a8d`。Root 统一执行 Desktop-only production 构建，未替换主后台管理页。全部 88 项候选源码、6 项产物，以及 6 项测试源码在 Native 前后 SHA 一致。[正式清单](../evidence/client-assets-catalog-queue-20261017/artifacts.json) 和 [Root 独立核验](../evidence/client-assets-catalog-queue-20261017/root-independent-native-proof.json) 保留精确值。

## 原生界面与实际请求

独占真实后台、SQLite、HTTPS、加密会话恢复及本机受控供应商；没有真实企微 OAuth 或付费模型调用。启动前经正式管理 API 发布 FS 权限、批准企业专家、桌面上下文和三组 scenes。同名个人 shadow 只放在本次独占 home，用于验证企业正文不会被覆盖。

| 阶段            | 实际父请求索引 | 批准专家 child 索引 | 新请求与新 settled 账本 |
| --------------- | -------------- | ------------------- | ----------------------- |
| 首启            | 2、4           | 3                   | 4 / 4                   |
| 同 profile 冷启 | 6、8           | 7                   | 4 / 4                   |

两轮真实输入均完成：父请求的 system 含 Desktop 段并提供 Agent tool；子请求包含批准正文 `NATIVE_APPROVED_ENTERPRISE_EXPERT_V1` 和实际 child prompt，且无 Desktop 段。全部请求无 personal shadow。Host 未出现 catalog 拒绝或 selection CAS 冲突，HTTP 没有 400 及以上响应。

原夹具另有 2 条 `other-user-test` 初始化请求；合计为 10 条实际正文、10 条 settled 账本，金额 220 为内部测试 Credit。不是 10 个业务用例，也不是外部供应商发票对账。Root 使用同一分析器独立重算两阶段，结果逐字段一致；分析器自身的 10 个用例覆盖缺 child、上下文泄漏和请求/账本缺漏等反例。

两代都在实际专家发送后进入自动化，定时模板可见；点击后标题、提示词、每工作日 09:00 均与发布值一致。通过面包屑返回取消，没有创建定时任务。回到新草稿点击推荐后填入准确普通提示词；未安装的 pluginStableId 没有插入 mention。既有 [SWR 完整回归](../evidence/client-native-scenes-fixed-20261017/summary.json) 的多次往返、V2 暖更新仍按其原候选单独保留。

## 验证与边界

新真实 TCP/磁盘/CLI 专项 9/9，原跨 Host 与崩溃专项 3/3，完整 Core 109/Host 288 通过。独立审查再运行新专项 9/9，并额外证明调用方取消后 dispose 仍等待内部真实尾链。Root 全量客户端 typecheck、Root/admin noEmit、配置范围 Root lint 均通过；客户端 lint 为 113 项既有 warning、0 error。[独审结果](../evidence/client-assets-catalog-queue-20261017/peer-review-Ry7H8O/review.json) 无 Required 项。

Root 一次手工扩大为 `eslint .` 的命令因遍历全仓库及过程目录超出堆内存，原日志保留；随后按 package.json 的准确 lint 范围执行并通过，未改代码或降低规则。Main 单独 noEmit 的既有 81 项诊断、CLI 标准命令缺 turbo 的限制继续保留，不据工作区检查冒称所有独立入口全绿。

本组是真实未打包 Electron，`isPackaged=false`。正式安装、系统 chooser、OS 外链、公开市场实际排序和不可达的 offPeak 旧入口不由本组替代。定时表单右下模型选择区存在文字视觉疑点，已保留暖、冷截图并单独核查；尚未按控件几何证实，不计作本组业务失败或已修复项。

17 个已知 PID 全部退出，4 个测试端口关闭，两代 BH 目录及独占根删除；Root 独立复查 PID、端口、107 项证据 SHA 及源/产物 SHA。见 [完整结果](../evidence/client-native-experts-config-final-20261017/summary.json) 和 [清理证明](../evidence/client-native-experts-config-final-20261017/peer-cleanup-proof.json)。主服务、主环境、主 Vault 和相邻客户端仓库没有参与测试；真实企微、外部 MCP 和网盘仍按用户要求排除。
