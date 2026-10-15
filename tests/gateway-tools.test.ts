import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { fixture } from "./fixtures.js";

const tools = [
  {
    type: "function",
    function: {
      name: "execute_javascript",
      description: "Execute isolated code",
      strict: true,
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
];
const call = {
  id: "call_controlled",
  type: "function",
  function: {
    name: "execute_javascript",
    arguments: JSON.stringify({ code: "console.log(42)" }),
  },
};
async function upstream(
  t: TestContext,
  respond: (body: Record<string, unknown>, res: ServerResponse) => void,
) {
  let calls = 0;
  const server = createServer(async (req: IncomingMessage, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    calls++;
    respond(JSON.parse(text), res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(
    t,
    `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  );
  return { ...f, calls: () => calls };
}
async function enable(
  f: Awaited<ReturnType<typeof upstream>>,
  contextWindow?: number,
) {
  const model = (
    await f.app.inject({ url: `${f.p}/models`, headers: f.headers })
  ).json()[0];
  const response = await f.app.inject({
    method: "PUT",
    url: `${f.p}/models/${f.model}`,
    headers: f.headers,
    payload: {
      name: model.name,
      ...model.data,
      scope: model.scope,
      enabled: model.enabled,
      revision: model.revision,
      supportsTools: true,
      ...(contextWindow ? { contextWindow } : {}),
    },
  });
  assert.equal(response.statusCode, 200, response.body);
}

test("indexed upstream function calls and tool results round-trip through the billed, opt-in JSON gateway", async (t) => {
  const f = await upstream(t, (body, res) => {
    assert.deepEqual(body.tools, tools);
    const messages = body.messages as {
      role: string;
      content: unknown;
      tool_calls?: unknown;
      tool_call_id?: string;
    }[];
    const last = messages.at(-1)!;
    const output =
      last.role === "tool"
        ? { content: "42" }
        : { content: null, tool_calls: [{ ...call, index: 0 }] };
    if (last.role === "tool") {
      assert.equal(last.tool_call_id, call.id);
      assert.deepEqual(messages.at(-2)!.tool_calls, [call]);
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: output,
            finish_reason: last.role === "tool" ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 12 },
      }),
    );
  });
  const payload = {
    model: f.model,
    messages: [{ role: "user", content: "Calculate" }],
    tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
  };
  const disabled = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload,
  });
  assert.equal(disabled.statusCode, 400);
  assert.equal(f.calls(), 0);
  await enable(f);
  const headers = { ...f.headers, "idempotency-key": "controlled-tool-json" };
  const first = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers,
    payload,
  });
  assert.equal(first.statusCode, 200, first.body);
  const message = first.json().choices[0].message;
  assert.deepEqual(message.tool_calls, [call]);
  const replay = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers,
    payload,
  });
  assert.deepEqual(replay.json(), first.json());
  assert.equal(f.calls(), 1);
  const final = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      ...payload,
      messages: [
        ...payload.messages,
        { ...message, content: null },
        { role: "tool", content: "42", tool_call_id: call.id },
      ],
    },
  });
  assert.equal(final.statusCode, 200, final.body);
  assert.equal(final.json().choices[0].message.content, "42");
  assert.equal(f.calls(), 2);
  const ledger = f.app.services.db.all<{
    status: string;
    input_tokens: number;
  }>("SELECT status,input_tokens FROM ledger");
  assert.equal(ledger.length, 2);
  assert.ok(
    ledger.every((row) => row.status === "settled" && row.input_tokens === 20),
  );
});

function toolResponse(
  res: ServerResponse,
  calls: (typeof call)[],
  stream: boolean,
  usage = { prompt_tokens: 20, completion_tokens: 12 },
  indexOffset = 0,
) {
  if (!stream) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          { message: { tool_calls: calls }, finish_reason: "tool_calls" },
        ],
        usage,
      }),
    );
    return;
  }
  res.setHeader("content-type", "text/event-stream");
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ ...call, index: index + indexOffset })) } }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}

test("upstream tool indices are bounded and never relax client history validation", async (t) => {
  let upstreamCall: Record<string, unknown> = { ...call, index: 31 };
  const f = await upstream(t, (_body, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content: null, tool_calls: [upstreamCall] },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 12 },
      }),
    );
  });
  await enable(f);
  const payload = {
    model: f.model,
    messages: [{ role: "user", content: "Calculate" }],
    tools,
  };
  const accepted = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload,
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json().choices[0].message.tool_calls, [call]);
  for (const index of [-1, 32, 0.5, "0", null]) {
    upstreamCall = { ...call, index };
    const rejected = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: f.headers,
      payload,
    });
    assert.equal(
      rejected.statusCode,
      502,
      JSON.stringify({ index, response: rejected.json() }),
    );
    assert.equal(rejected.json().error.code, "UPSTREAM_FORMAT");
  }
  upstreamCall = {
    ...call,
    index: 0,
    unknownTransportField: "must-not-pass-through",
  };
  const unknown = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload,
  });
  assert.equal(unknown.statusCode, 502, unknown.body);
  const callsBeforeHistory = f.calls();
  const history = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      ...payload,
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ ...call, index: 0 }],
        },
        { role: "tool", tool_call_id: call.id, content: "42" },
      ],
    },
  });
  assert.equal(history.statusCode, 400, history.body);
  assert.equal(f.calls(), callsBeforeHistory);
});

test("streamed tools are withheld until metering and durable success have been confirmed", async (t) => {
  const f = await upstream(t, (_body, res) =>
    toolResponse(res, [call], true, {
      prompt_tokens: 20,
      completion_tokens: 999,
    }),
  );
  await enable(f);
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      model: f.model,
      messages: [{ role: "user", content: "Calculate" }],
      tools,
      stream: true,
    },
  });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().error.code, "METERING_INVALID");
  assert.ok(!response.body.includes(call.id));
  assert.equal(
    f.app.services.db.get<{ status: string }>("SELECT status FROM ledger")!
      .status,
    "uncertain",
  );
  assert.equal(
    f.app.services.db.get<{ result: string | null }>(
      "SELECT result FROM gateway_calls",
    )!.result,
    null,
  );
});

test("parallel_tool_calls false rejects multiple upstream calls in JSON and SSE", async (t) => {
  const f = await upstream(t, (body, res) =>
    toolResponse(
      res,
      [call, { ...call, id: "call_second" }],
      body.stream === true,
    ),
  );
  await enable(f);
  for (const stream of [false, true]) {
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: f.headers,
      payload: {
        model: f.model,
        messages: [{ role: "user", content: "Calculate" }],
        tools,
        parallel_tool_calls: false,
        stream,
      },
    });
    assert.equal(response.statusCode, 502, response.body);
    assert.equal(response.json().error.code, "UPSTREAM_TOOL_FORMAT");
    assert.ok(!response.body.includes(call.id));
  }
});

test("a failed success-cache write cannot dispatch a tool or replay its upstream call", async (t) => {
  const f = await upstream(t, (_body, res) => toolResponse(res, [call], true));
  await enable(f);
  const db = f.app.services.db,
    write = db.run.bind(db);
  db.run = (sql, ...args) => {
    if (sql.startsWith("UPDATE gateway_calls SET result="))
      throw new Error("Controlled cache failure");
    return write(sql, ...args);
  };
  const payload = {
      model: f.model,
      messages: [{ role: "user", content: "Calculate" }],
      tools,
      stream: true,
    },
    headers = { ...f.headers, "idempotency-key": "cache-failure" };
  try {
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 502, response.body);
    assert.ok(!response.body.includes(call.id));
    const replay = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers,
      payload,
    });
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(f.calls(), 1);
  } finally {
    db.run = write;
  }
});

test("duplicate call identities, malformed arguments and sparse SSE fragments cannot become successful tools", async (t) => {
  let mode = 0;
  const f = await upstream(t, (body, res) =>
    toolResponse(
      res,
      mode === 0
        ? [call, call]
        : mode === 1
          ? [
              {
                ...call,
                function: { ...call.function, arguments: "invalid-json" },
              },
            ]
          : [call],
      body.stream === true,
      undefined,
      mode === 2 ? 1 : 0,
    ),
  );
  await enable(f);
  for (mode = 0; mode < 3; mode++) {
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: f.headers,
      payload: {
        model: f.model,
        messages: [{ role: "user", content: "Calculate" }],
        tools,
        stream: true,
      },
    });
    assert.equal(response.statusCode, 502, response.body);
    assert.ok(!response.body.includes(call.id));
  }
  assert.ok(
    f.app.services.db
      .all<{ status: string }>("SELECT status FROM ledger")
      .every((row) => row.status === "uncertain"),
  );
});

test("tool definitions and historical arguments count toward admission and input schemas are bounded", async (t) => {
  const f = await upstream(t, () => {
    throw new Error("Admission should reject before the upstream call");
  });
  await enable(f, 1024);
  const payload = {
    model: f.model,
    messages: [{ role: "user", content: "Calculate" }],
    tools,
  };
  const largeDefinition = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      ...payload,
      tools: [
        {
          ...tools[0],
          function: { ...tools[0]!.function, description: "x".repeat(2000) },
        },
      ],
    },
  });
  assert.equal(largeDefinition.statusCode, 400, largeDefinition.body);
  assert.equal(largeDefinition.json().error.code, "CONTEXT_LIMIT");
  const largeHistory = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      ...payload,
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              ...call,
              function: {
                ...call.function,
                arguments: JSON.stringify({ code: "x".repeat(2000) }),
              },
            },
          ],
        },
        { role: "tool", tool_call_id: call.id, content: "done" },
      ],
    },
  });
  assert.equal(largeHistory.statusCode, 400, largeHistory.body);
  assert.equal(largeHistory.json().error.code, "CONTEXT_LIMIT");
  let nested: Record<string, unknown> = { type: "object" };
  for (let i = 0; i < 25; i++) nested = { properties: { nested } };
  const deep = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      ...payload,
      tools: [
        { type: "function", function: { name: "deep", parameters: nested } },
      ],
    },
  });
  assert.equal(deep.statusCode, 400, deep.body);
  const duplicate = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: { ...payload, tools: [tools[0], tools[0]] },
  });
  assert.equal(duplicate.statusCode, 400, duplicate.body);
  assert.equal(f.calls(), 0);
  assert.equal(f.app.services.db.all("SELECT id FROM ledger").length, 0);
});

test("streamed function-call fragments and cached replay retain the complete tool contract", async (t) => {
  const f = await upstream(t, (_body, res) => {
    res.setHeader("content-type", "text/event-stream");
    const frames = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: call.id,
                  type: "function",
                  function: {
                    name: "execute_javascript",
                    arguments: '{"code":',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"console.log(42)"}' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 20, completion_tokens: 12 },
      },
    ];
    for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await enable(f);
  const payload = {
    model: f.model,
    messages: [{ role: "user", content: "Calculate" }],
    tools,
    stream: true,
  };
  const headers = { ...f.headers, "idempotency-key": "controlled-tool-stream" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    const frames = response.body
      .split("\n\n")
      .filter(
        (frame) => frame.startsWith("data: ") && !frame.includes("[DONE]"),
      )
      .map((frame) => JSON.parse(frame.slice(6)));
    const fragments = frames.flatMap(
      (frame) => frame.choices?.[0]?.delta?.tool_calls ?? [],
    );
    assert.equal(fragments[0].id, call.id);
    assert.equal(fragments[0].function.name, call.function.name);
    assert.equal(
      fragments.map((fragment) => fragment.function.arguments ?? "").join(""),
      call.function.arguments,
    );
    assert.equal(frames.at(-1).choices[0].finish_reason, "tool_calls");
    assert.equal(frames.at(-1).usage.total_tokens, 32);
    assert.ok(response.body.endsWith("data: [DONE]\n\n"));
  }
  assert.equal(f.calls(), 1);
});

test("undeclared upstream functions are rejected and uncertain billing is preserved", async (t) => {
  const f = await upstream(t, (_body, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  ...call,
                  function: { ...call.function, name: "not_declared" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
  });
  await enable(f);
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: {
      model: f.model,
      messages: [{ role: "user", content: "Calculate" }],
      tools,
    },
  });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().error.code, "UPSTREAM_TOOL_FORMAT");
  assert.equal(
    f.app.services.db.get<{ status: string }>("SELECT status FROM ledger")!
      .status,
    "uncertain",
  );
  for (const messages of [
    [{ role: "tool", content: "orphan" }],
    [{ role: "user", content: null }],
    [{ role: "assistant", content: null }],
  ]) {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/chat/completions",
          headers: f.headers,
          payload: { model: f.model, messages, tools },
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(f.calls(), 1);
});
