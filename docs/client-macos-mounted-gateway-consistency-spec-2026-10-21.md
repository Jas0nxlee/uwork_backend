# Mac 原包：同挂载网关的401退休与迟到200

本轮只补一个真实Mac缺口：后端撤销会话后，原页面的新请求收到401，旧请求随后成功交付200也不能恢复旧投影。使用已核对的正常ARM64 v10包、隔离真实后端和原UI；不是复跑已通过的卸载面板后abort/drop，也不覆盖自然TTL或同成员重新认证。

## 固定边界

- 新profile为`client-native-gateway-usage-macos-mounted-v1-20261021`。旧cold/capability输入、所有原loader和mode guard保持原样。
- 原包现有通用测试loader禁止组合mode。仅在新的、独立审查的transport-only测试入口中允许已知`UWORK_NATIVE_GATEWAY_USAGE_HOLD=controlled`；仍要求experience enabled，拒绝primary、twoOrg、viewer、file、dynamic等身份或执行拦截模式，并复用原v10全部资源哈希、源哈希、架构和签名校验。这不是宣称原loader本来支持该模式。
- 仅用已有真实HTTP透明hold：唯一exact month/requests GET实际200暂停，原headers/body透传；不创建新identity owner、改store、复制或注入Main/preload、修改原响应、替换请求或放宽原20秒请求期限。
- 撤销使用原后端logout API。随后仍用原页面输入触发401；本地身份owner是否退出按实测记录，不把后端session撤销冒称原UI logout或自然过期。真实企微浏览器、外部MCP、网盘与VM不涉及。

## 单次验收

1. 原签名包原onboarding后，打开原Gateway面板。记录账号、套餐/用量/额度基线及唯一DOM backendNodeId，原controller/bootstrap仅一次。
2. 原刷新用量触发唯一旧month请求；证明原后台已返回200且hold状态held、oneShot/matched均1，不读取或改写正文/凭据。
3. 原后端logout成功后点击原7天输入，记录新401和投影退休。面板backendNodeId与挂载状态必须未改变，不能Back、重载或重开面板。
4. 释放原旧响应，必须实际deliveryStarted与downstreamFinished为true，upstreamAborted为false。abort、drop、超时或仅调用release不算成功交付。
5. 原面板连续六次采样仍无旧账号、端点、用量与额度回灌。保留同backendNodeId；模型供应商、current/other ledger、Trace及gateway调用集合全部无新增/改动。
6. 按原关闭流程收口原Main/Host/CLI、私有后端/代理/供应商和浏览器控制进程；精确PID、TCP/UNIX连接及OS协议恢复分别核对。保留失败证据，不自动重试、降断言或把业务通过覆盖清理失败。

Root与独立peer先审查准确的新plan SHA和唯一Mac输入窗口，再授权一次真实运行。当前是准备合同，尚未执行本场景。成员disabled→active后原UI新认证仍是独立缺口：正常原包无现成合法本地IdP导航入口，不能重置一次性callback或借受拒外部SSO绕过它。
