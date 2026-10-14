# 实现与验收台账

2026-10-14，Asia/Shanghai。构建结果代表本地自有实现，不代表 WorkBuddy 完整服务端复现、生产上线或外部供应商批准。

| 模块                       | 实现位置                                   | 本轮证据                                                                         | 边界                                                       |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| identity                   | identity.ts / wecom.ts                     | 登录/退出、组织隔离、企微 state/proof/取消竞态、同步停用旧会话不复活             | 企微 provider 为受控测试，真实逐组织扫码待验               |
| directory / access-control | directory.ts / access.ts                   | 成员/部门/角色/席位、最后 owner、越权拒绝                                        | 本地组织 CRUD 为自有扩展，企微只同步                       |
| entitlements               | entitlements.ts                            | 并发预留、幂等、订阅月末、断流保留额度和对账                                     | 整数 Credit 非供应商最终账单                               |
| model-gateway              | models.ts / gateway.ts / network.ts        | 真实本机 HTTP、JSON/SSE、异常终态、SSRF 拒绝、密钥出口权限                       | OpenAI-compatible；真实付费模型待配置                      |
| credential-vault           | vault.ts                                   | 数据库无原文、吊销、列表脱敏                                                     | 环境主密钥，需生产密钥托管/轮换运维                        |
| ai-assets                  | assets.ts / connectors.ts                  | 不可变版本、审核发布、撤权、MCP session 与工具白名单                             | 技能文本包；不执行任意上传代码                             |
| client-policy              | policy.ts / client.ts                      | 草稿不生效、旧修订冲突、发布版本、安全优先级、CIDR/deny-all                      | 后端执行入口生效；完整终端本地 enforcement 待验            |
| agent-runtime              | runtime.ts / automation.ts / evaluation.ts | 真实模型任务、取消/超时、自动化唯一触发、投递关闭等待、真实评测运行              | model-only，无任意代码云沙箱；字符串评分不等于 AI 质量评审 |
| telemetry                  | telemetry.ts / client-usage.ts             | 审计/Trace/CSV/聚合、成员统计隔离                                                | 原始 prompt 不入日志；任务内容加密；归档保留策略按企业补齐 |
| external-integrations      | integrations.ts                            | 未配置 503、外部能力声明                                                         | 网盘适配网关合同；支付/云沙箱 unavailable                  |
| admin-web                  | admin/                                     | 实际登录，部门新增/修改/删除，配置草稿保存/发布；1432/768/320 布局，无横向溢出   | 未逐个实际供应商表单验收；本地截图在 ignored evidence/     |
| uwork-client               | backend-client.ts + 独立适配副本           | 实际 UWork identity/gateway 源码联调、终端凭据轮换和退出吊销；类型/Lint/架构检查 | 完整资产/菜单/安全 Host 应用、三平台打包安装待验           |

自动验证：`npm test`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run build`、`npm audit --audit-level=high`。跨仓库合同验证：`node --import tsx --test scripts/client-contract-smoke.ts`，使用真实适配源码和受控企微 provider，未调用真实企业凭据。

最终结果：后端 19 项测试通过，0 失败/跳过；类型、Lint、格式与生产构建通过；依赖审计 0 个已知漏洞。UWork 适配仓库 typecheck、架构检查（0 violations）及两个相关测试通过；Lint 为 0 errors、111 warnings，未将警告表述成无警告构建。另一个跨仓库实际源码合同测试通过。

跨源码故障注入覆盖旧二维码过期后重试、模型查询 503 与 Provider 写入失败；失败同步保留旧有效凭据，确认写入后才吊销旧凭据。管理端另核对模型、资产、Agent、用量、企业设置与概览路由的实际标题/错误状态，Runtime exception 事件为 0。

备份：在线 snapshot、持久化重开、第二实例拒绝均有行为测试。Dockerfile/Compose 已编写，本机没有 Docker daemon，未声称镜像已经运行。GitHub Actions 已编写，本轮不把本地通过称为远端 CI 已通过。

REA：本轮复用现有 55 份页面和发布脚本证据，另对 automation-fL5mZb_V.js 做受限静态分析。Evidence `ev_85a402a75b3d029b9ea50cfc97260b5c1ba2a4df2e7f1e291ec3518a4f3970f2`，输入树 SHA-256 `406e7d1c32ef8f1ef19a9bedc0214164d254ed65d9b44d9eace765532919998b`，解析 1 个源文件，无解析失败；308 个文件未选择，覆盖为 partial。没有把静态候选当成已执行服务端契约。

## 尚未完成的项目级验收

- 自有企微每个实际组织的新扫码、真实 callback 和通讯录权限。
- 真实模型生成/供应商计量对账及长时/负载测试。
- 完整 UWork 菜单、助理、资产安装更新撤销、路径/命令/分享/个人资产策略的 Host enforcement 与 Windows/macOS/Linux 安装回归。
- 生产 TLS、备份演练、外部网盘、支付、真正代码沙箱和通知渠道验收。

这些项目级项保留为未验收，不能据本轮本地构建将 CAPABILITY-MAP 的整个产品完成标准标记为通过。
