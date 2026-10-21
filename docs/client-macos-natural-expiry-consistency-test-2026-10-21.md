# Mac ARM64：真实会话自然到期与旧响应取消

2026-10-21一次真实Native运行通过6项检查，Root独核27项、coverage独核29项全部通过。初始受控会话按真实60秒TTL自然到期，原IdentityTimer退出身份并保存加密store墓碑，原authority signal真实取消暂挂的HTTP200；释放后也没有交付旧响应。与上一例“后台撤session后迟到200成功交付”分开验收。

- [Root27项独核](../evidence/client-native-gateway-usage-macos-mounted-v2-20261021/root-independent-verdict.json)
- [coverage29项独核](../evidence/client-native-gateway-usage-macos-mounted-v2-20261021/coverage-independent-verdict.json)
- [原result](../evidence/client-native-gateway-usage-macos-mounted-v2-20261021/result.json)
- [独立资源收口](../evidence/client-native-gateway-usage-macos-mounted-v2-20261021/owned-independent-closure.json)
- [冻结计划](../data/sandbox-verification/client-native-gateway-usage-macos-mounted-v2-20261021/preparation.json)
- [原场景规格](client-macos-natural-expiry-consistency-spec-2026-10-21.md)

## 准备边界与固定输入

使用正常ARM64 v10原签名包，manifest SHA `5f88bd045a31e535215b603933da2d4940fad70f37b7e66aa50b0f6be169c475`，source `d0a5f374`、Agent `cdf781ec…`、9项运行资源与12个ARM64原生文件不变。profile `client-native-gateway-usage-macos-mounted-v2-20261021`，plan SHA `f8ab8929c94fa6a88b3b5e67164bafb310ab54cdf276900b22cff6359c613433`，44源冻结。旧B的35源、既有loader/mode guard和所有旧输入保持不变；本轮仅使用已审transport-only严格入口。

本例只在新隔离夹具初始化时调用原内部`issueSession(...,60000)`，随后走原`GET /api/auth/me`及原encrypted shared-store.write。它不是公开登录TTL配置，也不是原UI重新认证。没有修改已有会话、系统时钟、Date/timer、store expiry或Identity owner；窗口不足会失败，不会重新签发掩盖问题。原metadata继承的email初始化描述不作本例认证方式证据，以冻结派生源码和真实issuer/me/store收据为准。

当前甲是operator；乙是同tenant不同department的member。原bootstrap乙的两次真实调用和44 Credit基线保留，未删seed来宣称全局调用总数为零。本例没有新的模型prompt，原受控模型元数据128000未为此场景修改。

## 真实到期证据

- 原后台只读session行`created_at=1792516284963`、`expires_at=1792516344963`，相差恰60000ms。原GET/me及加密store同为`expiresAt=1792516344963`，初始revision1/sessionPresent true。
- 原Gateway ready时实际剩余54137ms，超过8秒。只按真实时间等待；pre-hold单调时钟65秒上限未触发。arm后、原UI刷新前重新取得剩余5759ms，满足`1200 < remaining <= 6000`。
- 原month/requests GET于`1792516339587`开始，真实后台200于`1792516339589`暂挂；held快照仍剩5374ms，`matchedResponses=oneShotCount=1`，当时未交付、未关闭或abort。
- 到期后原UI身份徽标消失、登录入口出现；原Gateway仍可见但只显示“未登录企业账号”，旧账号、端点、额度和模型投影消失。原既有store.read观察到revision1→2、sessionPresent false、expiresAt null，未由观察器写墓碑。
- 原authority信号使旧响应于`1792516344967`关闭，比真实expiresAt晚4ms、距请求开始5380ms。`phase=aborted`、`upstreamAborted=true`、`downstreamClosed=true`，transportError false；同时`deliveryStarted=false`、`downstreamFinished=false`。controller持久化单调耗时5.925296999994316秒，原HTTP与单调时钟的20秒界限均通过。
- 之后执行原release仅令releaseRequested true；phase仍aborted，始终未开始或完成交付。未显式撤销当前甲的session，`serverSessionRevoked=false`；原traffic唯一logout204是初始化乙的既有seed步骤，不是到期替代。
- release后6次直接UI读取均立即保持退出状态，无轮询等待掩盖回灌。随后原模型菜单入口实际可达，沿原UI打开后企业UCAS provider group和model item均为0。本例确实验证了这个可达分支；没有为不可达入口改状态、打开SSO或创建新owner。

## 账务与资源

原raw inference POST2→2、供应商调用2→2，供应商请求摘要序列不变。甲ledger/Trace/gateway保持空；乙原2笔settled/44 Credit、24输入及20输出Token、2条succeeded Trace和2个完成gateway结果全行不变。后台membership仍active、原模型定义仍published是合法状态；到期的是认证会话和客户端有效投影，不是删除成员或后台模型。

controller句柄自然exit0、fixture exit0、cleanup errors为空。9个known PID及BH daemon共10个PID独立确认不存在，4个TCP端口关闭；私有0700控制目录保留的Unix socket节点拒绝连接。原协议关联已恢复，系统clipboard未使用，44源前后SHA稳定。正常后台PID92288和Stopped VM未触碰，没有自动重试或下一例。

本例不关闭同成员disabled→active后原UI重新认证缺口，也不等于真实企微、外部MCP、网盘、Windows或公开TTL配置验收。不得以内部受控签发代替这些尚未完成的入口。
