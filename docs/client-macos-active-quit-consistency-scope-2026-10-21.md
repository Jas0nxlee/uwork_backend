# Mac 活动任务原应用 Quit 一致性：最小执行规格

当前 v4 仅准备、尚未运行。独立 `mac-native-active-quit-*` 薄设施已运行纯合同；历史 v1 在 App 前因 Python 名称遮蔽失败，v2 已到真实 held main/reservation，但在原菜单前被 AXFrontmost 守卫挡住，v3 原 setter return0 但立即读回 false，仍未到菜单；各例保留 FAILED 与完整资源收口，**未改产品，尚无本例 Quit/Cancel/Allow Native 验收**。目标是验证原应用菜单 Quit → 原取消保活 → 再次 Quit 并允许 → 原退出屏障与真实在途请求/账目收口。不是身份 logout、普通 Stop、SIGTERM、崩溃恢复或 `app.quit` RPC 的替代测试。采用当前正常 ARM64 v12、原 Agent cdf 和隔离真实后端，最终仍须 fresh plan、来源冻结、独审和 Root 单次 Go。

## 原能力与状态所有者

| 原实现                                     | 实际合同与本例约束                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktopApplicationMenu.ts`                | darwin 分支创建 `label: app.name` 的应用菜单，子项 `getAppLabel(appQuit)`、`role: "quit"`。`shared/src/desktopMenu.ts` 的精确文案是 `退出 {appName}` / `Quit {appName}`。名字由原 `nativeEnvironment()` 的 `ZCODE_DESKTOP_APPLICATION_NAME` 与 Main `app.setName(runtimeApplicationName)` 绑定；不能拿 CFBundleName、个人正在运行 App 或猜测坐标代替                |
| Main `shouldConfirmAppQuit/confirmAppQuit` | `ZCODE_ENV === "production" && getRunningAgentSessionCount()>0`。原同步 NSAlert message 为 `确认退出 UWork?` / `Quit UWork?`；detail 为 `正在进行的会话：N 个，退出后会被中断。` / `In-progress sessions: N. They will be interrupted after quitting.`；按钮严格 `退出/取消` 或 `Quit/Cancel`，defaultId=cancelId=1。N 须为实际正整数，不从 fixture 注入 Host count |
| 原 Host → Main 计数                        | Host 的 workspaceTaskTracker 与 untrackedPromptRpcCount 产生 runningTaskCount；`desktopHostProcess.ts` 维护 Main 既有 map。以原 safe log/真实 dialog 的正数及当前 task stop 状态交叉证明，不能直接写 map 或补一个假 RPC                                                                                                                                             |
| Main `before-quit`                         | 取消时 `preventDefault`、重置 explicitQuit，然后直接返回；未进入 `prepareAppQuit`。允许时原屏障接管：并行 flush/cron/remote/Host Dispose；再次退出不重复确认。普通主实例流程不得换成新增 `app.exit` 快捷口                                                                                                                                                          |
| 原退出策略                                 | macOS 普通与 strict policy 都是 Host forceKillDelay 7500ms、waitTimeout 9000ms；Main 在完成屏障后原 `exitPreparedApp` 收口。Host 的原 Dispose 流会关闭 model relay、Agent/服务与 PTY。内部 fallback 若实际发生需如实记录，不叫全部“自然 exit0”                                                                                                                      |
| 后端原 Gateway/ledger                      | 客户端断连使原 AbortController abort；已派发且无确定上游 4xx 的请求按原合同 `uncertain`，amount=reserved；未完成 gateway_call result 为空，Trace failed/CANCELLED。取消不是退款、不是 supplier 未执行，也不是零新增账本                                                                                                                                             |

## 安全触发真正菜单，不绕入口

现有 `scripts/tests/macos-ax-driver.py` 提供 `AXUIElementCreateApplication`、属性读取、action_names 和元素级 perform；它没有“读取菜单就是执行菜单”的副作用，也没有现成的活动 Quit 业务入口。本例可以仅以其原 AX primitives 准备一个**专用**有限动作，不调用 `system_wide`、全局按键、盲点或个人 App。

1. 从本 case 原 launch handle/manifest 取得唯一 Main PID、birth、exact frozen executable；前后以 kernel txt mapping/birth、fixture generation 复核，已有相同 PID 号不够。仅绑定该 `AXUIElementCreateApplication(pid)`，要求 AXGetPid 一致、既有 Accessibility trusted；不发授权 prompt。Root 已明确授权为原菜单操作将本轮应用置前：先检查该 exact ref 的 AXFrontmost，若为 false，要求 `AXUIElementIsAttributeSettable` 成功且可设，只对该 ref 用 `AXUIElementSetAttributeValue(AXFrontmost,kCFBooleanTrue)` 一次；前后核身份和共同期限；设置后仅在同一原 5 秒期限内对同一 ref 只读轮询 AXFrontmost，每次先核身份和期限，直到 true 才进入菜单。不进行第二次设置；永久 false 到期则失败。成功和失败都保留本 App 的 pid、wasFrontmost、setCode 与有界 readbackSamples，异常收据写入失败不得替换原异常。不枚举、读取或激活其他 App；属性不可设/失败/读回 false 均停止，不 fallback NSRunningApplication、全局键或反复激活。
2. 读取该 Application 的 `AXMenuBar`；在其内唯一匹配 **app.name** 的 `AXMenuBarItem`。只执行它实际声明支持的元素级开菜单动作（`AXPress`，或明确列出的 `AXShowMenu`），再从该子菜单取唯一 enabled `AXMenuItem`，标题必须精确为原 `退出 {appName}` 或 `Quit {appName}`。记录同一 AX ref/角色/标题/父链/动作，不用 shortcut 字母 Q 单独定位。
3. 对该唯一 Quit item 发**一次**原 AXPress。这才是用户菜单触发，不得由 BH `Runtime.evaluate` 调平台隐藏方法、不直接发 Platform IPC/执行桌面命令、不从 fixture 调 `app.quit`。BH 仅用于之前的原 Composer 输入和取消后的只读 task 观察。
4. 原确认是同步 NSAlert，菜单 AX action 可能在 modal 打开期间尚未返回；准备时须有单次有界 action 调用/收据与独立只读同 PID dialog 观察，不以 action timeout 重发 Quit。只有精确原 dialog 出现才进入取消步骤；若菜单属性/动作不可用或未出现原确认，保留实际状态并停止，不能回退全局 Cmd+Q/模拟 IPC。后续实现应以纯 AX mock 覆盖“action 未返回但已出现 modal”的一次性规则。
5. 仅在同 PID 的唯一原 AXSheet/AXDialog 容器内，同时匹配完整 message、detail 正数 N 与两唯一按钮、frame/动作/所属 PID 后按原“取消” AXPress；刷新同 ref/frame，回调前后均检查共同期限与身份。macOS 的 `message_box_mac.mm` 明确忽略 `dialog.title`，不得强求标题可见；显式出现的冲突确认标题仍拒绝，父窗口标题不是确认标题。
6. 第二次原菜单动作与原确认匹配规则相同，只对该原确认的“退出”按一次。**允许后的期待是原 PID 退出，不能沿架构取消 helper 那样强求 action 后 Main 必须仍存活**；以原 child exit handle 与 kernel 消失收据确认，不在 closed AX ref 上重试。

原源码中菜单与确认入口均真实存在，故不是“无产品入口”。但当前没有本例的实际 AXMenuBar 树，尚不能宣称目标 ref/action 已可操作；prepare 必须先写严守卫合同，单次运行若观察不到就停止。原架构 dismiss helper 只能参考 ownership/full-text/deadline 做法，不能改文案或按钮参数后把它变成任意弹窗点击器。

## 一次最小链路

| 阶段           | 原动作和需要保存的证据                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基线           | 同当前包与 fresh profile，完成一条普通 task 并等真实标题稳定；原 UI/taskId/model/workspace 与实际 CLI cwd 一致。当前两 settled/44 Credit、24/20 tokens；另一成员 seed 两笔44单列，保存完整行。可先通过原 terminal UI 保留一个明确 PID/birth/TTY/cwd 的 shell，用于本例退出资源证明；不重复整套七项                                                                                    |
| 固定在途       | **同一已完成标题的 task** 发第二轮唯一 marker（`MACOS_ACTIVE_QUIT_HOLD_20261021`）。供应商仅匹配 stream=true、原 system cwd、controlled upstream model、该 marker 的唯一主请求。原 title generation 已 attempted/turnNumber>0；若出现额外 title/其他请求应失败记录，不静默归入 hold。供应商真实收完请求并发 SSE 200 headers 后 hold，**不发任何 SSE 内容、usage、DONE 或成功终态**    |
| 已派发证明     | 原 UI v4-stop 可见、原 Main Host runningTaskCount>0、真实 supplier 收到且未 close、后台同 actor/model 唯一新 reservation 与 gateway_call 存在，保存 request_key 摘要及 reservation ID/数额。此时当前旧 settled 行不变，新行 reserved；不能仅以界面“忙”推断模型已派发                                                                                                                  |
| 原 Quit → 取消 | 用上述原菜单与精确 dialog 取消。两个直接只读样本须证明同 Main/birth、原 Host/CLI/task 仍活、stop 仍在、同 supplier hold 未 close、不多发模型请求；后台新 reservation 仍原 ID/reserved/amount0、无新 Trace，旧账本与其他成员全行保持。不要靠额外发送一句“还活着”证明                                                                                                                   |
| 原 Quit → 允许 | 保持**同一个 hold 请求**，再次原菜单和确认“退出”。记录允许动作单调时刻、原 Main before-quit/Host Dispose/屏障结束日志、Host/CLI/PTY 身份与退出收据，真实 Gateway→supplier close/abort、未 finish/未送终态。先观察正常原退出；测试控制器不能先 stopNative/TERM/KILL 帮它通过                                                                                                           |
| 最终后端       | backend/fixture 继续存活只读取证：raw/supplier 相对基线**恰各+1**，无重试/自动标题/后继；当前只新增同一个 `uncertain` ledger，amount 精确等于 held 时 reserved，不硬编码22或44。原未发 usage 的路径 token 为0/0、failed/CANCELLED Trace 一条、gateway_call result 仍空；按真实 schema 核字段。所有旧行和他人 ledger/Trace/gateway 全行不变。Trace 无 request_key 外键，不造逐请求关联 |
| 正常收口       | Main 原 child 应 exit0/null，无测试方 kill；若原内部 Host kill fallback发生，单列实际信号与政策，不等同测试方干预。核全部已知 Main/Host/CLI/PTY PID/birth 关闭、CDP/BH 与私有 socket 闭；再正常关闭隔离后端/供应商与原 OS protocol guard。不是身份 logout：不发 `/api/auth/logout` 来驱动取消                                                                                         |

固定 hold 与 Gateway 用量 hold 不是同一接口。本例是真实 model data plane：当前 `safeRequest` 默认总预算120000ms/headers<=30000，model relay 300000ms；普通控制面10s以及用量20s不拿来覆盖它。只改测试供应商的自有 barrier，**不改产品 timeout**：建议该 barrier watchdog45s，发 headers 防止原30s headers期限成为混淆；watchdog只作失败/中断收尾，不可释放成功响应。允许 Quit 必须在仍有至少15s观察余量时触发；若 hold先超时/被其他原因关闭，整例失败，不拿其账目当退出效果。

建议 case 总预算180s，工作截止为总期限前20s；两个菜单/确认分别用共同有界动作阶段（各<=5s，而不是每次属性再加5s），允许后原退出等待<=15s并受剩余截止约束。每个外部 guard/ps/lsof/AX IPC都受剩余预算；到期先失败、保留原 outcome，再仅对精确自有资源做失败清理。阶段预算不足不启动依赖动作，不延迟原产品屏障或重试菜单求绿。

## 复用与不应冒认的现有证据

- `macos-clock-probe.py`：只复用 owned runtime、onboarding、workspace、Composer/terminal 与原 live CLI mapping，不能将其 group stop 当原菜单 Quit。
- `mac-arm64-cold-consistency-probe.py` 的稳定已完成 task/DB FD 绑定、`mac-arm64-model-capability-probe.py` 的任务/模型/当前 pane 判据可用于前置，不复用其旧 whole-case计数断言。
- `mac-backend-stage-snapshot.mjs`、`mac-cold-ingress-observer.mjs`：阶段完整后台事实与 raw inference POST；不能仅比汇总或用 `request_key` 伪造 Trace FK。
- `client-native-session-relay-smoke.ts` 已有实际 CLI stop 在 pending open/read 下使 Host/Gateway/supplier关闭、uncertain不退款；`client-native-session-fixture.ts` 有真实 close/时间取证。复用其取消 oracle，不把 stdio Stop 正例当 Native 菜单 Quit 正例。
- `macos-confirmation-probe.py` 的 child-sheet 独立容器/精确 AXPress、`macos-architecture-warning-dismiss.py` 的逐元素 PID、完整文本、三处回调后 deadline 核对可作薄设施参考；原文件均不改。既有 helper 本身不证明新菜单已走通。

仅在原菜单动作与原确认实际可达后才能运行业务阶段。任何 SIGTERM fallback、hold deadline、菜单误匹配、confirmation缺失或后台派发计数不符合，应分别保留失败；不提出产品修复结论。常驻后台、个人应用、真实企微、外部 MCP、网盘与 Linux/Windows 均不操作。源码/具名证据摘要见 `evidence/client-macos-active-quit-scope-20261021/result.json`。
