# G04h 客户端空身份原生登录进展（未验收）

2026-10-18。v4 已实际执行到原登录输入、held/pending、唯一 callback、原私有 claim 成功和 guest 关闭；随后首次固定公开 UI 观察失败，Main 留下 `session_guard` 拒绝。**原 Native 身份完成提交与整条登录链路仍未验收，G04h、U02–U05 保持开放。**

本轮使用仓库内客户端副本、正常生产 Electron/Main/Host 和全新空身份 profile。只预配公开后端地址及应用配置，没有预种成员 email 会话、Token、Provider 或有效身份，也没有初始化模型请求。后台通过正常管理 API 建立普通成员、部门、席位、政策、模型和额度。外部身份兑换由受控替身完成；官方企微网页、二维码和扫码未加载，真实企微、外部 MCP、网盘继续排除。

## v4 的实际证据与停止边界

v4 冻结来源为 `2f056e59571c8448220b86d5e9947b1bfeff3112`，261 个来源逐项核对；使用已批准的 Desktop 候选，产品 source/out 未因本轮修改或重建。primary 测试入口已改为真正 `entry.mjs`，以顶层 await 等待原 adapter 和 Main；准备阶段只核对生成器字节，没有改写入口。该次运行不代表之后的源码状态。

| 环节                   | 实际结果及其范围                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全新空身份与基线       | 原 `experienceSnapshot` → facts → prepare 同一次执行通过；模型请求、ledger、Trace、Credit 均为 0。后台成员/席位/额度事实不等于 Native 已读取或显示。                                                                                                                                                 |
| 原 Main 与 renderer    | 实际 PID/PPID/birth、per-PID 四字段、cwd、独占 CDP 和唯一受信任 file renderer 均通过；没有用私有 bridge ready 代替 Main 就绪。                                                                                                                                                                       |
| 专用 Browser Harness   | 新私有目录、真实 PID 与 socket、严格 `/tmp`/`/private/tmp` 归属校验通过；仅已拥有 socket 从 0700 收紧至 0600。固定登录页投影为 `loginVisible=true`、`authenticated=false`。                                                                                                                          |
| 原工作区入口           | 在上述真实就绪之后仅调用一次原 `openWorkspace`；第二实例实际 exit 0、signal null、未超时，原 Main 当时仍在。                                                                                                                                                                                         |
| 原登录操作与 pending   | 原按钮物理输入一次；公开投影进入 waiting。原 SSO 出口被唯一守卫在 RAM 暂挂，之后观察到原 Host 私有 claim 的 pending；callback 前为 held=true、pendingObserved=true、callbackCount=0。                                                                                                                |
| 唯一 callback 与 claim | 同次执行及时发送一次无参原 `completePrimaryLogin`，原命令完成。安全状态为 callbackCount=1、callbackSucceeded=true、successfulClaim=true、guestClosed=true。没有注入身份或替代原 Host claim。guest 关闭事件本身不证明身份已完成提交。                                                                 |
| 首次失败               | callback 后首次固定公开 UI `observe` 包装实际 exit 1；Main 的固定拒绝码为 `session_guard`。cleanup 前安全状态仍为 publicAuthenticated=false、guardSatisfied=false，且该次读取的 hold failed=null、adapter.failed=false。拒绝文件与未单独记录采样时间的状态读取不强行推断严格先后，见原公开顺序记录。 |

本轮未证明生产加密 session commit，也没有读取加密值、身份表、Cookie、proof、Token 或原始 Electron/BH 日志。`successfulClaim`、guest 关闭、组件合同和公开身份完成是不同的验收边界，不能互相替代。`session_guard` 只确定失败边界，尚未确认具体产品根因。

工作区入口的通过仅指原第二实例正常退出、原 Main 仍在。登录输入前的固定 UI 投影仍为 composerVisible=false、presentationReady=false，尚未证明工作区界面完成加载；后续诊断须继续区分入口投递与页面就绪。

首次失败后未再点击、登录、callback 或发送，没有业务重试。未执行原 UI 的已认证配置、模型列表、普通成员权限、本人额度/用量核对，也未执行主/标题模型请求、后台 Key 匹配和本人账本归属、同 profile 认证冷恢复、原退出、旧任务拒发或再次冷启保持退出。现场 supplier chat/models/rejected 均为 0、ledger rows 为 0；这些是未发送的结果，不能称模型 provider 或后台转发链路通过。

## v1–v4 各自停在哪一层

以下失败来自不同新 profile，原记录分别保留；没有在失败 profile 上重做业务，也不把测试入口或驱动问题直接记为产品登录缺陷。

| 运行 | 首次失败及未到达环节                                                                                                                                                                                        | 公开依据                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1   | baseline/prepare 通过后，原 `openWorkspace` 失败；当时尚无真实 Main/renderer 就绪前置，原 secondary 的完整 exit 详情未恢复。未进入 BH 登录、callback 或发送，不能补写 exit 原因。                           | [Root 独核收据](../evidence/client-sharing-followup-root-review-20261018/primary-v1-public-evidence-independent.json)，25 份公开文件。                                                                         |
| v2   | 实际 Main/file renderer 后，owned BH 的 cwd 将声明 `/tmp` 与系统 `/private/tmp` 写法直接比较而拒绝；未执行 preworkspace DOM、workspace、登录、callback 或发送。                                             | [Root 独核收据](../evidence/client-sharing-followup-root-review-20261018/primary-v2-public-evidence-independent.json)，33 份公开文件。                                                                         |
| v3   | 实际 Main、owned BH/socket 和 preworkspace 固定 DOM 通过；原 workspace 第二实例 exit 70，固定拒绝码 `main_import`，原 Main 仍在。未开始登录、callback 或模型。                                              | [封存](../evidence/client-native-primary-login-v3-20261018/manifest.json)及 [Root 独核](../evidence/client-sharing-followup-root-review-20261018/primary-v3-public-evidence-independent.json)，43 份公开文件。 |
| v4   | 原 workspace exit 0；已到原登录、pending、唯一 callback、claim 和 guest 关闭，停在首次 post-callback 固定 UI 观察及 `session_guard` 边界。公开 authenticated/存储提交未证，后续模型、额度、退出与冷启未验。 | [结果](../evidence/client-native-primary-login-v4-20261018/result.json)、[有限公开顺序](../evidence/client-native-primary-login-v4-20261018/failure-public-order.json)及下述 56 文件封存。                     |

v3 之后的独立微型 [入口时序探针](../evidence/client-native-primary-entry-timing-probe-20261018/result.json)只加载正式 adapter 和实际进程内协议 API：旧 CJS 在 API 前 app 已 ready，注册失败并 exit 70；顶层 await 的 ESM 在 ready 前注册成功、之后 ready、exit 0。它支持修复测试入口的时序机制，不直接确认 v3 的完整 production import 根因。v4 实际 workspace 成功是独立运行结果。49 项 Node 有限合同、ESM 探针和 [G04g 的 25 项 React 合同](client-enterprise-login-polling-test-2026-10-18.md)均不与本机完整 Native 登录验收相加。

## 收口与公开封存独核

v4 首错后先执行原 `stopNative`，实际 Main exit 为 code=null、signal=SIGKILL；BH 原工具 exit 0。Common 由 Root 独核精确 PID/PPID/birth/cwd、DB fd22/access u、三个监听及 children=0 后唯一 SIGKILL，原 PTY 工具实际 exit 1。四个已知 PID、四个 owned port、声明及规范 BH socket 均已关闭，所有自有工具句柄终态。总耗时 511,266ms。私有根 0700 保留，handoff 后未读/stat；未知写句柄只作聚合，不查持有者身份或发信号。

本次文档收尾独立读取 v4 manifest 列出的 **56/56 份公开普通文件**，逐项 SHA-256 与大小均匹配，总计 **2,021,795 字节**；固定 result 的 nativePrimaryAccepted/wholeFlowCompleted 均为 false，terminal 的 allOwnedHandlesTerminal=true、retainedRootReadAfterHandoff=false。独核只涉及公开 EV，没有读取或 stat 任何 R，也没有启动 Runtime。

| 公开文件                                                                                                           | 独核 SHA-256                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [manifest.json](../evidence/client-native-primary-login-v4-20261018/manifest.json)                                 | `c0b3dfa1374980b12cd0a73b0f7d3662e542098dd0b9a430a47f36d30729205f` |
| [result.json](../evidence/client-native-primary-login-v4-20261018/result.json)                                     | `d4beabaea35a9797c22098c16d574cf98d9f9f7a0fff727599420e9fd8be15d4` |
| [owned-resources-terminal.json](../evidence/client-native-primary-login-v4-20261018/owned-resources-terminal.json) | `dc7f91dba4d46a922f95fb827e454b7119313aaec92582624840525e95aee56c` |
| [failure-public-order.json](../evidence/client-native-primary-login-v4-20261018/failure-public-order.json)         | `06b57021338042f436699699c34189e61bf2d4630d0410922bc937d3372affd4` |

后续须以新的源码锁、独占新 profile 和单独授权继续 [完整联测合同](client-native-primary-login-spec-2026-10-18.md)。v4 冻结构建中的 Read 撤权 RED 仍未由本轮修复或复测。真实企微、真实外部模型 provider、远程/移动及跨平台发行不因本次进展完成。
