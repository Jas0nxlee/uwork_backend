# 企业本地附件正文消费：修复与验证（2026-10-19）

Core附件39项、相关Core合计89项，以及Shared/Host严格协议31项均通过，无skip。它们验证真实Runtime与受控I/O/授权端口；**Native G07e仍未验收，八轮均未执行原Send**，不能由这些合同或初始化模型调用代替。

## 安全修复与当前构建

原Composer附件不经过builtin Read，文本读取和媒体处理有独立出口。首18场景有14项真实RED。修复沿原权限端口加入固定内部消费者 `PromptAttachmentRead`，绑定session/workspace/port/managed owner，在读取和新正文交付前复验，媒体在派生artifact写入前复验；ordinary/steering使用原AbortSignal。inline按字段存在性识别，空字符串不再误读同名本机文件，unmanaged兼容保留。

后续真实双附件RED（37/38）与普通turn存储等待RED（38/39）也已修复：批末保留原proof并统一复验，任一拒绝则本批本机正文不释放；ordinary解析/记录移到共享上下文及timeline等待之后、紧邻同步history消费。原已接纳A历史与已派发artifact不承诺回滚。证据：[Core manifest](../evidence/client-attachment-consumption-core-20261019/manifest.json)、[Shared/Host manifest](../evidence/client-enterprise-attachment-host-fix-20261019/manifest.json)及[Root源码独核](../evidence/client-post-g04j-boundary-audit-20261019/attachment-source-independent.json)。

当前候选为 `a650d96961ef10c2473aeac0790cc229f9d16ba2`：五项标准门禁、五条正常构建命令及原控制器封存均exit0，7,339项来源稳定。Root最终完成六树metadata/完整零FD/逐文件SHA独核，较早不完整查询保留。见[正常构建manifest](../evidence/client-server-cli-esm-build-20261019/manifest.json)、[产物](../evidence/client-server-cli-esm-build-20261019/normal-artifacts.json)与[六树独核](../evidence/client-post-g04j-boundary-audit-20261019/normal-all-namespace-independent.json)。不据此声称旧Native/Web交互在此候选全部重跑。

历史 `f4928b42c76852fb8359f849ff5bd293281243e6` 的十条门禁/构建命令均0，但原控制器在核验阶段exit1，具体失败位置未保留、原因未定；随后单次独立只读seal实际exit0，没有重建或改写原终态。其[历史manifest](../evidence/client-attachment-consumption-build-20261019/manifest.json)与[Root产物独核](../evidence/client-post-g04j-boundary-audit-20261019/build-artifacts-independent.json)保留，旧opaque未读。

## Native八轮实际停止点

下表是运行器/观察证据，均非产品故障定论；所有轮次未到Send。v1–v8回执记录各自公开manifest SHA及独核范围，不用后续修正追认旧原因。

| 版本 | 已知停止点与证据边界                                                                                                                          | 公开回执                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1   | Common基线被拒。后续确认全局初始化2与当前成员0被错误比较并修正口径；首个失败子断言仍不能唯一还原。未启动Native/选择器。                       | [独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-first-attempt-public-independent.json)                                                                                                                                                                                                  |
| V2   | 原生启动/FirstRun后模型观察截止；观察器读不存在的`data-model`，实际属性为`data-model-current-value`。复合false不证明选模失败。                | [manifest](../evidence/client-native-attachment-consumption-v2-20261019/manifest.json)／[独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v2-public-independent.json)                                                                                                                     |
| V3   | FirstRun选择developer已claim，前一按钮投影可见/hit/未禁用；旧helper只留UNKNOWN，单帧完成及内部原因未知。                                      | [独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v3-public-independent.json)                                                                                                                                                                                                             |
| V4   | 首个mouseMoved等待IPC返回超时，不能证明未执行；不是外层35秒helper超时，也未定位旧因果。                                                       | [独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v4-public-independent.json)                                                                                                                                                                                                             |
| V5   | FirstRun完成、原picker实际打开，go_to已claim并返回；未观察到Go To sheet或可编辑焦点，未fill/Send。                                            | [独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v5-public-independent.json)                                                                                                                                                                                                             |
| V6   | 请求Target激活后page仍`hasFocus=false`，未续FirstRun/OS/Send；不编造OS6运行结果。                                                             | [独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v6-public-independent.json)                                                                                                                                                                                                             |
| V7   | AXApp＋Target setup成功、FirstRun通过；OS6的1秒focus诊断耗时1310.106ms，以deadline拒绝首键，CG事件0。App frontmost/同窗口为true，不归因产品。 | [100文件封存manifest](../evidence/client-native-attachment-consumption-v7-20261019/manifest.json)／[独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v7-public-independent.json)／[Root收口](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v7-root-closure.json) |
| V8   | 新增focus诊断上限3秒，1217.589ms通过；6原帧Post返回且key/flags匹配，非delivery ACK。固定投影未见GoTo，fill未claim、未Send，原因未证。         | [101文件封存manifest](../evidence/client-native-attachment-consumption-v8-20261019/manifest.json)／[独核](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v8-public-independent.json)／[Root收口](../evidence/client-post-g04j-boundary-audit-20261019/native-attachment-v8-root-closure.json) |

V7 manifest SHA为 `14e817f995c3cff467810258080e90f69633dddb6cc088972916e8a818b75102`；Root已逐SHA独核V7的100份及V8的101份公开文件。V7原Common PTY43008实际exit1、BH PTY41910实际exit0；V8原Common PTY10210实际exit1、BH PTY93807实际exit0，Root另核五PID、四端口与精确BH socket关闭。私有根保留，交接后未读/stat；不能将精准停止或保根改写为控制器全绿/零写者。

V8已实际将新增focus**诊断时限**从1秒校准为3秒；原Auth、owner、文件proof、5次cap及业务预算保持，仍未取得附件消费验收。后续在2026-10-19 04:11:30Z的[最小只读收据](../evidence/client-post-g04j-boundary-audit-20261019/current-console-state-v2.json)明确记录`IOConsoleLocked=true`及活动console的`CGSSessionScreenIsLocked=true`，当前环境锁定，停止新增OS Runtime及盲重试。此前公开最小收据的lock字段为unknown；新观测不回填旧状态，也不证明八轮失败的唯一原因。

主后台在04:14:04Z的[最新只读保护复核](../evidence/client-post-g04j-boundary-audit-20261019/main-after-native8-final-state.json)仍为原PID42125/DB/cwd，health、页面、JS/CSS均200，四部署资产SHA相同；九表相对旧基线仍为七同、`configurations`和`configuration_history`两表漂移。保留当前配置，不归因、回滚或重启，具体时间与原失败见[本机阶段报告](client-local-integration-acceptance-2026-10-19.md)。真实企微、外部MCP、网盘及目标平台边界保留，本报告不关闭G07e或整体客户端验收。

## G07e 当前阻塞（2026-10-19 复核，只读）

本轮用新 harness 覆盖 G05f 时顺带复核了 G07e 的可行入口，得到两条决定性事实（都不是产品结论）：

1. **控制台当前未锁定**：`/usr/sbin/ioreg -n Root -d1` 的 console 会话只报告 `kCGSSessionOnConsoleKey: true`，没有 `CGSSessionScreenIsLocked`。因此历史记录里「04:11:30 UTC 锁定」不再是当前阻塞。
2. **本进程没有辅助功能权限**：直接调用 `ApplicationServices.AXIsProcessTrusted()` 返回 `False`。仓库既有的 OS 选择器驱动（`evidence/client-native-os-attachment-*/os-picker.py`）依赖 ctypes + AXUIElement 定向按键，因此**从这里无法运行**。
3. 另一条路可用但风险不同：`osascript -e 'tell application "System Events" to get name of first process'` 能正常返回（Automation 权限可用）。但 System Events 的 `keystroke` 会发给**前台应用**，而按仓库合同要求应当是按 PID 定向并在每次按键前后核对控制台状态；没有 AX 就无法逐次验证面板状态。

因此 G07e 保持未验收，且**当前阻塞是权限而非锁屏**。解除方式只有用户侧动作：给运行探针的宿主（终端/IDE）授予辅助功能权限，之后既有的 PID 定向驱动才能使用；届时仍应保留「每次按键前确认前台是我们的 owned Electron，否则中止」的守卫。

## 授权的准确对象（2026-10-20 实测更正）

此前文档写的是「给运行探针的宿主（终端/IDE）授权」，**这是错的**。用系统「责任进程」API 查询本进程：

```
responsibility_get_pid_responsible_for_pid(self) -> 44142
ps -o pid=,comm= -p 44142           -> UWork
```

进程链为 `UWork(44142) → uwork-host-local-1 → uwork-cli → zsh → 探针命令`，因此 TCC 把权限归给**顶层应用 UWork.app**，而不是终端。

**正确操作**：系统设置 → 隐私与安全性 → 辅助功能 → 添加并打开 **UWork**（`/Applications/UWork.app`）。
