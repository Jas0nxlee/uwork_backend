# G07e 原生面板内交互（AX 元素动作）通过 — 2026-10-20

此前唯一列在「待授权」下的未覆盖项是**原 NSOpenPanel 面板内的交互**（GoTo 路径输入、允许/拒绝/取消）。2026-10-20 本机该授权已生效：`CGPreflightPostEventAccess() == True`、`AXIsProcessTrusted() == 1`，责任进程实测为 `UWork`。本报告记录据此取得的实测结果。

## 一、机制（与历史合成按键路径的关键区别）

- 新工具 `scripts/tests/macos-ax-driver.py`：AX 树有界 dump + **元素级动作**（`AXPress`/`AXConfirm`/写 `AXValue`）。元素按 **WindowServer 帧**匹配定位，动作直接发给解析出的真实控件本身，**不向桌面投递任何合成按键或盲点击标**。
- 探针 `scripts/tests/native-g07e-cdp-probe.py --phase panel-interaction` 改为 **AX 优先**，按键仅作回退，且回退前仍执行 owned-frontmost 守卫。
- 真实面板的身份：属主为夹具 Electron 的 `AXWindow "打开"`，frame `(316,144) 880x448` 与 WindowServer 元数据逐字一致；GoTo sheet 为 `AXSheet (526,208) 460x345`。
- 入口仍是唯一 gate：`python3 scripts/tests/native-g07e-panel-gate.py --profile client-native-g07e-panel5-20261020`（gate 自判权限；本轮起接受 `--profile` 透传，避免覆盖既有证据目录）。

## 二、三用例结果（真实面板、真实策略）

| 用例   | 实际动作                                                                                                                                       | 结果                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| cancel | AXPress 真实「取消」按钮（code 0）                                                                                                             | 面板关闭、chip 0、无附件                                       |
| deny   | AX 写入 sheet 路径字段（`settable=true`、code 0、回读一致）→ 面板导航到目标目录 → 定位真实文件行 → **AXConfirm（code 0）关闭面板、交付该文件** | chip 1；文件正文**未**进入任何模型请求（`markerRequests: []`） |
| allow  | 同上                                                                                                                                           | chip 1；正文进入模型请求（第 4 条请求命中 marker）             |

**14 项检查全通过**：`owned-main-renderer-attached-over-loopback-cdp`、`original-first-run-and-owned-workspace-ready`、`original-composer-exposed-the-attachment-entry`、`original-entry-opened-a-real-system-panel-owned-by-the-app`、`checked-the-accessibility-grant-before-any-panel-action`、`dismissed-the-panel-before-the-outcome-matrix`、`panel-cancel-left-no-attachment-and-closed-the-panel`、两个 `panel-navigated-to-the-target-folder-go-to`、`panel-go-to-path-input-produced-one-attachment-deny` / `-allow`、`panel-picked-attachment-body-withheld-under-the-revoked-policy`、`panel-picked-attachment-body-delivered-under-the-allowing-policy`、`panel-torn-down-with-its-owned-process`。

## 三、逐步机制（journal 逐动作记录，含失败动作）

- **GoTo sheet 打开**：PID 定向 `Cmd+Shift+G` 实测**不能**到达 AppKit 面板（未打开，`go-to-sheet-not-opened mode=pid-key`）；带守卫的全局投递打开了 sheet（`mode=global-key`）。这是本轮唯一仍需真实按键的步骤。
- **路径输入**：改由 AX 直接写字段 `AXValue`（`valueSettable=true`、`setValueCode=0`、`valueAfterSet` 与目标路径逐字一致），**不再逐字键入**。
- **sheet 提交**：AXConfirm(code 0) 与 sheet 内按钮 AXPress(code 0，命中的是描述为「关闭」的按钮)**都没有**关闭 sheet；真实按键 `Escape`+`Return` 关闭（journal `mode=keys`）。如实记录，**不把未生效的 AX 动作写成成功机制**。
- **文件行与接受**：行元素支持 `AXOpen`(-25205 不支持) 与 `AXConfirm`；**AXConfirm（code 0）关闭了面板**（`mode=row-action`），即接受动作由对真实文件行的 AX 确认完成，无需按键。
- **导航后的直接证据**：`ax-tree-panel-folder.json` 列出该工作区 8 个测试文件（txt/png/pdf/mp4 × allow/deny，含被选中的 `attachment-allow.txt`），证明面板确实显示目标目录而非默认视图。

## 四、面板导航的既有事实与边界

- 该面板默认落在 **「最近使用」**（而非工作区）；`AXDocument` 在本面板上不可读/不可设（`readCode=-25212`、`settable=false`），因此目录导航走 GoTo（真实按键），其余步骤均 AX。这两个能力缺口已在 journal 中留证，不作为 AX 已完成项。
- 「位置：」弹出按钮只给出最近位置菜单（iCloud 资料库/文稿/iCloud 云盘…），本轮早期把它误当作「更多」菜单并按开过（失败轮次已弃用），该菜单中**没有**「前往文件夹」。

## 五、无产品改动（探针侧缺陷，非产品缺陷）

前两轮的失败都定位在探针自身，产品代码与产物未改、未重建：

1. 早期用**猜测坐标**点击 sheet 字段（`click_sheet_field` 取最小 layer-0 窗口 = 面板本身，点到侧栏），正文从未进入 GoTo 字段 → 提交自然失败；
2. 提交策略只按 `Return` 一次后改按 Tab/Space，**从不复按 Return**，而实测 `Escape`+`Return` 即可提交。

删掉盲点击、补上提交序列后，**同一份产品产物**在允许与撤销两种策略下都通过。因此本项**没有发现产品缺陷**，也没有因此产生产品修复或产物重建。

## 六、未覆盖 / 保留边界

- 本结果由自建 AX/CDP 探针取得，**不是**仓库受审的 source-lock/Go/actor 流程，也没有 Root 独立复核；**G07e 的正式验收层继续保持未勾选**。
- 面板内仍有一项依赖真实按键（GoTo 的 `Cmd+Shift+G`）；`AXDocument` 与行 `AXOpen` 在该面板上不可用。
- 系统选择器/剪贴板/默认外链、安装包与三平台、生产目标机边界不变；真实企微、外部 MCP、网盘按用户要求排除。
- 资源：探针自报 `panel-torn-down-with-its-owned-process`；独立复核无残留夹具进程、无夹具监听端口；`data/<profile>` 私有根按既有惯例保留（每份约 226MB），证据目录保留。

## 六之二、加严前台守卫后的复跑（panel6，通过）

针对用户报告的「关机界面」异常，本轮把前台守卫从「最前台 layer-0 窗口」加严为「**layer ≥ 0 且在 Dock/菜单栏之下**的最前窗口」（`scripts/tests/macos-window-list.py --front-all`）——原判定会漏掉抬升到应用之上的系统对话框，那正是按键会落进去的位置。加严后以 `--profile client-native-g07e-panel6-20261020` 复跑：**14 项检查全过**，三用例结果与 panel5 逐字一致（cancel 0 附件；deny 正文 0 次入模；allow 第 4 条请求命中）。加严守卫未改变行为，只提高了安全性。

同一轮新增证据 `screenAtPanelStart`：记录面板阶段开始时前台窗口（本轮实测为夹具自己的面板窗口 pid 59292、880×448）与屏幕上**所有非本进程可见窗口**（本轮为 UWork / 企业微信 / Chrome×2 / 日历 / 活动监视器，各 layer 0）。若同类异常再现，证据可直接显示当时前台是什么，无需依赖口头描述。

## 七、证据

### 后续 Root 独立证据复核

Root 已运行 `scripts/tests/audit-native-panel-evidence.py`，对封存的 panel6 原始结果、AX/WindowServer 帧、supplier 请求与账本做 13 项交叉断言，全部通过。取消为 0 chip；deny/allow 均由真实行 AXConfirm 接受同一附件，正文 marker 在 deny 的全部请求中缺失、仅在允许后的第 4 号请求出现；五个唯一 settled 共 110 Credit，先前四个请求完整保留。输入文件 SHA 固定在 `evidence/client-native-g07e-panel6-root-review-20261020.json`。

这是历史证据的独立复核，没有新启动浏览器或操作系统面板，也没有重建历史 PID/端口关闭证据；不能代替受审 source-lock/Go/actor 运行。因此前文“没有 Root 独立复核”是当时状态，现关闭该证据复核缺口，正式流程验收仍开放。

- `evidence/client-native-g07e-panel5-20261020/probe-result.json`（status passed、14 检查、`axJournal` 逐步代码与窗口数）
- `evidence/client-native-g07e-panel6-20261020/probe-result.json`（加严前台守卫后的复跑；含 `screenAtPanelStart` 屏幕投影）
- `.../ax-tree-panel.json`、`.../ax-tree-panel-folder.json`（面板 AX 树；后者为导航后列出 8 个测试文件）
- `.../panel-allow-experience-proof.json`、`.../panel-deny-experience-proof.json`
- 失败与中间轮次保留：`client-native-g07e-panel-20261020`（GoTo 提交红）、`-panel2`（按开「位置」弹出菜单）、`-panel3`/`-panel4`（journal 的机制标注不精确，已被 panel5 取代为引用）。
