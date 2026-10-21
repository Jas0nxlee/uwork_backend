# Mac Quit v12：每对象消息子预算 counterfactual testing

本轮仅测试设施准备。原 `_NativeAx._own` 每次对传入对象设置 `min(0.1, remaining)`；这是单个 AX object 的消息超时，不是原 operation 的5秒总期限。Apple 的 [SetMessagingTimeout 文档](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout) 明确对象设置只影响该对象，不能由 application ref 或相等对象的设置推导其它 ref 的超时。

原规格规定 AX operation<=5秒，没有声明100ms单消息产品 SLA。v12 **明确扩大设施内部消息容忍至 `min(0.5, remaining)`**，不声称所有测试条件原样，更不把它偷换为产品性能要求的放宽。产品84源、旧共享 helper、原5秒/Host9秒/supplier45秒/180-160-20及完整确认与资源账务要求保持。旧 v11 FAILED5、241源、计划和编译产物先归档，不能回填为成功。

这是反事实设施变体：纯合同证明一条受控0.2秒消息在原100ms下失败，而在新子预算内可以返回；并不证明 v11 的 -25204 由100ms引起。即使后续 Native 改变结果，也只可报告新 profile 的观察和单次 Copy 耗时，不能仅靠错误码或一次前后运行宣称根因。若用户将来指定100ms SLA，应保留原100ms测试并单独判定，不能拿 v12 代替。

仅在独立 `_QuitAx` namespace 派生 `_own`，原 SetMessagingTimeout 调用位置、PID检查和原 API 错误条件不动，只改对象参数上限；PID guard返回后再检查同一原截止，防止已耗尽时继续发属性请求。不使用 SystemWide，不增加 AX 查询、动作、重试、激活或 Focus 属性。`_raw` 复用 v11 原许可分支与异常，额外两次 monotonic 读取围绕同一次 CopyAttributeValue；记录白名单 attribute、numeric code、返回值存在与耗时、该对象配置子预算，有限保留64条。成功动作随原 action receipt保存；失败随原异常保存，不采集文本、指针、locals、参数或环境。

原 overall deadline 不重设。同步 native call 不能由本设施硬抢占；若它晚返回，原 `checked`/identity guard 必须拒绝结果，不能进入候选消费、refresh 或 press。不能把子预算当作额外0.5秒窗口。纯合同以不合作的晚返回证明5秒越界零候选/零press；错误owner、API错误与 -25204仍原样失败，不吞错误或重试。

仅在原失败已写入 facts 且确有原 held 请求后，在 finally stopNative之前，通过已有 `activeQuitSnapshot`、phase=`poll` 读取 beforeCleanup。调用最多3秒并夹在原 work160剩余内，不占用或重开 AX operation5秒；没有余量即 unavailable。它不发客户端业务RPC、模型或 app.quit，不把原失败改成成功；快照或持久化失败不得 mask 原异常。该时刻的 nativeAlive/nativeExit/hold/账务与 finally 后收口分开，不能从 cleanup 日志反推原菜单行为。

纯测试先保原实际 `_own`+`_raw` 的100ms RED，再验证新合法返回、原允许错误码、owner、整体期限、原完整 `_confirmation`+refresh、CF释放、成功/失败计时和 FAIL-only snapshot。Root与fresh peer审核新计划后才可考虑唯一 Native 运行。本轮不启动App，不碰Linux case、共享 dist/out或产品源。
