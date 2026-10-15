# 逐页面/表单能力台账

本台账由 `scripts/build_page_ledger.mjs` 从控制台页面观察（`runtime-inventory.json`）与人工维护的映射（`page-coverage.json`）生成；测试校验两边双向完整、状态合法、缺口有说明，并核对声称的后端端点确实存在。

| 项目 | 值 |
| --- | --- |
| 控制台页面观察 | 55 |
| 已实现 | 43 |
| 部分实现 | 10 |
| 外部依赖 | 2 |

状态含义：已实现＝自有后端/管理端提供该能力并能以行为测试或受控运行验证；部分实现＝服务端事实已具备但终端/管理端应用或真实外部资源未完成（缺口逐条列出）；外部依赖＝需要真实第三方服务，未配置时明确不可用。

## 企业智能体

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Agents（`agents`） | `/admin/cloud-agent/template/list` | 表单字段 1 | `runtime.ts`<br>`agent-contract.ts`<br>`/api/tenants/{tenantId}/agents`<br>`/api/tenants/{tenantId}/agents/{id}`<br>`/api/tenants/{tenantId}/agents/{id}/publish` | agents | tests/runtime.test.ts | 已实现 | — |
| 新建任务（`automation-create`） | `/admin/cloud-agent/automation/list` | 表单字段 16 / 表单标签 19 / 列表列 8 | `automation.ts`<br>`/api/tenants/{tenantId}/automations`<br>`/api/tenants/{tenantId}/deliveries` | automations | tests/runtime.test.ts | 部分实现 | 飞书 Bot 与真实通知渠道需要外部服务，未接入；Webhook 投递与重放语义已有测试，单次执行 30 分钟上限由运行时限执行 |
| 自动化任务（`automation`） | `/admin/cloud-agent/automation/list` | 表单字段 4 / 列表列 8 | `automation.ts`<br>`/api/tenants/{tenantId}/automations`<br>`/api/tenants/{tenantId}/automations/{id}` | automations | tests/runtime.test.ts（cron 时区与唯一触发键） | 已实现 | — |
| 添加凭据（`credential-create`） | `/admin/cloud-agent/credential/list` | 表单字段 7 / 列表列 7 | `vault.ts`<br>`network.ts`<br>`/api/tenants/{tenantId}/credentials` | credentials | tests/gateway.test.ts<br>tests/security-regression.test.ts | 已实现 | — |
| 凭据管理（`credentials`） | `/admin/cloud-agent/credential/list` | 表单字段 4 / 列表列 7 | `vault.ts`<br>`/api/tenants/{tenantId}/credentials`<br>`/api/tenants/{tenantId}/credentials/{id}` | credentials | tests/gateway.test.ts（数据库无原文、列表脱敏、吊销） | 已实现 | — |
| 评测中心（`evaluation`） | `/admin/cloud-agent/agent-eval` | 纯浏览页（无表单字段观察） | `evaluation.ts`<br>`/api/tenants/{tenantId}/datasets`<br>`/api/tenants/{tenantId}/datasets/{id}`<br>`/api/tenants/{tenantId}/evaluations`<br>`/api/tenants/{tenantId}/evaluations/{id}`<br>`/api/tenants/{tenantId}/evaluations/{id}/cancel` | datasets<br>evaluations | tests/runtime.test.ts（评测打分与取消） | 已实现 | — |
| 快速开始（`quickstart`） | `/admin/cloud-agent/quickstart` | 表单字段 7 / 表单标签 2 | `runtime.ts`<br>`agent-runner.ts`<br>`sandbox/`<br>`/api/tenants/{tenantId}/agents`<br>`/api/tenants/{tenantId}/agents/{id}/publish`<br>`/api/tenants/{tenantId}/runs`<br>`/api/tenants/{tenantId}/runtime` | agents<br>runs | tests/runtime.test.ts<br>tests/agent-tools.test.ts<br>scripts/agent-sandbox-smoke.ts | 已实现 | — |
| Runtimes（`runtimes`） | `/admin/cloud-agent/runtime/list` | 表单字段 3 / 列表列 6 | `agent-sandbox.ts`<br>`sandbox/`<br>`/api/tenants/{tenantId}/runtimes`<br>`/api/tenants/{tenantId}/runtimes/capability`<br>`/api/tenants/{tenantId}/runtimes/{id}`<br>`/api/tenants/{tenantId}/runtimes/{id}/stop`<br>`/api/tenants/{tenantId}/runtimes/{id}/executions` | runtimes<br>sandbox-executions | tests/sandbox-lifecycle.test.ts<br>scripts/sandbox-api-smoke.ts<br>scripts/sandbox-crash-smoke.ts | 已实现 | 隔离 Runtime 是本机专用 Docker engine；不代表原站云 Runtime 或云沙箱供应商 |
| Session 列表（`sessions`） | `/admin/cloud-agent/session/list` | 表单字段 7 / 列表列 8 | `runtime.ts`<br>`agent-runner.ts`<br>`/api/tenants/{tenantId}/sessions`<br>`/api/tenants/{tenantId}/runs`<br>`/api/tenants/{tenantId}/runs/{id}/tools` | sessions<br>runs | tests/runtime.test.ts<br>tests/agent-tools.test.ts | 已实现 | — |

## 客户端配置

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 助理设置（`assistants`） | `/admin/client-config/channel` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`client.ts`<br>`client-console.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/tenants/{tenantId}/configurations/{kind}/draft`<br>`/api/tenants/{tenantId}/configurations/{kind}/publish` | configuration | tests/client-authorization.test.ts<br>scripts/client-console-contract-smoke.ts（真实 HTTP/当前菜单/受理回执/撤权） | 部分实现 | local/agents 已在实际 Gateway、Host 与企业菜单准入执行；云/移动实际渠道资源及完整安装验收仍待 T13d |
| 客户端定制（`client-custom`） | `/admin/client-config/custom` | 表单字段 2 / 列表列 6 | `policy.ts`<br>`client.ts`<br>`client-console.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/tenants/{tenantId}/configurations/{kind}/draft`<br>`/api/tenants/{tenantId}/configurations/{kind}/publish` | configuration | tests/policy-assets.test.ts（草稿不生效、旧修订冲突、发布版本）<br>scripts/client-console-contract-smoke.ts（真实 HTTP/当前菜单/受理回执/撤权） | 部分实现 | UWork 本机菜单命名/排序/启停与既有自动化/插件商店路由已应用；自定义项使用现有 HTTPS 标签页，iframe 免登/应用绑定与三平台安装未验 |
| 新建自建菜单（`custom-menu-create`） | `/admin/client-config/custom` | 表单字段 8 / 表单标签 8 / 列表列 6 | `policy.ts`<br>`client-console.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}` | configuration | tests/policy-assets.test.ts<br>scripts/client-console-contract-smoke.ts（真实 HTTP/当前菜单/受理回执/撤权） | 部分实现 | 自定义菜单按当前菜单 ID 准入打开既有 HTTPS 标签页；iframe 免登与组织应用绑定未实现 |
| 编辑菜单（`menu-edit`） | `/admin/client-config/custom` | 表单字段 2 / 表单标签 2 / 列表列 6 | `policy.ts`<br>`client-console.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/tenants/{tenantId}/configurations/{kind}/draft`<br>`/api/tenants/{tenantId}/configurations/{kind}/publish` | configuration | tests/policy-assets.test.ts<br>scripts/client-console-contract-smoke.ts（真实 HTTP/当前菜单/受理回执/撤权） | 已实现 | — |
| 移动端 APP 和小程序（`mobile-channels`） | `/admin/client-config/channel` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}` | configuration | tests/client-authorization.test.ts | 部分实现 | 渠道布尔在快照中发布；移动端应用未接入（无真实移动渠道资源） |
| 新建对话页（`new-chat-config`） | `/admin/client-config/custom` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`client.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/client/configuration` | configuration | tests/policy-assets.test.ts<br>scripts/client-console-contract-smoke.ts（真实 HTTP / version=0 / 身份迟到）<br>docs/review-2026-10-15.md（UWork 生产展示组件的真实 Chrome / 320、768、1440） | 已实现 | — |
| 分享与协作（`sharing`） | `/admin/client-config/share-collab` | 表单字段 4 | `policy.ts`<br>`client.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/client/authorize（action=share）` | configuration | tests/client-authorization.test.ts<br>scripts/client-sharing-contract-smoke.ts（真实 Host 网络适配器与后端当前策略） | 部分实现 | 现有公网分享已执行当前发布/文件/网络/退出裁决；组织协作、微信/企微无对应已实现客户端出口，三平台及真实外部服务待验 |

## AI 资源管理

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 新建连接器（`connector-create`） | `/admin/ai-resource/connectors/list` | 表单字段 28 / 表单标签 50 | `assets.ts`<br>`vault.ts`<br>`/api/tenants/{tenantId}/assets`<br>`/api/tenants/{tenantId}/credentials`<br>`/api/tenants/{tenantId}/assets/{id}` | assets<br>credentials | tests/client-connectors.test.ts<br>tests/agent-connectors.test.ts | 已实现 | — |
| 下发策略（`connector-distribution`） | `/admin/ai-resource/connectors/list` | 表单字段 6 / 表单标签 3 | `assets.ts`<br>`policy.ts`<br>`/api/tenants/{tenantId}/policies`<br>`/api/tenants/{tenantId}/configurations/{kind}` | policies<br>configuration | tests/policy-assets.test.ts | 已实现 | 控制台对连接器白名单是否“额外获得”与 allow 取交集存在冲突，自有实现按保守的可见范围+交集+deny 优先 |
| 自定义连接器（`connector-personal`） | `/admin/ai-resource/connectors/list` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}` | configuration | tests/client-authorization.test.ts | 已实现 | — |
| 连接器管理（`connectors`） | `/admin/ai-resource/connectors/list` | 表单字段 6 | `assets.ts`<br>`connector-service.ts`<br>`connectors.ts`<br>`/api/tenants/{tenantId}/assets`<br>`/api/tenants/{tenantId}/assets/{id}`<br>`/api/tenants/{tenantId}/assets/{id}/review`<br>`/api/tenants/{tenantId}/assets/{id}/publish`<br>`/api/client/assets/{id}/download`<br>`/api/client/connectors/{id}/rpc` | assets | tests/client-connectors.test.ts<br>tests/agent-connectors.test.ts<br>scripts/client-connectors-mcp-contract-smoke.ts | 已实现 | 远端地址与凭据只在服务端；客户端只拿掩码描述与网关路径，不代表真实第三方 MCP 服务验收 |
| 分类管理（`expert-categories`） | `/admin/ai-resource/expert/list` | 纯浏览页（无表单字段观察） | `assets.ts`<br>`resources.ts`<br>`/api/tenants/{tenantId}/categories`<br>`/api/tenants/{tenantId}/categories/{id}` | categories | tests/policy-assets.test.ts | 已实现 | — |
| 专家下发策略（`expert-distribution`） | `/admin/ai-resource/expert/list` | 表单字段 6 / 表单标签 3 | `assets.ts`<br>`/api/tenants/{tenantId}/policies` | policies | tests/policy-assets.test.ts | 已实现 | — |
| 专家管理（`experts`） | `/admin/ai-resource/expert/list` | 表单字段 5 | `assets.ts`<br>`/api/tenants/{tenantId}/assets`<br>`/api/tenants/{tenantId}/assets/{id}`<br>`/api/tenants/{tenantId}/assets/{id}/review`<br>`/api/tenants/{tenantId}/assets/{id}/publish` | assets | tests/policy-assets.test.ts<br>scripts/client-assets-host-contract-smoke.ts | 已实现 | — |
| 全局提示词（`global-prompt`） | `/admin/ai-resource/words/panel/prompt` | 表单字段 1 | `assets.ts` | — | SPEC-ai-assets.md（明确不注入旧全局提示词） | 部分实现 | 按控制台证据不实现旧全局提示词注入；仅保留历史说明，不静默启用 |
| 自定义指令（`instructions`） | `/admin/ai-resource/words/panel` | 纯浏览页（无表单字段观察） | `assets.ts`<br>`/api/tenants/{tenantId}/assets` | assets | tests/client-asset-admission.test.ts（CLIENT_UNSUPPORTED） | 部分实现 | 按已观察兼容边界明确不下发 UWork；Agent 所有者已支持指令注入，终端不支持属于显式边界 |
| 新增自定义模型（`model-create`） | `/admin/ai-resource/model/add` | 表单字段 15 / 表单标签 30 | `models.ts`<br>`vault.ts`<br>`network.ts`<br>`/api/tenants/{tenantId}/models`<br>`/api/tenants/{tenantId}/models/{id}`<br>`/api/tenants/{tenantId}/models/{id}/probe` | models | tests/model-capabilities.test.ts<br>tests/network.test.ts（SSRF 与私网拒绝） | 已实现 | — |
| 成员自定义模型（`model-personal`） | `/admin/ai-resource/model/` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`client.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}` | configuration | tests/client-authorization.test.ts | 已实现 | — |
| 模型策略（`model-policies`） | `/admin/ai-resource/model/` | 表单字段 7 / 表单标签 5 | `assets.ts`<br>`models.ts`<br>`/api/tenants/{tenantId}/policies` | policies | tests/policy-assets.test.ts | 已实现 | — |
| 模型管理（`models`） | `/admin/ai-resource/model/` | 表单字段 5 | `models.ts`<br>`/api/tenants/{tenantId}/models`<br>`/api/tenants/{tenantId}/models/{id}` | models | tests/gateway.test.ts<br>tests/model-capabilities.test.ts | 已实现 | — |
| Playbook（`playbooks`） | `/admin/ai-resource/playbook/list` | 表单字段 3 | `assets.ts`<br>`/api/tenants/{tenantId}/assets` | assets | tests/policy-assets.test.ts<br>tests/client-asset-admission.test.ts（显式声明 uwork 返回 400 CLIENT_UNSUPPORTED） | 部分实现 | 按已观察兼容边界明确不下发 UWork；Agent 所有者已支持指令注入，不能把终端不支持误写成待接线 |
| 分类管理（`skill-categories`） | `/admin/ai-resource/skill/list` | 表单字段 8 | `assets.ts`<br>`resources.ts`<br>`/api/tenants/{tenantId}/categories`<br>`/api/tenants/{tenantId}/categories/{id}` | categories | tests/policy-assets.test.ts | 已实现 | — |
| 技能下发策略（`skill-distribution`） | `/admin/ai-resource/skill/list` | 表单字段 6 / 表单标签 3 | `assets.ts`<br>`policy.ts`<br>`/api/tenants/{tenantId}/policies`<br>`/api/tenants/{tenantId}/configurations/{kind}` | policies<br>configuration | tests/policy-assets.test.ts | 已实现 | 个人上传策略只按控制台可见的布尔开关实现，未复现原站逐技能白名单 |
| 成员自定义技能（`skill-personal`） | `/admin/ai-resource/skill/list` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}` | configuration | tests/client-authorization.test.ts | 已实现 | — |
| 技能管理（`skills`） | `/admin/ai-resource/skill/list` | 表单字段 5 | `assets.ts`<br>`asset-paths.ts`<br>`/api/tenants/{tenantId}/assets`<br>`/api/tenants/{tenantId}/assets/{id}`<br>`/api/tenants/{tenantId}/assets/{id}/versions`<br>`/api/tenants/{tenantId}/assets/{id}/review`<br>`/api/tenants/{tenantId}/assets/{id}/publish` | assets | tests/policy-assets.test.ts<br>tests/client-asset-admission.test.ts | 已实现 | — |

## 日志管理

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 对话日志（`dialogue-logs`） | `/admin/log/sessions` | 纯浏览页（无表单字段观察） | `telemetry.ts`<br>`client-usage.ts`<br>`/api/tenants/{tenantId}/traces`<br>`/api/tenants/{tenantId}/client-events`<br>`/api/tenants/{tenantId}/retention/purge`<br>`/api/tenants/{tenantId}/retention` | traces<br>client-events | tests/wecom-telemetry.test.ts（分页/导出/脱敏）<br>tests/retention.test.ts（企业留存窗口与巡检） | 已实现 | 原始 prompt 不入日志；任务内容按企业策略加密留存。企业级留存天数与每小时巡检已实现，日志归档到外部对象存储仍按企业部署补齐 |
| 操作日志（`operation-logs`） | `/admin/log/list` | 表单字段 5 / 列表列 6 | `telemetry.ts`<br>`events.ts`<br>`/api/tenants/{tenantId}/audit`<br>`/api/tenants/{tenantId}/retention/purge` | audit | tests/wecom-telemetry.test.ts（分页/导出/脱敏） | 已实现 | 审计事实只按企业留存窗口清理，导出为同步 CSV；大规模归档导出仍需按企业部署补齐 |

## 腾讯网盘

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 网盘容量分配（`drive-capacity`） | `/admin/apps/drive/capacity-allocation` | 表单字段 1 | `integrations.ts`<br>`/api/tenants/{tenantId}/integrations`<br>`/api/tenants/{tenantId}/integrations/drive`<br>`/api/tenants/{tenantId}/integrations/drive/capacity`<br>`/api/tenants/{tenantId}/integrations/drive/health` | integrations | tests/integrations.test.ts（未配置返回 503、真实服务路由与容量写入门禁） | 外部依赖 | 需要真实网盘服务与订阅凭据；未配置时明确 503，不伪装成已实现的外部存储 |
| 网盘资产日志（`drive-logs`） | `/admin/apps/drive/asset-log` | 表单字段 6 / 列表列 6 | `integrations.ts`<br>`/api/tenants/{tenantId}/integrations/drive/logs`<br>`/api/tenants/{tenantId}/integrations/drive/files` | integrations | tests/integrations.test.ts | 外部依赖 | 同上：需真实网盘服务；本地只实现适配网关合同与能力声明 |

## 企业设置

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 企业信息（`enterprise`） | `/admin/organization` | 列表列 4 | `directory.ts`<br>`wecom.ts`<br>`/api/tenants/{tenantId}`<br>`/api/tenants/{tenantId}/wecom`<br>`/api/tenants/{tenantId}/wecom/sync` | enterprise | tests/flows.test.ts<br>tests/identity.test.ts | 已实现 | — |
| 计量设置（`metering`） | `/admin/setting/metering-settings` | 表单字段 2 | `entitlements.ts`<br>`/api/tenants/{tenantId}/subscription` | subscription | tests/flows.test.ts（月末夹取/周期重置） | 已实现 | — |
| 网络设置（`network`） | `/admin/setting/network` | 表单字段 1 | `policy.ts`<br>`client.ts`<br>`/api/tenants/{tenantId}/configurations/{kind}`<br>`/api/tenants/{tenantId}/configurations/{kind}/draft`<br>`/api/tenants/{tenantId}/configurations/{kind}/publish` | configuration | tests/client-authorization.test.ts（CIDR 与 deny-all 哨兵） | 已实现 | — |

## 可观测中心

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 实时监控（`monitor`） | `/admin/observability/scene-monitor` | 表单字段 4 | `telemetry.ts`<br>`/api/tenants/{tenantId}/metrics`<br>`/api/tenants/{tenantId}/usage/aggregates` | overview<br>usage | tests/wecom-telemetry.test.ts | 已实现 | 指标来自自有账本与请求事实的聚合口径，非原站监控后端；实时性以请求采样为准 |
| 会话追踪（`traces`） | `/admin/observability/trace` | 表单字段 9 / 列表列 8 | `telemetry.ts`<br>`agent-runner.ts`<br>`/api/tenants/{tenantId}/traces` | traces | tests/wecom-telemetry.test.ts<br>tests/agent-tools.test.ts | 已实现 | — |

## 组织与成员

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 组织架构（`organization`） | `/admin/users` | 纯浏览页（无表单字段观察） | `directory.ts`<br>`access.ts`<br>`wecom.ts`<br>`/api/tenants/{tenantId}/members`<br>`/api/tenants/{tenantId}/members/{id}`<br>`/api/tenants/{tenantId}/members/{id}/wecom`<br>`/api/tenants/{tenantId}/departments`<br>`/api/tenants/{tenantId}/departments/{id}`<br>`/api/tenants/{tenantId}/roles`<br>`/api/tenants/{tenantId}/permissions/{userId}`<br>`/api/tenants/{tenantId}/wecom`<br>`/api/tenants/{tenantId}/wecom/sync` | members<br>departments | tests/identity.test.ts<br>tests/flows.test.ts<br>tests/wecom-telemetry.test.ts | 已实现 | 原站在企微模式把组织写操作委托给企微后台；本地成员/部门 CRUD 是自有扩展，不冒充原站能力 |

## 组织概览

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 组织概览（`overview`） | `/admin/overview` | 纯浏览页（无表单字段观察） | `directory.ts`<br>`entitlements.ts`<br>`telemetry.ts`<br>`/api/tenants/{tenantId}`<br>`/api/tenants/{tenantId}/members`<br>`/api/tenants/{tenantId}/subscription`<br>`/api/tenants/{tenantId}/usage/aggregates`<br>`/api/tenants/{tenantId}/metrics` | overview | tests/flows.test.ts（组织/席位/用量聚合）<br>docs/acceptance.md（管理 Web 实际登录与布局验证记录） | 已实现 | — |

## 角色管理

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 角色管理（`roles`） | `/admin/admin` | 纯浏览页（无表单字段观察） | `access.ts`<br>`/api/tenants/{tenantId}/roles`<br>`/api/tenants/{tenantId}/permissions/{userId}` | members | tests/identity.test.ts（角色守卫与最后 owner） | 已实现 | — |

## 席位管理

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 席位管理（`seats`） | `/admin/seats` | 纯浏览页（无表单字段观察） | `entitlements.ts`<br>`directory.ts`<br>`/api/tenants/{tenantId}/members`<br>`/api/tenants/{tenantId}/limits`<br>`/api/tenants/{tenantId}/limits/{resource}/{id}` | members<br>usage | tests/flows.test.ts | 已实现 | 企微模式下原站把席位分配指向企微后台；席位上限与成员席位标记在自有后端强制执行 |

## 安全中心

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 客户端安全（`security-client`） | `/admin/security/client` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`assets.ts`<br>`/api/tenants/{tenantId}/policies/security`<br>`/api/tenants/{tenantId}/policies` | security | tests/policy-assets.test.ts | 已实现 | — |
| 新建策略（`security-create`） | `/admin/security/client/create` | 表单字段 3 | `policy.ts`<br>`/api/tenants/{tenantId}/policies/security` | security | tests/policy-assets.test.ts<br>tests/security-regression.test.ts | 已实现 | — |
| 综合管理（`security-general`） | `/admin/security/general` | 纯浏览页（无表单字段观察） | `policy.ts`<br>`/api/tenants/{tenantId}/policies/security`<br>`/api/tenants/{tenantId}/configurations/{kind}` | security<br>configuration | tests/policy-assets.test.ts（最高优先级整条生效）<br>tests/client-authorization.test.ts | 已实现 | — |

## 订阅与用量

| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 订阅管理（`subscriptions`） | `/admin/usage/subscription` | 纯浏览页（无表单字段观察） | `entitlements.ts`<br>`/api/tenants/{tenantId}/subscription` | subscription | tests/flows.test.ts（订阅月末夹取与周期重置） | 部分实现 | 购买/续费/变配/加量包需要真实支付与供应商，未接入；订阅为本地账期事实，不称为供应商账单 |
| 应用用量（`usage-apps`） | `/admin/usage/app` | 表单字段 6 / 列表列 5 | `telemetry.ts`<br>`/api/tenants/{tenantId}/usage/aggregates?groupBy=application` | usage-aggregates | tests/wecom-telemetry.test.ts（应用维度聚合）<br>docs/acceptance.md（实际浏览器切换维度验证） | 已实现 | 应用维度取自自有客户端事件与账本字段；尚无用真实第三方应用流量验证的报告 |
| 用量明细（`usage-details`） | `/admin/usage/detail` | 表单字段 14 | `telemetry.ts`<br>`entitlements.ts`<br>`/api/tenants/{tenantId}/usage`<br>`/api/tenants/{tenantId}/usage/{id}/reconcile`<br>`/api/tenants/{tenantId}/audit` | usage<br>audit | tests/wecom-telemetry.test.ts（分页/CSV/脱敏） | 已实现 | — |
| 成员用量（`usage-members`） | `/admin/usage/member` | 表单字段 15 | `telemetry.ts`<br>`entitlements.ts`<br>`/api/tenants/{tenantId}/usage`<br>`/api/tenants/{tenantId}/usage/aggregates` | usage | tests/wecom-telemetry.test.ts<br>tests/flows.test.ts | 已实现 | — |
| 组织用量（`usage-orgs`） | `/admin/usage/department` | 表单字段 4 | `telemetry.ts`<br>`/api/tenants/{tenantId}/usage/aggregates?groupBy=department` | usage-aggregates | tests/wecom-telemetry.test.ts（部门维度聚合）<br>docs/acceptance.md（实际浏览器切换维度验证） | 已实现 | — |

## 表单字段观察明细

以下只记录控制台页面观察到的字段/标签名（证据侧），自有实现的字段定义在 `admin/src/catalog.ts`；两侧不做逐字段等价声明。

### 企业智能体

- `agents`：表单 text；列表列 无观察列
- `automation-create`：表单 text、text、text、text、text、textarea、radio、radio、radio、text、text、text、text、text、text、textarea、名称、名称、描述、描述、频率、频率、每天、间隔、单次、生效区间、生效区间、配置方式、配置方式、选择 Agent、选择 Agent、模型、模型、执行指令、执行指令；列表列 名称、频率/Cron、模型、最近执行、下次执行、创建人、启用、操作
- `automation`：表单 text、text、text、text；列表列 名称、频率/Cron、模型、最近执行、下次执行、创建人、启用、操作
- `credential-create`：表单 text、text、text、text、text、text、textarea；列表列 名称、Connector类型、认证方式、值、状态、更新时间、操作
- `credentials`：表单 text、text、text、text；列表列 名称、Connector类型、认证方式、值、状态、更新时间、操作
- `evaluation`：表单 无观察字段；列表列 无观察列
- `quickstart`：表单 file、text、text、text、text、text、textarea、可见范围、可见范围；列表列 无观察列
- `runtimes`：表单 text、text、text；列表列 Runtime 名称、Runtime ID、沙箱模板、状态、创建时间、操作
- `sessions`：表单 text、text、text、text、text、text、text；列表列 Session ID、名称、Runtime ID、状态、创建者、Agent、创建时间、操作

### 客户端配置

- `assistants`：表单 无观察字段；列表列 无观察列
- `client-custom`：表单 radio、radio；列表列 序号、图标、菜单、类型、启用、操作
- `custom-menu-create`：表单 radio、radio、text、text、text、text、file、textarea、中文预览、English Preview、菜单名称（中文）、菜单名称（English）、iframe URL、绑定自建应用、菜单图标、说明；列表列 序号、图标、菜单、类型、启用、操作
- `menu-edit`：表单 radio、radio、中文预览、English Preview；列表列 序号、图标、菜单、类型、启用、操作
- `mobile-channels`：表单 无观察字段；列表列 无观察列
- `new-chat-config`：表单 无观察字段；列表列 无观察列
- `sharing`：表单 radio、radio、radio、radio；列表列 无观察列

### AI 资源管理

- `connector-create`：表单 radio、radio、text、text、text、text、text、text、textarea、text、radio、radio、text、text、password、text、text、text、text、text、text、text、text、text、password、text、text、text、自定义、内置、标识（name）、标识（name）、显示名称、显示名称、描述、描述、首页 URL、首页 URL、全员可见、指定可见范围、认证类型、认证类型、Client ID、Client ID、Client Secret、Client Secret、Authorization URL、Authorization URL、Token URL、Token URL、Scopes、Scopes、User Info Endpoint、User Info Endpoint、User Info Name Path、User Info Name Path、Redirect URL、Redirect URL、Key 字段名（Header Name）、Key 字段名（Header Name）、Key 前缀、Key 前缀、Base URL / Endpoint、Base URL / Endpoint、作为 MCP Server、作为 MCP Server、Transport、Transport、Token、Token、选择自建应用、选择自建应用、MCP Server URL、MCP Server URL、Transport、Transport、启用 MCP Gateway 代理、启用 MCP Gateway 代理；列表列 无观察列
- `connector-distribution`：表单 text、radio、radio、radio、text、text、全部状态、白名单、黑名单；列表列 无观察列
- `connector-personal`：表单 无观察字段；列表列 无观察列
- `connectors`：表单 radio、radio、text、text、text、text；列表列 无观察列
- `expert-categories`：表单 无观察字段；列表列 无观察列
- `expert-distribution`：表单 text、radio、radio、radio、text、text、全部、限定策略、屏蔽策略；列表列 无观察列
- `experts`：表单 text、radio、radio、text、text；列表列 无观察列
- `global-prompt`：表单 textarea；列表列 无观察列
- `instructions`：表单 无观察字段；列表列 无观察列
- `model-create`：表单 text、text、text、textarea、radio、radio、url、radio、radio、radio、radio、text、text、radio、radio、模型名称、模型名称、模型 ID、模型 ID、模型提供商、模型提供商、模型描述、模型描述、鉴权方式、鉴权方式、API Key、AK/SK、网络代理地址、网络代理地址、是否支持图片、是否支持图片、支持、不支持、是否支持思考、是否支持思考、支持、不支持、模型最大输入长度、模型最大输入长度、模型最大输出长度、模型最大输出长度、可见范围、可见范围、所有成员、部分成员；列表列 无观察列
- `model-personal`：表单 无观察字段；列表列 无观察列
- `model-policies`：表单 radio、radio、text、radio、radio、radio、text、默认启用、默认关闭、全部、限定策略、屏蔽策略；列表列 无观察列
- `models`：表单 text、radio、radio、radio、text；列表列 无观察列
- `playbooks`：表单 text、text、text；列表列 无观察列
- `skill-categories`：表单 text、text、text、text、text、text、text、text；列表列 无观察列
- `skill-distribution`：表单 text、radio、radio、radio、text、text、全部、限定策略、屏蔽策略；列表列 无观察列
- `skill-personal`：表单 无观察字段；列表列 无观察列
- `skills`：表单 text、radio、radio、text、text；列表列 无观察列

### 日志管理

- `dialogue-logs`：表单 无观察字段；列表列 无观察列
- `operation-logs`：表单 text、text、text、text、text；列表列 操作、操作内容、操作端、操作人、IP 地址、操作时间

### 腾讯网盘

- `drive-capacity`：表单 text；列表列 无观察列
- `drive-logs`：表单 text、text、text、text、text、text；列表列 时间、操作者、操作者部门、操作对象名称、操作类型、操作行为

### 企业设置

- `enterprise`：表单 无观察字段；列表列 姓名、手机号、邮箱、操作
- `metering`：表单 radio、radio；列表列 无观察列
- `network`：表单 textarea；列表列 无观察列

### 可观测中心

- `monitor`：表单 text、text、text、checkbox；列表列 无观察列
- `traces`：表单 text、text、text、text、text、text、text、text、text；列表列 输入 / 输出、开始时间、耗时、会话 ID（conversationId）、对话 ID（traceId）、用户 ID、应用名称、操作

### 组织与成员

- `organization`：表单 无观察字段；列表列 无观察列

### 组织概览

- `overview`：表单 无观察字段；列表列 无观察列

### 角色管理

- `roles`：表单 无观察字段；列表列 无观察列

### 席位管理

- `seats`：表单 无观察字段；列表列 无观察列

### 安全中心

- `security-client`：表单 无观察字段；列表列 无观察列
- `security-create`：表单 text、textarea、text；列表列 无观察列
- `security-general`：表单 无观察字段；列表列 无观察列

### 订阅与用量

- `subscriptions`：表单 无观察字段；列表列 无观察列
- `usage-apps`：表单 text、text、text、text、text、text；列表列 应用 ClientID、应用名称、用量消耗、周期限量、操作
- `usage-details`：表单 radio、radio、radio、radio、radio、radio、radio、text、text、text、text、text、text、text；列表列 无观察列
- `usage-members`：表单 text、text、text、text、text、text、checkbox、checkbox、checkbox、checkbox、checkbox、checkbox、checkbox、text、text；列表列 无观察列
- `usage-orgs`：表单 text、text、text、text；列表列 无观察列

## 已知缺口汇总

- `assistants`（部分实现）：local/agents 已在实际 Gateway、Host 与企业菜单准入执行；云/移动实际渠道资源及完整安装验收仍待 T13d
- `automation-create`（部分实现）：飞书 Bot 与真实通知渠道需要外部服务，未接入；Webhook 投递与重放语义已有测试，单次执行 30 分钟上限由运行时限执行
- `client-custom`（部分实现）：UWork 本机菜单命名/排序/启停与既有自动化/插件商店路由已应用；自定义项使用现有 HTTPS 标签页，iframe 免登/应用绑定与三平台安装未验
- `custom-menu-create`（部分实现）：自定义菜单按当前菜单 ID 准入打开既有 HTTPS 标签页；iframe 免登与组织应用绑定未实现
- `drive-capacity`（外部依赖）：需要真实网盘服务与订阅凭据；未配置时明确 503，不伪装成已实现的外部存储
- `drive-logs`（外部依赖）：同上：需真实网盘服务；本地只实现适配网关合同与能力声明
- `global-prompt`（部分实现）：按控制台证据不实现旧全局提示词注入；仅保留历史说明，不静默启用
- `instructions`（部分实现）：按已观察兼容边界明确不下发 UWork；Agent 所有者已支持指令注入，终端不支持属于显式边界
- `mobile-channels`（部分实现）：渠道布尔在快照中发布；移动端应用未接入（无真实移动渠道资源）
- `playbooks`（部分实现）：按已观察兼容边界明确不下发 UWork；Agent 所有者已支持指令注入，不能把终端不支持误写成待接线
- `sharing`（部分实现）：现有公网分享已执行当前发布/文件/网络/退出裁决；组织协作、微信/企微无对应已实现客户端出口，三平台及真实外部服务待验
- `subscriptions`（部分实现）：购买/续费/变配/加量包需要真实支付与供应商，未接入；订阅为本地账期事实，不称为供应商账单
