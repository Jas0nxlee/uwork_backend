# 客户端联动覆盖：完成度审计（2026-10-20）

> 当前目标仍active，**尚未完成全部覆盖**。此前“本机可自动覆盖范围全部完成”的阶段结论已撤回。后续具名证据见[持续补测记录](client-integration-continuation-2026-10-20.md)，下文原轮次的测试数量、产物和资源状态只作为历史记录，不代表当前变更全通过。

本文件将自动测试目标映射到具名证据。已有平台/功能切片与本轮Main协议、Server更新、Gateway晚回包/自然到期、Native Read等待撤权均分别取得结果；真实OAuth/Native企微、rpm/Arch实际安装、默认外层/SUID fallback、其他更新模式与跨平台仍开放，整体未完成。

## 当前执行截面

| 范围 | 已确认状态 |
| --- | --- |
| Mac ARM64 原联动 | 主链7项、已注册Server更新8项、运行中二实例长确认4项已实测通过，各自原报告和资源闭合保留。 |
| Mac x64 Rosetta | v8仍1/7，二实例原10s超时；own采样器在保护期限内未产堆栈且已回收，原源码原因未定。已有协议/请求时序和10PID/4port独核；未认定Intel验收。 |
| Linux matching1a8 原包 | v8原11项+真实UI PTY严格恢复通过，Root20项独核；两模型/2settled/44Credit、撤席位零增量、25.105s确认/并发URI与中文目录均通过。历史v3未知Error继续开放。 |
| Server node-pty | a1a924fc源/锁修复、49相关测试/必要门禁通过；正常Darwin4665与Linuxf55d原SDK各6项、Root13/17项独核通过，含原更新、实际stty/状态保留/停止卸载。 |
| 测试设施质量 | 10项Lint已通过真实ESM/模板迁移修复；Node22/24原入口9合同、Root完整typecheck/lint均通过，未关闭规则。 |

以上是本轮最新状态。下文按产物和具名切片保存历史证据，不能把不同代次部分通过拼成全平台通过。

## 当前补测状态

| 项目                             | 结论与权威入口                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实企微                         | 用户已允许。真实只读API、主库备份副本的幂等同步、配置/Vault及授权URL/state取消/拒绝已通过；Computer Use拒绝当前授权浏览器URL后已停止该页自动操作。真实授权回调成功、成员会话及Native登录未完成，见[报告](client-real-wecom-test-2026-10-20.md)。外部MCP和网盘仍排除。                                                                                                     |
| 普通member撤销后重认证           | v5通过：旧会话恢复成员后仍拒绝、新owner同步后同Host再执行、旧proof拒绝；恰两次受控供应商/两条本人settled、14 Token/18 Credit。它验证service/Host，不替代真实企微/Native按钮，见[报告](client-member-reauth-recovery-test-2026-10-20.md)。                                                                                                                                 |
| Linux普通用户sandbox             | 原AppImage v6首实例renderer的UID1000、Seccomp2、NoNewPrivs1与独立namespace实际通过；默认外层seccomp原包拒绝启动。不是新版协议或物理Linux验收，见[报告](client-linux-sandbox-test-2026-10-20.md)。                                                                                                                                                                         |
| Linux四格式与已有GUI/PTY/deb     | 2cd3fb4e阶段异步Main输入的AppImage/deb字节保持原样，释放GUI后原RPM/pacman单target分别成功；独立四格式消费/20核心SHA/20公共权限通过。保留此前禁网与OOM失败；最终YML仅pacman一条，不代表完整更新feed、签名或发布。rpm/Arch真实安装、FUSE/GPU/物理Linux仍开放，见[最新格式报告](client-linux-native-formats-async-test-2026-10-20.md)。                                      |
| Main协议/第二实例（R02具名范围） | 修复`2cd3fb4e`后正常AppImage v16完整11项与25.231秒并行URI唯一Main55通过；同源UID1000原deb在支持userns环境中25.109秒确认并行、唯一Main68、取消/允许/零计量、原purge均通过。v13和观察器RED保留，默认外层/SUID fallback不关闭，见[Main报告](client-second-instance-confirmation-test-2026-10-20.md)、[deb报告](client-linux-deb-protocol-test-2026-10-20.md)。               |
| Server CLI update                | 整包v3七项、候选失败回滚v1八项、增量/坏摘要/整包fallback v2九项已通过；属主`1a0e2c93`和manifest原文`63121013`修复正常重建复测。同版不同SHA不等于跨版本，force运行任务/OS服务更新/其他平台仍开放，见[整包](client-server-update-test-2026-10-20.md)、[回滚](client-server-update-rollback-test-2026-10-20.md)、[增量](client-server-component-update-test-2026-10-20.md)。 |
| Native Gateway晚回包与过期       | 同面板服务器401后原旧200真实成功交付仍不回灌，5项通过；另一组原60秒TTL自然到期、原store清空/请求abort、UCAS候选清退6项通过，模型/账本/Trace均0，见[晚200](client-native-gateway-mounted-late200-test-2026-10-20.md)、[自然到期](client-native-gateway-expiry-test-2026-10-20.md)。                                                                                        |
| Native Read真实等待中撤权        | v3六项通过：同包原CLI regular-file lease与内核\_\_break_lease，原publish/Skills UI确认false后解锁；Read完成后原before_result扣留正文，63字节错误模板SHA精确匹配，allow对照真实正文入后继模型。5本人settled/110Credit，资源闭合，见[报告](client-native-pending-read-test-2026-10-20.md)。                                                                                 |
| Server更新后持久状态             | v9原SDK六项通过；修复新发现的时钟问题后，新cdf Agent/原包v11七项通过：原file/settings/model与两条导入历史跨update/restart同ID、全字段保持，三WS原1001关闭，零chat。空Task懒持久化/plan兼容映射按原合同保留，见[状态报告](client-server-update-stateful-test-2026-10-20.md)。                                                                                              |
| SQLite启动计时修复               | SQLite启动wall-clock回拨误报已修复并提交`1db59c77`：真实schema/SQL/BUSY/rollback四永久红绿与两peer独立GREEN，原持久时间/跨进程租约不改。正常重建新cdf Agent/7774 Server原包，实际新Agent两进程回拨下schema ready；stateful v11七项/17独核及Root新AppImage v17完整11项通过。旧v10产品RED保留，见[时钟报告](client-sqlite-startup-clock-test-2026-10-20.md)。               |

## 一、此前轮次的具名实测（真实 Electron、隔离后台及各自受控端口）

| 切片                        | 结果                                                                                                                                                                                                  | 证据                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G04k 目录撤销（修复）       | 服务 9 + UI 6 项通过；相关回归 468/21/15/11；六产物按正常命令重建                                                                                                                                     | `evidence/client-native-g04k-catalog-revocation-20261019/`、[报告](client-g04k-catalog-revocation-test-2026-10-19.md)                                                                |
| G04k 原生 RED               | 停掉修复重建 → 真实菜单普查 **`G04K_CATALOG_STALE`**（弹层仍有 ucas 分组与 A 的模型）                                                                                                                 | `evidence/client-native-g04k-fix-red-20261019/probe-result.json`（status failed / code G04K_CATALOG_STALE）                                                                          |
| G04k 原生 GREEN             | **12 项通过 / 20 个原界面动作 / 0 模型调用**：A 登录→原退出→菜单普查为空→B 重认证仅得自有模型                                                                                                         | `evidence/client-native-g04k-fix-green-20261019/probe-result.json`、[报告](client-g04k-native-cdp-verification-2026-10-19.md)                                                        |
| G05e1 原生自动化按钮        | **13 项 / 23 个动作**：创建→暂停→恢复→再暂停→跨真实到期（58.1s 到期、等待 70.1s 零派发零调用）→删除取消→删除确认；每步核对只读持久化                                                                  | `evidence/client-native-g05e1-probe-20261019/probe-result.json`、[报告](client-native-automation-buttons-test-2026-10-19.md)                                                         |
| G05f 原生全局工作流         | **16 项 / 29 个动作**：受控 SaveWorkflow+原批准→项目档→原「提升为全局」会话路径→全局组→原启动对话框「运行于」选已打开项目→**模型 cwd 与 run.cwd 逐字一致**→撤权后 `enterprise_filesystem_denied` 拒绝 | `evidence/client-native-g05f-probe-20261019/probe-result.json`、[报告](client-native-global-workflow-cwd-test-2026-10-19.md)                                                         |
| G07e 附件消费（企业准入）   | **19 项**：文本/图片/视频/PDF × 允许/撤销；允许态正文与媒体分支交付、撤销态正文与载荷 0 次                                                                                                            | `evidence/client-native-g07e-probe-20261019/probe-result.json`、[报告](client-native-attachment-admission-test-2026-10-19.md)                                                        |
| G07e 面板**打开**           | WindowServer 实测：原菜单项「附件」→ 同进程新增 880×448 sheet → 拆解后 0 窗口                                                                                                                         | 同上报告「NSOpenPanel 的『打开』已实测」一节；工具 `scripts/tests/macos-window-list.py`                                                                                              |
| G07e 面板**内交互**         | **14 项 / 三用例**：AXPress 真实「取消」；AX 写路径 → GoTo 导航 → 真实文件行 AXConfirm 交付；deny 正文 0 次、allow 第 4 条请求命中正文                                                                | `evidence/client-native-g07e-panel5-20261020/probe-result.json`、`panel6`（加严守卫后复跑）、`ax-tree-panel-folder.json`、[报告](client-native-panel-interaction-test-2026-10-20.md) |
| G07e 面板交互**驱动与守卫** | `--phase panel-interaction`：`CGPreflightPostEventAccess()==false` → **一次按键未发**、状态 `blocked`；同轮验证 owned-frontmost 守卫取到我们的 Electron                                               | `evidence/client-native-g07e-probe-20261019/probe-result.json`（status blocked / 6 checks）                                                                                          |

本轮修复的产品问题：G04k 身份撤销未传导到托管模型候选目录（修复见 G04k 报告）。测试设施本身修掉三处假阳性（文件名签名撞 git status、历史请求污染 ×2），已在 G07e 报告中留档。

## 二、仍未覆盖

### 2.1 面板内交互：已完成（2026-10-20，AX 元素动作）

**授权已生效**：`CGPreflightPostEventAccess() == True`、`AXIsProcessTrusted() == 1`（责任进程 `UWork`），因此该项已由[面板内交互联测](client-native-panel-interaction-test-2026-10-20.md)实测完成：真实面板 = 属主夹具 Electron 的 `AXWindow "打开"`（frame 与 WindowServer 逐字一致）；cancel 由 AXPress 真实「取消」完成（chip 0）；deny/allow 由 AX 写入 sheet 路径字段 → 导航到目标目录（导航后 AX 树列出工作区 8 个测试文件）→ 对真实文件行 AXConfirm 交付附件；deny 正文 0 次进入模型请求、allow 第 4 条请求命中正文 marker，**14 项检查全过**。探针侧修掉两处缺陷（猜测坐标点击误点侧栏、提交序列从不复按 Return），**无产品改动、未重建产物**。

仍保留的边界（都已写进 journal，不作为 AX 已完成项）：GoTo sheet 的打开仍需一次真实 `Cmd+Shift+G`（PID 定向实测不能到达 AppKit 面板）；该面板 `AXDocument` 不可读/不可设（-25212/settable=false）；文件行的 `AXOpen` 不支持（-25205），只有 `AXConfirm` 生效。

（历史记录，供追溯）此前两条「借用已有授权」路径都不可行：`TCC.db` 受 Full Disk Access 保护无法枚举，`osascript` 经 Terminal 代跑报 AppleEvent 超时。该结论在授权已生效的今天不再构成阻塞。

### 2.1b「关机界面」报告：定向排查结论（2026-10-20，未复现，已加防护）

用户在 08:53 前后报告「你为啥打开了关机界面？」。相关的那一轮是 `evidence/client-native-g07e-panel-20261020`（旧探针代码），**08:52:58–08:53:28** 运行；`loginwindow` 在 08:52:57.932 记录夹具 Electron 启动（`data/client-live-20261017/electron/Electron.app`）。以下为只读定向排查，全部在**该轮的时间窗内**取数：

| 检查项                              | 方法                                                                                       | 结果                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 锁屏 / 注销 / 关机 / 重启           | `log show` 08:52:40–08:53:40 过滤 shutdown / log out / restart / PowerButton / screen lock | **无任何命中**（只命中 WebKit `Shutdown sockets` 等无关噪声）                                                                                                                              |
| 会话状态                            | 同窗 `SA: currentState` 迁移                                                               | 停在 2（active）；最后一次变化是 08:48:59，**早于本轮**                                                                                                                                    |
| 锁屏遮罩                            | `loginwindow` `SACShieldWindowShowing`                                                     | 全部 `isShieldWindowShowing = 0`（含夹具 08:53:02 那条）                                                                                                                                   |
| 显示器状态                          | `pmset -g log`                                                                             | 08:48:56 亮屏后**无熄屏**，本轮时段只有断言记录                                                                                                                                            |
| 权限/认证弹窗                       | `tccd` 同窗                                                                                | 只有**本探针自己**的 preflight 查询（`kTCCServicePostEvent`、`kTCCServiceAccessibility`，`authValue=2`、无 UI 呈现），责任进程 = UWork；无 SecurityAgent/authorizationhost 活动            |
| 崩溃 / 问题报告                     | `ReportCrash`、`CoreServicesUIAgent`、`~/Library/Logs/DiagnosticReports`                   | 该时段**0 份诊断报告**、无 panic；CoreServicesUIAgent 只有 LaunchServices 常规记录，且发生在 08:52:41（早于本轮）                                                                          |
| 「自动化助手 (UWork 联动验证)」日志 | 逐条读原文                                                                                 | 实为 **自动填充（AutoFill）助手** `com.apple.SafariPlatformSupport.Helper` 启动时的 shield 查询（`Application: 自动填充`），属常规行为，**不是**权限弹窗；此前把它当作权限确认的猜测已撤回 |

本轮对桌面**可见**的动作（逐条来自代码与 journal，可复算）：启动夹具 UWork 测试实例（1200×800 窗口）→ 把它置前 → 由原入口打开真实 NSOpenPanel（880×448，主显示器中部）→ 一次受守卫的 ⌘⇧G → 以 System Events 向夹具进程发送 Escape/Return/Tab/Space → 在该面板自身范围内一次全局点击（旧代码，落在面板侧栏）→ System Events 键入一条路径字符串。

**不可能**由本轮产生：任何电源键 / ⏏ / ⌃⌘Q / ⌃⏏ / ⌃⌥⌘⏏ 组合。探针与夹具的键位集合是固定枚举（Escape/Return/Tab/Space/⌘⇧G/⌘V + 路径字符），源码内没有任何 shutdown/logout/reboot 调用（已 grep 核对）。

**结论（如实）**：日志层面没有任何会话级关机/注销/锁屏事件，也没有系统对话框或崩溃；因此**既无法证实也无法复现**用户看到的是系统关机界面。最可能的可见对象是：夹具的 UWork 测试实例窗口 + 真实系统文件面板（880×448）在该 30 秒内占据前台，而该测试实例在系统里以 `Electron` / 「UWork 联动验证」身份出现。此异常**保持未闭环**，但没有证据显示存在会关机/注销/锁屏的产品或测试缺陷。

**已落地的防护（不需要用户操作）**：

1. 面板的取消/选文件改用 AX 元素级动作，不再发合成按键与盲点击（见 [2.1](#21-面板内交互已完成2026-10-20ax-元素动作)）。
2. **前台守卫加强**：`scripts/tests/macos-window-list.py --front-all` 现在返回「layer ≥ 0 且在 Dock/菜单栏之下」的最前窗口——原先只看 layer 0，会**漏掉抬升到应用之上的系统对话框**，那正是按键会落进去的位置。探针在每批按键前要求该窗口属主就是夹具进程，否则**拒绝发送并记录**（含属主名/PID/layer）。
3. 面板阶段开始时把当时屏幕上**所有非本进程的可见窗口**（属主/层/坐标）写入证据 `screenAtPanelStart`；若同类现象再现，证据将直接显示当时前台是什么，无需再依赖用户描述。

### 2.2 当前无消费者或产品入口（不作为测试通过）

`assistants`（云助手）配置在客户端**无任何消费者**（`packages/ui/src`、`packages/services/src` 均无引用），与既有结论「无对应本地产品出口」一致；热切企业、legacy 共享技能 UI、同 Main 第二 Root、手机/云协作 caller、managed 远端企业 authority、生产 workflow 灰度或 offPeak 启用来源（provider 固定关闭且无 caller）同属此类。

### 2.3 目标环境与真实链路尚未闭合

Windows、物理Linux/FUSE/GPU、rpm/Arch实际安装、生产目标主机部署、远端CI与未取得目标库存的官方市场/公司库存继续分列。macOS打包运行和Linux原发行运行时/桌面GUI/PTY/deb/格式/sandbox已由后续具名证据分别补测，不能继续统称“Windows/Linux构建与运行全部不可达”，也不能由局部通过宣称平台完成。

真实企微已不再排除；真实只读API/隔离同步与配置通过，但实际OAuth成功及Native消费仍未闭环，受浏览器策略拒绝的页面不绕过。外部MCP和网盘仍为用户明确排除，不计入本轮完成要求。Main系统URI（支持userns环境）与Server整包/回滚/增量三个更新切片现已通过；不能据此关闭默认外层/SUID fallback、其他更新模式或目标平台。

### 2.4 过程层

上述所有原生结果均由自建 CDP 探针取得，**不是**仓库受审的 source-lock/Go/actor 流程，也没有 Root 独立复核；G04k 的正式验收层因此仍未勾选。

## 附：此前阶段的具名回归验证（当轮通过，非当前全部变更门禁）

### 夹具合同套件：两处陈旧断言已修复（2026-10-20）

跑全量夹具合同时发现 **167 项里 2 项红**，根因都不是本会话的改动，而是此前那次双组织夹具改动**只更新了三个消费者中的一个**：

| 失败                                                                                                        | 根因                                                                                                | 处理                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `native-file-context.test.mjs` 对 `saveExperienceProof` 区域的哈希断言（期望 `f17ae3d…`、实得 `564ad524…`） | 该区域新增了受审的 dual-organization 分支，哈希随之改变；adapter 测试已承认新值，这个兄弟测试没跟上 | 按 adapter 已采用的同一模式：先证明「精确剔除该分支」后仍等于冻结原值 `f17ae3d…`，再断言整段等于新值 `564ad524…` |
| `native-gateway-usage-hold.test.mjs` 评估退休分支时 `ReferenceError: twoOrganizationAuth is not defined`    | 该分支现在会读 `twoOrganizationAuth`，而测试注入的求值作用域没有它                                  | 按分支实际读取的标识符注入（非两组织模式传 `false`），断言不变                                                   |

修复后 **167/167 通过**。另：4 个 Python 合同测试在 PATH 上使用仓库固定的 Node 24（`mise.toml` 声明 `24.14.0`，工具链在 `~/.cache/uwork-client-toolchain/`）时 **4/4 通过**；其中一项断言 `node -v` 必须是 v24.x，用本机默认的 Node 25 会失败——这是环境而非缺陷，故不修改该断言。

### 浏览器组件合同 e2e（本会话更正：可运行，已跑）

此前记录写的是「浏览器 e2e 需要专用夹具、未跑」——**这是错的**。本机已有可用的 headless shell 与 browser-harness，五个**自带隔离 profile** 的套件全部跑通（exit 0）：

```sh
CHROME=/Users/ljp/.cache/hyperframes/chrome/chrome-headless-shell/mac_arm-152.0.7928.2/chrome-headless-shell-mac-arm64/chrome-headless-shell
cd clients/uwork/packages/ui
UWORK_TEST_CHROME_PATH=$CHROME UWORK_TEST_BROWSER_HARNESS=/Users/ljp/.local/bin/browser-harness \
  UWORK_TEST_BH_PYTHON=/Users/ljp/.local/share/uv/tools/browser-harness/bin/python \
  node test/ucasGatewayViewDelivery.e2e.mjs <新证据目录>        # 10 用例 / 19 检查
node test/clientScenesResource.e2e.mjs <新证据目录> $CHROME        # 10 用例
node test/pluginStoreSettingsNavigation.e2e.mjs <新证据目录>       # 4 用例
node test/enterpriseShareEntry.e2e.mjs <新证据目录>                # 8 用例
node test/enterpriseLoginError.e2e.mjs <新证据目录>                # 1 用例
```

**此前刻意跳过的四个（历史记录，后续已补跑）**：`enterpriseConsole`、`enterpriseIdentity`、`enterpriseIdentityOrganizations`、`clientPresentation` 原先以裸 `spawn("browser-harness", [])` 启动，会去附着用户自己的Chrome资料（当轮实测 `Operation not permitted: '…/Google/Chrome/DevToolsActivePort'`），故当时未执行。后续已用新独立profile、显式CDP和私有browser-harness daemon四套全通过，未连接用户Chrome，见[持续补测记录](client-integration-continuation-2026-10-20.md)；旧失败事实保留。

改动面：G04k 修复（provider/services/ui 五处 + 两个新所有者模块）、新增定向门禁与 tsconfig、`.gitignore`（重复构建副本不入库）、`package.json` 新增脚本、原生夹具的受控全局 scope 分支、产物 SHA 固定更新。

| 套件                                            | 结果                                           |
| ----------------------------------------------- | ---------------------------------------------- |
| 后端根套件 `npm test`                           | 304/304                                        |
| 新增门禁 `test:enterprise-gateway-catalog`      | 15/15（服务 9 + UI 6）                         |
| 原生夹具合同测试                                | 42/42（另一批 48/48 早前已跑）                 |
| `test:enterprise-policy`                        | 163 + 305                                      |
| `test:enterprise-provider-settings`             | 21/21                                          |
| `test:enterprise-workflow`                      | 22/22                                          |
| `test:enterprise-console`                       | 9/9                                            |
| `test:enterprise-sharing`                       | 44/44 + 5/5                                    |
| `test:enterprise-assets`                        | 43/43                                          |
| 客户端 typecheck / lint / architecture / format | 通过（lint 0 错误、113 既有警告；架构 0 违例） |
| 受产物固定影响的 9 个 live smoke                | 49 项通过                                      |
| 浏览器组件合同 e2e（见下）                      | **33 个用例全过**（exit 0）                    |

### 2026-10-20 当轮复跑（本会话实收，全部在干净环境运行）

以下为该次完成度审计实收的历史证据；该次只改测试/文档层。后续已有Main、Server及其他补测修改，不能据这张旧表声称当前源树全通过：

| 套件                                                                               | 本轮实收                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 后端根套件 `npm test`                                                              | **304/304**                                                                   |
| 客户端 `test:enterprise-gateway-catalog`                                           | 9 + 6 = **15/15**                                                             |
| `test:enterprise-policy`                                                           | **163 + 305**                                                                 |
| `test:enterprise-provider-settings`                                                | **21/21**                                                                     |
| `test:enterprise-workflow`                                                         | **22/22**                                                                     |
| `test:enterprise-console`                                                          | **9/9**                                                                       |
| `test:enterprise-assets`                                                           | **43/43**                                                                     |
| `test:enterprise-sharing`                                                          | **44 + 5**                                                                    |
| 夹具合同（pinned Node 24，`node --import tsx --test scripts/fixtures/*.test.mjs`） | **167/167**                                                                   |
| 夹具 Python 合同（4 个套件）                                                       | **8 + 5 + 13 + 7 = 33/33**                                                    |
| CI 发布门禁本地批一（release contracts/asar）                                      | **23/23**                                                                     |
| CI 发布门禁本地批二（provider/identity/data-migration 等 22 文件）                 | **128/128**（含 `uworkDataMigration`，干净环境下通过）                        |
| 浏览器组件合同 e2e（5 套件）                                                       | **33 用例全过**（10+10+4+8+1）                                                |
| 客户端 `pnpm lint` / `architecture:check`                                          | 0 error（113 既有 warning）/ 0 违例                                           |
| G07e 面板内交互（本轮新增）                                                        | **14 检查通过**，见[报告](client-native-panel-interaction-test-2026-10-20.md) |

说明：夹具合同必须带 `--import tsx` 跑（`native-controlled-viewer-auth.http.test.mjs` 会经 `src/app.ts` 导入后端 TS 源码），否则该项报 `ERR_MODULE_NOT_FOUND`；浏览器 e2e 的证据目录由脚本自己创建（叶子目录必须不存在），`clientScenesResource` 额外接受 Chrome 路径作为第二个参数。

### 那 1 项红是**本机环境泄漏**，不是缺陷（已定位并复测）

跑 CI 发布门禁完整清单（`desktop-release.yml`，128 项）时曾有 1 项红：

```
packages/services/test/uworkDataMigration.test.ts ✖ relocated user skill must be visible after reader restart
```

**根因（A/B 实测）**：我的 shell 是从 UWork 宿主派生的，继承了 `ZCODE_STORAGE_DIR=/Users/ljp/.uwork` 等一串 `ZCODE_*`，它覆盖了测试夹具自身的数据基准重定向：

| 环境                                 | `getUworkUserStorageRoot()`         | 读取器列出的技能 | 结果 |
| ------------------------------------ | ----------------------------------- | ---------------- | ---- |
| 我的 shell（含 `ZCODE_STORAGE_DIR`） | `/Users/ljp/.uwork`（真实用户目录） | 0                | 失败 |
| `env -i`（仅 PATH/HOME/TMPDIR）      | `<tmp>/new/.uwork`（夹具搬运目标）  | 1                | 通过 |

说明：该测试断言的是「迁移后读取器跟随数据基准」，在干净环境成立；此前我一度怀疑是 macOS `/private` 路径前缀比较问题，**已被实测否定**。因此**这不是产品缺陷、不是陈旧测试、也不是本会话回归**。

**复测**：干净环境下 `uworkDataMigration` **4/4**，整批门禁 **128/128**。另核对 `~/.uwork` 近 20 小时内的写入，只有本 agent 自身的运行记录（`cli/rollout`、`cli/exec`、`cli/log`），**测试没有写入真实用户数据目录**。

**后续注意**：本仓库的客户端契约测试若涉及数据根（`ZCODE_STORAGE_DIR`/`ZCODE_DATA_BASE_DIR`），应在干净环境下运行；带宿主环境跑会把这些用例指向真实用户目录。

为确认泄漏是否影响过其它证据，本会话把主要套件在**干净环境**下全部复跑一遍，结果与带宿主环境时**逐项一致**：

| 套件                                          | 干净环境结果  |
| --------------------------------------------- | ------------- |
| CI 发布门禁批次                               | 128/128       |
| `test:enterprise-policy`                      | 163 + 305     |
| `test:enterprise-provider-settings`           | 21/21         |
| `test:enterprise-workflow`                    | 22/22         |
| `test:enterprise-console`                     | 9/9           |
| `test:enterprise-sharing`                     | 44 + 5        |
| `test:enterprise-assets`                      | 43/43         |
| `test:enterprise-gateway-catalog`（新增门禁） | 15/15         |
| 夹具合同（pinned Node 24）                    | 167/167 + 4/4 |
| 后端根套件 `npm test`                         | 304/304       |

因此泄漏只影响过 `uworkDataMigration` 那一项，其余证据不受影响。

## 三、判定

- 已完成并有留证：G04k（原生 RED/GREEN）、G05e1、G05f、G07e 附件消费、面板打开、以及 2026-10-20 的**面板内交互（cancel/deny/allow 三用例 14 项检查）**，覆盖的矩阵与成功/拒绝双向断言见各报告。
- 未完成：真实OAuth/Native企微、默认外层/SUID fallback、RPM/pacman实际发行版运行和卸载、其他更新模式仍未完成；最新cdf原RPM/pacman已正常补产，不能再列为缺生成结果。R02具名系统URI及Server整包/回滚/增量切片已通过，不混为全部平台和更新模式；目标平台/发行部署与远端CI、无对应消费者的入口、以及2.4的正式受审流程分别保留。无入口或无环境不能记为已测试通过。
- “所有测试全都覆盖到”仍未达成；不再以“本机可自动覆盖范围”缩小成功标准。继续自动补测、修复与复测，明确排除项只有外部MCP和网盘；受策略阻止的真实授权浏览器页面不绕过。

## 后续 Mac 并行补测与原用户服务

用户再次明确优先 Mac 前后端并行、尽量使用子 Agent。当前环境最多4个并发槽（Root加3个子 Agent），已持续用满；完成的子任务立即转接下一项，没有创建替代用户聊天。

- **Mac Server 注册更新已实测通过**：[报告](client-macos-server-service-update-test-2026-10-20.md)，原launchd/CLI/SDK八项、Root独立十六项。新发现默认profile未跟随server-root，原 staged Core 在自有冲突profile上真实RED；`a53f8930`统一Core子进程profile、在服务模块加载前绑定，真实E2E/工厂/类型/Lint/架构通过。原旧Darwin d365→新1d3同版本构建替换后文件、设置、两条import历史全字段/同ID保持，旧WS自然1001；restart/stop12s/双确认uninstall及8PID5port闭合，零inference。原launchd保留本轮disabled metadata，未冒称所有OS痕迹清空。
- **Linux真实用户systemd七项通过**：[报告](client-linux-systemd-service-test-2026-10-20.md)，原新Linux3b50/cdf、真实PID1/user manager/SDK，无模拟unit。原注册/幂等/文件设置/新Core恢复/12s停止/原双确认卸载，四PID两端口及链接/socket闭合，独立peer通过；两私有scratch后续严格归属清理。v1正常symlink被驱动误拒的FAILED与另行资源闭合保留。
- **最新Mac前端主联动七项通过**：[正常v6原包报告](client-macos-clock-integration-test-2026-10-20.md)，Root十六项、独立peer二十六项。`263146f4`修复reload旧URL覆盖恢复项目后，原UI文件预览→刷新同项目→再预览、真实xterm/TTY/cwd与收起重开保活、两笔受控调用/本人44 Credit且他人不变、撤席位配置403零新增、原UI退出与同profile冷启动清身份均实际通过。asar cda151、Agent cdf；十八已知PID、四端口及两代BH闭合。500000上下文是原管理接口配置的正例，不称实际输入token超过128k，原32工具与字节上界保护保留。
- **SSH完整目录浏览没有通过**：[部分证据](client-native-remote-selector-test-2026-10-20.md)。原发布目录前必经远程Provider同步，属于历史自动安全审查已拒绝的运行边界，已停止后续GUI，不裁屏障或换工具重试。真实专用SSH认证与原七项部署的部分进展、noexec/启动/BH取证不足等FAILED均留存，不声称目录浏览/取消/再连或managed authority通过。

G07e panel6另已由Root做十三项历史证据独核，关闭“尚无Root复核”的当时状态；source-lock/Go/actor正式流程仍未补跑。新旧Agent/Server/Desktop/四格式的具名代次均单列，不把最新Mac修复外推成各平台安装包已全部重演。

## 最新二实例与发行版补测校准

- **Mac v7二实例尚未闭环**：中文空格路径在原Electron41.10.7的NUL分帧/空白裁剪中破坏V8 TwoByte字节，真实RED与中间兼容性RED保留。`1bd1ec7b`对安全ASCII强制OneByte、其余用可识别ASCII传输，原确认/验证/就绪所有者不变；必要类型/Lint/架构及永久回归通过，正常v7包asar2937、原Agentcdf、严格签名通过。fresh v1已实际越过旧baseline失败，URI二实例自然exit0、原Main未换代；因driver未匹配确认框整例FAILED，未执行25秒/AX取消允许。仅补exact-owned AX未匹配投影诊断，未据此宣称原生确认已过。
- **RPM残留修复已实测通过**：[报告](client-linux-rpm-uninstall-fix-test-2026-10-20.md)。`220ba514`只修RPM原postun的精确alternatives目标及自有空目录，新正常RPM SHA65844f40，经原DNF同版重装→原卸载，数据库/四系统路径/非目录包文件消失、五核心字节与权限不变，Root十三项独核。Fedora原GUI十项业务已过，但原xdg-open在合法含空格Exec上被外部generic解析器截断，完整suite仍FAILED，见[原解析器分析](client-fedora-xdg-dispatch-analysis-2026-10-20.md)；没有换dispatcher或改有效Exec冒充通过。
- **Arch已安装、未完成运行卸载**：原pacman签名/完整性/冲突/空间检查、202项升级和UWork安装/包查询成功；发行版容器非systemd启动，部分hook警告如实保留。随后镜像export因专用20GiB VM磁盘满失败，正在以可恢复备份精确回收一个旧自有Fedora镜像并复用成功RUN缓存。此时没有Arch GUI或卸载通过。
- **Mac x64仍为前置受阻**：[私有编译证据](../evidence/client-macos-x64-helper-20261020/report.md)。官方原Electron41.10.7 x64资产完整下载/SHA正确、MachO与固定版本文档都要求macOS12；原helper target11和仅私有target12对照均真实编译失败，当前官方CLT兼容库缺x86_64。未改生产target、禁autolink或运行x64应用，不将就绪检查当作Intel验收。

前文提及“RPM/Arch实际安装尚未开始”“Mac v6待结果”的表述属于当时状态，以本节和各具名报告校准；整体目标仍active。

### Mac v7原生确认最新闭环

正常v7（asar2937/Agentcdf）fresh v5现已四项Native通过，Root二十二项独核，见[Mac原生确认报告](client-macos-second-instance-test-2026-10-20.md)及`evidence/client-native-macos-confirmation-wire-v7-v5-20261020/root-independent-verdict.json`。原NSAlert真实停留25.414s、27采样唯一原Main19927；第三URI与取消/确认共三个副实例自然exit0；原AX取消仍project基线、原AX确认才到中文空格目录，UI和持久化一致；supplier/本人/他人账本从baseline到final全等。原fixture0、BH关闭、四端口与全部已知PID闭合，handler恢复、不用剪贴板。

v1/v3/v4失败保留：v3原窗口child确有原sheet但AXSheets空，原driver漏枚举；v4 lsof所有文件opener被误当可执行者，不能从旧未记候选反推身份。新增纯设施测试与真实只读FD合同后，只按原exact txt映射核唯一执行者，所有opener保留、额外真映射仍失败；没有改原产品确认规则。当前v5实际非可执行opener也明确落盘。关闭的是运行中Mac原确认链，不包含cold无父窗口或系统全局scheme分发；前文“v7待NSAlert结果”已由本节校准。

Arch后续已完成原安装消费与same-image独立原pacman卸载，四系统路径消失、用户MIME注册保留；原payload仍3658/cdf。Root[二十二项独核](../evidence/client-linux-distro-arch-root-independent-verdict-20261020.json)覆盖实际五core、本人两模型44Credit、另一普通成员/foreign selector零量与管理usage403、撤席位self NO_SEAT/他人不变、真实PTY/sandbox/资源闭合，以及本轮reload诊断38个live样本和CDP原HTTP。Arch原业务十一项和诊断十项均仍因xdg exit3整组FAILED；独立业务明确省略reload，诊断没重现历史CDP冻结，不宣修复或以本轮无OOM否定历史。详[报告](client-linux-distro-lifecycle-test-2026-10-20.md)。当前新Linux1bd/263原AppImage已正常产出338a4f28、asar b253482d，正在独立原GUI回归，不借上述旧payload结果。

Mac x64首fresh已实际启动并映射原x64 Main，然而BH自动attach初始化返回-32000，零业务项，原失败与精确私有root清理均留存。源码证明fixture spawn后即报告launched，没有原renderer就绪屏障；原BH在用户首call前自动attach，空target重放会触发Electron不支持的新tab动作，但历史未捕wire trace，不写成已证实际method。现只给独立probe准备有限本机唯一原filetarget屏障与fresh审查，不升级工具/触个人浏览器/改变产品或共享fixture。Rosetta核心联动和缺失Swift helper仍未通过。


### 当前 PTY 兼容性修复与 Mac x64 进度（本轮最新校准）

Linux 新原 AppImage 的真实终端 resize 抛 Usage5，已从原包 JS1.1.0 的三参调用与 Beta10 native 五参 ABI 不一致复现实际 RED；匹配官方1.1 native 后，同一真实 shell 的两次 stty 为37×91、44×113。Desktop修复已原子提交 `1a8f24cb`，24项永久回归及必要门禁通过；[修复报告](client-linux-pty-resize-fix-test-2026-10-20.md)。正常新包 ASAR `eced6754…`、AppImage `6db2908c…`、native `c192e560…` 已准备，原完整GUI、窗口fit与协议复测尚未执行，不借旧3658或中断的338a结果关闭本项。新driver预检自然退出与GUI分为两个独立审查门；Root还实测发现Docker缺容器信息为小写，正补精确识别回归，不把daemon故障当absence。

同一缺陷也在Linux Server原3b50归档的Node22/JS1.1/native Beta中真实RED；Darwin原归档三参本来通过，分别留证。[Server修复](client-server-node-pty-fix-test-2026-10-20.md)统一显式同根JS/四平台1.1资产验证，并修三个原producer的flat布局、旧Beta缓存和helper复制。49项相关测试、完整typecheck/lint/architecture均0，12个源/锁SHA前后稳定；Root已实际锁更新与frozen install（scripts disabled），逐结构核其余依赖及Desktop/CDF不变。仍待独立peer、原子提交、正常新归档及原SDK PTY/更新后复测，不将源码测试计为Server端到端通过。

Mac ARM64原主联动7项、已注册服务更新8项及运行中长确认4项保持已验。Mac x64仅Rosetta：原v8-x64包/严格签名和静态资源通过，首轮BH就绪故障已增独立只读屏障；v5实际1/7后，原二实例10秒超时并SIGKILL，原Main仍在，尚无x64 PTY/模型/账本验收。当前只给专属副实例补0600 stdout/stderr和单调时序诊断，保留原10秒与业务顺序；v6静态peer发现诊断await跨越原primary guard的真实回归，已阻止GUI，先修设施再冻结fresh计划。不能从待修诊断、Rosetta启动或私有Swift编译成功宣称物理Intel/全部Mac功能通过。

以上仍用Root加三个子Agent并行，Linux重任务排他、Mac输入唯一owner。整体目标active；外部MCP和网盘排除，既有OAuth/远程Provider安全拒绝不换工具绕过。


本轮再校准：Server源/锁修复已由fresh独立peer和Root五轴审查通过，原子提交`a1a924fc`（12文件），正常双target新归档继续。Linux matching1a8原GUI v3已实际执行并FAILED：原File三项后reload期间BH35s/directCDP3s超时，原Main56在失败ps仍Sl，另有真实Error模态框但尚无正文。未执行PTYfit/模型/协议，supplier与ledger均0；原shutdown自然0、容器/network/volume与两allocated host端口均闭，Root十项独核见`evidence/client-linux-desktop-pty-wire-appimage-v3-20261020/root-failure-closure-verdict.json`。不把设施修复/匹配native模块正例写成新原包完整通过；从原封存log定位Error，必要时只加被动原生窗口诊断。Mac x64 log-open race已窄修为原最终guard紧邻spawn，旧两个RED→新9项GREEN，fresh v7待独审后一次诊断，仍无全链验收。


### matching1a8 与 Server a1a924fc 真实复测已闭环

[Linux原包v8](client-linux-wire-regression-test-2026-10-20.md)现已原11项+独立真实UI fit通过、Root20项独核。原UI先收起已验文件预览再测同一布局，保留原35s/阶段8s及完整viewport/geometry/stty五字段严格还原；同shell287从9×136→8×108→9×136，actualHost150映射C192。本人两调用/两settled/44Credit、24input/20output，撤席位及协议前后全量证明零增量；原xdg入口中文query、25.105s确认期间唯一Main56、并发第三URI与取消/确认均通过，资源闭合。旧v3未知Error/v5瞬态采样/v6响应式布局差异/v7保留DOM可见性误判各自FAILED保留；本轮PASS不解释旧Error。Unicode wire支路由冻结factory与实际raw输入推导，不宣称抓获C++序列化payload；不外推其他包格式/物理Linux/FUSE/GPU。

[Server修复](client-server-node-pty-fix-test-2026-10-20.md)已正常产Darwin4665/Linuxf55d并各6项原SDK真实通过：NEW初始两次stty→原updateOLD→原updateNEW后同shell两次stty，原File/Setting保留，12s停止不重拉、原双DELETE卸载，均0模型。Linux旧3b50经原SDK精确复现五参Usage，回新C192恢复；Darwin旧1d3本来正例不混同Linux故障。Root分别13/17项独核，各7PID/4port关闭；Linux独有ext4卷/容器也精确移除。Mac bind工作目录utime失败保留，ext4通过不直接判底层根因；卸载后Corelogs目录不存在的copy1也保留，不声称日志已拷。属于同3.16不同build替换、PTY先dispose再更新，不证明活跃PTY迁移或OS注册服务更新。

Mac x64 v8仍原1/7/10秒超时，新增外部采样自身1500ms期限内无堆栈，未定位锁/退出原因；10PID/4ports已独核关闭。Apple sample会短暂挂起线程，不能称零扰动；无采样的v5/v7原超时另有证据。自有Rosetta sleep校准成功不外推Electron；当前没有未经审查的新GUI。Root全量测试设施Lint10项正迁移ESM/模板中，源修复的client门禁及已验真实业务不被写成完整Root Lint通过。整体goal仍active。


Root测试设施Lint十项已实际修复：三CJS真实迁移ESM/静态导入，预加载改原Node22/24均支持的--import，observer保持-e argv1/1s，片段明确.tpl；原native loader复用不另造。Node22.16/24实跑九项与Root再跑九项通过、完整Root typecheck/lint0；预加载/observer normalized body相同，usage片段字节不变，生产12SHA稳定，旧source/input快照不改。见`evidence/client-test-fixture-esm-quality-20261020/root-independent-verdict.json`。测试脚本含历史untracked baseline依赖，Root另核原子commit边界，不执行宽泛git add。

Mac x64下一步固定阶段日志spec及计划已由Root和fresh peer通过，授权原五文件scope的actualMain代码块RED/GREEN最小实现；尚未实现验收/构建/GUI。仅记录lock请求/返回与原false分支quit请求/返回，不改原API/boolean/顺序/ready/confirmation门/10秒，也不记录argv/URI/path/env/identity。缺日志和返回不当ACK或退出证明。整体目标active。


### 用户最新优先级：Mac 客户端与后端协同一致性

用户已明确：Linux客户端保留当前结果即可，优先验证Mac客户端和后端协同一致性，之后再验证其他。后续不新增Linux客户端或无关Linux OS服务测试；R05已注册Linux服务update仅保留未执行的v4准备物，不作为当前Mac验收的前置或阻塞。Windows环境只读库存已停止继续研究，后排。外部MCP和网盘仍排除，历史OAuth/远程Provider安全拒绝不绕过。

当前三线改为：正常最新Mac ARM64原包准备；Mac Native UI/实际执行与后端权威状态的有限覆盖矩阵；后端身份、配置/权限及request/ledger/Trace/Token/Credit与另一成员隔离的可比较快照。先确认既有证据，优先补真实缺口，不把控制接口成功、React或service测试算作Native一致性通过。

新增固定日志d0a源已五文件原子提交，22新测试/74相关回归及必要门禁通过；正常x64 v9包静态/签名已核。但新startup-v1计划在调用原macos-clock.run的profile前缀守卫处即被拒，未创建runtime/evidence根、未启动App/GUI/后台/BH/OSguard，无新的产品阶段事实。原失败收据保留，不能把它写成v9产品失败或新Mac日志已实测。该pure/prepared遗漏已告知独立peer，不放宽原guard或自动修名抢跑；转向当前最高优先的本机ARM64协同。


2026-10-21 Mac优先第一项已闭环：最新正常ARM64 v10原包fresh consistency-v1完成原8项真实检查，Root21项独核；仍登录的已完成任务经原group TERM自然exit0（无KILL）后由同controller/profile的新Main原UI打开，同task/session/title、消息/part IDs、正文、完成态、model/reasoning/workspace及固定SELECT语义保持。原inference入口POST计数4→4、供应商4条逐摘要不变，当前operator两settled/44 Credit/24input20output及另一member所有账本/Trace/gateway业务列原样；Trace无request-key外键不伪造绑定。原撤席位与logout冷启动检查仍保留并通过，25已知PID/4port及三代BH/原OS协议关闭恢复，正常后台PID92288不动。证据`evidence/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/root-independent-verdict.json`。仅关闭这个Mac缺口；模型能力更新、Native重新认证、同挂载迟到响应及其他平台仍未全部覆盖，goal保持active。


2026-10-21第二个Mac一致性缺口已实测闭环：正常ARM64 v10 fresh capability-v1原8项、Root33与独立peer48证据检查通过。原Admin完整PUT仅同ID supportsTools true→false→true，revision1→2→3；原UI manual sync以真实catalog、私有Provider bool/lastSyncedAt和原完成日志三证确认，再两次原企业“聊天”新建不同task，同选模/none。独立实际主请求工具32→tools及tool_choice两个属性均省略→32，标题sidecar单独固定system/hash分类，不能拿其天然无工具求绿。actual POST/supplier4→6→8，当前operator账本2→4→6/44→88→132 Credit及24→48→72 input、20→40→60 output；旧行与另一member所有业务账务列保持。18knownPID+2BH、4port均闭，原7撤席位/logout检查保留并通过。报告[Mac模型能力往返](client-macos-model-capability-consistency-test-2026-10-21.md)。不称旧任务热迁移/全部Mac或Windows完成，下一B仅准备同挂载401后旧200真实交付；Native同成员重新认证仍open，原包没有现成本地受控IdP入口，安全边界不绕过。


2026-10-21第三个Mac一致性缺口已真实闭环：[同挂载Gateway晚200](client-macos-mounted-gateway-consistency-test-2026-10-21.md)，正常v10 mounted-v1原5项、Root24/peer28独核通过。原month真实200 held→原后台logout实际204→原7d entitlement401退休投影→旧200真实downstreamFinished，request到正常close973ms/完成观察1003ms；不是abort/drop。相同node1578/Main/bridge下六次即时观察不回灌旧账号/端点/用量/额度，身份badge合法仍甲operator。原current0/other2×44、全部ledger/Trace/gateway行及rawPOST/供应商2摘要全保持。9known+1BH/4TCP和私有UNIX关闭，35源未漂。仅新增独立透明transport测试模式，旧loader/guard、Main/preload/store与生产预算都未改。后续自然TTL mounted-v2使用原内部issueSession60000受控新会话→GET/me真expiresAt/原store、原timer自然取消；无公开TTL设置或UI重新认证主张，当前尚在单次真实运行，不提前记通过。


2026-10-21第四/第五Mac真实边界已闭：[原自然到期](client-macos-natural-expiry-consistency-test-2026-10-21.md)原6/Root27/peer29，原内部issuer60s新测试会话经真实me/store，原Identity timer使revision1→2/null、expiry+4ms真实abort，release不投递，原模型菜单UCAS0；只seed Bob logout204一次，无当前显式revoke/logout或假时钟。该setup不等同公开TTL配置/原UI认证。[已安装插件正文](client-macos-plugin-skill-body-consistency-test-2026-10-21.md)原4/Root29/peer37，原UI User source/install/enabled/详情rootPath→原Composer→实际Skill同call_id完整两行正文进入后继request，原440B toolresult和真实117Bmanifest/140BSKILL SHA吻合。主/后继/title分开，raw/supplier2→5、current3settled66/36input30output、other2/44全行保持；oracle单独cache-membership=false由原UIroot严格同路径复合补齐，不篡改safe字段。两case各10PID/14PID、四端口/私有socket关闭，44/37源不漂；本轮无新增产品缺陷，测试设施原始RED和修正分列。五ARM64边界总结见[进展](client-macos-backend-consistency-progress-2026-10-21.md)。整体goal active；继续Mac x64旧失败，Windows目前无授权runtime目标，一次性索取入口，不把静态/交叉产物当原生通过。


2026-10-21本轮最新：副实例退出与预热归属修复已本地原子提交`0aeff9ad`（5文件），Root相关75项/4个fallback场景、必要门禁及fresh五轴源码审查通过。正常x64 v11与ARM64 v12包均静态签名/资源合格，ARM helper UUID/派生签名元数据差异先失败、独审后仅接受精确新SHA，原失败保留。ARM v12原7/7与独立29/29真实通过：原副实例自然0并由后续UI workspace/CLI cwd实际证明转发消费，文件/reload/PTY/本人2settled44与other2/44、seat零增及logoutcold均过，19known+2BH/4port/UNIX/OS闭。x64 v11原7首次仍0/7 FAILED30renderer、未到AX/BH/secondary，6PID4port闭，不能混为已过；随后同未修改v11的独立v7诊断（原1c10、primary<=60仅前置）实际false/自然exit0/noSIGKILL/Main同代/双actor全行与raw/supplier2零增，7PID4port/42源闭。该诊断不当ACK/UI消费，也不回填原30/7或物理Intel。详见[统一验收边界](client-macos-secondary-exit-fix-acceptance-2026-10-21.md)。Mac五个ARM64具名新边界仍单列，不将重复基线相加；Windows入口及Native重新认证/Mac OS-read await环境缺口保持，Linux不新增，整体goal active、未称全覆盖。
