# Mac 原包：真实短会话到期与原请求取消

本例验证正常ARM64 v10原包的身份计时器，不是公开TTL设置或原UI重新认证验收。现HTTP邮箱登录默认12小时，没有可直接调节的公开短TTL配置。隔离夹具仅在初始当前会话创建处调用原内部`issueSession(...,60000)`：原后端新建真实会话、原`GET /api/auth/me`取得同一个`expiresAt`、原初始化加密store写入该完整会话。用户乙原两次模型/44 Credit种子保持。没有改已有会话、时钟、计时器或单独伪造客户端时间。

profile使用`client-native-gateway-usage-macos-mounted-v2-20261021`，复用既有严格transport-only loader允许的vN合同；所有B场景35源、旧loader与guards保持原样。新fixture/driver和签发setup另存。原签名App、Main/preload及生产身份owner不注入、不替换；真实企微浏览器、MCP、网盘与VM不涉及。

验收仅沿原路径：

1. 原onboarding和Gateway就绪时，真实剩余TTL须大于8秒；记录原`me.expiresAt`及已存在初始化store的只读revision/session-present事实。若窗口不足，失败收口，不重签或延时求绿。
2. 等真实时间至剩余不超过6秒且仍大于1.2秒，再原UI刷新并暂停唯一真实month200；不改原20秒网络期限。
3. 真实到期由原IdentityService计时器清身份、原store的token/revision CAS写入tombstone，并由同一原authority signal取消在途请求。不能显式revoke、logout、改数据库或手动改store代替到期。
4. 到期后的原UI没有活动旧身份和旧Gateway账号/额度；允许原面板因登出卸载，不借此冒称B同挂载晚200。若原模型菜单入口可用，再核旧UCAS候选已退休，入口不可用须如实记录。
5. 原hold实际关闭/abort，之后release不得开始delivery或完成下游。原有效期、真实时间、客户端匿名态、原store revision推进/session-null互相核对；六次直接采样不得吞掉瞬间回灌。
6. 当前及另一成员全部ledger/Trace/gateway业务行、实际inference POST与供应商摘要保持；精确进程、端口、浏览器控制和OS协议恢复收口。受控60秒签发不等同公开配置、真实企微或所有平台完成。

Root及独立peer审准确plan SHA后仅放行一次运行；当前是准备合同，尚无本例Native结果。
