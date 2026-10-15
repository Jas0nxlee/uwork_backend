# client-policy

Host 执行裁决：`/api/client/authorize` 先检查有效订阅、席位、IP 白名单及指定助理渠道（缺省 local）。`action=execution` 仅确认当前执行上下文可用并返回同一时刻的 tenantId/effective security，不代表任意资源动作获准；可信 Host 仍须逐项检查实际 shell/filesystem/network 能力。原有资源 action 保留，拒绝不能被 yolo、Hook、用户审批或缓存覆盖。

执行准入同时返回已发布 `personal` 的 models/skills/connectors 三个布尔值（不包含 mcpHub）。它们与 effective security 在同一次同步服务端裁决内读取，避免客户端把两次 HTTP 的个人与危险技能策略拼成不一致快照。草稿不能进入该结果；旧布尔动作合同保持不变，额外字段不授予资产权限。受管技能 Host 需要该字段，旧服务端缺失时明确拒绝，不回退到旧允许结果。

目标：菜单/新对话/助理/分享草稿与发布、版本化快照、安全策略和 IP 白名单。
实现：src/policy.ts；草稿独立于生效快照，乐观版本锁；内置菜单保留，自建 HTTPS；风险提示不可关闭。安全策略按最高数字优先级整条选择。
验收：草稿不生效，发布版本递增，成员覆盖只能收紧；运行入口执行网络/分享/渠道策略。空 IP 允许，单独 127.0.0.1 禁止全部。
命令：npm test；npm run build。策略矩阵、CIDR 和发布冲突测试。
边界：路径/命令本地 enforcement 依赖 UWork Host 适配，快照下发不等于终端执行已验收。

分享准入扩展：`action=share` 的响应额外返回同一次裁决读取的已发布 `sharing`（publish/collaborate/files/wechat/wecom）；草稿不进入响应，旧 `allowed` 语义不变。终端公网分享（包括依赖公网服务的“私有链接”）必须使用 `target=internet`，仅 publish=internet 可通过；无组织隔离合同的公网链接不能视为 organization 分享。新 Host 消费者严格校验字段，并在实际写出口前重查，不用投影缓存授权。

## 企业菜单与独立控制台

内置 chat 对应既有新任务入口，agents/assets 对应独立企业智能体/企业资产页，不映射为个人自动化或插件商店。Host 通过 `POST /api/client/menus/:id/authorize` 在每次打开前读取当前已发布菜单，校验有效会话/席位/订阅，返回 `{allowed,tenantId,menu?,version}`。禁用/不存在菜单不返回 URL，草稿不生效，chat/agents 同时检查相应助理渠道；自定义页面仅允许既有 HTTPS 标签页，不宣称 iframe 免登或第三方会话隔离。

`/api/client/agents` 和 `/api/client/runs` 只用于企业智能体页；运行创建/查询/取消先检查 agents 菜单与渠道，成员只可查看和取消本人任务，租户来源仅为会话。列表不暴露模型供应商地址/凭据、Agent 指令或其他成员内容。Runtime 仍为任务状态唯一所有者；客户端接口复用 enqueue/decode/cancel，不创建第二份队列。GET agents 是当前发布/启用/可见清单；POST runs 使用 `{agentId,input,timeoutMs?,sessionId?}`，202 返回任务 DTO；已禁用菜单的访问必须重新启用后才可读取，取消本人已有任务可在菜单关闭后执行，以便停止已接受工作。
