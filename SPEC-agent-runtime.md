# agent-runtime

目标：Agent 配置发布、隔离的模型执行上下文、Session、超时/取消终态、自动化/结果投递、评测。
实现：src/runtime.ts、src/automation.ts、src/evaluation.ts；持久化 queued/running/terminal，最大 30 分钟；单进程工作器，重启对中断任务记录 failed；cron-parser 明确时区，禁止任务重叠。
运行与会话列表的 q 按可见元数据做不区分 ASCII 大小写的字面子串查询，不检索加密输入/输出。运行支持任务/智能体/会话/成员 ID、状态与错误码，会话支持会话/智能体/成员 ID；与租户、状态、会话条件相交，总数与分页使用同一过滤，排序包含唯一 ID。
CLI 的 SIGINT/SIGTERM 关闭由应用单次负责；关闭完成前保留信号监听器，避免 SDK 的信号处理提前退出。先等待工作器关闭并释放数据库租约，再退出；不缩短命名空间保护窗口或强制删除租约。
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

已采用固定版本 `@openai/agents-core@0.20.0` Runner 负责受控工具循环，自有 GatewayAgentModel 端口逐次经过 Gateway 授权和账本，不另建绕过计量的 SDK HTTP 客户端。SDK 自动 tracing 和 exporter 全局关闭，Runner 也关闭 tracing，模型自动重试为 0；不把企业输入、代码、工具结果发送到外部 tracing 服务。工具为 SandboxService 的 execute_javascript 和已批准连接器的 MCP 工具；模型不能选择 Docker 配置、凭据或宿主路径。循环限制模型轮次、工具调用数、总运行时长，取消贯穿模型和真实代码进程，重启不重放已执行副作用。

Agent 的隔离代码默认关闭，通过 `sandbox=true`、`maxTurns`（最多 20）、`maxToolCalls`（最多 20）、`toolTimeoutMs`（最多 60 秒）显式开启。每个 run 按需创建仅授权当前成员的独立沙箱，模型只能提交 code，不能选择 runtime。run_sandboxes 绑定与容器记录同事务写入；run_tools 以 run/callId 唯一、参数指纹防冲突，执行 ID 与持久化队列原子绑定，任何未确认结果均不重新执行。同 ID 的已成功结果可重放，不重新运行代码。

父运行的取消意图持久化；running 任务取消需等待模型/工具结束及自己沙箱的停止确认再写终态。每次 provision、enqueue、实际执行、模型调用和发布结果均重新检查成员、Agent、模型、资产与安全策略。重启将中断任务终结，停止并移除绑定的沙箱，不恢复执行有副作用的工具调用。清理失败明确记录 STOP_UNCONFIRMED，不报告取消/成功已确认。

沙箱生命周期继承父运行的剩余截止时间，不因较晚 provision 重置完整寿命。所有新调用也检查持久化的 started_at + timeout_ms，不能只等待事件循环定时器；容器 watchdog 通过 daemon 时间校准绝对截止点，并以剩余 duration 封顶，避免依赖宿主与 VM 时钟一致或因启动延迟延长期限。自然看门狗退出明确归类 TIMEOUT；created 状态的 exitCode=0 不是超时证据。

参考：[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)、[SDK models/providers](https://developers.openai.com/api/docs/guides/agents/models)、[SDK observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability)。

## 受控 MCP 工具

固定 `@modelcontextprotocol/client@2.3.1` 负责初始化握手、协议校验、工具清单和调用；自定义 Transport 只能经 ConnectorService 的 DNS 固定 safeRequest，不使用 SDK 默认 HTTP、stdio 或自动 OAuth。共享服务保留现有不透明 session 代理，真实 session 加密且不进入模型/客户端响应。响应的凭据/session 回显递归脱敏，顶层非协议字段剥离。

Agent 引用的 connector 必须已审核发布、supportedClients 含 agent、成员及资产范围允许。run_connectors 冻结发布版本；allowedTools 与远端清单交集绑定固定函数名、资产/版本/remote_name，模型不能提供 URL、credentialId 或 session。MCP-only Agent 不要求 allowSandbox，但模型 supportsTools、有效席位/订阅、agents 渠道与网络出口策略始终检查。模型调用中途撤权或订阅到期不能再派发工具。

每页响应最多 1 MiB、清单最多 4 页且合计 100 项，最多 63 个 MCP 工具；schema 沿用 100 KiB/20 层/10000 节点限制，并在 SDK 编译前拒绝正则、引用及 uniqueItems 构造。输入实际校验，工具结果最多 32 KiB。发现及单次调用有独立 toolTimeoutMs，总截止点不会重置；DNS 阶段也可取消。这里只实现 2025-03-26 POST JSON/SSE 工具子集，不宣称全协议兼容。

run_tools 的 kind/dispatched/asset_id/asset_version/remote_name 是持久化审计合同。真正 HTTP 分派前在写事务中登记 dispatched；同 run/callId 仅确认成功时回放结果，未知结果不重发。取消通知只能尽力发送，断开连接不是远端已停止的证据：分派后任何未确认结果均保留 uncertain，父运行 failed/REMOTE_EFFECT_UNCONFIRMED；强制重启保留 uncertain/PROCESS_RESTARTED。本地会话释放不等于远端 session 删除或业务副作用回滚，远端回收仍由服务提供方负责。

参考：[MCP SDK Client](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)、[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)、[MCP Cancellation](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/cancellation)。

## 通知业务确认

通用 Webhook 维持 HTTP 2xx 接受语义；`type=feishu` 另按[官方自定义机器人合同](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)要求 HTTP 2xx、64 KiB 内合法 JSON 且数字 `code=0`。非零业务码、缺失/非法 code、非 JSON 或超限均走原 DELIVERY_FAILED 重试和上限，不因 HTTP 200 误记 sent；冗余 StatusCode 不覆盖业务 code，远端 msg 不进入错误记录。该确认只表示接收端接受，不证明用户已读或真实账号验收。
