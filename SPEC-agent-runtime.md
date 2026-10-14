# agent-runtime

目标：Agent 配置发布、隔离的模型执行上下文、Session、超时/取消终态、自动化/结果投递、评测。
实现：src/runtime.ts、src/automation.ts、src/evaluation.ts；持久化 queued/running/terminal，最大 30 分钟；单进程工作器，重启对中断任务记录 failed；cron-parser 明确时区，禁止任务重叠。
验收：真实 HTTP 模型执行，取消传播、超时、重启终态、唯一调度触发、Webhook 重试边界、评测汇总。取消只终止业务任务，不能认定上游未计费；中断用量遵循 entitlements 的 uncertain 对账规则。
命令：npm test；npm run build。测试包含本机真实上游和时钟边界。
边界：此 Runtime 为无任意 shell/文件访问的模型运行器，云沙箱供应商未配置，不能标成已具备任意代码隔离沙箱。
