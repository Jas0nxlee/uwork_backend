import { PassThrough } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import type { Entitlements } from "./entitlements.js";
import { authenticate, requirePermission } from "./access.js";
import { ApiError, fail, hash, id, now, type Actor } from "./core.js";
import { getResource } from "./resources.js";
import { allowedResource, type ModelData } from "./models.js";
import { readJson, safeRequest } from "./network.js";
import { assertExecution } from "./policy.js";

export const completionSchema = z
  .object({
    model: z.string().min(1).max(80),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().max(200000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    max_tokens: z.number().int().min(1).max(131072).optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    stream: z.boolean().default(false),
    stream_options: z.object({ include_usage: z.boolean() }).optional(),
  })
  .strict();
export type CompletionInput = z.infer<typeof completionSchema>;
const upstreamCompletion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          role: z.string().optional(),
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
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class Gateway {
  constructor(
    private db: Db,
    private vault: Vault,
    private entitlements: Entitlements,
    private allowPrivate: boolean,
  ) {}
  async complete(
    actor: Actor,
    input: CompletionInput,
    key: string,
    application = "uwork",
    signal?: AbortSignal,
    onDelta?: (content: string) => void,
  ): Promise<CompletionResult> {
    requirePermission(actor, "execute");
    const model = getResource<ModelData>(
      this.db,
      actor.tenantId,
      "model",
      input.model,
    );
    assertExecution(
      this.db,
      actor,
      application === "uwork" ? "local" : "agents",
      model.data.baseUrl,
    );
    if (!allowedResource(this.db, actor, "model", model))
      fail(403, "MODEL_DENIED", "模型不可用或未授权");
    const token = this.vault.read(actor.tenantId, model.data.credentialId);
    const maxTokens = Math.min(
      input.max_tokens ?? model.data.maxOutputTokens,
      model.data.maxOutputTokens,
    );
    const inputBound = input.messages.reduce(
      (n, m) => n + Buffer.byteLength(m.content) + 64,
      256,
    );
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
    try {
      const response = await safeRequest(
        `${model.data.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          token,
          body: {
            model: model.data.upstreamModel,
            messages: input.messages,
            max_tokens: maxTokens,
            temperature: input.temperature,
            stream: input.stream,
            ...(input.stream
              ? { stream_options: { include_usage: true } }
              : {}),
          },
          signal,
        },
        this.allowPrivate,
      );
      let content = "",
        reason = "stop",
        usage: { prompt_tokens: number; completion_tokens: number } | undefined;
      if (!input.stream) {
        const data = upstreamCompletion.safeParse(await readJson(response));
        if (!data.success)
          fail(502, "UPSTREAM_FORMAT", "上游对话响应格式不正确");
        content = data.data.choices[0]!.message.content ?? "";
        reason = data.data.choices[0]!.finish_reason ?? "stop";
        usage = data.data.usage;
      } else {
        try {
          if (response.statusCode !== 200)
            fail(502, "UPSTREAM_REJECTED", `上游返回 ${response.statusCode}`);
          const decoder = new TextDecoder();
          let buffer = "",
            size = 0,
            done = false;
          const frameSchema = z.object({
            choices: z
              .array(
                z.object({
                  delta: z.object({
                    content: z.string().nullable().optional(),
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
              content += delta;
              if (delta) onDelta?.(delta);
              if (parsed.choices?.[0]?.finish_reason)
                reason = parsed.choices[0].finish_reason;
              if (parsed.usage) usage = parsed.usage;
            }
          }
          if (!done) fail(502, "UPSTREAM_INCOMPLETE", "上游流未提供终态");
        } finally {
          await response.close();
        }
      }
      promptTokens = usage?.prompt_tokens ?? inputBound;
      outputTokens =
        usage?.completion_tokens ??
        Math.min(Buffer.byteLength(content), maxTokens);
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
            message: { role: "assistant", content },
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
      return result;
    } catch (error) {
      this.entitlements.release(reservationId);
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
    reply
      .header("content-type", "text/event-stream")
      .header("x-accel-buffering", "no")
      .send(stream);
    const emit = (value: unknown) => {
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
      emit({
        error: {
          code: error instanceof ApiError ? error.code : "UPSTREAM_FAILURE",
          message: error instanceof ApiError ? error.message : "调用失败",
        },
      });
    } finally {
      stream.end("data: [DONE]\n\n");
      reply.raw.off("close", disconnect);
    }
    return reply;
  });
}
