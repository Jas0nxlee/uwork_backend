# model-gateway

内网模型准入：启动项 `PRIVATE_MODEL_ORIGINS` 默认空，逐项为精确 HTTPS origin（含端口，不含用户信息、查询、片段或非根路径）。仅模型生成与模型探测消费该清单；命中时允许 RFC1918/IPv6 ULA，回环、链路本地及其他保留地址仍拒绝。全部 DNS 结果逐项检查，连接固定已检查地址；TLS 和禁止重定向保持不变。该清单不改变 MCP、企微、网盘或通知出口，默认 `ALLOW_PRIVATE_UPSTREAMS=false` 不变。

目标：模型目录/策略/探测/启停，OpenAI-compatible 对话与 SSE，服务端注入密钥并计量。
实现：src/models.ts、src/gateway.ts；HTTPS 出口，DNS 验证并固定连接地址，禁止重定向；上游时限、响应大小和 token 限制。受控本机测试仅显式环境开关允许。
管理端模型列表保留配置供管理员修复；客户端 `/v1/models` 在启用/作用域/策略检查之外，排除本租户凭据引用不存在或已吊销的模型。凭据轮换恢复 active 后重新出现。目录只检查凭据元数据，不解密密文或探测供应商健康，也不授予后续执行永久权限；调用及幂等重放仍重新校验当前授权和凭据。
JSON 上游工具调用可带可选整数 index（0–31）；只作为传输元数据接收并丢弃，不改变数组顺序，不进入响应缓存或下一轮消息。客户端历史仍使用严格工具调用合同；未知字段、非法参数、重复 ID、未声明工具及并行限制继续拒绝。
SSE 顶层非 null 的 error 表示上游失败，即使 HTTP 200 且随后给出 DONE，也不能结算或缓存成成功；返回稳定 UPSTREAM_REJECTED，不转发上游错误正文。已经派发而不能确认用量时保留 uncertain，已有正文的流以错误终态结束；error:null 保持正常帧兼容。
命名事件 `event:error` 同样拒绝；首个 `[DONE]` 立即结束读取并关闭上游，不等待连接关闭，也不处理终态后的额外帧。额度预占和持久请求标记在同一事务提交；派发前标记写入失败时一起回滚，恢复存储后允许原幂等键重试。
供应商凭据的回显在 Gateway 出口阻断，返回通用 `UPSTREAM_PRIVATE`，已派发的成功 HTTP 响应按 uncertain 保留额度且不缓存。JSON 检查已解码字符串、对象键及工具参数内嵌 JSON；SSE 对内容逐片段保留可能匹配当前凭据的最长尾部，只实时释放已证安全的前缀，跨事件和 Unicode 转义不能拼出完整凭据。工具调用累计完成后、最终结果结算/缓存前以及旧缓存重放前再次检查。供应商错误正文仍不转发。检查绑定本次已授权的凭据，拒绝过程中不会输出供应商原文、Key 或私有错误细节；它不是对任意未知秘密或任意人为编码的通用 DLP。
验收：真实 HTTP 受控上游调用、SSE 终态、失败/断开释放、模型撤权立即阻断，客户端看不到供应商凭据。
命令：npm test；npm run build。测试不连接付费服务。
边界：先支持 OpenAI-compatible 文本/视觉消息；其他供应商协议必须显式声明不支持。

## UWork 托管模型描述

`GET /v1/models` 保留 `id/object/owned_by/name/context_window/max_output_tokens`，额外返回显式布尔 `supports_vision/supports_reasoning/supports_tools`。这些公开模型能力与上限来自当前租户模型记录，不含供应商地址、凭据或价格秘密，不授予后续执行权限。支持能力为 false 必须明确返回 false，客户端不得把未知 opaque model ID 当成通用 UCAS 高能力模板。

UWork 将同一份已授权目录的描述沿现有私有 Gateway provisioning writer 应用到对应模型的精确配置；同步可纠正已落盘的旧错误参数。此合同只描述当前后端 OpenAI-compatible 字段：输出使用 max_tokens，思考仅 low/medium/high；不兼容的供应商方言不通过放宽全局输入schema处理。旧 UCAS 与个人模型模板由原所有者保留，不被该自有后端描述覆盖。
