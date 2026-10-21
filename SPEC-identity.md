# identity

目标：本地登录及企微扫码，组织绑定会话、一次性 OAuth state、可吊销终端凭据。上游 Secret 不出服务端。
实现：src/identity.ts、src/wecom.ts；会话仅存哈希，cookie HttpOnly/SameSite，非 GET 校验 Origin；scrypt 密码，登录速率持久化限制。切组织重新发会话。
验收：过期、退出、重放、禁用成员、组织切换、跨租户拒绝；企微未配置返回 503。
命令：npm test；npm run build；npm start。测试位于 tests/，使用 node:test + Fastify inject，真实 SQLite。
边界：不创建生产企微应用，不沿用 WorkBuddy cookie。

Cookie 写入的 Origin 校验与认证来源一致：只有 Bearer 认证可不携带 Origin；Basic/未知 Authorization 仍回退 Cookie，因此缺 Origin 时拒绝且不写入。无效 Bearer 不回退 Cookie，有 Origin 时仍必须匹配 PUBLIC_URL。

`GET /api/auth/me` 保留原字段，增加只读 `membership: { source, externalId, department: { id, name } | null }`。成员与部门均由认证会话的当前 tenant/user 联合定位，不接受查询参数指定身份；相同部门 ID 在其他租户的记录不能参与关联。组织切换、部门调整在下一次读取立即反映，移除部门返回 null；未配置的职位等资料不凭空生成。只返回本人当前成员资料，不增加管理权限或泄露私有凭据。

通讯录同步只能读取自建应用「可见范围」内的部门与成员：`department/list` 返回的就是可见集合，成员按每个可见部门分别读取后按 userid 去重；用根部门查询会因超出范围被判 60011。可见范围为空时同步以 `WECOM_SCOPE_EMPTY` 拒绝，避免把已同步成员整体停用。上游 errcode 随 `WECOM_REJECTED` 一并返回，因为可见范围不足与凭据、可信 IP 问题的处置完全不同。
