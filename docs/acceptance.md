# 实现与验收台账

2026-10-15，Asia/Shanghai。构建结果代表本地自有实现，不代表 WorkBuddy 完整服务端复现、生产上线或外部供应商批准。

| 模块                       | 实现位置                                                            | 本轮证据                                                                                                                                  | 边界                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| identity                   | identity.ts / wecom.ts                                              | 登录/退出、组织隔离、企微 state/proof/取消竞态、同步停用旧会话不复活                                                                      | 企微 provider 为受控测试，真实逐组织扫码待验                                                                                 |
| directory / access-control | directory.ts / access.ts                                            | 成员/部门/角色/席位、最后 owner、越权拒绝                                                                                                 | 本地组织 CRUD 为自有扩展，企微只同步                                                                                         |
| entitlements               | entitlements.ts                                                     | 并发预留、幂等、订阅月末、断流保留额度和对账                                                                                              | 整数 Credit 非供应商最终账单                                                                                                 |
| model-gateway              | models.ts / gateway.ts / network.ts                                 | 真实本机 HTTP、JSON/SSE、异常终态、SSRF 拒绝、密钥出口权限                                                                                | OpenAI-compatible；真实付费模型待配置                                                                                        |
| credential-vault           | vault.ts                                                            | 数据库无原文、吊销、列表脱敏                                                                                                              | 环境主密钥，需生产密钥托管/轮换运维                                                                                          |
| ai-assets                  | assets.ts / connectors.ts                                           | 不可变版本、审核发布、撤权、MCP session 与工具白名单                                                                                      | 技能文本包；不执行任意上传代码                                                                                               |
| client-policy              | policy.ts / client.ts                                               | 草稿不生效、旧修订冲突、发布版本、安全优先级、CIDR/deny-all                                                                               | 后端执行入口生效；完整终端本地 enforcement 待验                                                                              |
| agent-runtime              | runtime.ts / agent-\*.ts / automation.ts / evaluation.ts / sandbox/ | SDK 计量端口、真实 Docker/MCP 工具循环、取消/撤权/预算/去重、代码及远端工具 SIGKILL 恢复                                                  | MCP 为受控工具子集；受控 HTTP 模型不等于真实供应商验收                                                                       |
| telemetry                  | telemetry.ts / client-usage.ts                                      | 审计/Trace/CSV/聚合、成员统计隔离、改状态端点审计不变量（静态+行为测试）、企业留存窗口（7–3650 天 + 每小时仅清理已配置企业 + 管理端面板） | 原始 prompt 不入日志；任务内容加密；日志归档到外部对象存储按企业部署补齐                                                     |
| external-integrations      | integrations.ts                                                     | 未配置 503、实际 Docker 能力检查                                                                                                          | 网盘适配网关合同；支付 unavailable，自有沙箱非外部云服务                                                                     |
| admin-web                  | admin/                                                              | 实际登录，部门新增/修改/删除，配置草稿保存/发布；1432/768/320 布局，无横向溢出                                                            | 未逐个实际供应商表单验收；本地截图在 ignored evidence/                                                                       |
| uwork-client               | backend-client.ts + 独立适配副本                                    | 实际 UWork identity/gateway 源码联调、终端凭据轮换和退出吊销；受控 MCP 连接器经反向 RPC 接入既有 MCP 所有者；类型/Lint/架构检查           | 本地菜单/新会话/分享/个人策略 Host 应用已验；远程工作区、云/移动渠道与三平台安装待验；连接器可执行代码与取消仍按后端网关语义 |

逐页面台账：`docs/reverse-engineering/page-capability-ledger.md` 由 `scripts/build_page_ledger.mjs` 从 55 个控制台页面观察与人工映射生成，列出每个页面的实现模块/端点、管理端视图、验证引用、状态与缺口；`tests/page-ledger.test.ts` 保证观察与映射双向完整、状态合法、部分/外部项都有缺口说明，并核对台账声称的后端端点确实存在、管理端视图 id 真实存在、文档不漂移。当前分布 43 已实现 / 10 部分实现 / 2 外部依赖，缺口集中在云/移动/协作与终端安装（T13c6/T13d）、自定义菜单 iframe 免登、真实支付与网盘服务；本机已支持项不继续标为未接线。

自动验证：`npm test`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run ledger:check`、`npm run build`、`npm audit --audit-level=high`。跨仓库合同验证：`node --import tsx --test scripts/client-contract-smoke.ts scripts/client-policy-contract-smoke.ts scripts/client-assets-contract-smoke.ts scripts/client-assets-host-contract-smoke.ts scripts/client-assets-rpc-contract-smoke.ts`，共 6 项，另加 `scripts/client-connectors-mcp-contract-smoke.ts` 的连接器闭环，使用真实适配源码和受控企微 provider/本机 HTTP，未调用真实企业凭据。

自动化结果：后端 135 项测试通过，0 失败/跳过；类型检查覆盖生产、测试和验证脚本，Lint/格式/生产构建通过，依赖审计 0 个已知漏洞。UWork 适配仓库 services 231 项、CLI core 60 项与跨源码十个脚本共 12 项通过；精确 Node 24.14.0/pnpm 10.33.2 的 root/CLI 类型、严格测试类型、格式和架构检查（0 violations）通过。Root Lint 为 114 warnings/0 errors；CLI Lint 14 个任务成功、0 errors，17 个范围内包中 3 个未定义 lint，已有 warnings 如实保留。根 frozen install 重验成功，根/嵌套锁摘要不变。CLI 是依赖父仓库共享包的 private 子工作区，正式发布使用 root workspace 构建；不把嵌套目录宣称为独立源码安装项目。跨源码/组件测试不能代替真实企业与已安装平台验收。

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
- 真实模型生成/供应商计量对账及长时/负载测试。
- 附加远程工作区完整企业准入、云/移动与组织协作渠道，以及 Windows/macOS/Linux 的实际安装回归；本机 Host 菜单、新会话、资产、分享与个人策略已通过源码/真实 HTTP/stdio/组件浏览器验收。
- 真实外部 MCP 服务对接与服务商侧 session/远端资源回收确认（本机受控调用及不确定性处理已通过）。
- 生产 TLS、目标主机备份演练、外部网盘、支付、生产沙箱部署和通知渠道验收。

这些项目级项保留为未验收，不能据本轮本地构建将 CAPABILITY-MAP 的整个产品完成标准标记为通过。

本轮代码复核与补齐的当前结果另见 [2026-10-15 复核记录](review-2026-10-15.md)，其中区分本地通过、跨源码通过和仍未完成的真实外部验收。

本轮合并快照：后端 135 项、跨源码十个脚本共 12 项、客户端 services 231 项与 CLI core 60 项通过；精确 Node 24.14.0/pnpm 10.33.2 的客户端类型、格式、架构（0）与 Lint（114 warnings/0 errors）通过。真实 Docker API/SDK/生产镜像 SDK 复核通过；专用 profile 已恢复初始关闭状态。T13c1–T13c5 的本地实现已完成，T13c6/T13d 与真实服务验收继续保留。
