import { PassThrough } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import type { Entitlements } from "./entitlements.js";
import { authenticate, currentActor, requirePermission } from "./access.js";
import { ApiError, fail, hash, id, now, type Actor } from "./core.js";
import { getResource } from "./resources.js";
import { allowedResource, type ModelData } from "./models.js";
import { readJson, safeRequest } from "./network.js";
import { assertExecution } from "./policy.js";
import {
  functionToolSchema,
  toolCallSchema,
  toolDeltaSchema,
  toolChoiceSchema,
  ToolCallAccumulator,
  validateToolCalls,
  type ToolCall,
  type ToolDelta,
} from "./completion-tools.js";

export const completionSchema = z
  .object({
    model: z.string().min(1).max(80),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant", "tool"]),
            content: z
              .union([
                z.string().max(200000),
                z
                  .array(
                    z.discriminatedUnion("type", [
                      z
                        .object({
                          type: z.literal("text"),
                          text: z.string().max(200000),
                        })
                        .strict(),
                      z
                        .object({
                          type: z.literal("image_url"),
                          image_url: z
                            .object({
                              url: z
                                .string()
                                .max(1400000)
                                .regex(
                                  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
                                ),
                              detail: z
                                .enum(["auto", "low", "high"])
                                .default("auto"),
                            })
                            .strict(),
                        })
                        .strict(),
                    ]),
                  )
                  .min(1)
                  .max(8),
              ])
              .nullable(),
            tool_call_id: z.string().min(1).max(200).optional(),
            tool_calls: z.array(toolCallSchema).min(1).max(32).optional(),
          })
          .strict()
          .superRefine((message, ctx) => {
            if (message.role === "tool") {
              if (
                typeof message.content !== "string" ||
                !message.tool_call_id ||
                message.tool_calls
              )
                ctx.addIssue({
                  code: "custom",
                  message: "工具结果需要字符串内容及 tool_call_id",
                });
            } else if (message.role === "assistant") {
              if (
                message.tool_call_id ||
                (message.content === null && !message.tool_calls?.length)
              )
                ctx.addIssue({
                  code: "custom",
                  message: "助理消息需要内容或工具调用",
                });
            } else if (
              message.content === null ||
              message.tool_calls ||
              message.tool_call_id
            )
              ctx.addIssue({
                code: "custom",
                message: "普通消息不能携带工具调用字段",
              });
            if (
              message.tool_calls &&
              new Set(message.tool_calls.map((call) => call.id)).size !==
                message.tool_calls.length
            )
              ctx.addIssue({ code: "custom", message: "工具调用 ID 不能重复" });
          }),
      )
      .min(1)
      .max(200),
    max_tokens: z.number().int().min(1).max(131072).optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    stream: z.boolean().default(false),
    stream_options: z.object({ include_usage: z.boolean() }).optional(),
    reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
    tools: z.array(functionToolSchema).min(1).max(64).optional(),
    tool_choice: toolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const names = new Set(input.tools?.map((tool) => tool.function.name) ?? []);
    if (
      names.size !== (input.tools?.length ?? 0) ||
      (input.tool_choice &&
        input.tool_choice !== "none" &&
        !input.tools?.length) ||
      (typeof input.tool_choice === "object" &&
        !names.has(input.tool_choice.function.name))
    )
      ctx.addIssue({ code: "custom", message: "工具定义或选择不正确" });
  });
export type CompletionInput = z.infer<typeof completionSchema>;
const upstreamCompletion = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullable().optional(),
            role: z.string().optional(),
            tool_calls: z.array(toolCallSchema).max(32).optional(),
          })
          .superRefine((message, ctx) => {
            if (message.content === undefined && !message.tool_calls?.length)
              ctx.addIssue({
                code: "custom",
                message: "上游消息缺少内容和工具调用",
              });
          }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export interface CompletionResult {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: string; content: string; tool_calls?: ToolCall[] };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class Gateway {
  purgeCalls(tenantId: string, before: number) {
    return Number(
      this.db.run(
        "DELETE FROM gateway_calls WHERE tenant_id=? AND created_at<?",
        tenantId,
        before,
      ).changes,
    );
  }
  constructor(
    private db: Db,
    private vault: Vault,
    private entitlements: Entitlements,
    private allowPrivate: boolean,
  ) {}
  private authorize(actor: Actor, modelId: string, application: string) {
    requirePermission(actor, "execute");
    const session = actor.sessionHash
      ? this.db.get<{ kind: string; scopes: string }>(
          "SELECT kind,scopes FROM sessions WHERE hash=? AND tenant_id=? AND user_id=? AND expires_at>?",
          actor.sessionHash,
          actor.tenantId,
          actor.userId,
          now(),
        )
      : undefined;
    if (actor.sessionHash && !session)
      fail(401, "SESSION_EXPIRED", "模型请求凭据已失效");
    const fresh = {
      ...currentActor(this.db, actor.tenantId, actor.userId),
      sessionHash: actor.sessionHash,
      kind: session?.kind ?? actor.kind,
      scopes: session ? (JSON.parse(session.scopes) as string[]) : actor.scopes,
    };
    requirePermission(fresh, "execute");
    this.entitlements.subscription(fresh.tenantId);
    const model = getResource<ModelData>(
      this.db,
      fresh.tenantId,
      "model",
      modelId,
    );
    assertExecution(
      this.db,
      fresh,
      application === "uwork" ? "local" : "agents",
      model.data.baseUrl,
    );
    if (!allowedResource(this.db, fresh, "model", model))
      fail(403, "MODEL_DENIED", "模型不可用或未授权");
    return {
      actor: fresh,
      model,
      token: this.vault.read(fresh.tenantId, model.data.credentialId),
    };
  }
  async complete(
    requestActor: Actor,
    input: CompletionInput,
    key: string,
    application = "uwork",
    signal?: AbortSignal,
    onDelta?: (content: string) => void,
    onToolDelta?: (deltas: ToolDelta[]) => void,
  ): Promise<CompletionResult> {
    const { actor, model, token } = this.authorize(
      requestActor,
      input.model,
      application,
    );
    const assertCurrent = () => {
      const current = this.authorize(actor, input.model, application);
      if (
        current.model.revision !== model.revision ||
        current.actor.departmentId !== actor.departmentId
      )
        fail(409, "REQUEST_CONTEXT_CHANGED", "模型或成员范围在请求期间已变更");
      if (current.token !== token)
        fail(409, "CREDENTIAL_CHANGED", "模型凭据在请求期间已变更");
    };
    const maxTokens = Math.min(
      input.max_tokens ?? model.data.maxOutputTokens,
      model.data.maxOutputTokens,
    );
    if (
      (input.tools?.length ||
        input.messages.some(
          (message) => message.role === "tool" || message.tool_calls?.length,
        )) &&
      !model.data.supportsTools
    )
      fail(400, "TOOLS_UNSUPPORTED", "模型未启用工具调用能力");
    const inputBound = input.messages.reduce(
      (n, m) =>
        n +
        (typeof m.content === "string"
          ? Buffer.byteLength(m.content)
          : (m.content?.reduce((sum, part) => {
              if (part.type === "image_url" && !model.data.supportsVision)
                fail(400, "VISION_UNSUPPORTED", "模型未启用图片能力");
              return (
                sum +
                (part.type === "text"
                  ? Buffer.byteLength(part.text)
                  : Buffer.byteLength(part.image_url.url) + 16384)
              );
            }, 0) ?? 0)) +
        (m.tool_calls ? Buffer.byteLength(JSON.stringify(m.tool_calls)) : 0) +
        Buffer.byteLength(m.tool_call_id ?? "") +
        64,
      256 + (input.tools ? Buffer.byteLength(JSON.stringify(input.tools)) : 0),
    );
    if (input.reasoning_effort && !model.data.supportsReasoning)
      fail(400, "REASONING_UNSUPPORTED", "模型未启用思考能力");
    if (inputBound + maxTokens > model.data.contextWindow)
      fail(400, "CONTEXT_LIMIT", "请求超过模型上下文限制");
    const fingerprint = hash(
      JSON.stringify({ actor: actor.userId, input, application }),
    );
    const cached = this.db.get<{
      user_id: string;
      fingerprint: string;
      result: string | null;
    }>(
      "SELECT user_id,fingerprint,result FROM gateway_calls WHERE tenant_id=? AND request_key=?",
      actor.tenantId,
      key,
    );
    if (cached) {
      if (cached.user_id !== actor.userId || cached.fingerprint !== fingerprint)
        fail(409, "IDEMPOTENCY_CONFLICT", "幂等键已绑定其他请求");
      if (!cached.result)
        fail(409, "REQUEST_EXISTS", "请求已受理，不能重复执行");
      const result = JSON.parse(
        this.vault.open(cached.result, `${actor.tenantId}:${key}`),
      ) as CompletionResult;
      if (onDelta) onDelta(result.choices[0]!.message.content);
      if (onToolDelta && result.choices[0]!.message.tool_calls)
        onToolDelta(
          result.choices[0]!.message.tool_calls.map((call, index) => ({
            ...call,
            index,
          })),
        );
      return result;
    }
    const cost = (i: number, o: number) =>
      Math.ceil((i * model.data.inputRate) / 1000) +
      Math.ceil((o * model.data.outputRate) / 1000);
    const reservationId = this.entitlements.reserve(
      actor,
      key,
      model.id,
      application,
      cost(inputBound, maxTokens),
    );
    this.db.run(
      "INSERT INTO gateway_calls VALUES(?,?,?,?,NULL,?)",
      actor.tenantId,
      key,
      actor.userId,
      fingerprint,
      now(),
    );
    const started = now();
    let promptTokens = 0,
      outputTokens = 0;
    let upstreamStatus = 0;
    let dispatched = false;
    try {
      const response = await safeRequest(
        `${model.data.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          token,
          body: {
            model: model.data.upstreamModel,
            messages: input.messages,
            ...(input.tools ? { tools: input.tools } : {}),
            ...(input.tool_choice ? { tool_choice: input.tool_choice } : {}),
            ...(input.parallel_tool_calls === undefined
              ? {}
              : { parallel_tool_calls: input.parallel_tool_calls }),
            ...(input.reasoning_effort
              ? { reasoning_effort: input.reasoning_effort }
              : {}),
            max_tokens: maxTokens,
            temperature: input.temperature,
            stream: input.stream,
            ...(input.stream
              ? { stream_options: { include_usage: true } }
              : {}),
          },
          signal,
          onDispatch: () => {
            assertCurrent();
            dispatched = true;
          },
        },
        this.allowPrivate,
      );
      upstreamStatus = response.statusCode;
      let content = "",
        reason = "stop",
        usage: { prompt_tokens: number; completion_tokens: number } | undefined;
      let calls: ToolCall[] = [];
      if (!input.stream) {
        const data = upstreamCompletion.safeParse(await readJson(response));
        if (!data.success)
          fail(502, "UPSTREAM_FORMAT", "上游对话响应格式不正确");
        content = data.data.choices[0]!.message.content ?? "";
        reason = data.data.choices[0]!.finish_reason ?? "stop";
        usage = data.data.usage;
        calls = data.data.choices[0]!.message.tool_calls ?? [];
      } else {
        try {
          if (response.statusCode !== 200)
            fail(502, "UPSTREAM_REJECTED", `上游返回 ${response.statusCode}`);
          const decoder = new TextDecoder();
          const toolCalls = new ToolCallAccumulator();
          let buffer = "",
            size = 0,
            done = false;
          const frameSchema = z.object({
            choices: z
              .array(
                z.object({
                  delta: z.object({
                    content: z.string().nullable().optional(),
                    tool_calls: z.array(toolDeltaSchema).max(32).optional(),
                  }),
                  finish_reason: z.string().nullable().optional(),
                }),
              )
              .optional(),
            usage: z
              .object({
                prompt_tokens: z.number().int().nonnegative(),
                completion_tokens: z.number().int().nonnegative(),
              })
              .nullable()
              .optional(),
          });
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024)
              fail(502, "UPSTREAM_TOO_LARGE", "上游响应超出限制");
            buffer += decoder.decode(chunk, { stream: true });
            buffer = buffer.replaceAll("\r\n", "\n");
            let end: number;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = frame
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trimStart())
                .join("\n");
              if (!data) continue;
              if (data === "[DONE]") {
                done = true;
                continue;
              }
              let parsed: z.infer<typeof frameSchema>;
              try {
                parsed = frameSchema.parse(JSON.parse(data));
              } catch {
                fail(502, "UPSTREAM_FORMAT", "流式响应格式不正确");
              }
              const delta = parsed.choices?.[0]?.delta.content ?? "";
              const toolDeltas = parsed.choices?.[0]?.delta.tool_calls;
              if (toolDeltas?.length) {
                toolCalls.add(toolDeltas);
              }
              content += delta;
              if (delta) {
                assertCurrent();
                onDelta?.(delta);
              }
              if (parsed.choices?.[0]?.finish_reason)
                reason = parsed.choices[0].finish_reason;
              if (parsed.usage) usage = parsed.usage;
            }
          }
          if (!done) fail(502, "UPSTREAM_INCOMPLETE", "上游流未提供终态");
          calls = toolCalls.finish();
        } finally {
          await response.close();
        }
      }
      calls = validateToolCalls(
        calls,
        input.tools,
        input.tool_choice,
        reason,
        input.parallel_tool_calls,
      );
      promptTokens = usage?.prompt_tokens ?? inputBound;
      outputTokens =
        usage?.completion_tokens ??
        Math.min(
          Buffer.byteLength(content) +
            (calls.length ? Buffer.byteLength(JSON.stringify(calls)) : 0),
          maxTokens,
        );
      if (promptTokens > inputBound || outputTokens > maxTokens)
        fail(502, "METERING_INVALID", "上游计量超出请求限制");
      const result: CompletionResult = {
        id: `chatcmpl-${id()}`,
        object: "chat.completion",
        created: Math.floor(now() / 1000),
        model: model.id,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
              ...(calls.length ? { tool_calls: calls } : {}),
            },
            finish_reason: reason,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + outputTokens,
        },
      };
      this.entitlements.settle(
        reservationId,
        cost(promptTokens, outputTokens),
        promptTokens,
        outputTokens,
      );
      assertCurrent();
      this.db.run(
        "UPDATE gateway_calls SET result=? WHERE tenant_id=? AND request_key=?",
        this.vault.seal(JSON.stringify(result), `${actor.tenantId}:${key}`),
        actor.tenantId,
        key,
      );
      this.trace(
        actor,
        model.id,
        application,
        "succeeded",
        promptTokens,
        outputTokens,
        started,
        null,
      );
      if (input.stream && calls.length)
        onToolDelta?.(calls.map((call, index) => ({ ...call, index })));
      return result;
    } catch (error) {
      const knownNotExecuted =
        !dispatched || (upstreamStatus >= 400 && upstreamStatus < 500);
      if (knownNotExecuted) this.entitlements.release(reservationId);
      else this.entitlements.uncertain(reservationId);
      const code = signal?.aborted
        ? "CANCELLED"
        : error instanceof ApiError
          ? error.code
          : "UPSTREAM_FAILURE";
      this.trace(
        actor,
        model.id,
        application,
        "failed",
        promptTokens,
        outputTokens,
        started,
        code,
      );
      if (error instanceof ApiError) throw error;
      fail(
        signal?.aborted ? 499 : 502,
        code,
        signal?.aborted ? "调用已取消" : "上游调用失败或超时",
      );
    }
  }
  private trace(
    a: Actor,
    modelId: string,
    app: string,
    status: string,
    input: number,
    output: number,
    started: number,
    error: string | null,
  ) {
    this.db.run(
      "INSERT INTO traces VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id(),
      a.tenantId,
      a.userId,
      app,
      modelId,
      status,
      input,
      output,
      now() - started,
      error,
      started,
    );
  }
}
export function gatewayRoutes(app: FastifyInstance, db: Db, gateway: Gateway) {
  app.post("/v1/chat/completions", async (req, reply) => {
    const a = authenticate(db, req);
    const data = completionSchema.parse(req.body);
    const key = z
      .string()
      .min(1)
      .max(128)
      .parse(req.headers["idempotency-key"] ?? id());
    const controller = new AbortController();
    const disconnect = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on("close", disconnect);
    if (!data.stream) {
      try {
        return await gateway.complete(a, data, key, "uwork", controller.signal);
      } finally {
        reply.raw.off("close", disconnect);
      }
    }
    const stream = new PassThrough({ highWaterMark: 65536 });
    let streaming = false;
    const emit = (value: unknown) => {
      if (!streaming) {
        streaming = true;
        reply
          .header("content-type", "text/event-stream")
          .header("x-accel-buffering", "no")
          .send(stream);
      }
      if (stream.writableLength > 1024 * 1024) {
        controller.abort();
        return;
      }
      stream.write(`data: ${JSON.stringify(value)}\n\n`);
    };
    try {
      const result = await gateway.complete(
        a,
        data,
        key,
        "uwork",
        controller.signal,
        (content) =>
          emit({
            object: "chat.completion.chunk",
            model: data.model,
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          }),
        (tool_calls) =>
          emit({
            object: "chat.completion.chunk",
            model: data.model,
            choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }],
          }),
      );
      emit({
        id: result.id,
        object: "chat.completion.chunk",
        model: data.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: result.choices[0]!.finish_reason,
          },
        ],
        usage: result.usage,
      });
    } catch (error) {
      if (!streaming) throw error;
      emit({
        error: {
          code: error instanceof ApiError ? error.code : "UPSTREAM_FAILURE",
          message: error instanceof ApiError ? error.message : "调用失败",
        },
      });
    } finally {
      if (streaming) stream.end("data: [DONE]\n\n");
      reply.raw.off("close", disconnect);
    }
    return reply;
  });
}
