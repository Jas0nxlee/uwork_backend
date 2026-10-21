# 管理端浏览器会话交付

管理端使用同源 `fetch(..., credentials: same-origin)` 和 HttpOnly Cookie 访问后台，不读取或存储登录响应中的 Bearer 令牌。登录表单必须显式选择后台已有 `delivery: cookie` 合同，响应正文只交付 expiresAt，Cookie仍包含HttpOnly/SameSite，后续me、管理请求和退出继续按原服务执行。

唯一会话签发与Origin校验所有者仍为后端 identity；不新增身份、认证流程或权限，不改变Native默认token交付模式。该修改消除原浏览器JSON响应中多余的会话令牌暴露。

同一规则适用于管理端组织切换：`/api/auth/switch` 复用已有 delivery 枚举，cookie模式先校验同源，再执行原成员准入和原子旧会话退休/新会话签发；缺省token模式保持Native兼容。浏览器选择组织时显式请求cookie模式，JSON不得返回token。拒绝缺Origin的cookie交付请求时旧会话仍有效。真实UI在副本内增加一个纯测试组织验证往返，不向主库或真实企业增加成员权限。

真实浏览器验收：原登录表单→响应有HttpOnly Cookie且JSON无token→原企业配置/真实企微同步/目录读取正常→退出及reload保持退出。受控后端合同继续验证cookie-only同源要求和Native token模式。修复前real-wecom-admin-v3已复现JSON token存在，证据只保存布尔值，不保存令牌。
