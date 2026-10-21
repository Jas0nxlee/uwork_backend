# UWork 联动持续补测（2026-10-20）

范围更新：用户已允许真实企微测试，当前按 [真实企微测试范围](client-real-wecom-spec-2026-10-20.md)核验实际接入。外部 MCP、网盘仍排除。下文旧轮次的“真实企微排除”是历史边界，不代表当前范围。

## 当前状态与未完成项

目标仍 active，尚未达到“所有测试全都覆盖”。以下是本轮并行补测的当前状态；后文按轮次保留历史结果，历史“VM已停止”、测试数量和产物版本不代表此刻运行状态或当前改动已全部通过。

| 能力                               | 当前证据与边界                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实企微                           | 可信IP生效后真实只读API、主库备份的隔离副本两次目录同步、配置/Vault和授权URL/state取消/拒绝通过；原浏览器URL被Computer Use策略明确拒绝，已停止该页面操作。真实OAuth成功、成员会话及Native登录仍未闭环，见[报告](client-real-wecom-test-2026-10-20.md)。                                                                                                                                                                                           |
| 普通成员禁用→恢复→重认证           | 同一真实Host/profile两次执行恰两条本人settled、14 Token/18 Credit；禁用/恢复后旧token、旧owner proof均拒绝，新owner完整同步后恢复。v5及默认owner联合回归通过；隔离email会话不是企微SSO/Native按钮，见[报告](client-member-reauth-recovery-test-2026-10-20.md)。                                                                                                                                                                                   |
| Linux普通用户Chromium sandbox      | 原AppImage UID1000、无关闭产品sandbox的开关，CDP精确renderer PID与内核Seccomp=2/NoNewPrivs=1/独立user、PID、net namespace通过；默认外层seccomp原包拒绝启动。结论限定v6首实例，不代表新版协议、物理Linux或全部进程sandbox，见[报告](client-linux-sandbox-test-2026-10-20.md)。                                                                                                                                                                     |
| Linux四种包格式                    | 2cd3fb4e阶段异步Main输入的AppImage/deb字节保持原样，释放GUI后原RPM/pacman单target分别成功；独立四格式消费/20核心SHA/20公共权限通过。保留此前禁网与OOM失败；最终YML仅pacman一条，不代表完整更新feed、签名或发布。rpm/Arch真实安装、FUSE/GPU/物理Linux仍开放，见[最新格式报告](client-linux-native-formats-async-test-2026-10-20.md)。                                                                                                              |
| Linux原生协议与Main（R02具名范围） | 同步确认阻塞握手已修复并提交`2cd3fb4e`。AppImage v16完整11项/21原动作通过，原Main55确认25.231秒并发URI后仍唯一；同源普通UID已安装deb仅在支持userns的临时外层容器中通过取消/允许、25.109秒并行、唯一Main68及零模型/账本，原purge通过。默认外层拒绝及上游SUID含空格路径仍保留；v13/观察器RED不覆盖，见[Main报告](client-second-instance-confirmation-test-2026-10-20.md)与[deb对照](client-linux-deb-protocol-test-2026-10-20.md)。                 |
| Server CLI原包update               | 三个具名原包切片已通过：整包生命周期v3七项、候选启动失败回滚v1八项、增量/坏组件摘要/整包fallback v2九项。归档属主与manifest原文字节两修复分别提交`1a0e2c93`、`63121013`，正常重建及原包复测通过；同版不同SHA替换不冒称跨版本，force运行任务、注册OS服务和其他平台仍开放。见[整包](client-server-update-test-2026-10-20.md)、[回滚](client-server-update-rollback-test-2026-10-20.md)、[增量](client-server-component-update-test-2026-10-20.md)。 |
| Native Gateway晚回包与过期         | 同面板服务器401后原旧200真实成功交付仍不回灌，5项通过；另一组原60秒TTL自然到期、原store清空/请求abort、UCAS候选清退6项通过，模型/账本/Trace均0，见[晚200](client-native-gateway-mounted-late200-test-2026-10-20.md)、[自然到期](client-native-gateway-expiry-test-2026-10-20.md)。                                                                                                                                                                |
| Native Read真实等待中撤权          | v3六项通过：同包原CLI regular-file lease与内核\_\_break_lease，原publish/Skills UI确认false后解锁；Read完成后原before_result扣留正文，63字节错误模板SHA精确匹配，allow对照真实正文入后继模型。5本人settled/110Credit，资源闭合，见[报告](client-native-pending-read-test-2026-10-20.md)。                                                                                                                                                         |
| Server更新后持久状态               | v9原SDK六项通过；修复新发现的时钟问题后，新cdf Agent/原包v11七项通过：原file/settings/model与两条导入历史跨update/restart同ID、全字段保持，三WS原1001关闭，零chat。空Task懒持久化/plan兼容映射按原合同保留，见[状态报告](client-server-update-stateful-test-2026-10-20.md)。                                                                                                                                                                      |
| SQLite启动计时修复                 | SQLite启动wall-clock回拨误报已修复并提交`1db59c77`：真实schema/SQL/BUSY/rollback四永久红绿与两peer独立GREEN，原持久时间/跨进程租约不改。正常重建新cdf Agent/7774 Server原包，实际新Agent两进程回拨下schema ready；stateful v11七项/17独核及Root新AppImage v17完整11项通过。旧v10产品RED保留，见[时钟报告](client-sqlite-startup-clock-test-2026-10-20.md)。                                                                                       |

## 此前已完成的具名切片（历史轮次）

最新：[Linux PTY 与 deb 实际安装](client-linux-pty-installer-test-2026-10-20.md)补测通过：原 xterm 实际写文件/活 TTY/面板保活；原 deb 真实安装后从系统链接启动，再跑九项/21 原动作及真实后台两调用/44 Credit、撤席位零增量。dpkg purge 系统文件/链接清理通过。修复本机缺 xz 及系统 ar 产出 96 字节假成功的问题，用 GNU ar 原流程重打有效包；无产品逻辑改动。协议注册仅落盘/原 fallback 成功，实际 URI 回调与单次未归因首启超时仍保留。资源独核关闭，VM 恢复 Stopped。

最新：[Linux 原桌面包与后台联测](client-linux-desktop-test-2026-10-20.md)七项、15 个原动作通过：普通成员恢复、文件/重载后重开、真实发送/本人两 settled/44 Credit、活包内 CLI/cwd、撤席位后零新增调用/账本。修正中英文不可用提示的授权检查指引，原子提交 `f4e97eb4`；两项回归及类型/Lint/架构/格式/正常构建通过。128k 窗口的正确上下文拒绝另留原证据；允许用例声明 500k 窗口且保留完整工具。九组测试资源独核关闭，专用 Colima 恢复 Stopped。

最新：[Linux ARM64 发行运行时和版本修复](client-server-version-test-2026-10-20.md)完成原包 RED→GREEN。发现并修复正常 Server 构建漏注入版本导致实际报告 0.0.0-dev、与 manifest 3.16.0 不同；五项永久回归、正常重建/macOS 服务六项及 Linux 原包八项通过。Linux 使用包内 Node22、无外部网络、真实 HTTP/WS/文件/重启/卸载；五组件与归档哈希独核一致。容器/卷清理，专用 Colima 恢复原 Stopped。

最新：[本机 launchd 服务注册与卸载](client-server-service-test-2026-10-20.md)六项真实通过。修复原 CLI 卸载/取消后 stdin 持有导致进程不退出，永久回归 2 RED→3 GREEN、联合 ESM 4/4；正常构建后原注册→幂等→重启→停止→双确认卸载自然 exit 0。类型/Lint/架构/格式通过，原子提交 `231c0919`。继续逐能力终审。

[默认浏览器外链](client-default-browser-test-2026-10-20.md)已由签名包 v4 的原菜单实际打开系统默认 Chrome，自有页网络回执与原生标签出现/消失双重确认；六项通过、10 个已知进程与 5 个端口独核关闭。未访问系统剪贴板。

[启动工作区覆盖缺陷](client-startup-workspace-test-2026-10-20.md)已取得真实 React 和签名包的 RED→GREEN；指定目录现在同时进入模型上下文与实际 CLI cwd。相关 React 24、原 IPC 10、fallback 3 项及新 Desktop 上 G04k 15 项通过。

最新补充：[原生打包态联动与分享复制](client-packaged-runtime-test-2026-10-20.md)已通过六项业务检查、完整退出与本轮 OS 状态恢复，夹具 170/170。v2 测试曾未恢复原剪贴板，旧内容无法找回；仅清除了已确认的测试链接，守卫已修复并在 v3 复测，事故不被后续 GREEN 覆盖。继续核验启动期间显式工作区意图与默认浏览器外链。

最新继续结果：[Native B 原选模/发送](client-native-b-execution-test-2026-10-20.md)已通过 15 项业务与完整清理；修复两处夹具关闭错误及清理假阳性。另完成[macOS 打包补测](client-macos-packaging-test-2026-10-20.md)：修复目标架构辅助程序构建，4 项回归、实际 ARM64 编译/运行通过；v2 DMG/ZIP 验证及最终 v3 `.app` 构建/签名通过。打包态原应用启动联动和 OS 分享出口仍继续自动推进。

该轮新增 **4 套浏览器组件场景、2 项真实后台/Host 跨组织执行测试**，修复测试设施问题并复测通过。目标继续 active；不将这些结果写成“所有功能全部验收”。该轮真实企微尚在排除范围，现已由用户纳入；外部 MCP、网盘继续排除。

## 新增覆盖

| 场景                            | 当前结果                                                                                                                                  | 证据                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| enterpriseConsole               | 真实 Sidebar/生产 dispatcher，菜单名称、撤权、迟到退出/卸载、个人入口与三宽度全部通过                                                     | `evidence/client-remaining-browser-contracts-v2-20261020/enterpriseConsole.log`  |
| enterpriseIdentity              | 登录生命周期、受控 native callback 端口、UCAS 提示/保存/重试、响应式与取消通过                                                            | 同目录 `enterpriseIdentity.log`                                                  |
| enterpriseIdentityOrganizations | 组织切换时旧 start 延迟/失败、重复返回重试通过                                                                                            | 同目录 `enterpriseIdentityOrganizations.log`                                     |
| clientPresentation              | 欢迎/风险展示、草稿/发布、退出与迟到响应通过                                                                                              | 同目录 `clientPresentation.log`                                                  |
| 跨组织真实执行                  | A 实际调用 → 原身份退出 → 同一 profile 恢复 B → B 自有模型成功；A 旧 owner proof 被拒，B 调用 A 模型 404、读 A 账本 403，供应商不增加调用 | `evidence/client-gateway-final-20261020/cross-organization-execution-green.json` |
| 跨组织未读响应                  | A 真实模型响应已打开未消费 → 退出 → B 恢复；读旧 stream 被拒且 chunk 为空，B 新请求仍成功                                                 | 同目录 `cross-organization-unread-stream-green.json`                             |

四套浏览器测试使用全新 headless Chrome profile、显式 CDP 和独立 browser-harness daemon，保留原脚本全部断言。它们验证生产 React 组件与受控服务端口，不能替代真实后台或 Native 操作。未连接用户 Chrome。首轮因 macOS 默认临时目录令 Unix socket 路径过长而失败，原日志保留；短 `/tmp/uwbc-*` 路径修复后四套通过。

两项跨组织测试使用真实后台临时 SQLite、HTTPS/TCP、身份服务、Gateway、ProviderRuntime、私有 Host relay 和受控本地 HTTP 供应商。身份初始值来自隔离后台 email 会话，经过实际 adapter.restore 与原身份所有者验证；不是 Native 组织登录/发送按钮测试。A、B 在执行用例中各有一条 settled、7 Token、9 Credit；A 账本在 B 操作后逐行不变。响应切换用例另运行两次供应商请求，不与前一用例混算。三监听端口关闭，身份/Provider 已 dispose，隔离根已清理。最初一次失败是安全断言 helper 固定解析 A 模型，现已显式接受当前模型 ID；不记为产品缺陷。

## 修复与验证

- 新增 `scripts/tests/run-isolated-browser-contracts.py`：独立浏览器、有限超时、短 Unix socket 路径；清理用私有 PID 文件 + 实际 Unix socket 属主验证 daemon。首轮清理条件误以为 daemon 命令行包含 BH_HOME，已修正；旧 daemon 经相同双重验证后停止。修复后用 `clientPresentation` 再跑，daemon/PID/CDP/socket 全部闭合。临时 profile 保留在新建的 0700 根中，未声称删除。
- 后端 Lint 原有 7 错：原生 Enter 驱动 CommonJS 导入 5 项、未使用变量 1 项、adapter 测试未使用导入 1 项。驱动改为 ESM `main.mjs` 并更新复制/哈希/启动路径；保留退出监听，删除未使用导入。没有关闭规则、添加 suppression 或跳过断言。历史封存的 CJS 证据保持原样。
- ESM 驱动真实 Electron 三表单用例均提交一次；两个 Enter 场景均观察到 keydown/keypress/keyup。原 Electron exit 0、6 个已知子进程全部关闭、CDP 拒连、Unix socket 关闭、零写 FD，测试 scratch 删除。见 `evidence/native-key-enter-esm-20261020/`。这只是驱动验证，不冒充原生产品功能。

| 本轮验证                                                                                 | 结果                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 后端 `npm test`                                                                          | 304/304，0 失败/跳过                                                                                                             |
| Gateway 全量真实 HTTP/Host smoke                                                         | 12/12，含本轮新增两项，0 失败/跳过                                                                                               |
| 原生夹具合同 `node --import tsx --test --test-concurrency=1 scripts/fixtures/*.test.mjs` | 167/167                                                                                                                          |
| Enter 协议 Python 合同                                                                   | 4/4                                                                                                                              |
| Enter 真实 Electron 表单                                                                 | 3/3                                                                                                                              |
| 后端 typecheck / lint                                                                    | 通过；Lint 初次 7 错保留于 `client-remaining-backend-checks-20261020.log`，修复结果见 `client-remaining-lint-green-20261020.log` |
| 客户端 typecheck / lint / architecture --changed                                         | 通过；113 既有 warning、0 error，架构 0 违例                                                                                     |
| 本轮修改文件格式 / diff whitespace                                                       | 通过                                                                                                                             |

## 仍需自动推进的具体边界

1. **Native B 真实发送已补齐**：见上述 15 项原生报告。B 两次真实本机调用、44 新增 Credit，A 无增量；与原先 12 项零调用证据分别保留。
2. **OS 分享出口**：真实复制按钮与系统剪贴板已由打包态 v3 验证；恢复事故及修复见上述报告。默认浏览器外链已由 v4 原菜单实测通过，详情见最新报告；G08f 自身仍只证明应用内 guest。
3. **本机打包形态**：v3 完成隔离启动、Host/CLI 发送、分享及退出；启动工作区覆盖缺陷已在 v4 包修复并实际验证模型/CLI cwd。`/Applications/UWork.app` 保持不变；不能据此声称 Windows/Linux、签名发行或部署完成。
4. 受审 source-lock/Go/actor 的正式流程没有被本轮补跑；不改勾 G04k、G07e 的正式验收层。现有 G04k GREEN 的 host/main SHA 与当前产物逐字一致，本轮只复核这一事实，不声称重跑 Native。
5. Windows、物理Linux/FUSE/GPU、其余平台协议并发回调、rpm/Arch安装、目标生产部署、远端CI，以及当前没有产品消费者的云/移动/助理入口继续分列。Linux普通UID sandbox内核、四格式消费、Server发行运行时、原桌面包、PTY、deb安装/卸载的具名切片已通过，各自不关闭整个平台；R02支持userns环境的系统URI及Server整包/回滚/增量具名切片已通过，默认外层/SUID fallback、跨发行版本/运行任务force更新和OS服务更新仍未关闭。没有环境或产品入口不是已测试通过。

先前完成度审计“本机可自动覆盖范围全部完成”的概括过宽，已撤回，应以本文件逐项状态为准。继续自动推进，不要求用户手动测试；真实企微已获准，受策略阻止的浏览器页面不绕过，外部MCP与网盘仍排除。

本轮收尾记录（2026-10-20 19:17，非今后恒定状态）：四个修复已本地原子提交，最终新Native v17及Server stateful-clock v11通过，所有测试容器已消失，专用uwork-backend恢复Stopped，其他两profile保持Stopped；正常本机backend PID92288/127.0.0.1:3000 health200。见 `evidence/client-parallel-round-close-20261020.json`。目标仍active，按剩余能力审计继续，不要求用户手动测试。

## 19:17 收尾后的下一轮并行执行

专用VM已重新启动，只用`colima-uwork-backend`，正常backend保留。三个独立owner分别推进：最新cdf Desktop的RPM/Arch真实包管理器安装运行卸载；原SSH远程选择器只读连接/浏览/取消/再连；macOS原launchd已注册Server更新和持久状态。Linux压缩与GUI由Root排他调度，尚未从准备状态预判成功。

注册服务前已发现新的具体隔离缺陷：原CLI只传`ZCODE_DATA_BASE_DIR`，Setting却按桌面home/HOME定位设置，显式Server root不能独自证明隔离；继承`UWORK_DATA_BASE_DIR`的优先级也需核对。子任务在临时HOME/Server root中先做真实RED，未在修复前注册服务或执行SDK设置写入。独立临时根、label及用户原目录保护是本次复测前置。

Root另对已封存G07e panel6做13项独立交叉复核，五唯一settled/110Credit、deny零正文、allow第4号请求正文、AX/WindowServer帧及取消结果一致。证据`evidence/client-native-g07e-panel6-root-review-20261020.json`，脚本提交`5a0fe63d`；没有新操作系统面板或重建历史PID关闭证据，source-lock/Go/actor正式运行仍未关闭。

用户随后明确优先核Mac前后端并行进展：`linux_sandbox` 已转为最新正常macOS前端原包/真实后台复测owner，`backend_linkage`继续Core隔离修复与Darwin原launchd更新，`coverage_audit`继续隔离Linux的原SSH metadata selector。Fedora/Arch原新包、两份已真验签rootfs及驱动保留，尚未真实安装运行，后续继续；不得因转派写成完成。Root另已确认专用VM真实systemd用户manager可用并准备原SDK File/Setting+服务生命周期driver，等待修复后原Linux归档，不注册旧有隔离缺陷候选。

随后两服务切片闭环：Mac registered update八项与Root十六项通过，修复`a53f8930`；Root正常产新Linux3b50/cdf并在真实systemd user manager七项通过，独立peer与资源闭合已完成。详见[Mac服务更新](client-macos-server-service-update-test-2026-10-20.md)、[Linux用户服务](client-linux-systemd-service-test-2026-10-20.md)。正常backend3000持续健康。

Mac前端两个新原包profile进一步复现reload项目恢复被旧入口覆盖，`263146f4`已窄修并经十二项Hook/原store、十项Main链与完整必要门禁；独立peer通过，正常v6包Native复测继续。完成Mac Server的子Agent已即时转接Fedora/Arch安装运行卸载；SSH子Agent因自动Provider同步落历史拒绝边界停止GUI后，完成Mac纯peer/systemd独核，再准备Mac单实例原OS确认切片。持续用满4槽，不把工具并发数不足转成用户新聊天。

### 最新结果与继续入口

正常Mac v6主联动现已完成七项Native、Root十六项和独立peer二十六项：[报告](client-macos-clock-integration-test-2026-10-20.md)。原文件/刷新恢复、真实PTY/cwd与收起重开、两笔受控模型与本人44 Credit/他人不变、撤席位配置403零增量、原UI退出和同profile冷启清身份均通过；不是Mac全部能力完成。原上下文500000为合法管理接口正例，不代表实际token超过128k。

Mac二实例另实收中文空格路径底层传输RED，`1bd1ec7b`修复后正常v7包严格签名及五资源SHA已验。fresh v1实际baseline成功、URI二实例自然exit0、原Main未换代，但driver未匹配NSAlert，长确认和取消/允许未执行，整例FAILED及资源闭合保留。现只新增exact-owned AX投影诊断，fresh plan独核后进行一次定向观察；不改原确认匹配保护或产品流程。

RPM原卸载悬链/空目录已由`220ba514`修复，新原包经真实DNF同版重装→卸载及Root十三项独核通过，见[报告](client-linux-rpm-uninstall-fix-test-2026-10-20.md)。Fedora原GUI十项业务通过而系统URI仍失败，原因已定位外部xdg generic误截合法含空格Exec，完整suite保留FAILED，见[分析](client-fedora-xdg-dispatch-analysis-2026-10-20.md)。Arch原202项升级和UWork安装/查询已成功，镜像export遇专用VM磁盘满，正在保护成功RUN缓存、以已独核可恢复备份精确回收旧自有镜像继续；尚无Arch GUI/卸载通过。

Mac x64前置独立推进：官方原Electron x64资产SHA已核、最低macOS12已双证；原helper target11及私有target12均因当前CLT缺x64兼容库编译失败，未修改生产target或运行x64包。见[证据](../evidence/client-macos-x64-helper-20261020/report.md)。所有平台缺口、历史安全拒绝和外部MCP/网盘排除保持，整体目标active。

本轮后续：专用测试VM在Arch export/unpack两次ENOSPC后，Root先核可恢复镜像备份，仅回收原自有Fedora消费者；仍不足时保留成功RUN缓存，以原Colima入口把唯一uwork-backend数据盘20→40GiB。配置diff只有disk一行、CPU2/内存4/全局Docker context不变，其他两profile仍Stopped、正常backend3000健康，证据`evidence/client-colima-disk-extension-20261020.json`。扩盘后同冻结Arch context复用CACHED自然build0，原pacman数据库与五核心SHA/大小/公共权限proof0，普通用户GUI仍等实际结果，不以安装/导出替代联动。该专用盘40GiB配置保留，测试结束仍恢复VM初始Stopped。

Mac x64原正常producer也已自然产包并严格签名0；原helper不可用单列，未改生产target或Builder。新v8-x64实际8资源、11个选定native均x86_64、源hash、旧v6/v7不可变字节通过Root31项静态核验，`evidence/client-macos-x64-package-v2-root-verdict-20261020.json`。尚无Rosetta主联动/ABI验收；独立严格loader/fresh plan准备后再按[范围](client-macos-x64-integration-spec-2026-10-20.md)执行，不改共享arm64 fixture。

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
