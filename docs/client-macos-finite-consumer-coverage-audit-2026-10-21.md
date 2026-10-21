# Mac 原 UI 消费者有限覆盖复核

本轮只读当前仓库 `clients/uwork`、具名结果与报告，没有 App、AX、HTTP、构建、数据库连接、新测试或运行源改动。当前源为 `d14eef85`。Mac 是唯一继续平台；Windows 已取消，Linux 不新增，外部 MCP／网盘及既有受拒认证不绕过。本表是有限消费者审计，不是全部界面／工具组合的穷举证明。

## 必须补的有限能力

| 排序 | 原可达消费者／当前缺口 | 最小实际证明与复用入口 |
| --- | --- | --- |
| 1，处理中 | **活动任务原菜单 Quit：Cancel 与 Allow**。Main `confirmAppQuit`／`before-quit`／`prepareAppQuit`，原应用菜单 `role:quit` | 最新 [v11 result](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v11-20261021/result.json) 是 FAILED5：已到真实第五主请求 hold，原菜单 action 成功，但 AXRole `-25204` 后未 Cancel、未 Allow。须同一请求取消后保活／账目不变，再允许原屏障退出并核真实取消、uncertain 原 reserved 金额及资源。沿当前已审 Quit 路线；不以 finally 终止或旧锁屏观察代证产品行为 |
| 2，处理中 | **完整 x64 包及客户端联动**，不是只有 Electron 启动或独立拒锁退出 | [v17 producer result](../evidence/client-macos-x64-memory-manifest-package-v17-20261021/result.json) 为 failed，四条正常命令 exit0 仍缺必需 x64 Swift helper；[实际前置失败](../evidence/client-macos-x64-memory-manifest-package-v17-20261021/swift-helper-build-precondition-failure.json) 保留。先完整资产严格验收，再同包原 UI／真实副实例消费／CLI／PTY／后端与退出；当前不能 Go，也不能用旧 optional-helper 例外称完整包通过 |
| 3，**新确认，可本机准备** | **归档任务删除后不复活**。`WorkspaceArchivedTasksFlatSection.tsx:279` 原单条确认调用 `zcodeTaskService.deleteTask`；`DeleteAllArchivedTasksButton.tsx:45` 原批量确认经 `archivedTaskDeletion.ts` 调 `deleteArchivedTasks`。Host 持久 `deleted` tombstone 与 UI `buildTaskListResultFromSessions.ts:183` 的负向 join 是独立于归档的消费者 | 只创建本 case 任务：原归档→删除 Cancel 保留→Confirm 消失→同 profile reload／冷启不被仍保留的 CLI session 重新列回。核 Host `deleted=1`、CLI 历史保持、另一自有未选任务不变、raw／supplier／双 actor 全账务零增。可复用 `mac-arm64-task-archive-probe.py`、固定 SELECT observer 与冷恢复入口；一次薄片包含单条和小批次即可，不扩全项目组合。[archive 报告](client-macos-native-task-archive-test-2026-10-21.md) **明确未验单条／批量删除**，不能复用其 8/8 关闭此项。它是 Native Host／本地持久层删除，不冒称后台云任务 DELETE |
| 4，**新确认，可本机准备** | **忙任务的原输入队列入队／移除／后续执行**。`ConversationComposer.tsx:1095` 读原 `inputRouting`；`followupModeSettings.ts:5` 默认 queue，原设置 `settingsPageHelpers.tsx:636` 可选择交互行为。`ConversationQueuePanel.tsx:251` 真按钮 `v4-queue-item-delete-ID`，`SessionPane.tsx:3186` 发原 `deleteQueueItem`，原 CLI 裁决队列与 drain | 最小同 task：受控在途 A→原 Composer 排队 B，证明仅队列出现、没有 B 的供应商／账目→原按钮移除 B→排队 C→供应商正常完成 A，原 drain 只执行 C。核 B marker 永不出现在实际主请求，C 正确 cwd／模型／同 session，A/C 各按真实 usage 结算、旧行与 other 保持。复用现 owned Composer／后台阶段快照和受控 supplier；不必同时追加 steer、抢占、重排、全部快捷键或所有 race。已查具名 Native 索引／报告未找到该消费者验收；资产 FIFO、workflow Resume、普通 Stop 和 edit/fork 均不是它 |

以上两项新缺口各对应独立持久状态机／执行语义，不是为了计数重复普通模型发送。没有发现需要把未被 UI 调用的云 API 增列为现成客户端功能：`enterpriseMenuNavigation.ts:12` 仍将 agents 导向自动化、assets 导向插件；`IEnterpriseConsoleService.listAgents/listAssets/listRuns/createRun/readRun/cancelRun` 当前无 UI 方法消费者，workflow 工具展示文案中的 `listRuns` 不构成云 Console API 调用。

## 已有具名证据，不应重开

| 证据归属 | 当前实际结论 |
| --- | --- |
| **ARM v16**：[FSfalse](../evidence/client-native-packaged-macos-clock-arm64-memory-manifest-fixed-denied-v2-20261021/result.json)、[已有 topic FStrue](../evidence/client-native-packaged-macos-clock-arm64-memory-manifest-allowed-v1-20261021/result.json)、[Auto](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v16-v2-20261021/result.json) | 实际 6/6、6/6、8/8，fixture0、cleanup=[]。前两项分别证明原 154B 已有 topic 描述拒绝外发／允许入原 builder sidecar；Auto 初始 manifest 为空，证明原提取、两 Write、root 外拒绝与新任务消费。**已有 topic 正控现已独立通过**；Auto 不能替代它。Native FSfalse 是观察窗口内未外发／无提取请求；listing/range-read=0 的因果证据归独立 Runtime，不虚构 Native 系统调用计数。详见[准确的当前修复报告](client-macos-native-memory-manifest-fix-test-2026-10-21.md) |
| **ARM v15**：[edit/fork v3](../evidence/client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021/result.json)、[archive v1](../evidence/client-native-packaged-macos-clock-arm64-task-archive-v1-20261021/result.json) | 各 8/8，分别已有真实有效分支／子会话后续执行、归档取消归档／reload 零重放；不再待测。不外推删除或普通输入队列 |
| **ARM v13／v12／v10** | v13 独立原7；v12 真 SIGKILL 后同 A 恢复、原新 B 正常计费 9/9，以及单件 PDF 原 UI 分享 7/7；v10 五个一致性边界（same-task 冷恢复、同 ID tools 往返、同挂载晚200、自然 TTL、已装 Skill 完整正文同 call-id）保留各自实际结果。不能拼成 v16 全量重演。v16 Auto8 内已执行的原基线与 seat/logout 尾段也只归该场景 |
| 历史 Native 设置／workflow／配额／Stop | 技能导入和策略三门、专家配置发布与暖冷恢复、workflow 取消／Resume／父通知、实际 Stop 的 uncertain 与额度拒绝／恢复已有具名历史报告。设置同步、自动化删除、资产写队列分别有自身消费者，不代证上表普通任务删除／输入队列 |

## 环境边界

- 同成员 disabled→active 后原 UI 新认证仍缺合法受控 IdP epoch；旧 token 失效／Host service 合同不替代 Native，不能重置 auth hold 或绕过受拒 SSO。
- Mac regular-file Read-await 中撤权仍缺可证明的本机 OS barrier；Mac lease 前置 EPERM、Linux lease 和受控 Runtime Promise 都不能补成 Mac Native await 正例。
- 物理 Intel 不由本机 Rosetta替代；x64 当前首先是严格包资源 NoGo，尚不能把后续运行失败归因于产品。正式签名／公证／发布不是此次本地 QA 结论。Windows 和 Linux 不再列当前必补项。

## 当前文书需校准，不能靠重复测试修正文书

1. `client-macos-remaining-capability-slices-audit-2026-10-21.md:29,47,50` 仍有“Auto 准备中／manifest 修复待跑／v16 正构建”，与 v16 三份 actual 及其独审冲突；45行消息／fork／归档待测也已被47行及具名结果关闭。Quit 当前为 v11 AXRole 原码失败，不再只有 v7 collector 上限事实。
2. `client-macos-arm64-backend-consistency-matrix-2026-10-20.md` 顶部“当前基线 v13”、Auto 准备中、当前锁屏阻断、Windows 缺入口等为历史状态。应分别标历史包证据、v16已执行场景、当前 v11 动作失败和 Windows 取消，不能从锁屏键缺失宣称已解锁。
3. `evidence/client-active-priority-20261020.json` 新 `memoryManifestFilesystemCandidate.nativeFalse/nativeOriginalAuto/existingTopicAllowNative` 与 `activeQuitCurrentState` 已记新事实；但 `packagedNativeGreenForManifest:false`、`normalV16Build`、`nextMacSlice`、`nextReachableMacSlices` 和 `WindowsPriorResourceFinding` 等旧字段仍相互冲突。应统一当前投影，不改历史 actual／旧 FAILED。`allMacComplete:false` 仍正确。

本轮未发现上述新修复报告把 Native 未外发误称 Native 零读，也未把 empty-manifest Auto 充作已有 topic 正控；主要问题是旧矩阵／priority 的增量附记没有统一。审计来源与已读实际结果摘要、SHA 见 `evidence/client-macos-finite-consumer-coverage-audit-20261021/result.json`。未修改聚合索引、冻结输入或产品。
