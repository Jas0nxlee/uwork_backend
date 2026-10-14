import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  Agent,
  Runner,
  tool,
  getGlobalTraceProvider,
  setTraceProcessors,
  type ModelRequest,
} from "@openai/agents-core";
import { z } from "zod";
import { fixture } from "./fixtures.js";
import { currentActor } from "../src/access.js";
import { GatewayAgentModel } from "../src/agent-model.js";

test("the SDK agent loop uses the billed Gateway for every model turn without external tracing", async (t) => {
  let upstreamCalls = 0,
    toolCalls = 0,
    traces = 0;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    upstreamCalls++;
    const last = body.messages.at(-1);
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tools[0].function.name, "calculate");
    assert.equal(body.messages[0].content, "Calculate precisely");
    if (last.role === "tool") {
      assert.equal(last.tool_call_id, "call_math");
      assert.equal(last.content, "42");
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message:
              last.role === "tool"
                ? { content: "42" }
                : {
                    content: null,
                    tool_calls: [
                      {
                        id: "call_math",
                        type: "function",
                        function: {
                          name: "calculate",
                          arguments: '{"left":6,"right":7}',
                        },
                      },
                    ],
                  },
            finish_reason: last.role === "tool" ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    setTraceProcessors([]);
  });
  const f = await fixture(
    t,
    `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  );
  const model = (
    await f.app.inject({ url: `${f.p}/models`, headers: f.headers })
  ).json()[0];
  const update = await f.app.inject({
    method: "PUT",
    url: `${f.p}/models/${f.model}`,
    headers: f.headers,
    payload: {
      name: model.name,
      ...model.data,
      scope: model.scope,
      enabled: true,
      revision: model.revision,
      supportsTools: true,
    },
  });
  assert.equal(update.statusCode, 200, update.body);
  setTraceProcessors([
    {
      onTraceStart: async () => {
        traces++;
      },
      onTraceEnd: async () => {
        traces++;
      },
      onSpanStart: async () => {
        traces++;
      },
      onSpanEnd: async () => {
        traces++;
      },
      forceFlush: async () => {},
      shutdown: async () => {},
    },
  ]);
  const adapter = new GatewayAgentModel(
    f.model,
    "controlled-sdk",
    3,
    (input, key, signal) =>
      f.app.services.gateway.complete(
        currentActor(f.app.services.db, f.tenantId, f.userId),
        input,
        key,
        "agent-runtime",
        signal,
      ),
  );
  const agent = new Agent({
    name: "Math",
    instructions: "Calculate precisely",
    model: adapter,
    modelSettings: {
      maxTokens: 128,
      parallelToolCalls: false,
      retry: { maxRetries: 0 },
    },
    tools: [
      tool({
        name: "calculate",
        description: "Multiply two integers",
        parameters: z.object({
          left: z.number().int(),
          right: z.number().int(),
        }),
        errorFunction: null,
        execute: ({ left, right }) => {
          toolCalls++;
          return String(left * right);
        },
      }),
    ],
  });
  const result = await new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  }).run(agent, "Calculate six times seven", { maxTurns: 3 });
  assert.equal(result.finalOutput, "42");
  assert.equal(upstreamCalls, 2);
  assert.equal(toolCalls, 1);
  assert.deepEqual(
    f.app.services.db
      .all<{
        request_key: string;
        status: string;
      }>("SELECT request_key,status FROM ledger ORDER BY request_key")
      .map((row) => ({ ...row })),
    [
      { request_key: "run:controlled-sdk:model:1", status: "settled" },
      { request_key: "run:controlled-sdk:model:2", status: "settled" },
    ],
  );
  await getGlobalTraceProvider().forceFlush();
  assert.equal(traces, 0);
});

test("the model port bounds calls and rejects unsupported or cancelled input before contacting a provider", async () => {
  let calls = 0;
  const adapter = new GatewayAgentModel(
    "controlled-model",
    "budget",
    1,
    async () => {
      calls++;
      return {
        id: "controlled",
        object: "chat.completion",
        created: 0,
        model: "controlled-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "done" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  );
  const request: ModelRequest = {
    input: "hello",
    modelSettings: { maxTokens: 10 },
    tools: [],
    handoffs: [],
    tracing: false,
    outputType: "text",
  };
  await assert.rejects(
    () => adapter.getResponse({ ...request, tracing: true }),
    /超出自有网关合同/,
  );
  await assert.rejects(
    () =>
      adapter.getResponse({
        ...request,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image: "data:image/png;base64,eA==" },
            ],
          },
        ],
      }),
    /仅接受文本上下文/,
  );
  await assert.rejects(() =>
    adapter.getResponse({ ...request, signal: AbortSignal.abort() }),
  );
  assert.equal(calls, 0);
  assert.equal((await adapter.getResponse(request)).usage.totalTokens, 2);
  await assert.rejects(() => adapter.getResponse(request), /轮次已达上限/);
  assert.equal(calls, 1);
});
