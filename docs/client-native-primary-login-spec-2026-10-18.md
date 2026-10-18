# 客户端空身份原生登录联测合同

本合同验证既有生产登录链路；仅测试夹具替换外部身份兑换和网络出口，不新增产品身份 owner、认证 API 或会话写入路径。真实企微页面、二维码、扫码、外部 MCP 和网盘继续排除。

## 起点与所有者

- 每次运行认领全新独占根、HOME、profile 和浏览器控制目录。Native 起点只写公开 backend/tenant/Corp/agent/callback 和本次 CA；不预种成员 email 会话、共享 Token、Provider 或有效 Gateway 状态，不做模型预热。
- 管理者仅用正常后台 API 建立受控模型、普通 member、部门、席位、身份映射和额度；成员限额必须写给实际待登录成员并 GET 回读。
- 原 Host 继续持有 attempt proof、会话、issuer、加密存储及当前用户事实。Renderer 只使用原公开投影；模型供应商 Key 由后台 Vault 持有和派发。
- 原 201 attempts、claim、callback 和生产加密提交保持原逻辑，测试观察器不主动 claim、签发会话或修改响应。
- 私有控制器的 ready 早于生产 Main 导入完成，不能作为单实例锁或界面就绪证明。原 launch 后先记录实际 Main 的 PID/PPID/birth、per-PID 入口、cwd 与 CDP 归属；在该独占端点的唯一受信任 renderer 中用固定公开布尔确认登录页就绪，才允许一次原 openWorkspace。命令收集器先持久保存原始安全进程事件，再处理命令失败。

```mermaid
sequenceDiagram
    participant UI as 原Native登录界面
    participant H as 原Host身份owner
    participant M as 原Main登录guest
    participant G as 测试私有出口守卫
    participant B as 本机真实后台
    UI->>H: 原按钮beginLogin
    H->>B: 原attempts
    H-->>UI: waiting公开投影
    UI->>M: 原openEnterpriseLogin
    M->>G: 原SSO请求（RAM暂挂）
    UI->>H: 原waiting effect自动poll
    H->>B: 原私有claim返回pending
    G->>B: 一次严格TLS原callback
    H->>B: 原poll/私有claim及auth-me
    H->>H: 生产加密store提交
    H-->>UI: authenticated
    UI->>M: 原effect自然关闭guest
    UI->>B: 原配置/模型/权限/用量链路
```

## 接线和取证

原 Main 导入前安装唯一 Session 请求守卫。只允许已绑定的原窗口/guest/Session/main-frame GET；父夹具在 RAM 对齐原 attempt、nonce、六项 SSO 参数、回调、TTL 和请求标识。官方 SSO 一直暂挂，确认 held 后确有原 pending claim 才允许一次无参受控 callback；原 Hook 成功后自然关闭 guest，守卫不抢先取消成功路径。

nonce/state/URL 只过匿名 IPC RAM。原 Main 导入前清除私有 channel bootstrap 环境与测试 flag，Host/CLI 不继承控制 fd。消息、输出、初始化、授权见证和 callback 均有数量/字节/绝对截止；primary 原始 Electron stdout/stderr 只计数，不解码落盘。默认夹具分支保持原行为。

primary 启动器使用真正的 entry.mjs，先执行环境守卫，再以顶层 await 等待适配器和原 Main 导入；关键初始化链不能裸用 import().then，也不能等待 app.whenReady 后再导入。此时序遵循 [Electron ESM 说明](https://www.electronjs.org/docs/latest/tutorial/esm)。启动器自己用 wx0600 写 pid/ppid/isPackaged/appPath 四字段记录；后续准备只核对生成器的精确入口字节，不再前插 CJS 代码。默认模式仍使用原 entry.cjs。

测试入口诊断仅允许 secondary_argv_shape、owned_workspace、session_guard、main_import、private_channel 五种固定拒绝码，以及已拥有进程的实际退出 code/signal。拒绝收据用 wx0600 保留第一次结果，不记录原异常、cause、argv、URL 或请求详情。这些测试收据不能作为产品认证或用户权限的来源。

登录输入前锁定敏感观察；随后只允许固定公开布尔、文本和原控件几何及 Browser Harness 物理输入。禁止读取或输出原始 AX/截图/DOM、链接、网络明文、Cookie、Storage、proof、Token 和 OAuth 参数。冷启动的新 Root 必须重新核对实际 PID/PPID/birth/appPath/CDP 与受信任 renderer，不沿用旧 attachment。

原生产快照、stopNative 和 owned openWorkspace 仍使用原有限接口；不提供通用 RPC。primary supplier 只接受精确 models/chat 路径和本次正常 API 创建的后台 Key；拒绝未知路径、query 变体或错误凭据，Trace 与默认模式保持原行为。公开证据只输出匹配计数、角色/额度及本人账本归属布尔。

## 接受边界

1. 全新 Native 原按钮完成一次登录，真实 attempts/pending/callback/claim/auth-me 与原 guest 自然关闭均有证据。
2. 原公开配置、可选模型、普通成员权限、有效额度及本人用量吻合实际后台；原一次对话经后台到受控 supplier，Key 匹配且账本归当前成员。
3. 同 profile 冷启后不增加 SSO attempt 自动恢复；原退出后配置/用量投影退休、新发送拒绝且无 supplier/账本增量；再次冷启保持退出。
4. 每业务动作一次、无业务重试，780 秒业务/900 秒总预算，witness soft96/hard128。首次失败停止业务并先清理；未知写者或清理不确定时保留私有根，不查询/操作外部持有者。

接线代码的独审通过后，Root 可以显式将测试 review 锁设为 true，并复验完整有限合同；这只允许进入后续受控 Native 测试。组件 25/25、Node IPC 微探针、有限合同以及 review 锁解除都不代表本合同已验收，完成仍需上述实际 Native 证据。
