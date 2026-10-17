# identity

目标：本地登录及企微扫码，组织绑定会话、一次性 OAuth state、可吊销终端凭据。上游 Secret 不出服务端。
实现：src/identity.ts、src/wecom.ts；会话仅存哈希，cookie HttpOnly/SameSite，非 GET 校验 Origin；scrypt 密码，登录速率持久化限制。切组织重新发会话。
验收：过期、退出、重放、禁用成员、组织切换、跨租户拒绝；企微未配置返回 503。
命令：npm test；npm run build；npm start。测试位于 tests/，使用 node:test + Fastify inject，真实 SQLite。
边界：不创建生产企微应用，不沿用 WorkBuddy cookie。

Cookie 写入的 Origin 校验与认证来源一致：只有 Bearer 认证可不携带 Origin；Basic/未知 Authorization 仍回退 Cookie，因此缺 Origin 时拒绝且不写入。无效 Bearer 不回退 Cookie，有 Origin 时仍必须匹配 PUBLIC_URL。
