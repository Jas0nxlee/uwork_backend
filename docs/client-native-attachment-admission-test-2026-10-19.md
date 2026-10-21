# G07e 附件正文消费的企业准入（原生运行时，文本/图片/PDF 双态，2026-10-19）

在真实 Electron Native 应用上，用**原 Composer** 分别持有文本、图片、**视频**、PDF 四类本地路径附件，在「当前策略允许」与「当前策略撤销」两种状态下各发送一次，核对模型请求真正收到了什么。**19 项检查全部通过。**

**层次与边界声明**：

- 覆盖的是**附件正文/媒体消费链路**（本地路径 → 附件解析 → 企业 filesystem 准入 → 模型可见内容）。
- **部分覆盖**：`chat-attachment-button → chat-attachment-menu-item → 真实 NSOpenPanel` 的**打开**已由 WindowServer 观测证实；面板自身的路径输入与允许/拒绝/取消仍需辅助功能权限（见下）。G07e 因此仍未勾选。
- 不是仓库受审的 source-lock／Go／actor 流程，也没有 Root 独立复核。

## 为什么可以绕过面板而不失真

`ConversationComposer` 无条件渲染了一个隐藏的 `<input type="file">`（原注释：web／无 native picker 平台回退）。探针用 CDP `DOM.setFileInputFiles` 投喂真实文件；Electron 下 `addAttachmentFiles` 会用 `platform.getPathForFile(file)`（preload `webUtils`）解析出**真实本地路径**，随后两条入口汇总到同一个 `addPreparedAttachments`。因此走的是规格里的**本地路径 AttachmentRef**，不是内联字节，正文由 Host/CLI 侧读取并受企业 filesystem 策略约束。

## 八轮实测（矩阵）

| 轮次      | 策略 | 模型请求里实际出现的内容                                                                                                           |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 文本-允许 | 允许 | 引用 + **正文**（标记出现在该轮请求中）                                                                                            |
| 图片-允许 | 允许 | 引用 + `[Attached image/png: …]` + `[Image: source: …]` + `[Media omitted … does not support image input.]` → **媒体分支已处理**   |
| 视频-允许 | 允许 | 引用 + `[Attached video/mp4: …]` + `[Media omitted … does not support video input.]` → **媒体分支已处理**                          |
| PDF-允许  | 允许 | 引用 + `[Attached application/pdf: …]` + `[PDF: source: …]` + `[Media omitted … does not support PDF input.]` → **媒体分支已处理** |
| 文本-撤销 | 撤销 | 仅占位 `[Attached text/plain: <路径>]`；**正文 0 次**                                                                              |
| 图片-撤销 | 撤销 | 仅占位 `[Attached image/*: <路径>]`；**媒体分支未执行**、无载荷                                                                    |
| 视频-撤销 | 撤销 | 仅占位 `[Attached text/plain: <路径>]`；**媒体分支未执行**、无载荷                                                                 |
| PDF-撤销  | 撤销 | 仅占位 `[Attached application/pdf: <路径>]`；**媒体分支未执行**、无载荷                                                            |

「媒体分支已处理」的判据是**承载本轮附件的那条消息**里出现指向本轮文件绝对路径的 `[Image: source: …]`/`[Video: source: …]`/`[PDF: source: …]`，或该消息里的媒体省略注释（模型不支持该媒体类型时，媒体块在物化派生路径前就被省略，省略注释即分支已运行的证据）；「无载荷」的判据是文件字节的 base64 片段在全部请求中出现 0 次。撤销态仍会以占位形式点名路径——这与规格「未获准的本次附件可以沿原明确失败/占位语义处理，普通文本模型请求可按原规则继续」一致，而正文/媒体确实一次都没有被消费。

受控模型未声明图片/视频/PDF 输入能力，因此允许态同样出现「media omitted」注释；这正是媒体分支运行的证据，不构成未处理。

## 两处我自己的假阳性（已修正，留档）

1. **文件名签名太弱**：最初的签名是裸文件名，而它会出现在系统提示的 `gitStatus` 未跟踪文件列表里，导致「撤销后仍出现引用」的错误判定。改为**绝对路径**签名后恢复正常。
2. **历史污染（两次）**：模型请求是累积的，用整份请求列表提取媒体注释会把**前几轮**的注释算进本轮。第一次修正为「只从本轮自己的请求提取 + 注释须指向本轮文件路径」，但**省略注释不含路径**，仍会被前几轮同名类型的注释污染；最终改为只检查**承载本轮附件的那条消息**（`carriedByOwnMessage`），撤销态四类的媒体判据才正确为空。

## 消费者归属（源码核对）

模型可见内容形如：

```
Called the Read tool with the following input: {"file_path":"<…>/attachment-allow.txt"}
Result of calling the Read tool:
1  NATIVE_ATTACHMENT_ALLOW_MARKER_7f31
```

这个「Read 形状」是**设计好的**：`apps/zcode-cli/packages/core/src/system-reminder/prompt-attachment.ts` 的 `buildPromptAttachmentReminderBodies`（`kind:"file"`）刻意用该措辞与 `formatReadTextResult` 渲染；全文只有两处产生该措辞，另一处是压缩后的读状态提醒。所以附件正文**没有**经过 builtin Read ToolExecutor，走的是规格里那个固定消费者。

## NSOpenPanel 的「打开」已实测（不需要辅助功能权限）

用 **WindowServer 元数据**（`CGWindowListCopyWindowInfo`，不需要辅助功能、也不抓屏）观测 owned Electron 进程的窗口：

| 时点                   | 该进程窗口                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| 点击前                 | 1 个：1200×800 @ (156,33)                                                  |
| 点原菜单项「附件」之后 | 2 个：新增 880×448 @ (316,144)，即嵌在主窗口内的 sheet —— 真实系统文件面板 |
| 拆解（stopNative）后   | 0 个                                                                       |

动作全部走原入口：CDP 点 `chat-attachment-button` → 原菜单项（文案实测为「附件」）。因此「原 Composer 附件入口确实打开真实 NSOpenPanel」已有运行时证据，且面板随其进程一起关闭，屏幕上不留残留。辅助脚本：`scripts/tests/macos-window-list.py`（只读窗口元数据）。

**仍未覆盖**：面板自身的交互——GoTo 路径输入与「允许 / 拒绝 / 取消」三种结果。这一段必须用按 PID 定向的键盘事件，而键盘事件属于被拒的辅助功能权限类，因此仍需用户侧授权。

## 决定性实验：按 PID 定向的合成按键确实被丢弃（2026-10-20）

此前只能依据 `CGPreflightPostEventAccess() == False` **推断**按键会被拒；本轮做了真实投递实验（`--phase key-probe`），目标是我们**自己的** Electron 窗口，因此无副作用：

| 步骤                                                  | 观测                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| 记录 `CGPreflightPostEventAccess()`                   | `false`                                                          |
| owned-frontmost 守卫                                  | 通过（最前台 layer-0 窗口属主 PID = owned Electron）             |
| CDP 点入 composer 后经 `CGEventPostToPid` 发 2 个字符 | —                                                                |
| 复查 composer 文本                                    | 与发送前**完全一致**（仍是 `"\n"`），标记未出现 → **按键被丢弃** |
| 拆解后该进程窗口                                      | 0                                                                |

结论：`CGPreflightPostEventAccess()` 是**真实**拒绝而非保守判定，`CGEventPostToPid` 的「定向投递」并不能绕过该权限。因此面板内交互在授权前没有任何可行路径，也不再需要尝试其它变体（AX、System Events、CGEventPost、CGEventPostToPid 均已排除）。

## 面板内交互的驱动与守卫（已就绪，等待授权后可一条命令复跑）

**唯一入口**：`python3 scripts/tests/native-g07e-panel-gate.py` —— 它自己用 `CGPreflightPostEventAccess()`/`AXIsProcessTrusted()` 判定权限，并**动态查出**责任进程（本轮实测 `responsiblePid=44142 / responsibleApp=UWork`）；权限不足时以 exit 2 打印要打开的开关，权限足够时直接跑 `--phase panel-interaction`，无需再手工决定跑什么。

`scripts/tests/native-g07e-cdp-probe.py --phase panel-interaction` 已实现完整链路：

1. 走原入口打开真实面板（已验证，见上）；
2. **前置检查**：`CGPreflightPostEventAccess()` —— 这正是「合成键盘事件」所需的那个权限的直接 API；
3. 权限不足时**拒绝执行任何按键**，以独立状态 `blocked` 结束并拆解进程（不伪装成通过）；
4. 权限足够时按批次发送按键，且**每批之前**先执行 owned-frontmost 守卫：用 WindowServer 的**最前台 layer-0 窗口属主 PID** 与 owned Electron PID 比对，不一致即中止；
5. 按键用 `CGEventPostToPid` **定向到该 PID**（不是全局投递），因此不可能落到别的应用窗口；
6. 三种结果各自的序列与断言（均已实现，待授权执行）：

| 结果 | 面板内序列                                             | 断言                                                       |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 取消 | 直接 `Escape`                                          | 面板关闭（窗口数回到打开前）且**无附件 chip**              |
| 拒绝 | `Cmd+Shift+G` → 填路径 → `Return` → `Return`，策略撤销 | chip=1 且面板关闭；发送后附件标记在**全部模型请求中 0 次** |
| 允许 | 同上，策略允许                                         | chip=1 且面板关闭；发送后附件标记**进入模型请求**          |

本轮实测记录（2026-10-20，权限未授予，故仅走到第 3 步）：

- `postEventAccess: false` → `panelInteraction.attempted = false`，`reason = "synthetic key events denied"`；
- 同轮的 `frontmostNormalPid` 恰为 owned Electron（57782），说明守卫在有权限时会放行、且其判定依据已被真实验证；
- 拆解后该进程 0 窗口，屏幕上无残留。

前置阻塞的**精确**证据是 `CGPreflightPostEventAccess() == False`（比此前的 `AXIsProcessTrusted()`/`-25211` 更直接地对应「发键」这一动作）。授权对象见下节。

## 阻塞剩余部分的证据（本宿主无辅助功能权限）

三条独立只读证据：

1. `ApplicationServices.AXIsProcessTrusted()` → `False`。
2. `osascript -e 'tell application "System Events" to get count of windows of process "Finder"'` → **-25211「osascript 不允许辅助访问」**。
3. `get name of every process whose background only is false` 可正常返回 —— 基础进程枚举可用，**被拒的正是 UI 脚本/按键这一类**。

控制台当前不锁定（console 会话仅报告 `kCGSSessionOnConsoleKey: true`），因此**阻塞是权限而非锁屏**。`evidence/client-native-os-attachment-*/os-picker.py`（ctypes + AXUIElement 的 PID 定向按键）与 osascript 按键同属被拒权限类，无法运行。

解除方式只有用户侧动作：在「系统设置 → 隐私与安全性 → 辅助功能」中给运行探针的宿主（终端/IDE）授权；之后仍应保留既有合同的守卫——每次按键前确认前台是我们的 owned Electron，否则中止。

## 未覆盖清单

- 真实 NSOpenPanel 的 GoTo 路径输入与允许/拒绝/取消三种结果（打开已实测；驱动与守卫已就绪，只差授权）。
- 取消与 owner/port 变更期间「迟到正文不得进入」的运行时竞态（该部分已有 Core 源码级测试与规格）。

## 授权的准确对象（2026-10-20 实测更正）

此前文档写的是「给运行探针的宿主（终端/IDE）授权」，**这是错的**。用系统「责任进程」API 查询本进程：

```
responsibility_get_pid_responsible_for_pid(self) -> 44142
ps -o pid=,comm= -p 44142           -> UWork
```

进程链为 `UWork(44142) → uwork-host-local-1 → uwork-cli → zsh → 探针命令`，因此 TCC 把权限归给**顶层应用 UWork.app**，而不是终端。

**正确操作**：系统设置 → 隐私与安全性 → 辅助功能 → 添加并打开 **UWork**（`/Applications/UWork.app`）。
