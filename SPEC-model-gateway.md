# model-gateway

目标：模型目录/策略/探测/启停，OpenAI-compatible 对话与 SSE，服务端注入密钥并计量。
实现：src/models.ts、src/gateway.ts；HTTPS 出口，DNS 验证并固定连接地址，禁止重定向；上游时限、响应大小和 token 限制。受控本机测试仅显式环境开关允许。
验收：真实 HTTP 受控上游调用、SSE 终态、失败/断开释放、模型撤权立即阻断，客户端看不到供应商凭据。
命令：npm test；npm run build。测试不连接付费服务。
边界：先支持 OpenAI-compatible 文本/视觉消息；其他供应商协议必须显式声明不支持。
