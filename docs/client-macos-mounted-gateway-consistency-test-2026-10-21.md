# Mac ARM64：同挂载 Gateway 的401与迟到200

2026-10-21一次真实Native运行通过5项检查，Root独核24项、coverage独核28项全部通过。原后台撤销会话后，原面板的新请求收到401并清空Gateway投影；此前暂挂的真实200随后成功交付，同一个面板连续6次直接读取均未恢复旧数据。本例未修改产品代码，也没有重跑或放宽失败判据。

- [coverage28项独核](../evidence/client-native-gateway-usage-macos-mounted-v1-20261021/coverage-independent-verdict.json)
- [Root24项独核](../evidence/client-native-gateway-usage-macos-mounted-v1-20261021/root-independent-verdict.json)
- [原result](../evidence/client-native-gateway-usage-macos-mounted-v1-20261021/result.json)
- [独立资源收口](../evidence/client-native-gateway-usage-macos-mounted-v1-20261021/owned-independent-closure.json)
- [冻结计划](../data/sandbox-verification/client-native-gateway-usage-macos-mounted-v1-20261021/preparation.json)
- [原场景规格](client-macos-mounted-gateway-consistency-spec-2026-10-21.md)

## 固定输入

使用正常ARM64 v10原签名包，manifest SHA `5f88bd045a31e535215b603933da2d4940fad70f37b7e66aa50b0f6be169c475`，source `d0a5f374`、Agent `cdf781ec…`，9项运行资源和12个ARM64原生文件保持不变。新profile为`client-native-gateway-usage-macos-mounted-v1-20261021`，plan SHA `c7118697b2bbc766a7f2dfdf87dafb978a5572a5d6ba6a699a1b4d37c7e1becf`，35个源冻结。

新的transport-only测试loader只接纳本case明确的controlled hold组合，再委托原strict v10 loader执行全部制品校验；旧loader和mode guard未放宽。新派生fixture仅加入透明传输观察和只读快照。原Common fixture子进程环境只去掉它默认加入但本场景不允许的configuration witness，再开启原有hold模式；未注入Main/preload/store或新的身份owner。

本例保留原bootstrap乙的真实两次供应商调用，不把基线伪称全部为零。当前甲实际role为operator，乙为同tenant不同department的member；甲初始无模型调用、乙两笔settled/44 Credit。没有发送新的模型prompt。

## 真实时间轴

1. 原onboarding、身份菜单打开原Gateway面板；同一个DOM `backendNodeId=1578`，原Main PID86810、同一BH会话贯穿全例。初始面板展示甲、原网关端点、套餐与当前0用量。
2. 原“刷新”触发exact `/api/client/usage?period=month&metric=requests`，真实后台200于`1792515743339`被原one-shot hold暂挂。`oneShotCount=matchedResponses=1`，没有改写headers或body。
3. 原`revokeIdentity`调用正式`POST /api/auth/logout`；原`desktop-traffic.json`记录本阶段204。随后点击原7d输入，`/api/client/entitlement`于`1792515743984`真实返回401，收据标明发生在后台logout之后。
4. 原面板立即显示“企业会话已过期，请重新登录。”、“网关地址 未设置”、“账号下暂无生效套餐”和“该区间暂无用量记录。”。旧账号、端点、额度和模型列表投影均已移除；没有Back、重载、重开面板或本地UI logout。
5. 释放原旧200后，`deliveryStarted=true`、`downstreamFinished=true`，`upstreamAborted=false`、`duplicateResponse=false`、`transportError=false`。正常`downstreamClosed=true`发生在完成后，不代表abort。请求开始至正常close为973ms；完成快照在请求开始后1003ms取得。原20秒期限未改变，controller单调时钟和原HTTP时间戳两项小于20秒的断言均通过；没有将releaseRequested或abort/drop当成成功交付。
6. 成功交付之后6次直接DOM读取均立即通过，没有用轮询等待掩盖短暂回灌。每次backendNodeId仍1578，同Main及同BH会话，Gateway退休投影保持。顶层身份徽标仍为甲是实际结果：本例验证后台撤session后的Gateway投影退休，不声称本地身份owner已经退出。

## 账务与收口

原raw `/v1/chat/completions`入站POST、供应商调用均为2→2，供应商请求完整摘要序列不变。甲的ledger/Trace/gateway集合保持空；乙原2笔settled/44 Credit、2条succeeded Trace和2个已完成gateway结果全部逐行保持，未新增或改写。后台原Db仅借用作固定SELECT读取，没有新建生产Db、修改账务或将缓存命中误当没有HTTP请求。

原controller句柄自然exit0，fixture exit0，cleanup errors为空。独立核对9个known进程及BH daemon共10个PID均不存在，4个TCP端口关闭；私有0700控制目录保留的Unix socket节点拒绝连接，不把残留节点说成已删除。原协议关联已恢复、系统clipboard未使用，35源前后SHA不变。正常后台PID92288和Stopped VM未触碰，未自动启动下一例。

本例不覆盖自然TTL、同成员重新认证、真实企微、外部MCP、网盘或Windows。成员disabled→active后的原UI新认证仍独立开放；正常signed包没有合法本地IdP入口，不以重置callback、改Main或受拒SSO绕过代替验收。
