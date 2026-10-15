# 后端整体实际测试记录

测试日期：2026-10-15，Asia/Shanghai。初始源码 `811eff3`，后端配置修复 `092d1c3`，管理端修复 `897ffcd`。Node 24.19.0 / npm 11.12.1。

## 测试环境与证据

先只读检查现有环境：3000 端口无监听，数据库有 1 个组织，没有已配置业务资源或运行记录。本轮使用合成组织/账号、独立临时磁盘 SQLite、真实 TCP 后端进程和生产构建管理端；不改现有 `.env` 或业务库。模型、MCP、Webhook、网盘使用可观测的本机 HTTP/HTTPS 服务；企微使用显式注入的受控 provider。它们验证自有服务的协议与业务链路，不代表真实供应商账号验收。

本机 Docker 使用独立 Colima profile `uwork-backend`、context `colima-uwork-backend`。测试镜像 `uwork-backend:whole-test-20261015`，镜像 ID `sha256:d9468895dcdbe9cbf7fec1c70de177031c558229b0cce6bbb62aa36a2d1fc9ca`。镜像构建于 `811eff3` 加本轮 directory 修复的工作树，与随后提交的 `092d1c3` 产品源码相同；Docker 报告中的 baseline 是构建时 HEAD，不能误读为未包含修复。

运行证据存于 ignored `evidence/whole-backend-*`；它们不进入 Git，也不作为公开发布内容。汇总只保留路由模板、状态、计数和合成业务结果。

## 实际发现与修复

发现企业信息 PATCH 会整体替换 `tenants.settings`：将留存设为 14 天，再修改名称/联系人后，留存变为默认 90 天，`configured` 从 true 变 false。这样还会退出仅处理显式配置组织的自动清理范围。

`092d1c3` 改为合并联系人字段，省略联系人则保留原值，名称/联系人变更与审计在同一事务中。两条新增测试先用实际 HTTP 复现失败，再验证联系人变更及仅名称变更都保留留存配置；两条均通过。复现原始证据为 `whole-backend-settings-regression.json` 和 `whole-backend-shared-settings-regression.json`。

真实管理端还发现两类问题：

- 删除已被评测引用的数据集，后端正确返回 `409 DATASET_IN_USE`，但确认弹窗仍开着，错误放在其后的 inert 页面中，用户无法看到。修复为在当前弹窗内显示 `role=alert`，新开确认时清除旧提示，保留取消与重试。原始截图 `evidence/whole-backend-ui/dataset-delete-error-hidden-by-modal.png`。
- 企业信息表单默认发送 PUT，后端只注册 PATCH，实际保存返回 404。已明确使用 PATCH，并从已保存设置预填联系人，避免仅改名称时空表单覆盖联系人。原始截图 `evidence/whole-backend-ui/enterprise-form-error.png`。

两项管理端修复提交为 `897ffcd`。新生产构建 `index-mPjPVcE3.js` 已在同一真实后端上重新加载验证：PATCH 保存成功、联系人预填及仅名称变更后保留联系人/留存；320/1440 下弹窗内错误可被可访问性树读取、取消及再次打开清除旧提示、未引用的数据集实际删除返回 204。修后截图 `fixed-delete-error-320.png` / `fixed-delete-error-1440.png`。原始失败记录保留，另加修后通过记录。

## 真实 HTTP 业务流程

主流程 14/14 通过，执行编译后的 `dist/app.js`，开启真实 worker，使用磁盘 SQLite；所有正常业务状态通过实际 HTTP 创建/变更/读取。直接数据库操作仅用于初始合成账号 bootstrap，以及将合成事件时间移到留存窗口之外的显式故障注入。

| 流程                   | 已检查的业务结果                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 身份、组织、RBAC、席位 | 两组织隔离、成员/部门、角色权限、席位即时作用                                         |
| 凭据与模型网关         | 创建/轮换/吊销、真实上游 JSON/SSE、幂等及额度                                         |
| 并发与账本             | 20 个同时请求，16 个进入真实受控上游，4 个 429；预留最终归零，幂等请求不重复调用/收费 |
| 五类资产               | 审核、不可变发布版本、按范围下载；UWork 不支持的类别明确拒绝                          |
| MCP                    | 真实 TLS 握手、工具调用、白名单拒绝、凭据与远端 session 脱敏、会话回收                |
| 客户端配置             | 草稿不生效、发布后客户端读取与菜单/安全/个人策略裁决改变                              |
| Agent 与会话           | worker 实际执行、会话续跑、取消及超时终态                                             |
| 自动化                 | 一次性任务由实际调度 worker 触发，受控 HTTP Webhook 确实收到通知                      |
| 评测                   | 实际模型用例完成、分数聚合、取消运行中的评测                                          |
| 企微                   | 受控 provider 下 proof/claim 组织绑定、重复认领拒绝、取消与通讯录同步                 |
| 外部接入               | 未配置服务明确拒绝；真实 HTTP 网盘适配器健康/容量/文件/日志往返                       |
| 遥测与留存             | 非空审计/Trace/账本聚合、CSV、留存清理结果                                            |
| 撤权                   | 资产撤权后下载拒绝、设备 token 吊销后访问 401                                         |
| 持久化与恢复           | 实际进程更换 PID 后业务可用，在线快照复制到独立恢复库后名称/模型/加密凭据仍可用       |

完整检查名和时间记录在 `evidence/whole-backend-runtime-report.json`；路由模板与状态计数在 `whole-backend-runtime-requests.json`。这 14 项是业务场景组，不等于全部路由/参数/状态组合覆盖。

共享实例的 API/UI/安全探针流量保留在 `whole-backend-shared-requests.json`，初次归一发现 131 操作中有 7 项缺少正向覆盖，因此追加独立补测。合并 `whole-backend-supplemental-requests.json` 后，最终 `whole-backend-combined-requests.json` 按 method + 路由模板归一到运行期 OpenAPI 清单：**131 已注册 / 131 已观察 / 131 有 2xx，负面-only 与未观察均为 0**。2xx 只表示有成功 HTTP 响应，不能代替所有参数分支或真实供应商验收；异步业务终态另按场景断言。`/health`、静态资源、HEAD 和未匹配路径单独排除，不混入 131 分母。

7 项追加实际 HTTP 验证全部通过，使用编译后的 App、独立临时磁盘库与真实监听；初始化同一用户的第二组织 membership 明确标为 setup，其余被测行为走 HTTP：

| 操作                                               | 实际结果                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/switch`                            | 同一合成用户真正切到另一组织，角色 owner→auditor，旧 token 401、跨当前组织 403，再切回                                          |
| `GET /api/tenants/{tenantId}/permissions/{userId}` | 当前成员 active/seat、安全及可见模型投影符合真实资源                                                                            |
| `PUT /api/tenants/{tenantId}/usage/{id}/reconcile` | 上游真实派发 1 次，返回非法 JSON 后网关 502、账本 uncertain；按受控供应商独立记录核实为 15 Credit，重复核实 409，不增加上游调用 |
| `PUT /api/tenants/{tenantId}/agents/{id}`          | 合法更新为 v2 并发布，关闭/重开应用后名称、指令和已发布 v2 从磁盘保留                                                           |
| `GET /api/tenants/{tenantId}/runtimes/capability`  | 未配置时明确 available=false/image=not-configured，network/hostMounts/credentialInjection=false                                 |
| `GET /api/auth/wecom/callback`                     | 受控 provider 下真 GET state/code 完成验证，再 proof claim 获取对应组织/成员身份                                                |
| `GET /api/openapi.json`                            | 实际 HTTP 读取 OpenAPI 3.1.0，精确 131 操作，含切换/对账契约                                                                    |

对账过程实际观察到 in-flight reserved=374；uncertain 后 reserved=0、consumed 保守占用 374；人工核实后 consumed=15、reserved=0，释放差额 359。uncertain 的历史预留字段与当前聚合预留含义不同，不能误写为每条 ledger.reserved 都置零。受控供应商账本不是实际付费供应商发票。

覆盖矩阵为 `evidence/whole-backend-coverage-matrix.json`，补测报告为 `whole-backend-supplemental-report.json`。默认 CLI 后续复跑另存 `whole-backend-default-*`，不覆盖共享流量证据；它再以 `897ffcd` 完整通过 14/14，自然 exit 0、无超时，临时资源残留为 0，后端/模型/MCP 监听均已实际关闭。

## 安全负面验证

从新建实例的运行期 OpenAPI 清单获得 131 个方法/路径操作，其中 124 个受保护、7 个公开。对 124 个受保护操作逐个发送真实匿名 HTTP 请求，124/124 都是 401，未将 403/404/5xx 计为通过；独立 security 组织的 17 类业务资源在测试前后的数量及 ID 均一致，无匿名写入。证据为 `evidence/whole-backend-anonymous-probe.json`。这是鉴权拒绝检查，不代表每个接口的合法写入与资源所有权分支已验收。

默认禁止私网的独立真实监听测试中，6 种 loopback/编码/localhost/映射 IPv6 目标均拒绝，上游 TCP 请求数为 0，6 笔预留均释放且金额为 0。另用显式允许本机的受控环境验证 302：只收到首跳 1 次请求，后续目标没有被跟随。证据为 `evidence/whole-backend-strict-network.json`。主业务 fixture 刻意启用 `allowPrivateUpstreams=true` 以接入本机受控供应商，不能用它证明生产默认 SSRF 防护。

静态 route-invariant 扫描器当前识别 67 个顶层注册，另有 51 个动态/多行注册和 11 个嵌套 sandbox 注册不在它的静态解析范围。它的结果不能充当所有路由的鉴权证明；本轮采用上面的运行期清单与实际匿名请求补足当前快照验证。

另在独立 security 组织执行 68/68 真实负面/对照检查：member 的 21 类管理操作拒绝、auditor 只读、device 管理拒绝及吊销、跨租户、本人 run 隔离、最后 owner、CSRF、参数与 HTTP 2 MiB 上界、CIDR/XFF/拒绝全部策略、成员/应用/祖先部门/企业配额、撤席位、订阅过期、幂等、凭据吊销和禁用后重启不复活。受控模型上游只观察到 2 次合法调用；额度/撤权拒绝和缓存重放均不增上游调用。证据 `evidence/whole-backend-negative-matrix.json`。其中 404 只用于本人资源隔离场景，未当作通用鉴权通过；400/413 用于确实无效/超界输入，未将它们当作角色拒绝通过。

另直接对实际 Vault 服务与独立内存 SQLite 做 4/4 次故障注入：错误主密钥、同组织 credential-id 间密文交换、跨组织密文交换、GCM 认证 tag 篡改，均返回 `503 VAULT_UNAVAILABLE`，恢复原密文后正向读取成功。证据 `whole-backend-vault-negative.json`。这是组件级直接故障注入，不算 HTTP 场景或 139 项常规测试；尚未纳入持续自动回归，也不替代生产密钥轮换验收。

## 真实管理端

用户 Mac 当时锁屏，原 Chrome 新调试授权无法操作，改用本机官方 Chrome 的独立临时 headless profile，经 browser-harness/CDP 测试生产管理端。没有替换 fetch/RPC、注入模拟后端响应或使用用户真实浏览器 Cookie。下拉选项由真实 DOM change 进入 React 控件，再产生实际 HTTP。

- 26 个主视图实际访问，分别记录可达和非空数据，不把访问成功当作业务成功。
- 实际新增/修改/审核/发布：凭据轮换、独立模型及真实 probe、分类、五类资产、技能 v2、部门、审计员角色/席位、独立 Agent。Agent 实际返回 `whole-answer`，慢任务取消有终态；评测包含通过与失败用例，实际 passRate 为 0.5；自动化实际触发任务。
- 7 个配置编辑页逐个保存草稿、发布、丢弃；客户端读取证明草稿不外泄，发布后才改变当前配置。
- Docker UI 实际创建 ready Runtime、编辑、执行代码输出 `whole-ui-code42` / exit 0、运行中取消后 stopped、删除；第二个 Runtime 用停止按钮实际停止并删除。临时 allowSandbox 策略随后删除。
- 非空用量/聚合/Trace/审计、实际搜索/分页；CSV 核对页面暴露的真实 URL 及内容，不宣称操作系统保存位置已验收。终端事件由合成 device 经实际 HTTP 写入后立刻吊销 token，再由页面读取，明确不冒充管理端 UI 写入。
- 审计员登录后写控件隐藏/禁用，服务端实际 403 且企业状态不变；无效输入、重复、被引用删除、真实浏览器离线错误及恢复均记录。320/768/1024/1440 有实际数据的页面无 body 横向溢出。

证据 `evidence/whole-backend-ui/report.json`、`browser-network.json` 及截图。资产与分类的关联、策略/分类/数据集/自动化正文编辑目前没有相应管理端控件，本轮不为这些操作标记 UI 通过；后端接口与已有切换/删除操作分别记录。

管理端汇总 `summary.json`：26/26 主视图、14/14 通用新增表单、7/7 配置编辑页；135 条通过断言，26 条可达记录；743 个脱敏 HTTP 响应，其中 110 次 2xx 业务 POST/PUT/PATCH/DELETE 请求。请求数按方法统计，不等于独立功能数。2 条修前失败、1 条预期任务取消、1 条初始空态历史保留，修后通过记录另列；未处理 Runtime 异常为 0。四宽度与弹窗截图经实际查看。浏览器临时进程/profile 已清理。

## Docker 与故障恢复

最终 10/10 通过：生产镜像重启持久化；真实沙箱驱动；真实沙箱 API；沙箱进程中断恢复；SDK 工具循环；生产镜像内 SDK 循环；执行中 SIGKILL；工具完成后 SIGKILL；lease 命名空间隔离；MCP 已派发后 SIGKILL。

验证了 UID 1000、只读根文件系统、能力移除、同工作区连续调用、取消/超时/撤权实际终止进程、输出上限、容量限制、backend 密钥/socket 不进入沙箱、恢复时保留副作用不确定性和已完成结果，并禁止重放模型/工具调用。故障注入和直接数据库设置单独标注，不冒充正常用户操作。

首次 9/10 的唯一失败是测试编排将 crash mode 误传为 `running`，脚本只接受 `active/ready`，在业务执行前即拒绝；修正后对新镜像完整重跑 10/10。首次报告和失败日志保留于 `evidence/whole-backend-docker/initial/`，最终结果为 `evidence/whole-backend-docker/report.json`。

管理端修复后另构建最终镜像 `uwork-backend:whole-test-final-20261015`，ID `sha256:5098624adcd6a55ea0d131f49592a21eeef05dd5ae7a33398e465601a9b0850a`，基于 `897ffcd`。该镜像重新通过容器业务/重启持久化与生产镜像内 SDK 工具循环两项验证，并检查镜像内包含修后 UI bundle `index-mPjPVcE3.js`。10 项故障矩阵来自前述 `092d1c3` 后端源码，最终镜像这两项为复跑，不重复累加为新的独立覆盖。证据 `final-container.log`、`final-agent-container.log`、`final-ui-bundle.log`。

## 自动检查与验证脚本自身

最终后端测试 139/139，0 失败/取消/跳过；两项新增是企业信息与留存组合的真实 HTTP 回归。类型检查、Lint、格式、页面台账、生产构建均通过；依赖审计 0 个已知漏洞。`scripts/backend-security-smoke.ts` 独立实跑 7/7。摘要与原始日志为 `evidence/whole-backend-checks.json` / `whole-backend-logs/*-final.log`；补测脚本冻结后的最新类型/Lint/格式及 7 项再运行日志为 `*-last.log`，均 exit 0。

业务验证脚本默认成功后清理，仅 `--hold-for-ui` 保持供浏览器协同。另实际触发自身 child/IPC 启动失败，以及主业务完成后的受控后置失败再 SIGTERM：两次均进入 catch/cleanup、自然或信号退出码为 1、没有超时，临时资源残留为 0，避免测试失败被清理逻辑“洗绿”。证据 `whole-backend-lifecycle-child-failure.json` / `whole-backend-lifecycle-signal-failure.json`。这些是验证编排的故障检查，不算产品故障恢复场景。

## 复跑

使用受支持 Node 24，先执行 `npm run build`。业务 HTTP：`node --import tsx scripts/backend-e2e-smoke.ts`。该脚本只使用自建临时库和受控供应商，完成后清理；浏览器协同时使用 `--hold-for-ui`，由独立 stop 标记结束。

默认私网与跳转检查：`node --import tsx scripts/backend-security-smoke.ts`，使用独立内存库、真实监听和合成账号，完成后关闭自有进程与监听。

组织切换/权限/手工对账/Agent 更新/能力/企微 callback/OpenAPI 的 7 项补测：`node --import tsx scripts/backend-supplemental-smoke.ts`，使用独立临时库，默认完成后清理。

Docker：先准备独立 Docker 引擎与 `uwork-sandbox:local` 镜像，构建 `uwork-backend:whole-test-20261015`，再执行 `node --import tsx scripts/backend-docker-suite.ts`。可用 `UWORK_DOCKER_CONTEXT` / `UWORK_DOCKER_IMAGE` 指定专用 context / 镜像；脚本不切换全局 context。

## 环境恢复

共享实例的三个组织通过真实 HTTP 查询 Runtime 列表均为 0；UI 的两个 Runtime 及临时策略已删除。停止专用 Docker 引擎前实际 `docker ps -a` 为空；Colima profile `uwork-backend` 已恢复初始 stopped，默认 Docker context 始终为 `default`。合成后端/供应商监听、临时 SQLite/TLS 文件和浏览器/profile 均按自有资源清理，验证结果保留在 ignored evidence。证据 `whole-backend-shared-runtime-cleanup.json`、`whole-backend-default-cli.json`、`whole-backend-environment-cleanup.json`。

## 验收边界

本轮不覆盖真实逐组织企微扫码/回调/通讯录权限、真实付费模型计费、第三方 MCP/网盘/支付、生产 TLS、目标生产主机恢复、远端 CI，以及已安装 Windows/macOS/Linux 客户端。并发试验验证受控负载下的准入与账本一致性，不是生产吞吐基准。原有 UWork 菜单继续按用户选择复用“自动化 / 插件商店”。
