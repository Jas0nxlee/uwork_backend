# model-gateway

内网模型准入：启动项 `PRIVATE_MODEL_ORIGINS` 默认空，逐项为精确 HTTPS origin（含端口，不含用户信息、查询、片段或非根路径）。仅模型生成与模型探测消费该清单；命中时允许 RFC1918/IPv6 ULA，回环、链路本地及其他保留地址仍拒绝。全部 DNS 结果逐项检查，连接固定已检查地址；TLS 和禁止重定向保持不变。该清单不改变 MCP、企微、网盘或通知出口，默认 `ALLOW_PRIVATE_UPSTREAMS=false` 不变。

目标：模型目录/策略/探测/启停，OpenAI-compatible 对话与 SSE，服务端注入密钥并计量。
实现：src/models.ts、src/gateway.ts；HTTPS 出口，DNS 验证并固定连接地址，禁止重定向；上游时限、响应大小和 token 限制。受控本机测试仅显式环境开关允许。
JSON 上游工具调用可带可选整数 index（0–31）；只作为传输元数据接收并丢弃，不改变数组顺序，不进入响应缓存或下一轮消息。客户端历史仍使用严格工具调用合同；未知字段、非法参数、重复 ID、未声明工具及并行限制继续拒绝。
验收：真实 HTTP 受控上游调用、SSE 终态、失败/断开释放、模型撤权立即阻断，客户端看不到供应商凭据。
命令：npm test；npm run build。测试不连接付费服务。
边界：先支持 OpenAI-compatible 文本/视觉消息；其他供应商协议必须显式声明不支持。
