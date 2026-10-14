import {
  Agent,
  Runner,
  tool,
  MaxTurnsExceededError,
  ToolCallError,
  type AgentInputItem,
} from "@openai/agents-core";
import { z } from "zod";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import type { Gateway } from "./gateway.js";
import type { SandboxService } from "./sandbox/service.js";
import { GatewayAgentModel } from "./agent-model.js";
import { AgentSandbox } from "./agent-sandbox.js";
import { agentRunContext } from "./agent-access.js";
import type { Run, RunTool, AgentData } from "./agent-contract.js";
import type { ToolCall } from "./completion-tools.js";
import { ApiError, fail, hash, now } from "./core.js";
import { audit } from "./events.js";

export class AgentToolRunner {
  private sandbox: AgentSandbox;
  constructor(
    private db: Db,
    private vault: Vault,
    private gateway: Gateway,
    sandbox: SandboxService,
  ) {
    this.sandbox = new AgentSandbox(db, sandbox);
  }
  private register(run: Run, agent: AgentData, calls: ToolCall[]) {
    this.db.transaction(() => {
      agentRunContext(this.db, run.id);
      for (const call of calls) {
        const fingerprint = hash(
          JSON.stringify({
            name: call.function.name,
            arguments: call.function.arguments,
          }),
        );
        const previous = this.db.get<RunTool>(
          "SELECT * FROM run_tools WHERE run_id=? AND call_id=?",
          run.id,
          call.id,
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            fail(
              409,
              "TOOL_IDEMPOTENCY_CONFLICT",
              "工具调用 ID 已绑定不同参数",
            );
          continue;
        }
        if (
          this.db.get<{ n: number }>(
            "SELECT count(*) n FROM run_tools WHERE run_id=?",
            run.id,
          )!.n >= agent.maxToolCalls
        )
          fail(429, "TOOL_CALL_LIMIT", "智能体工具调用次数已达上限");
        this.db.run(
          "INSERT INTO run_tools(run_id,call_id,name,fingerprint,input,status,created_at) VALUES(?,?,?,?,?,'proposed',?)",
          run.id,
          call.id,
          call.function.name,
          fingerprint,
          this.vault.seal(
            call.function.arguments,
            `${run.tenant_id}:${run.id}:${call.id}:tool-input`,
          ),
          now(),
        );
      }
    });
  }
  private async invoke(
    run: Run,
    callId: string,
    code: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const previous = this.db.transaction(() => {
      agentRunContext(this.db, run.id);
      const row = this.db.get<RunTool>(
        "SELECT * FROM run_tools WHERE run_id=? AND call_id=?",
        run.id,
        callId,
      );
      if (!row || row.name !== "execute_javascript")
        fail(409, "TOOL_CALL_MISSING", "缺少已登记的工具调用");
      if (row.status === "succeeded") return row;
      if (
        !this.db.run(
          "UPDATE run_tools SET status='running' WHERE run_id=? AND call_id=? AND status='proposed'",
          run.id,
          callId,
        ).changes
      )
        fail(409, "TOOL_CALL_EXISTS", "工具调用已受理，不能重新执行");
      return undefined;
    });
    if (previous) {
      if (!previous.result)
        fail(409, "TOOL_RESULT_UNAVAILABLE", "工具结果不可用，不能重新执行");
      return this.vault.open(
        previous.result,
        `${run.tenant_id}:${run.id}:${callId}:tool-result`,
      );
    }
    try {
      const result = await this.sandbox.execute(
        run.id,
        callId,
        code,
        timeoutMs,
        signal,
      );
      signal.throwIfAborted();
      agentRunContext(this.db, run.id);
      this.db.run(
        "UPDATE run_tools SET status='succeeded',result=?,finished_at=? WHERE run_id=? AND call_id=? AND status='running'",
        this.vault.seal(
          result,
          `${run.tenant_id}:${run.id}:${callId}:tool-result`,
        ),
        now(),
        run.id,
        callId,
      );
      return result;
    } catch (error) {
      this.db.run(
        "UPDATE run_tools SET status=?,error_code=?,finished_at=? WHERE run_id=? AND call_id=? AND status='running'",
        error instanceof ApiError && error.code === "STOP_UNCONFIRMED"
          ? "uncertain"
          : error instanceof ApiError && error.code === "TIMEOUT"
            ? "timed_out"
            : signal.aborted
              ? "cancelled"
              : "failed",
        error instanceof ApiError
          ? error.code
          : signal.aborted
            ? "CANCELLED"
            : "TOOL_FAILURE",
        now(),
        run.id,
        callId,
      );
      throw error;
    }
  }
  async execute(
    run: Run,
    agent: AgentData,
    system: string,
    history: { role: "user" | "assistant"; content: string }[],
    signal: AbortSignal,
  ) {
    const controller = new AbortController(),
      parentSignal = AbortSignal.any([signal, controller.signal]);
    const active = new Set<Promise<string>>();
    const model = new GatewayAgentModel(
      agent.modelId,
      run.id,
      agent.maxTurns,
      (input, key, modelSignal) => {
        const { actor } = agentRunContext(this.db, run.id);
        return this.gateway.complete(
          actor,
          input,
          key,
          "agent-runtime",
          modelSignal,
        );
      },
      (calls) => this.register(run, agent, calls),
    );
    const codeTool = tool({
      name: "execute_javascript",
      description:
        "Execute JavaScript in the current isolated offline Node.js workspace. No host files, network or credentials are available.",
      parameters: z.object({ code: z.string().min(1).max(100000) }).strict(),
      errorFunction: null,
      execute: ({ code }, _context, details) => {
        const callId = details?.toolCall?.callId;
        if (!callId) fail(500, "TOOL_CALL_MISSING", "SDK 缺少工具调用 ID");
        const work = this.invoke(
          run,
          callId,
          code,
          agent.toolTimeoutMs,
          details.signal
            ? AbortSignal.any([parentSignal, details.signal])
            : parentSignal,
        ).finally(() => active.delete(work));
        active.add(work);
        return work;
      },
    });
    const instance = new Agent({
      name: "Enterprise Agent",
      instructions: system,
      model,
      tools: [codeTool],
      modelSettings: {
        maxTokens: agent.maxOutputTokens,
        temperature: 0.7,
        parallelToolCalls: false,
        retry: { maxRetries: 0 },
      },
    });
    const runner = new Runner({
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
      toolNameCollisionPolicy: "error",
      toolNotFoundBehavior: "raise_error",
    });
    const input: AgentInputItem[] = history.map((message) =>
      message.role === "user"
        ? { role: "user", content: message.content }
        : {
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: message.content }],
          },
    );
    try {
      const result = await runner.run(instance, input, {
        maxTurns: agent.maxTurns,
        signal: parentSignal,
      });
      signal.throwIfAborted();
      agentRunContext(this.db, run.id);
      if (typeof result.finalOutput !== "string")
        fail(502, "AGENT_OUTPUT_MISSING", "智能体没有返回最终文本");
      return result.finalOutput;
    } catch (error) {
      if (error instanceof MaxTurnsExceededError)
        throw new ApiError(429, "MODEL_TURN_LIMIT", "智能体模型轮次已达上限");
      if (error instanceof ToolCallError && error.error instanceof ApiError)
        throw error.error;
      throw error;
    } finally {
      controller.abort("finished");
      await Promise.allSettled(active);
      try {
        this.db.run(
          "UPDATE run_tools SET status='failed',error_code='TOOL_NOT_EXECUTED',finished_at=? WHERE run_id=? AND status='proposed'",
          now(),
          run.id,
        );
      } finally {
        try {
          await this.sandbox.release(run.id);
        } catch (error) {
          this.db.run(
            "UPDATE run_tools SET status='uncertain',error_code='STOP_UNCONFIRMED',finished_at=? WHERE run_id=? AND execution_id IS NOT NULL AND status IN ('running','cancelled','failed','timed_out')",
            now(),
            run.id,
          );
          throw error;
        }
      }
      audit(
        this.db,
        { tenantId: run.tenant_id, userId: run.user_id },
        "agent.tools.finish",
        run.id,
      );
    }
  }
  tools(run: Run) {
    return this.db
      .all<RunTool>(
        "SELECT * FROM run_tools WHERE run_id=? ORDER BY created_at,call_id",
        run.id,
      )
      .map((row) => ({
        ...row,
        fingerprint: undefined,
        input: this.vault.open(
          row.input,
          `${run.tenant_id}:${run.id}:${row.call_id}:tool-input`,
        ),
        result: row.result
          ? this.vault.open(
              row.result,
              `${run.tenant_id}:${run.id}:${row.call_id}:tool-result`,
            )
          : null,
      }));
  }
}
