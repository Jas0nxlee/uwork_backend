# Mac 真实联动剩余切片独立审计

> 当前校正（2026-10-21）：本页后续保留历史审计叙述，出现“下一步／未运行”时应结合具名版本。最新以[有限消费者覆盖复核](client-macos-finite-consumer-coverage-audit-2026-10-21.md)及[进展顶部](client-macos-backend-consistency-progress-2026-10-21.md)为准：ARM v16 已有 topic 的 FSfalse6/6、FStrue6/6、原自动写回8/8均已真实通过并独审；v15 edit/fork、archive/unarchive 各8/8，不再待测。新增的原归档单条删除、忙碌 Composer 队列正在准备。Quit 当前 v11 原菜单已发，AXRole -25204 后仍未确认／Cancel／Allow；v12 私有消息子预算反事实变体已通过独立准备审查。x64 v17 缺必需 helper 为严格 NoGo。Windows 已取消、Linux不新增，整体未完成。


2026-10-21最新收口：**ARM64 v13原7项与独立31项通过；v12完成任务强杀恢复后新执行9/Root30/peer32、单件PDF分享7/Root27/独核15均已通过。** 它们不再列为next/pending。v10五个深入一致性边界保留各自具名来源，不能冒称全部在最新包重新执行。完整状态见[ARM64矩阵](client-macos-arm64-backend-consistency-matrix-2026-10-20.md)。

最新x64 v14本次在原30秒期限内于**29.894秒**选中原file renderer，随后`Owned AX attribute failed`，结果仍**FAILED0/7**，未到BH、原副实例或业务。旧v9/v11的30秒失败保留；新一次前置成功不证明所有冷启性能已修复。[v9/v10只读诊断](client-macos-x64-architecture-ax-diagnostic-test-2026-10-21.md)随后确认AXWindows唯一元素与应用根CFEqual=true，未获可验证真实窗口；无AX动作、双方全行账务零增，原七项继续开放。原 ActiveQuit 尚未验收。此前 `screenLocked=true` 与无法置前是旧观察；新三键读回锁屏键缺失仍不证明已解锁。最新 v15 v7 已真实 readback foreground=true 并发送原菜单动作，失败准确定位到 AX candidates 的 depth/seen 上限，尚未调用确认选择器或 Cancel AXPress；不是已证产品退出故障，不把 finally 清理取消当 Allow 结果。

本页只读核对源码入口、报告与实际结果并整理文档，没有App、GUI、HTTP、VM、构建或产品改动。Mac为唯一继续验收平台、Windows已由用户取消、Linux不新增；外部MCP/网盘和受拒SSO/远程Provider边界保持。

## 此前优先切片已完成的边界

| 此前排序                      | 现有真实结果                                                                                                                                                                                                                                                                                                                                                    | 不外推的范围                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1：已完成任务强杀恢复后新执行 | [v12 consistency-v5](client-macos-crash-task-consistency-test-2026-10-21.md)：原7加两项共9/Root30/peer32；Main真实SIGKILL、旧Host/CLI/PTY全部消失且无补杀；同profile原UI恢复同task/消息/模型/workspace语义，raw/supplier及双成员全行零重放；原UI新task新增主/标题两笔44，旧行和另一成员不变                                                                     | v2/v3设施失败与v4仅强杀观察仍各自保留。不是在途任务强杀、原应用菜单Quit或所有平台恢复                                                                                                                               |
| 2：原菜单活动任务Quit         | [ActiveQuit v1–v4](client-macos-active-quit-consistency-test-2026-10-21.md)均未形成Quit/Cancel/Allow验收；v4约4.9秒40个直接样本frontmost=false，随后只读公开会话布尔核锁屏                                                                                                                                                                                      | 真实第五请求hold和测试finally取消不算原菜单退出效果；没有发原菜单动作，不推断产品退出屏障故障                                                                                                                       |
| 3：Native实际分享一件文件制品 | [v12 PDF分享](client-macos-native-share-artifact-test-2026-10-21.md)：7/Root27/[独核15](../evidence/client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021/agent-independent-verdict.json)，原xterm写合法606B一页PDF→原Composer真实引用/可见卡→原Share UI上传；源/上传/撤销前真实BLOB/授权HTTPS下载同SHA；分享前后raw/supplier与双成员账务全行不变 | 只验一个原支持类型，不是PNG或全部附件组合。Host内部FormData最终经managed通道为content_base64 JSON，不称实际HTTP multipart。原DELETE清理，不冒称原UI撤销入口；撤销后BLOB/confirmed_json已清，不补造事后选轮/字节读取 |
| 最新正常包基线与ASAR修复      | [ARM v13原7](../evidence/client-native-packaged-macos-clock-arm64-asar-integrity-v1-20261021/result.json)/[31项独核](../evidence/client-native-packaged-macos-clock-arm64-asar-integrity-v1-20261021/agent-independent-verdict.json)；实际最终header=Info声明、原fuse不变、真实CLI/PTY/cwd/本人2/44、撤seat零增/logoutcold均成立                                | 本例另一成员仅原聚合before与最终记录，不能补成full-row before；v12 crash/Share有各自完整行基线                                                                                                                      |

## 当前有限剩余差距

| 差距                                | 已有产品入口/证据                                                                                                  | 当前可执行性与必要成功证明                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原应用菜单活动任务Quit Cancel/Allow | 原`role:quit`、`shouldConfirmAppQuit`、`confirmAppQuit`、`before-quit`、`prepareAppQuit`；已准备exact-owned AX设施 | 新 v15 v7 原菜单已成功，后续受候选 collector 的深度/节点数断言挡住。正准备仅有界只读诊断；Cancel 后同 task/stream、Allow 屏障和账务仍未验收，不放宽上限/时钟或用 finally SIGTERM 代替 |
| x64完整原7与架构提示之后的联动      | v14实际30秒目标已选中；旧v11独立诊断已证原1c/10秒拒锁自然退出                                                      | 本次被owned AX属性失败挡住，缺同次BH/真实副实例工作区消费/CLI/PTY/业务/撤权/退出证据。先准确定位原AX可达性，不凭缺属性推产品原因；不自动重试或延30/10秒。Rosetta结果不代替物理Intel  |
| 同成员disabled→active后的原UI新认证 | 后端禁用删除session、恢复不重建session；Host/service恢复已验                                                       | 正常signed包缺合法可达local IdP epoch，受拒SSO不能绕过。须旧token仍401、原UI合法新session/newowner同步后新task正常计费、旧数据与另一成员保持；不手写store/重置hold/替认证owner       |
| Mac regular-file Read-await中撤权   | 原Read工具与动态准入存在；Linux/Host别例不能拼作Mac实测                                                            | 尚无能证明本机真实regular-file OS await的安全可移植barrier，不以模拟Promise/其它OS lease声称关闭。明确该前置后才可验证撤权后正文扣留及零新增副作用                                   |

此前只围绕上述有限边界得出的“未发现另一项可直接执行薄切片”范围不足。扩展到原设置消费者后发现 **Native Memory开关→新任务上下文→真实主模型请求与计费**。正常v13 `memory-v2` 现已实际8项/33.263秒通过：原UI同项目off→on→off三新任务，原始主请求连续记忆片段0/1/0、标题独分，current8/176与other全行2/44、原撤seat/logoutcold保持；34B原xterm文件与目录scope/count1吻合，21PID/4TCP/OS收口，89源稳定。v1设施缺hashlib真实FAIL5保留，实际片段RED/GREEN修复后才运行v2。[Root独核](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/root-verdict.json) · [独立19项](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/linux-sandbox-independent-verdict.json)。

这不等于自动提取已经验收。当前下一可执行边界是原自然extraction发出模型请求→原Write写回新index/topic、拒绝memoryRoot外的本case文件→另一原UI新任务消费index；仅准备独立新切片，不修改已冻结89源。目录UI不显示正文，不虚构preview；未触用户或Codex记忆。[原入口12份来源](../evidence/client-macos-goal-continuation-audit-20261021/memory-entry-discovery.json)。

这仍不是全部产品功能的穷举证明。已完成的crash和PDF不再重开；不为补数量扩成全部文件类型、全部热迁移/权限笛卡尔积，或创造客户端未支持的UI/RPC。新的实际用例仍须精确scope、artifact/依赖冻结和独占资源安排。

## 保留而不重演的旧覆盖

普通对话Stop已有[Native实测](client-live-test-2026-10-17.md)（等待上游后停止、账目uncertain）；额度拒绝/恢复已有[用户旅程](client-user-journey-test-2026-10-17.md)；自动化按钮暂停/恢复/删除已有G05e1；workflow取消、同run Resume、父结果送达已有[父通知报告](client-native-workflow-label-test-2026-10-17.md)。v10已登录同task冷恢复、same-ID tools往返、同挂载晚200、新401退休、自然TTL和installed-plugin Skill正文各自已具名接受。它们不因新ASAR/签名摘要变化自动失效，也不能拼成最新包所有组合全量验收。

v9/v11原30秒失败、修复前二实例10秒超时、CPU/secondary诊断与ASAR最初静态失败都保留其原报告；本页更新当前状态，不覆盖历史结果，也不从ASAR header正确推断AOT/首启耗时因果。

另有消费者边界：`IEnterpriseConsoleService.listAgents/listAssets/listRuns/createRun/readRun/cancelRun`有服务/HTTP合同，但当前UI未调用这些方法；`enterpriseMenuNavigation.ts`把agents导向自动化、assets导向插件商店。不能把后台API或菜单导航称为Native云Agent执行已支持，也不能造新UI探针来凑验收数量。未查到Native分享撤销消费者时，API清理不被追加为原UI撤销通过。

真实企微OAuth与Native远程选择器的既有操作策略拒绝不绕过。Windows联测已由用户取消；物理Intel、完整x64 Swift helper、生产CI/外部TLS与通知等另需真实资源，不伪造本地正例。原独立只读审计索引`evidence/client-macos-remaining-slices-audit-20261021/result.json`是历史来源；本页最新状态以顶部具名原result/独核为准，未新增任何运行。

## 本轮新确认的 Mac 可达缺口

用户已取消 Windows 联测，后续仅 Mac 验收。只读核源码及现有 v13 ASAR/CDF 后，另找到尚无具名真实 Native 动作证据的入口：消息原位编辑重跑、从 assistant 回复 fork 子会话、任务 archive/unarchive。前两项正准备可审规格和请求/账务观察器，后者保留待测；它们不同于新建任务、冷恢复、workflow Resume 或普通 Stop，不回写为已通过。当前仍优先完成 Memory filesystem 显式策略负例、修复和复测。

本轮上述三个新入口现均已有真实正常v15结果：消息edit/fork v3 8/8，task archive/unarchive v1 8/8；原失败与各Scope证据保留。自动提取的filesystem=false manifest描述读取又发现独立source/Runtime RED，正补Native后修复。原应用Quit的fresh v15准备因独审发现测试teardown预算耗尽可跳恢复而暂No-Go，正在仅改设施；未突破原AX前台守卫，也未取得该Quit验收。当前session三选键中screenLocked缺失，不当作已解锁或前台可用证明。


最新补充：正常 v15 的 Manifest 描述权限负例已实际 RED（16.694秒、显式 FSfalse、topic154B、noindex、非流式原请求泄露描述），修复与永久 Runtime33/完整企业策略541均通过并保存本地提交 d14eef85。正常 ARM64 v16 正在完整 CLI→stage→Desktop 构建及静态独核，false 拒绝/true 已有 topic 正控仍待该包真实执行。原 v2 462 源、实际原请求和失败已归档，不以源码 GREEN 代替 Native。
