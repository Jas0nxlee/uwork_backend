# client-policy

Host 执行裁决：`/api/client/authorize` 先检查有效订阅、席位、IP 白名单及指定助理渠道（缺省 local）。`action=execution` 仅确认当前执行上下文可用并返回同一时刻的 tenantId/effective security，不代表任意资源动作获准；可信 Host 仍须逐项检查实际 shell/filesystem/network 能力。原有资源 action 保留，拒绝不能被 yolo、Hook、用户审批或缓存覆盖。

执行准入同时返回已发布 `personal` 的 models/skills/connectors 三个布尔值（不包含 mcpHub）。它们与 effective security 在同一次同步服务端裁决内读取，避免客户端把两次 HTTP 的个人与危险技能策略拼成不一致快照。草稿不能进入该结果；旧布尔动作合同保持不变，额外字段不授予资产权限。受管技能 Host 需要该字段，旧服务端缺失时明确拒绝，不回退到旧允许结果。

目标：菜单/新对话/助理/分享草稿与发布、版本化快照、安全策略和 IP 白名单。
实现：src/policy.ts；草稿独立于生效快照，乐观版本锁；内置菜单保留，自建 HTTPS；风险提示不可关闭。安全策略按最高数字优先级整条选择。
验收：草稿不生效，发布版本递增，成员覆盖只能收紧；运行入口执行网络/分享/渠道策略。空 IP 允许，单独 127.0.0.1 禁止全部。
命令：npm test；npm run build。策略矩阵、CIDR 和发布冲突测试。
边界：路径/命令本地 enforcement 依赖 UWork Host 适配，快照下发不等于终端执行已验收。
