# 本机客户端联动阶段验收（2026-10-19）

> 逐条目标→证据的完成度审计见[客户端联动覆盖：完成度审计（2026-10-20）](client-integration-final-audit-2026-10-20.md)。

新增通过 [G07e 附件正文消费的企业准入](client-native-attachment-admission-test-2026-10-19.md)（真实 Electron 原生运行时，文本/图片/视频/PDF × 允许/撤销 19 项检查）：原 Composer 本地路径附件在 `allowFilesystem=true` 时正文进入模型请求、图片/视频/PDF 走媒体分支，撤权后正文与媒体载荷均 0 次；并核对正文由专用 prompt-attachment 消费者渲染，非 builtin Read。真实 NSOpenPanel 的**打开**已由 WindowServer 观测实测（菜单项「附件」→ 同进程新增 sheet → 拆解后 0 窗口）；面板内的路径输入与允许/拒绝/取消仍需辅助功能权限（`AXIsProcessTrusted()=False`、System Events 报 -25211；控制台未锁定，责任进程实测为 UWork.app），G07e 不勾选。另通过 [G05f 原生全局工作流「运行于」与 cwd/撤权](client-native-global-workflow-cwd-test-2026-10-19.md)：真实 Electron 上经原会话创建与权限允许保存工作流、经原「提升为全局」会话路径进入全局组，用原启动对话框「运行于」选择已打开项目运行；实际模型 cwd 与运行历史 run.cwd 逐字一致（均为该项目），撤权后同入口报 `工作流启动失败 enterprise_filesystem_denied`；16 项检查、29 个原界面动作通过，受审 Go/actor 流程未执行。另通过 [G05e1 原生自动化按钮](client-native-automation-buttons-test-2026-10-19.md)：真实 Electron 原自动化页手动创建（自定义每 1 分钟）→暂停→恢复→再暂停→跨过真实到期（58.1s 到期、等待 70.1s、零派发零模型调用）→删除取消→删除确认，13 项检查、23 个原界面动作通过，每步核对只读持久化；受审 Go/actor 流程未执行。另通过 [G05e 暂停后自然到期](client-automation-paused-due-test-2026-10-19.md)的 Host／完整 Main 切片：同一原 scheduler 跨 due 后 45.318 秒无派发、模型或账本新增，恢复后原任务与原 due 恰一次 succeeded，supplier／settled 2→3；Root 独核 20 已知 PID／三端口收口。原 Native 按钮未替代验收。正常后台已[独立备份恢复](local-backend-recovery-2026-10-19.md)。[G04k](client-native-two-organization-login-test-2026-10-19.md)的 v9 已实际复现 A 完整登录与同 owner 退出后，原菜单仍有一个可选 A 旧候选；[本轮已修复并真实复测](client-g04k-catalog-revocation-test-2026-10-19.md)：身份撤销同步撤掉托管目录准入、异步经原私有 Writer 清盘，真实后台／身份／Gateway／Writer／Registry 取得双向有效 RED 与 GREEN，六产物按正常命令重建，受影响 9 个 smoke 49 项全通过。该结果属 Host/源码层；其后[真实 Electron 原生渲染层](client-g04k-native-cdp-verification-2026-10-19.md)已补 A→原退出→菜单普查→B 重认证，修复前复现 `G04K_CATALOG_STALE`、修复后菜单为空而 B 仅得自有可选模型，两轮 0 模型调用、无 Send。该探针不是受审的 source-lock/Go/actor 流程，G04k 的正式验收层保持未勾选。178 公开文件及五已知 PID／四端口／BH 关闭已独核。12:58 UTC 正常后台九表保持、健康与入口 200；原系统附件及其他 Native 切片仍开放，整体勾选不变。

已完成下述原生登录、文件上下文、Web与插件安装到Skill正文消费的新增验收。后续复核补上成功连接后断线的 W02：真实失败复现后修复 RPC/UI 关闭与工作区恢复 Hook 序列两处问题，42 项回归、新完整构建和 v4 浏览器恢复通过，console0/script0，详见[W02报告](client-web-disconnect-recovery-test-2026-10-19.md)。随后[G09b](client-native-gateway-usage-logout-test-2026-10-19.md)完成原用量真实HTTP在途退出、原authority abort/drop与匿名原面板重开，Native计量增量0、console0/script0。新审计列出的[G04j推荐卡绑定](client-native-installed-plugin-suggestion-test-2026-10-19.md)随后完成原安装setup、启用mention/禁用纯prompt两阶段，八业务click、每卡测试源HTTP不增及Native模型/计费增量0，console0/script0；已知资源独立收口。此前“本机当前可运行独有切片已完成”的表述过宽，撤回该概括。U02–U05保持未勾，T13项不变。历史报告保持各自日期、候选和失败，不把旧用例数量冒称在当前产物全部重跑。

| 范围                         | 已接受的实际证据                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native空身份原登录           | [G04h v8](client-native-primary-login-progress-2026-10-18.md)：prelogin全0、唯一attempt/callback与Host私有claim；原主/标题2模型、2本人settled、2Trace、44 Credit；认证冷恢复、Gateway、原退出拒发与cold3保持退出。                |
| Native文件上下文             | [G07c v3](client-native-file-context-test-2026-10-19.md)：原mention/Back/发送，A Read正文3请求/66；同task B发送前撤FS后Read拒绝、无新B marker，新增2请求/44。Native5/110与独立2B/44分列。                                         |
| Standalone Web               | [Web v8](client-web-standalone-dom-test-2026-10-19.md)：Electron41原正常Web产物、Cookie/FirstRun/目录/预览/reload恢复11项通过；企业仍未配置，不含模型、自动重连或Chrome兼容声称。                                                 |
| Web断线与原重试              | [W02 v4](client-web-disconnect-recovery-test-2026-10-19.md)：实际关闭连接、错误页、四宽及原Tab/Enter Retry；同配置服务恢复后Cookie/项目/文件恢复，console0/script0。两处修复、42项回归及新正常构建通过；Native交互未由此替代。    |
| server-cli前台生命周期       | [W03 v3](client-server-cli-lifecycle-test-2026-10-19.md)：原serve/status、同root重复拒绝、restart/Core换代、显式新WS File/System哨兵、stop七事件通过；原PTY exit0、资源关闭，模型操作0。                                          |
| server-cli detached fallback | [W04](client-server-cli-detached-fallback-test-2026-10-19.md)：显式跳过OS注册，启动CLI退出0后Supervisor/Core归属保持；原status、File/System哨兵和唯一stop通过，2.715s/四事件，原PTY66321 exit0。                                  |
| 插件正文消费桥               | [G04i v5](client-plugin-skill-bridge-test-2026-10-19.md)：普通成员原Host/正常CLI安装非默认根；D/S禁启catalog与别名、A正文入模、同S撤personal.skills后未消费B拒绝且无B正文；5模型/5settled/5Trace、25 input/10 output、45 Credit。 |
| 既有本机入口                 | [持续矩阵](client-integration-coverage-2026-10-17.md)保留配置/菜单、技能管理、专家/工作流恢复、Main定时调度、个人能力、插件生命周期、分享发布及guest阅读退出等已验切片；正式CLI/Host与真实OS工具合同不按tool再套重复Native测试。  |

此前完成的两条产品修复：[freshDraft](client-fresh-draft-model-selection-test-2026-10-18.md)保留空目录新草稿待选资格，登录目录到达后只补模型，15项回归及v8原界面发送通过；[Read结果复验](client-read-result-authorization-test-2026-10-18.md)在释放正文前重查同owner/授权端口和当前权限，原deadline/取消不被迟到allow绕过，Core119/Host292、正常打包CLI真实OS五阶段与G07c原界面分层验收。G07c发送前撤权不冒称Native OS handler等待期间撤权。

前述Native/File/Web结果沿各自原manifest：CLI/stage正常dd0a、Desktop正常7fb08候选、Web/Server独立正常e111构建，不宣称在新产物重跑。G04i采用[legacy完整选型修复后的新正常构建](client-legacy-model-selection-test-2026-10-19.md)：7,325客户端来源、CLI/stage03adc56b及正常Desktop，标准根/CLI类型、Lint与架构通过；legacy真实RED2→GREEN9，严格缺失/非法档位拒绝保持。FileUI返回与身份缺失拒发5项是测试/spec修正，不为其单独重建产品，也不累加重叠测试数量。

W03另用源码a650的新正常构建：ESM builtin加载真实RED1→GREEN1，五项标准门禁/五条正常构建0，7,339来源稳定；Root先独核server-cli四文件，随后[六树独核](../evidence/client-post-g04j-boundary-audit-20261019/normal-all-namespace-independent.json)完整metadata/零FD/全SHA通过，较早不完整查询保留。该结果不声称前述Native/Web交互已在此候选重跑。此前另列的detached daemon边界已由W04复用同产物独立实测，不代表目标OS服务注册；Native G07e仍独立待验。

资源分别收口：Native v8为8已知PID/4ports/3BH，FileContext为已记录PID/4ports/BH及21 helper，Web为275已知PID/2ports；G04i v5原PTY实际exit0，[Root独核](../evidence/client-sharing-followup-root-review-20261018/plugin-bridge-v5-public-independent.json)29公开文件全SHA、4已知PID/4ports闭合。原不完整handoff或FD查询失败保留，由Root独核处理；保留私有根不能写成已删，也不能由PID/端口关闭推断零写者。未读/stat retained私有根或查询未知holder。

W03 v3的[Root独核](../evidence/client-post-g04j-boundary-audit-20261019/w03-v3-runtime-independent.json)另证17公开文件全SHA、33已知PID/两端口/control socket闭，fixture完整FD0；30子句柄实际closed，私有根保留0700。v1守卫误报、v2启动失败和FD不完整原封存保留。daemon/OS服务、安装更新卸载、Node22发行与目标平台不在W03范围。

W04的[独立核验](../evidence/client-post-g04j-boundary-audit-20261019/w04-runtime-independent.json)另证12公开文件全SHA、23子句柄实际closed，加Supervisor/Core/driver共26已知PID严格不存在、端口64420拒连及精确control socket闭；原fixture完整FD0保留、未重进私有根查询。未观察中间reparent、不编detached直接exitCode；根保0700，不扩OS service/install/enterprise/模型。

[G07e附件报告](client-attachment-consumption-test-2026-10-19.md)分列已通过的Core/Shared/Host修复与仍未完成的Native验收。v8六帧按键API返回不等于交付，未观察到GoTo路径输入框、未填路径或Send；101公开文件全SHA及5已知PID/4端口/BH关闭已独核。04:11:30 UTC的[最小控制台状态](../evidence/client-post-g04j-boundary-audit-20261019/current-console-state-v2.json)明确处于锁定状态，暂停系统输入重试，不归因为历史各轮的唯一根因。

G04i结束后，Root于2026-10-18 19:41:01.783 UTC确认主PID42125身份/cwd/DB正确，health及首页JS/CSS均200、字节SHA匹配，九业务表及四部署资产哈希不变。见[插件桥结束后的主服务保护](../evidence/client-sharing-followup-root-review-20261018/plugin-bridge-final-main-protection.json)。W02结束后的[最新只读核验](../evidence/client-web-disconnect-audit-20261019/main-final-protection.json)时间为2026-10-18 21:32:09.788 UTC，同样确认PID42125、HTTP资源及九表/四资产不变；未重启、重新部署、管理员登录或调用主后台模型。

后续于2026-10-19 01:41:24 UTC只读检查发现主服务仍健康，九表中七表与既定基线一致，`configurations`、`configuration_history`已变化；原九表一致检查因此真实失败，未改写为通过。[有限元数据核对](../evidence/client-post-g04j-boundary-audit-20261019/main-configuration-metadata-diagnosis.json)显示菜单发布更新时间为01:28:24 UTC。现有证据不足以归因；保留当前配置，没有回滚、重启或补写旧基线。后续测试继续使用隔离后台。

2026-10-19 02:22:23 UTC的[只读状态](../evidence/client-post-g04j-boundary-audit-20261019/main-current-final-state.json)及04:14:04 UTC的[Native8后核验](../evidence/client-post-g04j-boundary-audit-20261019/main-after-native8-final-state.json)再次确认原PID42125身份/cwd/DB绑定、health与首页JS/CSS均200、四部署资产SHA一致；相对旧基线七表一致，两配置表有差异。这不证明两配置表在两次核验间逐字相同，也不替代原九表一致检查的失败；未读取私有测试根、重启或重新部署。

剩余范围分列：

- **当前无入口/未实现**：热切企业、legacy共享技能UI、同Main第二Root、手机/云协作caller、managed远端企业authority、生产workflow灰度或offPeak启用来源。普通Docker File/System已验，不造新authority/票据/协作服务补数量。
- **目标环境未验**：签名安装包与Windows/Linux/macOS安装目标、OS选择器/剪贴板/默认外链、官方市场/公司库存及生产CI；unpackaged Electron不能替代。
- **排除/外部边界**：真实企微、外部MCP、网盘；受控supplier不代表外部模型账单，Chrome旧导航失败根因仍未知。Gateway在途用量退出已由G09b另验；G04i自有包正文消费不替代官方市场、任意插件代码、全部Workspace或跨平台安装验收。

G04i已以有限真实Host/CLI/FS实测补齐独有连接，没有重演G04f安装生命周期。其余场景仅在新增可用环境、明确新入口、相关产品变更或具体失败出现时追加验证。
