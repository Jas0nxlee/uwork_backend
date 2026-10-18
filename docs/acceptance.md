# 实现与验收台账

2026-10-18，Asia/Shanghai（历史分轮证据保留原日期）。构建结果代表本地自有实现，不代表 WorkBuddy 完整服务端复现、生产上线或外部供应商批准。

| 模块                       | 实现位置                                                            | 本轮证据                                                                                                                                                           | 边界                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| identity                   | identity.ts / wecom.ts                                              | 登录/退出、组织隔离、企微 state/proof/取消竞态、同步停用旧会话不复活                                                                                               | 企微 provider 为受控测试，真实逐组织扫码待验                                                                                 |
| directory / access-control | directory.ts / access.ts                                            | 成员/部门/角色/席位、最后 owner、越权拒绝                                                                                                                          | 本地组织 CRUD 为自有扩展，企微只同步                                                                                         |
| entitlements               | entitlements.ts                                                     | 并发预留、幂等、订阅月末、断流保留额度和对账                                                                                                                       | 整数 Credit 非供应商最终账单                                                                                                 |
| model-gateway              | models.ts / gateway.ts / network.ts                                 | 真实本机 HTTP、JSON/SSE、异常终态、SSRF 拒绝、密钥出口权限                                                                                                         | OpenAI-compatible；一个真实文本/代码工具/视觉/思考参数模型已验，供应商发票待核实                                             |
| credential-vault           | vault.ts                                                            | 数据库无原文、吊销、列表脱敏                                                                                                                                       | 环境主密钥，需生产密钥托管/轮换运维                                                                                          |
| ai-assets                  | assets.ts / connectors.ts                                           | 不可变版本、审核发布、撤权、MCP session 与工具白名单                                                                                                               | 技能文本包；不执行任意上传代码                                                                                               |
| client-policy              | policy.ts / client.ts                                               | 草稿不生效、旧修订冲突、发布版本、安全优先级、CIDR/deny-all                                                                                                        | 后端执行入口生效；完整终端本地 enforcement 待验                                                                              |
| agent-runtime              | runtime.ts / agent-\*.ts / automation.ts / evaluation.ts / sandbox/ | SDK 计量端口、真实 Docker/MCP 工具循环、取消/撤权/预算/去重、代码及远端工具 SIGKILL 恢复                                                                           | MCP 为受控工具子集；真实模型代码循环已验，其他供应商能力待验                                                                 |
| telemetry                  | telemetry.ts / client-usage.ts                                      | 审计/Trace/CSV/聚合、成员统计隔离、改状态端点审计不变量（静态+行为测试）、企业留存窗口（7–3650 天 + 每小时仅清理已配置企业 + 管理端面板）                          | 原始 prompt 不入日志；任务内容加密；日志归档到外部对象存储按企业部署补齐                                                     |
| external-integrations      | integrations.ts                                                     | 未配置 503、实际 Docker 能力检查                                                                                                                                   | 网盘适配网关合同；支付 unavailable，自有沙箱非外部云服务                                                                     |
| admin-web                  | admin/                                                              | 实际登录，部门新增/修改/删除，配置草稿保存/发布；1432/768/320 布局，无横向溢出                                                                                     | 未逐个实际供应商表单验收；本地截图在 ignored evidence/                                                                       |
| uwork-client               | src/client.ts + clients/uwork/                                      | Host 私有企业会话转发、无模型 Key 的真实 SDK/打包 CLI/Native 对话、停止及退出拒绝；成员企微绑定浏览器实测；类型/Lint/架构检查                                      | 本地菜单/新会话/分享/个人策略 Host 应用已验；远程工作区、云/移动渠道与三平台安装待验；连接器可执行代码与取消仍按后端网关语义 |
| member-sharing             | src/sharing.ts + src/sharing/ + src/sharing-viewer.ts               | 组织只读分享的存储/授权/限额/幂等；实际 Electron 正常对话与 UI 发布、跨仓真实 HTTP、文件库 Cookie 登录与浏览页；无席位成员查看及他企业/匿名/终端凭据/撤销/停用拒绝 | 企微 provider 为受控替身；默认浏览器/剪贴板、Native 附件选择器、签名安装包与三平台未验；PDF/图片只下载不解析，不扫描恶意软件 |

逐页面台账：`docs/reverse-engineering/page-capability-ledger.md` 由 `scripts/build_page_ledger.mjs` 从 55 个控制台页面观察与人工映射生成，列出每个页面的实现模块/端点、管理端视图、验证引用、状态与缺口；`tests/page-ledger.test.ts` 保证观察与映射双向完整、状态合法、部分/外部项都有缺口说明，并核对台账声称的后端端点确实存在、管理端视图 id 真实存在、文档不漂移。当前分布 43 已实现 / 10 部分实现 / 2 外部依赖，缺口集中在云/移动/协作与终端安装（T13c6/T13d）、自定义菜单 iframe 免登、真实支付与网盘服务；本机已支持项不继续标为未接线。

企业内会话分享：后端合同由 `tests/member-sharing*.test.ts`（含真实 TCP、独立文件库与 Cookie 会话的重开/撤销回归）覆盖；跨仓真实 HTTP 闭环由 `scripts/client-organization-sharing-live-smoke.ts` 覆盖，使用真实 Host 源码（真实私有 BackendSession、`createUWorkSharePorts`、真实 `ConversationShareHttpClient`）发布，再由同企业无席位成员、他企业成员、匿名请求、终端凭据分别读取，并检查撤销、策略关闭、成员停用、附件在 files 关闭后的元数据/字节差异、只读导入拒绝与 1 MiB 确认预算；客户端侧 `npm run test:enterprise-sharing`（services 5 个文件 + UI 2 个文件，49 项）覆盖受管通路选择、有限请求预算与 UI 权限映射。真实逐企业扫码、签名安装包与三平台仍属未验边界；本功能不做恶意软件扫描，不解析 PDF/图片。

实际 Native 发布补验：新正常 Desktop 候选完整副本在本机 Electron 运行，经正常工作区入口发送一次文本，再点击原分享入口、选择、披露确认并发布；真实 ShareService/CLI 投影/私有 scope 完成 prepare 201、confirm 200，新增 confirmed 恰一条、三公开行、摘要一致。主对话和标题共两次本机受控模型请求、44 内部 Credit 已在分享前结算，发布零增量。同一 Native 产物由同企业无席位 reader 读取 200；匿名、退出旧 Cookie 401，只读 continuation 403。实际 Header 旧 OAuth 门槛的八场景由 4 失败/4 通过修复为 8/8。该 URL 仅后端派生，未点复制或打开；独立浏览页验收不冒充 Native 默认浏览器链路。十三个已知 PID、五端口独立收口，外部写 FD 下保留私有测试根。详见 `docs/client-member-sharing-test-2026-10-18.md`。

后续独占 Native 已实际点击原打开按钮，确认 Desktop 是应用内浏览面板；新 guest 的同源中文分享页、JS/CSS 200、匿名正文隐藏/preview401及独立 session 网络记录通过。后续地址栏输入没有形成管理页导航，未运行登录、授权后阅读或退出，不拼接先前独立浏览器结果作为此链路完成。原三组失败、soft96 后停止业务与精确资源终态见 `docs/client-native-share-browser-test-2026-10-18.md`；系统默认浏览器、剪贴板及跨平台仍未覆盖。

企业用量界面的迟到视图、用户与 service 更换、在途周期退休及 busy 隔离已修复：同一永久组件测试旧 Hook 为九项失败、一项冷同步对照通过，修复后十项全部通过；正常类型、Lint、架构、格式、十一项既有 Gateway 服务回归及 Desktop 构建通过。该测试控制合法公开 DTO 的交付次序，不替代真实 Native 注销或网络竞态发生频率；详见 `docs/client-gateway-view-delivery-test-2026-10-18.md`。共享 Enter 驱动另在同版本 Electron 三个表单验证，普通回车补文本及单次驱动等待上限已修复；它不改写历史 Native 导航失败，详见 `docs/client-native-test-driver-2026-10-18.md`。

浏览页新增真实验收：独立 Chromium 148 通过原页面按钮发起企微 attempt，再经受控 provider 与原页面 Cookie claim 登录；没有注入 Cookie、Token、React 或业务 RPC。五阶段通过：匿名不见正文、无席位成员正文与两次 UI 下载、实际退出后附件 401、B 企业正常登录后访问 A 返回 404、owner 取消/确认撤销后正文与附件 404。三个 claim 均观察到实际 HttpOnly、SameSite=Strict Cookie 且 JSON 无 token，四种宽度（320/768/1024/1440）无水平溢出，脚本错误和页面未知外网请求为零。最终 80 文件封存于 `evidence/client-enterprise-sharing-viewer-live-final-20261018/`；前两轮驱动观察错误保留，不混称产品失败。独占进程自然退出、端口拒连与写者零后清根；真实企微仍未覆盖，Native 发布由上一段单独取证。

当前门禁：后端 301/301、跨仓真实 HTTP 3/3、客户端分享 49/49；类型、Lint、接口台账、架构与正常构建通过。完整后端格式门禁仅被原有无关未暂存测试副本阻挡（保留原文件），自有变更格式检查通过。自有插件实际 Native 十二阶段与三代冷启动、设置“浏览插件”修复及清退边界见 `docs/client-native-owned-plugin-test-2026-10-18.md`，不将官方插件运行或全部 Workspace 纳入该通过范围。

主服务于 2026-10-18 06:13 UTC 首次恢复运行；原 PID 29003 的终态与端口关闭经确认后，08:09 UTC 以同一正常命令独立启动为 PID 42125。08:12 UTC 核验 `http://127.0.0.1:3000/` 首页和健康均 200，原九业务表 hash 不变、分享表为空、reserved 为零、四个 admin 资产一致。首次恢复前的私有在线备份、有意部署四个新资产、六个旧资产可精确恢复而一个历史副本缺失的事实均保留，不把新部署叫作原样恢复。详见 `docs/local-backend-recovery-2026-10-18.md`；独立测试通过与主服务运行分别取证，未再次执行主库管理员登录或模型调用。

自动验证：`npm test`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run ledger:check`、`npm run build`、`npm audit --audit-level=high`。跨仓库合同验证：`node --import tsx --test scripts/client-contract-smoke.ts scripts/client-policy-contract-smoke.ts scripts/client-assets-contract-smoke.ts scripts/client-assets-host-contract-smoke.ts scripts/client-assets-rpc-contract-smoke.ts`，共 6 项，另加 `scripts/client-connectors-mcp-contract-smoke.ts` 的连接器闭环与 `scripts/client-organization-sharing-live-smoke.ts` 的组织分享闭环，使用真实适配源码和受控企微 provider/本机 HTTP，未调用真实企业凭据。

自动化结果：后端 232 项测试通过，0 失败/跳过/取消（第六轮补齐 Cookie Origin、通知业务确认与 64 KiB 边界、Agent 版本冻结及 Session 串行/隔离；前五轮回归保留）；类型检查覆盖生产、测试和验证脚本，Lint/格式/生产构建通过，前轮依赖审计 0 个已知漏洞。UWork 适配仓库此前 services 233 项、CLI core 60 项与跨源码十个脚本共 12 项通过；精确 Node 24.14.0/pnpm 10.33.2 的 root/CLI 类型、严格测试类型、格式和架构检查（0 violations）通过。Root Lint 为 114 warnings/0 errors；CLI Lint 14 个任务成功、0 errors，17 个范围内包中 3 个未定义 lint，已有 warnings 如实保留。根 frozen install 重验成功，根/嵌套锁摘要不变。CLI 是依赖父仓库共享包的 private 子工作区，正式发布使用 root workspace 构建；不把嵌套目录宣称为独立源码安装项目。跨源码/组件测试不能代替真实企业与已安装平台验收。本轮后端真实 TCP、磁盘库、Docker、浏览器及安全负面场景的独立记录见 `docs/backend-system-test-2026-10-15.md`；后续记录见 `docs/live-business-test-2026-10-15.md`、`docs/live-more-test-2026-10-15.md`、`docs/live-third-test-2026-10-16.md`、`docs/live-fourth-test-2026-10-16.md`、`docs/live-fifth-test-2026-10-16.md` 和 `docs/live-sixth-test-2026-10-17.md`；本轮没有重复声明客户端平台验收。

Host 准入：独立适配副本中的 CLI 使用现有 PermissionService 承载不可由项目/yolo/Hook/用户审批覆盖的企业裁决端口，反向 RPC 绑定当前连接和工作区。Host 每次向真实后端查询当前订阅、渠道和安全策略；私有身份代际、共享会话修订、issuer 与配置指纹阻止退出/撤权/换端点后的迟到允许。已进入受管模式的 Host 遇到配置消失仍拒绝，显式 UCAS 保留旧行为。原生前台/后台进程另行准入；受管 HTTP 强制手工跳转与公网出口，并逐跳裁决目标域名。拒绝会发布工具终止错误。

资产准入：后端新增绑定当前发布版本和 checksum 的 asset 动作；真实 loopback HTTP SDK 测试证明旧版本下载冲突、未发布草稿不改变绑定、发布换版/撤权/撤审核后拒绝。高风险技能受危险技能策略限制；列表和下载受当前订阅/IP/席位保护。技能包拒绝 C0/C1 控制字符、孤立 Unicode 代理项、Windows 保留设备名、NFC/大小写/文件目录冲突，中文和合法双代理 Unicode 路径仍可用。此项是后端合同与路径验证，不代表实际 Host 已完成安全安装/撤销。

受管缓存与 Host 编排：独立适配副本的严格资产测试为 26 项（16 缓存、2 选择代次、8 Host），覆盖不可变版本、校验和/路径/树篡改、软硬链接、未知目录、并发初始化、320 次交错校验、取消/失效与实际 SIGKILL 暂存恢复。此前复核独立 3,200 次交错校验无失败。新增双 Host 真实文件系统回归先复现旧同步删掉较新成功目录，再以磁盘选择代次修复；清理先在原文件锁内比较/推进代次，网络不持有锁。实际 HTTP 下载内容可由现有 NodeSkillAdapter 显式根加载；新增实际身份服务/共享会话/HTTP/Host 生命周期测试验证登录事件预热、缓存复用、换版、撤权拒绝与退出清理。Root 已装配该私有维护服务；随后已接入真实 stdio、Runtime SkillPort 与专家子智能体所有者，并通过本轮跨源码 HTTP/stdio 回归。Playbook/指令按已观察兼容边界明确拒绝下发 UWork，不能用落盘冒充生效。观察事件只含 traceId/操作/状态/时长/稳定错误码。两轮 Host 复核后无新增实质问题；Cross-model skipped: non-interactive context.

技能目录 RPC 基础另加 6 项桥接回归，使严格资产测试合计 32 项。目录与工具准入共享原 32 槽 pending/取消，拒绝伪造工作区、缺失 Trace、过期连接、无效/超界响应和超时。实际 HTTP Host 测试的复用/换版改由真实 CLI 协议工厂/Host 桥 JSON 往返验证；独立协议测试检查可信工作区/Trace、输入边界、取消与响应校验。复核先复现真实协议客户端显式回收不能取消同步，随后用客户端唯一 disposal signal 修复，保留 transport close 语义并避免重入进程清理/监听异常阻断。三轮复核最终无剩余实质问题。Host 请求路由、CLI bootstrap/SkillPort/composer 附着及正文前后授权现已接线；`scripts/client-skills-stdio-contract-smoke.ts` 通过实际打包 CLI stdio 验证。T13b 自有实现已勾选，已安装 Electron 与三平台验收仍属 T13d。

连接器接入：客户端目录只带连接器元数据（无目录、无正文、无远端地址），加载时经服务端取一次掩码描述并绑定该不可变版本；MCP 帧（initialize/notifications/tools）经既有反向 RPC 交给 Host，由 Host 用私有后端会话转给 `POST /api/client/connectors/:id/rpc`，CLI 侧没有后端凭据、远端地址或远端会话，帧与响应都做真实内容断言。连接前、连接后与每次工具调用前后各做一次 `asset_load` 准入（绑定当前 ownerKey 与版本/校验和）；拒绝、取消、超时或撤权只减少一个 server，不回退到本地语义，已注册工具在下次调用失败关闭。后端另补 `DELETE` 会话显式回收与按连接协商并回放的 `mcp-protocol-version`（请求体不能改写已建立连接）。跨源码 `scripts/client-connectors-mcp-contract-smoke.ts` 用真实打包 CLI、真实反向 RPC/协议端口、真实 loopback 后端 HTTP 与受控远端 MCP 验证握手/工具发现、逐次准入、撤权后不再连接。仍是受控远端，不是真实第三方 MCP 服务或三平台验收。

跨仓库 `scripts/client-policy-contract-smoke.ts` 使用实际 executor、协议端口、Host bridge、身份所有者与共享会话库，以及真实 loopback 后端 HTTP 和 Node 进程，验证默认禁止、发布允许后返回 42、Hook 期间发布撤权、退出登录、协议输入上限和迟到取消。协议传输是进程内 JSON 往返，不是已安装 Electron stdio/真实企微/远程工作区验收。任意原生进程不等于 OS 沙箱；混合文件/网络限制不能证明时明确 unsupported，不声称已隔离。完整资产/UI/远程/三平台集成仍未完成。

工具协议：真实 HTTP 上游完成 function tools JSON 请求/响应、assistant tool_calls、tool 结果及 SSE 片段重组；缓存重放不重复调用上游。显式 opt-in、工具定义/历史参数上界、重复/未知函数、非法 JSON、稀疏片段、禁止并行均有回归；合法调用伴随非法 usage 或成功缓存写入失败时，不向消费者发送工具调用。协议代理与实际代码工具循环分开验证。

SDK 闭环：每个模型轮次均经过现有 Gateway 授权和 Credit 账本，SDK tracing 事件为 0。真实 Docker Agent 在同一个工作区连续两次工具调用，先写文件并观察 UID1000，再读回 42，随后返回最终答案；取消/撤权/总超时实际移除对应容器。普通有席位成员无需管理权限可运行授权 Agent，但不能创建管理 Runtime 或读取其他成员工具历史。代码参数/工具结果加密，run/callId 去重与执行队列原子绑定，重复 ID 不重新执行、不同参数冲突拒绝、工具预算与模型轮次分别限制。

MCP 闭环：真实本机 HTTP 服务完成 SDK 握手、白名单清单、SSE 工具结果和三轮计量模型循环，相同 callId 只执行远端一次。MCP-only Agent 在 allowSandbox=false、local=false、agents=true 下成功；越权终端 scope、非法参数、危险 schema、发布版本变化、模型生成中撤资产或订阅到期均阻止分派。上游在 result 与顶层回显凭据/session 仍不会进入模型/客户端响应。取消、工具超时、连接丢失保留 REMOTE_EFFECT_UNCONFIRMED；真实分派后 SIGKILL 重启保留工具 uncertain/PROCESS_RESTARTED，清理本地 session，不重放模型或远端调用。未验证真实外部 MCP 服务；本地释放不等于远端已停止或 session 已删除。

网络回归：DNS 等待可以在解析返回前取消，已取消请求不启动解析；解析迟到不能继续分派。与已有公网地址校验、固定 DNS 连接和分派前的权限/凭据重查共同生效。

崩溃验证包括工具正在运行，以及工具已成功但第二轮模型尚未返回两个真实 SIGKILL 场景。中断父运行 failed/PROCESS_RESTARTED；前者工具 uncertain，后者保留已成功结果；两者都移除绑定的真实容器，模型/工具均不重放。停止失败故障注入证明工具不能误标 cancelled，父运行 failed/STOP_UNCONFIRMED、工具 uncertain；单次工具超时与父运行超时均记录 timed_out。

时限边界另验证较晚 provision 不重置父运行寿命，以及事件循环 timer 尚未触发但持久化预算已耗尽时不再分派工具。巡检发现父预算耗尽、Runtime 提前自然到期均归为超时而非撤权或用户取消。看门狗按 daemon 时间校准截止点并以剩余 duration 封顶；真实自然到期为 TIMEOUT，未启动容器不能因初始 exitCode=0 误判超时。

打包镜像验证：后端本身在生产镜像内以 UID1000、只读 root、cap-drop、无网络运行，仅通过专用 socket 的实际组权限控制同一 engine；受控模型在其 loopback。实际 SDK 完成两轮计量调用与一个子沙箱代码执行，子沙箱 UID1000、无 backend key/socket，最终资源移除。这不只是在 macOS 源码进程中调用 Docker 的验证。

跨源码故障注入覆盖旧二维码过期后重试、模型查询 503 与 Provider 写入失败；失败同步保留旧有效凭据，确认写入后才吊销旧凭据。管理端另核对模型、资产、Agent、用量、企业设置与概览路由的实际标题/错误状态，Runtime exception 事件为 0。

备份：只读在线 snapshot 不迁移源库，目标独占创建；持久化重开、第二实例拒绝、失锁后 HTTP/写入拒绝、恢复期间心跳均有行为测试。独立 macOS 宿主与 Docker 容器共享临时库的实际验证确认拒绝跨命名空间接管、原 running 记录未被恢复程序改写。本地真实库升级前已生成保护快照。

故障注入另覆盖 SQLite BEGIN IMMEDIATE 失败后的重试，确保嵌套事务深度未被污染、后续写入仍持锁校验租约。验证脚本清理采用 allSettled，首个删除失败不会跳过其余资源；失败资源的归属恢复信息仅写入 0600 文件，不打印 owner token。

容器：专用 Colima profile `uwork-backend`，用户默认 Docker context 保持 `default`。镜像真实构建，并在独立数据卷验证非 root、只读 root、cap-drop ALL、初始化/登录/配置发布/重启持久化。沙箱实测 UID1000、watchdog UID999、无网络、无宿主文件/主密钥、资源限额、容器存活期工作区复用、错误归属拒绝、取消/超时/输出超限实际停止进程、租户隔离和 4 个容量上限。静默 16 秒执行超过 transport timeout 仍成功；后端 SIGKILL 后从持久数据库恢复并停止实际 running exec。验证脚本只清理自己持有匹配 owner label 的资源。

管理 UI：新增「用量聚合」视图（成员/部门/应用维度切换，`admin/src/Collection.tsx` 的只读筛选器），在受控实例上用真实账本数据验证三个维度分别得到 2/2/1 行、合计 45 Credit 与总览一致，320px 下文档宽度 320px 且表格内部滚动、Runtime exception 0；截图在 ignored `evidence/admin-usage-aggregates*.png`。

管理 UI：真实创建 Runtime、修改 revision、执行代码得到 `result=42,uid=1000`、查看 stdout、停止和删除，临时执行策略已删除、容器已清理。桌面与 320px 手机布局截图在 ignored `evidence/admin-sandbox-*.png`；手机文档宽度 320px，表格内部滚动，Runtime exception 0。菜单新增隔离 Runtime 与代码执行视图。

Agent 管理 UI 另在独立受控实例验证创建、发布、执行、刷新状态和查看工具参数/结果，实际 Docker 输出 `42 (UID 1000)`；新增 sandbox、maxTurns、maxToolCalls、toolTimeoutMs 控件生效。桌面与 320px 截图在 ignored `evidence/admin-agent-*.png`，文档宽度 320px，Runtime exception 0。受控域名隔离主实例 Cookie，验证进程/标签页/容器均已清理。

GitHub Actions 增加独立 Docker 验证 job；本轮未触发远端 CI，不把本地通过称为远端 CI 已通过。

REA：此前已复用 55 份页面和发布脚本证据并对 automation-fL5mZb_V.js 做受限静态分析；本次 homepage mapper 复核另记录在本轮复核报告。此前 automation Evidence `ev_85a402a75b3d029b9ea50cfc97260b5c1ba2a4df2e7f1e291ec3518a4f3970f2`，输入树 SHA-256 `406e7d1c32ef8f1ef19a9bedc0214164d254ed65d9b44d9eace765532919998b`，解析 1 个源文件，无解析失败；308 个文件未选择，覆盖为 partial。没有把静态候选当成已执行服务端契约。

## 尚未完成的项目级验收

- 自有企微每个实际组织的新扫码、真实 callback 和通讯录权限。
- 供应商账单对账、多模型覆盖及长时/负载测试；一个真实模型的文本生成和 JavaScript 工具循环已完成。
- 附加远程工作区完整企业准入、云/移动与组织协作渠道，以及 Windows/macOS/Linux 的实际安装回归；本机 Host 菜单（既有自动化/插件商店）、新会话、资产、分享与个人策略已通过源码/真实 HTTP/stdio/组件浏览器验收。
- 真实外部 MCP 服务对接与服务商侧 session/远端资源回收确认（本机受控调用及不确定性处理已通过）。
- 生产 TLS、目标主机备份演练、外部网盘、支付、生产沙箱部署和通知渠道验收。

这些项目级项保留为未验收，不能据本轮本地构建将 CAPABILITY-MAP 的整个产品完成标准标记为通过。

本轮代码复核与补齐的当前结果另见 [2026-10-15 复核记录](review-2026-10-15.md)，其中区分本地通过、跨源码通过和仍未完成的真实外部验收。

本轮合并快照：后端 135 项、跨源码十个脚本共 12 项、客户端 services 231 项与 CLI core 60 项通过；精确 Node 24.14.0/pnpm 10.33.2 的客户端类型、格式、架构（0）与 Lint（114 warnings/0 errors）通过。真实 Docker API/SDK/生产镜像 SDK 复核通过；专用 profile 已恢复初始关闭状态。T13c1–T13c5 的本地实现已完成，T13c6/T13d 与真实服务验收继续保留。

菜单后续选择：按用户要求映射 UWork 既有自动化/插件商店，独立企业页面导航撤下；保留兼容 ID 与当前菜单准入。后端 Agent API 作为独立能力保留，权限不再关联本地自动化菜单，具体跟进测试见本轮复核记录。

菜单调整跟进验证：后端 137 项、客户端 services 233 项及十个跨仓合同脚本共 12 项通过；精确 Node 24.14.0 的客户端类型/架构、9 项导航与权限回归、格式及 Lint（114 warnings/0 errors）通过。真实 Sidebar 验证默认/旧发布/自定义标题均进入既有页面 owner，打开菜单时 Agent/Assets/Runs API 调用数为 0；320/768/1440 与退出/卸载迟到响应回归通过。

## 真实模型代码工具跟进（2026-10-15）

使用用户已配置的真实上游与现有智能体，通过实际 HTTP 完成 Docker JavaScript 输出、运行中取消，以及“真实模型生成工具调用 → Docker 执行 → 第二轮模型回答”。上游 JSON 工具调用带可选 `index`，原严格响应校验将其拒为 `UPSTREAM_FORMAT`；新增仅限上游的 0–31 整数元数据兼容并在响应/缓存/后续消息前丢弃，客户端输入合同和工具准入不变。修前回归失败，修后 140 项全通过，类型/Lint/格式/构建通过。

真实复测两轮模型调用均 settled，聚合预留为 0，代码实际输出符合预期，临时 Runtime/容器已清理；已发布现有智能体的隔离代码能力，宿主命令与宿主文件权限仍关闭。首轮失败保留 uncertain 账目，未冒充供应商账单已核实。真实记录、配置快照和本地计量证据只保存在 ignored evidence，不提交凭据、模型服务地址或实际租户/运行标识。

后续真实业务验证完成资产审核/发布/换版/撤权、模型消费资产、会话续接、正反例评测、一次性调度、RBAC/席位/配额、幂等和设备吊销、在线备份独立恢复与当前容器镜像重启持久化。修复运行/会话搜索忽略 q，以及 SDK 信号处理导致应用关闭前退出、遗留租约两个问题。后端与专用 Docker profile 按用户要求保持运行；原模型和已发布智能体配置未改动。测试成员及资源已停用，自动化和临时策略已删除，评测引用及审计历史按 API 约束保留。外部接入仍遵循上述未验收边界。

第二批补测增加真实供应商 SSE 完整终态、同键三路并发、60 秒间隔实际到期/禁用与 endsAt 边界，以及持久凭据故障注入。首次配置未保存草稿却返回发布成功、重复发布 500 的缺陷已修复，七类配置实际磁盘/TCP 回归通过；运行实例已备份更新，五类未保存配置的十次发布均为 409 且状态/历史不变。主实例保持健康、原发布配置保持不变，未增加 uncertain 账目。

个人配置的 MCP Hub 清空操作此前发送空字符串，导致合法清除被后端拒绝；现仅该可空字段将空输入转换为 null，普通文本仍保留空字符串。真实组件事件回归先失败后通过，生产界面在独立实例验证保存和发布后的 null 值；这只是配置元数据测试，未连接外部 MCP。

第三批补测完成真实 Cron 触发、同会话并发入队串行执行，以及评测容量/取消/留存交叉边界。修复指标忽略模型/状态筛选、客户端按账目数计算请求份额且遗漏仅有成本的日期，以及 Host 地址错误接受 loopback FTP/WebSocket 等协议的问题。模型域名改为内网解析后，新增默认关闭的精确 HTTPS 模型 origin 例外，只允许该模型的 RFC1918/ULA 生成与探测，广域私网开关仍关闭，其他出口不变。原模型经实际私网 TLS 探测和三次生成验证，均 settled；备份更新后的主实例健康，原 Agent v4/安全配置保持不变。

第四批补测完成多租户切换、设备轮换/批量退出、并发最后 owner 与限流持久化、部门迁移/祖先作用域及策略交集。修复 Host 同步跨身份混用、取消后继续应用及迟到响应/旧下载版本问题，并保护草稿之外的当前发布分类引用，阻止失效历史分类重发布或重新启用。独立磁盘/TCP 回归及当前主实例五组实际检查通过；仅通过 API 解除前批两条停用测试资产的旧引用，原模型/Agent/安全配置不变，未新增真实模型生成或计量。

第五批补测修复初始化后随机密码遗失、失效凭据模型仍被列出、SSE 错误被视为成功、DONE 后继续读取，以及派发前存储失败残留预占。新增回归均先复现后通过，模型管理独立生产构建 HTTP 矩阵 65/65；当前主实例已备份更新，原模型/Agent v4/安全配置保持不变。两次真实供应商图像与思考参数请求均得到预期基础结果，新增 414 内部 Credit，原 uncertain 账目未处理。按规格审计补齐五组有限边界：人工核实金额/状态/并发/权限与跨租户、事件首写/隔离/字段、通知 pending 磁盘重启/截止/Feishu 载荷、锁定 Cron 库夏令时 UTC 投影、评测数量/长度/Unicode/空值/失败评分。后几组仅受控本地协议与显式测试时钟，无新增产品缺陷、真实通知账号或 DST 墙钟验收。详情见第五批报告；已排除外部服务与 T13c6/T13d 等项目级验收继续保留。

第六轮按现行模块规格与具名命令逐项复核：当前范围 116/116 个公开操作实际成功、17 组业务断言通过；15 个企微/网盘操作排除且无请求，外部 MCP 未连接，受控本机 MCP 仍测试。实际生产界面 26 视图、139 有名检查与四尺寸通过，十个专用 Docker 场景、七项严格网络检查通过；独立锁定安装成功、锁文件不变、当前依赖审计 0 漏洞。修复非 Bearer 头借 Cookie 绕过 Origin，以及飞书 HTTP200 业务失败被误记 sent；232 项测试、类型/Lint/格式/台账/构建通过，独立审查无阻断。主实例已备份更新并通过实际认证模型目录探测，原模型/Agent v4/安全配置/账本不变，本轮付费生成与新增 Credit 为0。详细范围、原始中断和清理边界见第六轮报告；项目级与排除外部项不据此关闭。

## 2026-10-17 客户端私有会话与后台用户管理验收

按用户要求，客户端全部源码已移入本仓库 `clients/uwork/`，后续修改、安装和构建不再使用外部客户端 checkout。当前 UWork 通过现有企业身份所有者读取后台配置，CLI 的上下文经 Host 私有会话转给后台；登录 Token 不返回 CLI/Renderer，模型 Key 只保存在后端 Vault。当前托管 Provider 只有 `enterprise-session` 访问方式，旧 device API Key 下载/写入路径已退出当前桌面链路；公开 device API 仅保留兼容。

- 后端 245 项、客户端 services 254 项、真实 HTTPS 9 项、实际 SDK 3 项、实际打包 CLI 4 项通过。另有 CLI 合同 8 项、后端会话授权 54 次 HTTP 检查和独立 Host 安全 6 项，覆盖身份伪造、席位/停用/额度/模型范围、编码回显、跨绑定及销毁。各层存在覆盖重叠，不相加为一个“总测试数”。
- 正式构建的原生 macOS Electron/Host/CLI 实际完成无 Key 流式对话、用量展示、旧终端凭据迁移、停止后约 4ms 转 uncertain、退出及重启后拒绝。原生测试使用自有临时身份和受控供应商，不是已安装发行包或真实企微扫码验收。
- 管理端显示企微 UserId，owner/admin 可从成员行绑定；真实浏览器已验证保存/刷新，以及 operator 不显示绑定操作。已有角色、部门、席位、状态、模型范围、限量、本人用量隔离与管理员聚合复用原权限引擎。
- 修复模型能力/参数继承导致真实 SDK 400、身份迟到写入、新无 Key 访问模式重启丢失、工厂漏接出口准入、响应中凭据转义/跨 delta 回显和退出错误提示。中断或私有输出的已派发请求保留 uncertain；本机 Credit 预留不等于真实费用。
- 类型、Lint、格式、架构、构建与台账检查通过；客户端 Lint 保留 114 条既有警告，CLI Lint 保留 53 条既有警告，均 0 错误。后端镜像重新构建成功，clients 不进入后端 Docker 上下文。
- 主后端先在线备份再更新；实际登录、模型目录和已配置供应商 probe 成功。原模型、Agent、配置、成员/策略、Vault 和账本哈希保持不变，本轮新增付费模型调用为 0。

详细测试、原始失败与验收边界见 [客户端联动报告](client-live-test-2026-10-17.md)。真实企微、外部 MCP、网盘按用户约定未测试；Windows/Linux 安装、手机与远程工作区的端到端验收继续保留，不据本机证明关闭。

## 2026-10-17 企业用户完整链路补充验收

后端全量增至 249 项；新企业用户 HTTPS/Host 链路 24 项（935 次 HTTP）、客户端服务 259 项、旧 HTTPS 9 项、Core 15 项、实际 SDK 3 项、打包 CLI 5 项及合同/资产 13 项均通过。实际 Native 自动选模、有效额度与本人用量、额度恢复后的刷新、席位撤销/恢复、服务端注销清投影通过。修复当前成员映射、真实角色显示、共享限制下的有效余额、旧默认模型、无工具能力模型请求，以及拒绝后迟到响应/清理覆盖新投影的问题。主实例业务与原账本不变，无新增真实供应商生成。完整证据、计数重叠与外部验收边界见 [企业用户链路报告](client-user-journey-test-2026-10-17.md)。

## 2026-10-17 持续全功能覆盖进展

新增真实联动：资产跨企业/issuer 2 项（279 次 HTTP），缓存三故障 3 项（315 次 HTTP），Agent 子任务 2 项，builtin 文件/进程/网络策略 5 项（与原 stdio/Agent 合计 12 项回归），分享 5 项（299 次 HTTP，另 26 项回归）。实际 Native 又验证了技能正文 v1→v2→撤权进入/不进入模型上下文、菜单/欢迎与风险提示草稿发布、旧可见菜单被撤权后的点击拒绝、自动化派发/渠道拒绝/重启、个人模型创建/发现/运行及同会话撤权。修复“权限拒绝被写成格式错误”和“个人模型撤权显示内部码”两条 UI 提示，单元 RED→GREEN 与重建后 Native 复测通过，权限逻辑保持不变。

目标尚未全部完成：指定企业专家、绑定任务 resume、个人技能/本机 MCP 的生产入口、缓存并发/安装崩溃组合、可运行 Web/remote 及平台边界仍逐项保留。真实企微、外部 MCP 和网盘继续排除。以 [持续覆盖矩阵](client-integration-coverage-2026-10-17.md) 为本目标当前任务状态，不以既有绿灯或新增数量代替全范围验收。
