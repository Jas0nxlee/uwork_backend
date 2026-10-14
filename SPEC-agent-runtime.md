# agent-runtime

目标：Agent 配置发布、隔离的模型执行上下文、Session、超时/取消终态、自动化/结果投递、评测。
实现：src/runtime.ts、src/automation.ts、src/evaluation.ts；持久化 queued/running/terminal，最大 30 分钟；单进程工作器，重启对中断任务记录 failed；cron-parser 明确时区，禁止任务重叠。
验收：真实 HTTP 模型执行，取消传播、超时、重启终态、唯一调度触发、Webhook 重试边界、评测汇总。取消只终止业务任务，不能认定上游未计费；中断用量遵循 entitlements 的 uncertain 对账规则。
命令：npm test；npm run build。测试包含本机真实上游和时钟边界。

## Docker 沙箱切片

补齐真实 Runtime 生命周期和隔离执行，保留已有 model-only 执行方式。服务端通过显式配置的专用 Docker unix socket 使用 Dockerode，不能从 HTTP 请求接收 Docker 地址、镜像或 Docker 参数。

- Runtime 状态持久化，Docker 的实际状态为运行证据；每租户最多 4 个沙箱，全实例最多 16 个。
- 容器非 root、只读根、无 host bind/设备/socket、无网络、cap-drop ALL、no-new-privileges、默认 seccomp、256 MiB 内存、0.5 CPU、64 PID，工作目录和 /tmp 为受限 tmpfs；容器自身最长存活 30 分钟。
- 代码仅在该容器内以 Node.js 执行，输入/输出加密保存；输出总量最多 128 KiB。一次执行拥有一个 Runtime，同一 Runtime 不重叠。
- 取消/超时停止整个容器，不能仅断开 Docker exec 的 HTTP 流后宣称进程已终止。后端重启时核对带匹配 owner label 的容器并停止中断执行。
- 删除/停止/执行都要求本租户授权，Docker 容器的随机 owner label 必须与持久化行匹配，不能凭名字删除第三方容器。
- Docker 未配置或不可达返回明确不可用；不向容器注入模型/vault/后端密钥，也不挂载用户目录。

验收包括真实容器中的读写、网络隔离、host 文件不可见、非 root、取消/超时、输出限制、并发拒绝、重启恢复和跨租户拒绝。后续 Agent 工具调用连接这套 Runtime，不能把单独的执行接口当作 Agent 工具闭环已完成。

## 模型工具协议与循环

先以可单独验收的切片扩展 model-gateway：OpenAI-compatible function tools、assistant tool_calls、tool 消息及 JSON/SSE 往返。模型须显式启用 supportsTools，未知函数名、重复调用 ID、过大或不合法参数拒绝；工具定义、调用与结果均进入上下文上界预留和加密幂等缓存。只完成协议不代表服务端执行了工具。

后续使用成熟的 Agents SDK Runner 负责模型/工具循环，自有 Model 端口逐次经过 Gateway 授权和账本，不另建绕过计量的 SDK HTTP 客户端。SDK 自动 tracing 必须禁用，不把企业输入、代码、工具结果发送到外部 tracing 服务。工具只暴露受控 SandboxService/MCP 端口，模型不能选择 Docker 配置、凭据或宿主路径。循环限制模型轮次、工具调用数、总运行时长，取消贯穿模型和真实代码进程，重启不重放已执行副作用。

参考：[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)、[SDK models/providers](https://developers.openai.com/api/docs/guides/agents/models)、[SDK observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability)。
