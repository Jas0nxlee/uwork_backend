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
import {
  AgentConnectors,
  type AgentConnectorTool,
} from "./agent-connectors.js";
import type { ConnectorService } from "./connector-service.js";

export class AgentToolRunner {
  private sandbox: AgentSandbox;
  constructor(
    private db: Db,
    private vault: Vault,
    private gateway: Gateway,
    sandbox: SandboxService,
    private connectors: ConnectorService,
  ) {
    this.sandbox = new AgentSandbox(db, sandbox);
  }
  private register(
    run: Run,
    agent: AgentData,
    calls: ToolCall[],
    connectors: Map<string, AgentConnectorTool>,
  ) {
    this.db.transaction(() => {
      agentRunContext(this.db, run.id);
      for (const call of calls) {
        const connector = connectors.get(call.function.name);
        if (
          !connector &&
          (!agent.sandbox || call.function.name !== "execute_javascript")
        )
          fail(403, "TOOL_DENIED", "工具不在当前运行的授权清单");
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
          "INSERT INTO run_tools(run_id,call_id,name,fingerprint,input,status,created_at,kind,asset_id,asset_version,remote_name) VALUES(?,?,?,?,?,'proposed',?,?,?,?,?)",
          run.id,
          call.id,
          call.function.name,
          fingerprint,
          this.vault.seal(
            call.function.arguments,
            `${run.tenant_id}:${run.id}:${call.id}:tool-input`,
          ),
          now(),
          connector ? "mcp" : "sandbox",
          connector?.assetId ?? null,
          connector?.assetVersion ?? null,
          connector?.remoteName ?? null,
        );
      }
    });
  }
  private async invoke(
    run: Run,
    callId: string,
    name: string,
    signal: AbortSignal,
    execute: (beforeDispatch: () => void) => Promise<string>,
  ) {
    signal.throwIfAborted();
    const previous = this.db.transaction(() => {
      agentRunContext(this.db, run.id);
      const row = this.db.get<RunTool>(
        "SELECT * FROM run_tools WHERE run_id=? AND call_id=?",
        run.id,
        callId,
      );
      if (!row || row.name !== name)
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
      const result = await execute(() =>
        this.db.transaction(() => {
          signal.throwIfAborted();
          agentRunContext(this.db, run.id);
          if (
            !this.db.run(
              "UPDATE run_tools SET dispatched=1 WHERE run_id=? AND call_id=? AND kind='mcp' AND status='running' AND dispatched=0",
              run.id,
              callId,
            ).changes
          )
            fail(409, "TOOL_CALL_EXISTS", "远端调用已分派，不能重新发送");
        }),
      );
      if (name === "execute_javascript") {
        signal.throwIfAborted();
        agentRunContext(this.db, run.id);
      }
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
      signal.throwIfAborted();
      agentRunContext(this.db, run.id);
      return result;
    } catch (error) {
      if (
        signal.aborted &&
        signal.reason instanceof DOMException &&
        signal.reason.name === "TimeoutError"
      )
        error = new ApiError(408, "TIMEOUT", "工具时间预算已耗尽");
      const row = this.db.get<RunTool>(
        "SELECT * FROM run_tools WHERE run_id=? AND call_id=?",
        run.id,
        callId,
      );
      const uncertain =
        row?.kind === "mcp" &&
        row.dispatched === 1 &&
        row.status !== "succeeded";
      if (uncertain)
        error = new ApiError(
          502,
          "REMOTE_EFFECT_UNCONFIRMED",
          "远端工具已分派但结果未确认，不能重新执行",
        );
      this.db.run(
        "UPDATE run_tools SET status=?,error_code=?,finished_at=? WHERE run_id=? AND call_id=? AND status='running'",
        uncertain ||
          (error instanceof ApiError && error.code === "STOP_UNCONFIRMED")
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
    const connectors = new AgentConnectors(this.db, this.connectors, run.id);
    const discoverySignal = AbortSignal.any([
      parentSignal,
      AbortSignal.timeout(agent.toolTimeoutMs),
    ]);
    let discovered = false;
    try {
      const available = await connectors.discover(
        discoverySignal,
        agent.toolTimeoutMs,
      );
      discovered = true;
      const registry = new Map(available.map((item) => [item.name, item]));
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
        (calls) => this.register(run, agent, calls, registry),
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
          const callSignal = details.signal
            ? AbortSignal.any([parentSignal, details.signal])
            : parentSignal;
          const work = this.invoke(
            run,
            callId,
            "execute_javascript",
            callSignal,
            () =>
              this.sandbox.execute(
                run.id,
                callId,
                code,
                agent.toolTimeoutMs,
                callSignal,
              ),
          ).finally(() => active.delete(work));
          active.add(work);
          return work;
        },
      });
      const connectorTools = available.map((connector) =>
        tool({
          name: connector.name,
          description: connector.description,
          parameters: connector.parameters,
          strict: false,
          errorFunction: null,
          execute: (arguments_, _context, details) => {
            const callId = details?.toolCall?.callId;
            if (!callId) fail(500, "TOOL_CALL_MISSING", "SDK 缺少工具调用 ID");
            const callSignal = AbortSignal.any([
              parentSignal,
              AbortSignal.timeout(agent.toolTimeoutMs),
              ...(details.signal ? [details.signal] : []),
            ]);
            const work = this.invoke(
              run,
              callId,
              connector.name,
              callSignal,
              async (beforeDispatch) => {
                const validated = connector.validate(arguments_);
                if (!validated.valid)
                  fail(
                    400,
                    "MCP_ARGUMENTS_INVALID",
                    "连接器工具参数不符合已声明 schema",
                  );
                return connector.invoke(
                  validated.data,
                  callSignal,
                  beforeDispatch,
                );
              },
            ).finally(() => active.delete(work));
            active.add(work);
            return work;
          },
        }),
      );
      const instance = new Agent({
        name: "Enterprise Agent",
        instructions: system,
        model,
        tools: [...(agent.sandbox ? [codeTool] : []), ...connectorTools],
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
      if (
        !discovered &&
        !parentSignal.aborted &&
        discoverySignal.aborted &&
        discoverySignal.reason instanceof DOMException &&
        discoverySignal.reason.name === "TimeoutError"
      )
        throw new ApiError(408, "TIMEOUT", "连接器发现时间预算已耗尽");
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
          try {
            await this.sandbox.release(run.id);
          } finally {
            await connectors.close();
          }
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
