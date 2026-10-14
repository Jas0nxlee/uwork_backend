import { setTimeout as sleep } from "node:timers/promises";
import type { Db } from "./db.js";
import type { SandboxService } from "./sandbox/service.js";
import { agentRunContext } from "./agent-access.js";
import { ApiError, fail } from "./core.js";

export class AgentSandbox {
  constructor(
    private db: Db,
    private sandbox: SandboxService,
  ) {}
  async execute(
    runId: string,
    callId: string,
    code: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const { actor, run } = agentRunContext(this.db, runId);
    const runtime = await this.sandbox.provisionForRun(
      runId,
      Math.max(1, Math.min(30, Math.ceil(run.timeout_ms / 60000))),
    );
    signal.throwIfAborted();
    const executionId = await this.sandbox.enqueue(
      actor,
      runtime.id,
      code,
      timeoutMs,
      { runId, callId },
    );
    for (;;) {
      if (signal.aborted) {
        const cancelled = await this.sandbox.cancel(actor, executionId);
        if (cancelled.error_code === "STOP_UNCONFIRMED")
          throw new ApiError(503, "STOP_UNCONFIRMED", "工具进程停止尚未确认");
        signal.throwIfAborted();
      }
      this.sandbox.pump();
      const status = this.db.get<{ status: string }>(
        "SELECT status FROM sandbox_executions WHERE id=?",
        executionId,
      )?.status;
      if (!status) fail(500, "TOOL_EXECUTION_MISSING", "工具执行记录丢失");
      if (status !== "queued" && status !== "running") {
        const result = this.sandbox.getExecution(actor, executionId);
        if (result.error_code)
          throw new ApiError(
            result.error_code === "STOP_UNCONFIRMED" ? 503 : 409,
            result.error_code,
            "隔离工具执行未成功完成",
          );
        agentRunContext(this.db, runId);
        const stdout = Buffer.from(result.stdout ?? ""),
          stderr = Buffer.from(result.stderr ?? "");
        const limit = 32768;
        return JSON.stringify({
          executionId,
          exitCode: result.exit_code,
          stdout: stdout.subarray(0, limit).toString("utf8"),
          stderr: stderr
            .subarray(0, Math.max(0, limit - stdout.length))
            .toString("utf8"),
          truncated: stdout.length + stderr.length > limit,
        });
      }
      await sleep(20, undefined, { signal }).catch((error) => {
        if (!signal.aborted) throw error;
      });
    }
  }
  async release(runId: string) {
    try {
      await this.sandbox.releaseRun(runId);
    } catch {
      throw new ApiError(503, "STOP_UNCONFIRMED", "智能体沙箱清理尚未确认");
    }
  }
}
