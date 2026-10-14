# 自有 API 合同

这是 UWork 自有协议，不是 WorkBuddy 私有服务端接口的复制。交互式路径索引：`GET /api/openapi.json`。其主要请求体由实际 Zod 合同生成；未附请求体的操作以本文、模块 SPEC 和 tests 为准。

## 鉴权与组织

- `POST /api/auth/login`：`{email,password,tenantId?}`，返回不透明 `token,expiresAt`，同时设置 HttpOnly/SameSite cookie。管理 Web 不保存 token。
- `GET /api/auth/me`：当前成员、组织、角色、到期时间；`POST /api/auth/switch` 重新签发会话并废止旧会话。
- `POST /api/auth/logout`：可选 `{revokeDevices:true}` 同时废止当前成员在本组织的全部终端凭据。
- `POST /api/auth/device-tokens`：`{ttlHours:24,replaceId?}`，返回一次可见 `id,token,expiresAt`。只允许 execute，不允许管理/vault；最长 168 小时，默认 24 小时。GET 列元数据、DELETE `/:id` 吊销。
- 每个 `/api/tenants/{tenantId}/...` 必须与会话组织一致。角色 owner/admin 可管理身份及 vault，operator 可管理非敏感业务资源，auditor 只读，member 仅执行。调用还要求有效席位、订阅、资源可见性和执行策略。
- Cookie 写请求必须带与 PUBLIC_URL 相同的 Origin；Bearer 客户端无需 Cookie。服务器不信任代理转发的 IP，IP 白名单使用 TCP 对端地址。

## 企微扫码

管理员：PUT `/api/tenants/{id}/wecom` `{corpId,agentId,credentialId}`，Secret 先存 vault；PUT `/members/{userId}/wecom` `{externalId}` 绑定现有成员，或 POST `/wecom/sync` 创建明确标记为 wecom 的成员（默认无席位、普通角色）。

1. POST `/api/auth/wecom/attempts` `{tenantId}` → `id,proof,expiresAt,authorizeUrl`。
2. 系统浏览器 GET `/api/auth/wecom/callback?state=...&code=...`；原生拦截回调时用 POST `/attempts/{id}/complete` `{proof,code}`。随机 state 与 attempt 绑定，proof 不放 URL。
3. POST `/attempts/{id}/claim` `{proof}`。pending/verifying 继续轮询，authorized 一次性返回会话；重复认领 409。
4. POST `/attempts/{id}/cancel` `{proof}`。验证中的取消也有效，迟到回调不能复活。

## 模型与计量

模型列表/创建/更新/停用：`/api/tenants/{id}/models`，创建和改变 URL/凭据关联需要 vault 权限。`/{modelId}/probe` 访问真实上游 `/models`，不把 HTTP 200 等同于模型生成可用。

```json
{
  "name": "Enterprise Model",
  "upstreamModel": "provider-model-id",
  "baseUrl": "https://provider.example/v1",
  "credentialId": "vault-resource-id",
  "contextWindow": 128000,
  "maxOutputTokens": 4096,
  "inputRate": 1000,
  "outputRate": 1000,
  "supportsVision": false,
  "supportsReasoning": false,
  "scope": { "all": true },
  "enabled": true
}
```

更新需要完整内容与 `revision`；旧 revision 返回 409。`GET /v1/models` 只返回本成员当前可用模型。`POST /v1/chat/completions` 使用本地模型 id，支持文本、SSE、可选 reasoning_effort，以及显式启用的 data URL 图片；不下载任意图片 URL。上游协议是 OpenAI-compatible；其他厂商专属签名协议未适配。

Header `Idempotency-Key` 最长 128 字符；同键/同人/同内容重放成功结果，同键不同内容或处理中返回 409。成功缓存加密存储。输入按 UTF-8 字节及消息开销上界预留，输出按 max_tokens 预留，按真实 usage 结算；无 usage 时保守估算。每模型整数单价为每 1000 token 的 Credit，**Credit 不是美元或供应商账单**。

已输出、超时、取消、连接异常或进程重启不能证明上游免费，账本变为 `uncertain` 并占用全部预留额度。只有明确未执行的拒绝释放。管理员 PUT `/api/tenants/{id}/usage/{ledgerId}/reconcile` `{amount,evidenceReference}` 在预留范围内核实，一次性审计。成员/部门祖先/应用/企业限制在同一个 SQLite 事务内检查，组织最多 16 个并发上游调用。

`/subscription` 管理本地席位与订阅，`/limits` 维护 tenant/member/department/application 限量；自然月或订阅周年切片均使用 UTC，月末周年按当月最后一天夹取，不删除历史账本。

## 资产与策略

- `/assets` 支持 skill/expert/connector/playbook/instruction，内容严格按类型校验；技能为包含 SKILL.md 的安全相对路径文本文件包，单包最多 1 MiB。不是任意压缩包解压执行器。
- 每次更新新增不可变版本；`/{id}/review` `{version,approved}`，`/{id}/publish` `{version}`；审核拒绝当前发布版本会撤下。`/categories` 维护分类。
- `/policies` 支持 allow/deny/distribute，作用域为成员/部门/全员；先默认可见范围，allow 取交集，deny 优先。连接器遵循同样规则。
- `/policies/security` 采用最大数字优先级的完整规则，不合并多个命中策略。
- `/configurations/{kind}` 的 kind 为 menus/new-chat/assistants/sharing/personal/security/network；PUT `{revision,data}` 只存草稿，POST `/publish` `{revision}` 才生效；DELETE `/draft` 放弃草稿。已发布快照有独立递增版本与历史。
- `/api/client/configuration`（ETag）、`/assets`、`/assets/{id}/download`、`/authorize`、`/events` 为终端合同。撤权后下载/执行即时拒绝；获取快照不等于本地 Host 已执行所有策略。
- 内置菜单保留，自建地址 HTTPS；AI 风险前缀固定；历史全局提示词不注入。IP 空列表允许，**单独 127.0.0.1 是产品兼容的禁止全部标志**。

连接器 RPC：POST `/api/client/connectors/{id}/rpc`，仅允许声明方法与 `allowedTools`。initialize 返回本地不透明 MCP-Session-Id；远端 session 加密并绑定成员、资源发布版本和有效期。凭据只由代理注入。支持 POST JSON 与单次 SSE 响应；不提供长期服务端推送 GET 流。

## Runtime 与观测

- `/agents` 创建/更新/发布；运行锁定发布版本，启动时重新检查模型和资产授权。运行器为独立上下文的模型执行器，不运行任意 shell，不冒充云代码沙箱。
- POST `/runs` `{agentId,input,sessionId?,timeoutMs?}` → 202；GET 列表/详情，POST `/{id}/cancel`。queued/running/succeeded/failed/cancelled/timed_out 均持久化；最长 30 分钟，重启中断任务为 failed/PROCESS_RESTARTED。
- `/automations` 支持 once/interval/cron（含秒、显式时区），生效至 endsAt；持久化唯一触发键，禁止重叠，不重放离线期间每个历史时点。Webhook 凭据内容为 `{url,token?,type:webhook|feishu}`；最多 3 次投递，at-least-once，接收方用 run id 去重。
- `/datasets` 的样本为 `{input,expected,match:exact|contains}`；POST `/evaluations` 创建真实运行，GET 报告、POST `/{id}/cancel`；不把字符串匹配评分冒充 AI 评审质量分。
- `/audit`、`/traces`、`/usage`、`/client-events` 支持 page/pageSize/q/from/to/userId；trace/usage 另支持 application/status。`format=csv` 上限 10000 条，CSV 防公式注入，使用时间范围分段导出。
- `/metrics`、`/usage/aggregates?groupBy=member|department|application` 聚合自有账本。成员 `/api/client/usage` 仅看自己的统计，Credit 单位明确。
- POST `/retention/purge` `{days:90}` 清理诊断记录、临时缓存和可删除终态任务；业务账本、评测、自动化历史按业务保留，需按企业要求补充归档策略。

## 外部适配

`/integrations` 声明能力状态。网盘经自有 HTTPS 适配网关提供 health/capacity/files/logs 及容量策略，不直接宣称已实现腾讯网盘私有协议。缺少配置返回 503。支付和云沙箱明确 unavailable。
