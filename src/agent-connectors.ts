import {
  Client,
  parseJSONRPCMessage,
  type Transport,
  type JSONRPCMessage,
  type Tool,
  type JsonSchemaValidator,
  type JsonSchemaType,
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { FunctionTool } from "@openai/agents-core";
import type { Db } from "./db.js";
import type { Actor } from "./core.js";
import { ApiError, fail, hash } from "./core.js";
import { agentRunContext } from "./agent-access.js";
import {
  ConnectorService,
  type ConnectorBinding,
} from "./connector-service.js";
import { functionToolSchema } from "./completion-tools.js";
import { z } from "zod";

function assertToolSchemas(result: unknown) {
  const list = z
    .object({
      tools: z
        .array(
          z.object({
            inputSchema: z.record(z.string(), z.unknown()),
            outputSchema: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .max(100),
    })
    .safeParse(result);
  if (!list.success)
    fail(502, "MCP_TOOL_SCHEMA", "连接器工具清单不符合受控合同");
  for (const tool of list.data.tools)
    for (const schema of [tool.inputSchema, tool.outputSchema]) {
      if (!schema) continue;
      if (
        !functionToolSchema.safeParse({
          type: "function",
          function: { name: "validate", parameters: schema },
        }).success
      )
        fail(502, "MCP_TOOL_SCHEMA", "连接器工具 schema 超出限制");
      const pending = [schema];
      while (pending.length) {
        const item = pending.pop()!;
        if (
          [
            "pattern",
            "patternProperties",
            "$ref",
            "$dynamicRef",
            "$recursiveRef",
          ].some((key) => Object.hasOwn(item, key)) ||
          item.uniqueItems === true
        )
          fail(
            502,
            "MCP_TOOL_SCHEMA",
            "受控工具 schema 不支持正则、引用或 uniqueItems",
          );
        for (const key of [
          "properties",
          "$defs",
          "definitions",
          "dependentSchemas",
          "dependencies",
        ]) {
          const value = item[key];
          if (value && typeof value === "object" && !Array.isArray(value))
            for (const child of Object.values(value))
              if (child && typeof child === "object" && !Array.isArray(child))
                pending.push(child as Record<string, unknown>);
        }
        for (const key of [
          "allOf",
          "anyOf",
          "oneOf",
          "prefixItems",
          "items",
          "contains",
          "propertyNames",
          "additionalProperties",
          "unevaluatedProperties",
          "unevaluatedItems",
          "additionalItems",
          "contentSchema",
          "not",
          "if",
          "then",
          "else",
        ]) {
          const value = item[key];
          for (const child of Array.isArray(value) ? value : [value])
            if (child && typeof child === "object" && !Array.isArray(child))
              pending.push(child as Record<string, unknown>);
        }
      }
    }
}

class ControlledMcpTransport implements Transport {
  onclose?: Transport["onclose"];
  onerror?: Transport["onerror"];
  onmessage?: Transport["onmessage"];
  sessionId?: string;
  private lifetime = new AbortController();
  private pending = new Set<Promise<void>>();
  operation?: { signal: AbortSignal; beforeDispatch: () => void };
  constructor(
    private connectors: ConnectorService,
    private actor: Actor,
    private binding: ConnectorBinding,
    private parent: AbortSignal,
    private guard: () => void,
    private timeout: number,
    private runId: string,
  ) {}
  async start() {
    this.parent.throwIfAborted();
    this.guard();
  }
  async send(message: JSONRPCMessage) {
    if (!("method" in message))
      fail(400, "MCP_METHOD_DENIED", "不支持服务端反向请求");
    const cancellation = message.method === "notifications/cancelled";
    const operation = this.operation;
    if (message.method === "tools/call" && !operation)
      fail(409, "TOOL_CALL_MISSING", "缺少已登记的受控远端调用");
    const signal = AbortSignal.any([
      this.lifetime.signal,
      cancellation
        ? AbortSignal.timeout(1000)
        : (operation?.signal ?? this.parent),
    ]);
    const work = (async () => {
      const response = await this.connectors.rpc(
        this.actor,
        this.binding.id,
        message,
        {
          client: "agent",
          version: this.binding.version,
          sessionId: this.sessionId,
          signal,
          timeout: cancellation ? 1000 : this.timeout,
          runId: this.runId,
          beforeDispatch: () => {
            if (!cancellation) this.guard();
            if (message.method === "tools/call") operation!.beforeDispatch();
          },
        },
      );
      if (response.sessionId) this.sessionId = response.sessionId;
      if (
        message.method === "tools/list" &&
        response.result &&
        Object.hasOwn(response.result, "result")
      )
        assertToolSchemas(response.result.result);
      if (response.result)
        this.onmessage?.(parseJSONRPCMessage(response.result));
    })();
    this.pending.add(work);
    try {
      await work;
    } finally {
      this.pending.delete(work);
    }
  }
  async close() {
    this.lifetime.abort("closed");
    await Promise.allSettled(this.pending);
    if (this.sessionId) this.connectors.release(this.actor, this.sessionId);
    this.onclose?.();
  }
}

export interface AgentConnectorTool {
  name: string;
  description: string;
  parameters: Extract<
    FunctionTool["parameters"],
    { additionalProperties: true }
  >;
  assetId: string;
  assetVersion: number;
  remoteName: string;
  validate: JsonSchemaValidator<Record<string, unknown>>;
  invoke: (
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
    beforeDispatch: () => void,
  ) => Promise<string>;
}
export class AgentConnectors {
  private clients: Client[] = [];
  constructor(
    private db: Db,
    private connectors: ConnectorService,
    private runId: string,
  ) {}
  async discover(signal: AbortSignal, timeout: number) {
    const context = agentRunContext(this.db, this.runId);
    this.db.transaction(() => {
      for (const binding of context.connectors)
        this.db.run(
          "INSERT INTO run_connectors(run_id,asset_id,asset_version) VALUES(?,?,?)",
          this.runId,
          binding.id,
          binding.version,
        );
    });
    const tools: AgentConnectorTool[] = [];
    for (const binding of context.connectors) {
      const guard = () => {
        agentRunContext(this.db, this.runId);
      };
      const transport = new ControlledMcpTransport(
        this.connectors,
        context.actor,
        binding,
        signal,
        guard,
        timeout,
        this.runId,
      );
      const validator = new AjvJsonSchemaValidator();
      const client = new Client(
        { name: "uwork-agent", version: "0.1.0" },
        {
          supportedProtocolVersions: ["2025-03-26"],
          enforceStrictCapabilities: true,
          listMaxPages: 4,
          jsonSchemaValidator: validator,
        },
      );
      this.clients.push(client);
      await client.connect(transport, { signal, timeout });
      const approved = this.connectors.authorize(
        context.actor,
        binding.id,
        "agent",
        binding.version,
      ).content.allowedTools;
      const listed = await client.listTools(undefined, {
        signal,
        timeout,
        cacheMode: "bypass",
      });
      if (
        listed.tools.length > 100 ||
        new Set(listed.tools.map((item) => item.name)).size !==
          listed.tools.length
      )
        fail(502, "MCP_TOOL_LIMIT", "连接器工具清单超出限制或名称重复");
      for (const remote of listed.tools) {
        if (!approved.includes(remote.name)) continue;
        const name = `mcp_${hash(`${binding.id}:${binding.version}:${remote.name}`).slice(0, 40)}`;
        const definition = functionToolSchema.safeParse({
          type: "function",
          function: {
            name,
            description: remote.description ?? remote.name,
            parameters: remote.inputSchema,
          },
        });
        if (!definition.success || remote.inputSchema.type !== "object")
          fail(502, "MCP_TOOL_SCHEMA", "连接器工具定义不符合受控合同");
        let validate: JsonSchemaValidator<Record<string, unknown>>;
        try {
          validate = validator.getValidator(
            remote.inputSchema as JsonSchemaType,
          );
        } catch {
          fail(502, "MCP_TOOL_SCHEMA", "连接器工具参数 schema 不可用");
        }
        const frozen: Tool = structuredClone(remote);
        tools.push({
          name,
          description: definition.data.function.description!,
          // SDK non-strict types require additionalProperties=true even though its JSON parser preserves the schema.
          parameters: remote.inputSchema as AgentConnectorTool["parameters"],
          assetId: binding.id,
          assetVersion: binding.version,
          remoteName: remote.name,
          validate,
          invoke: async (arguments_, callSignal, beforeDispatch) => {
            guard();
            callSignal.throwIfAborted();
            transport.operation = { signal: callSignal, beforeDispatch };
            try {
              const result = await client.callTool(
                { name: frozen.name, arguments: arguments_ },
                { signal: callSignal, timeout, toolDefinition: frozen },
              );
              const output = JSON.stringify(result);
              if (Buffer.byteLength(output) > 32768)
                fail(502, "MCP_RESULT_LIMIT", "连接器工具结果超过 32 KiB");
              return output;
            } catch (error) {
              if (error instanceof ApiError) throw error;
              if (callSignal.aborted)
                throw new ApiError(499, "CANCELLED", "连接器调用已中断");
              throw new ApiError(
                502,
                "MCP_TOOL_FAILURE",
                "连接器工具调用未完成",
              );
            } finally {
              transport.operation = undefined;
            }
          },
        });
        if (tools.length > 63)
          fail(502, "MCP_TOOL_LIMIT", "单次 Agent 可用连接器工具过多");
      }
    }
    return tools;
  }
  async close() {
    const closed = await Promise.allSettled(
      this.clients.map((client) => client.close()),
    );
    if (closed.some((result) => result.status === "rejected"))
      fail(503, "MCP_CLEANUP_FAILED", "连接器本地会话清理未完成");
  }
}
