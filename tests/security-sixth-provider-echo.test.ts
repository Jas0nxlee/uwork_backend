import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

const unicode = (value: string) =>
  Array.from(
    value,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  ).join("");
const tools = [
  {
    type: "function",
    function: {
      name: "controlled",
      parameters: { type: "object", properties: { text: { type: "string" } } },
    },
  },
];
async function fixture(t: TestContext, mode: string) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-provider-key-echo-"));
  const vendorKey = randomBytes(32).toString("hex");
  let calls = 0,
    upstreamClosed = false;
  let finish!: () => void;
  const finished = new Promise<void>((done) => {
    finish = done;
  });
  const provider = createServer(async (req, res) => {
    req.resume();
    calls++;
    res.on("close", () => {
      upstreamClosed = true;
    });
    const isStream = mode.startsWith("sse") || mode === "hold";
    res.setHeader(
      "content-type",
      isStream ? "text/event-stream" : "application/json",
    );
    const call = {
      id: mode.endsWith("id") ? vendorKey : "controlled-call",
      type: "function",
      function: {
        name: "controlled",
        arguments: mode.endsWith("id")
          ? '{"text":"safe"}'
          : `{"text":"${unicode(vendorKey)}"}`,
      },
    };
    if (!isStream) {
      const message = mode.includes("tool")
        ? { role: "assistant", content: null, tool_calls: [call] }
        : {
            role: "assistant",
            content:
              mode === "json-unicode"
                ? "PLACEHOLDER"
                : mode === "json-metadata" || mode === "safe"
                  ? "safe"
                  : vendorKey,
          };
      const output = {
        choices: [
          {
            message,
            finish_reason:
              mode === "json-metadata"
                ? vendorKey
                : mode.includes("tool")
                  ? "tool_calls"
                  : "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      };
      res.end(
        JSON.stringify(output).replace(
          '"PLACEHOLDER"',
          `"${unicode(vendorKey)}"`,
        ),
      );
      return;
    }
    const frame = (value: unknown) =>
      res.write(`data: ${JSON.stringify(value)}\n\n`);
    if (mode === "hold") {
      frame({
        choices: [
          { delta: { content: "live-prefix-" + vendorKey.slice(0, 12) } },
        ],
      });
      await finished;
    } else if (mode === "sse-fragmented" || mode === "sse-safe-then-private") {
      if (mode === "sse-safe-then-private")
        frame({ choices: [{ delta: { content: "safe-prefix" } }] });
      frame({ choices: [{ delta: { content: vendorKey.slice(0, 32) } }] });
      await new Promise((done) => setImmediate(done));
      frame({ choices: [{ delta: { content: vendorKey.slice(32) } }] });
    } else if (mode === "sse-unicode") {
      res.write(
        `data: {"choices":[{"delta":{"content":"${unicode(vendorKey)}"}}]}\n\n`,
      );
    } else if (mode.includes("tool")) {
      const argumentsText = call.function.arguments;
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  ...call,
                  index: 0,
                  function: {
                    name: "controlled",
                    arguments: argumentsText.slice(0, 20),
                  },
                },
              ],
            },
          },
        ],
      });
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: argumentsText.slice(20) } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    } else if (mode === "sse-metadata") {
      frame({
        choices: [{ delta: { content: "safe" }, finish_reason: vendorKey }],
      });
    } else frame({ choices: [{ delta: { content: vendorKey } }] });
    frame({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(async () => {
    finish();
    try {
      provider.closeAllConnections();
      await new Promise<void>((done) => provider.close(() => done()));
    } finally {
      try {
        app.server.closeAllConnections();
        await app.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  const owner = await bootstrap(app.services.db, {
    name: "Synthetic key echo",
    email: "key-echo@example.test",
    password: "Synthetic-key-echo-password!",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function post(path: string, body: unknown, token?: string) {
    const response = await fetch(origin + path, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      value: (await response.json()) as Record<string, unknown>,
    };
  }
  const login = await post("/api/auth/login", {
    email: "key-echo@example.test",
    password: "Synthetic-key-echo-password!",
  });
  assert.equal(login.status, 200);
  const token = String(login.value.token),
    p = `/api/tenants/${owner.tenantId}`;
  const credential = await post(
    `${p}/credentials`,
    { name: "Synthetic vendor", value: vendorKey },
    token,
  );
  assert.equal(credential.status, 201);
  const model = await post(
    `${p}/models`,
    {
      name: "Controlled echo model",
      upstreamModel: "synthetic",
      baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
      credentialId: credential.value.id,
      scope: { all: true },
      supportsTools: true,
    },
    token,
  );
  assert.equal(model.status, 201);
  const input = {
    model: model.value.id,
    messages: [{ role: "user", content: "Controlled test" }],
    max_tokens: 16,
    ...(mode.includes("tool") ? { tools } : {}),
    stream: mode.startsWith("sse") || mode === "hold",
  };
  const request = (key: string, signal = AbortSignal.timeout(10000)) =>
    fetch(origin + "/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": key,
      },
      body: JSON.stringify(input),
    });
  return {
    app,
    input,
    request,
    vendorKey,
    calls: () => calls,
    upstreamClosed: () => upstreamClosed,
    owner,
    finish,
  };
}

for (const mode of [
  "json-content",
  "json-unicode",
  "json-tool",
  "json-tool-id",
  "json-metadata",
  "sse-content",
  "sse-unicode",
  "sse-fragmented",
  "sse-tool",
  "sse-metadata",
  "sse-safe-then-private",
]) {
  test(`supplier ${mode} credential echo cannot cross backend output or cache`, async (t) => {
    const f = await fixture(t, mode);
    const response = await f.request("private-echo");
    const text = await response.text();
    assert.equal(
      text.includes(f.vendorKey),
      false,
      "server-only key is never in client output",
    );
    assert.equal(response.status, mode === "sse-safe-then-private" ? 200 : 502);
    if (mode === "sse-safe-then-private") {
      assert.match(text, /safe-prefix/);
      assert.match(text, /UPSTREAM_PRIVATE/);
      assert.equal(text.includes(f.vendorKey.slice(0, 32)), false);
    } else
      assert.equal(
        (JSON.parse(text) as { error: { code: string } }).error.code,
        "UPSTREAM_PRIVATE",
      );
    const row = f.app.services.db.get<{
      status: string;
      amount: number;
      reserved: number;
    }>("SELECT status,amount,reserved FROM ledger")!;
    assert.equal(row.status, "uncertain");
    assert.equal(row.amount, row.reserved);
    assert.equal(
      f.app.services.db.get<{ result: string | null }>(
        "SELECT result FROM gateway_calls",
      )!.result,
      null,
    );
    const replay = await f.request("private-echo");
    assert.equal(replay.status, 409);
    await replay.text();
    assert.equal(f.calls(), 1);
  });
}

test("private-key holdback preserves live streaming and cancellation with an unresolved key prefix", async (t) => {
  const f = await fixture(t, "hold");
  const controller = new AbortController();
  const response = await f.request(
    "cancel-held-prefix",
    AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  const text = Buffer.from(first.value!).toString();
  assert.match(text, /live-prefix-/);
  assert.equal(
    text.includes(f.vendorKey.slice(0, 12)),
    false,
    "candidate private prefix stays held",
  );
  controller.abort();
  void reader.cancel().catch(() => {});
  for (let i = 0; i < 100; i++) {
    if (
      f.upstreamClosed() &&
      f.app.services.db.get<{ status: string }>("SELECT status FROM ledger")
        ?.status === "uncertain"
    )
      break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(f.upstreamClosed(), true);
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

test("cache replay rechecks decoded provider privacy before any callback or response", async (t) => {
  const f = await fixture(t, "safe");
  const first = await f.request("legacy-private-cache");
  assert.equal(first.status, 200);
  const result = (await first.json()) as {
    choices: { message: { content: string } }[];
  };
  // Explicit legacy-cache fault injection is limited to this owned temporary DB.
  result.choices[0]!.message.content = f.vendorKey;
  f.app.services.db.run(
    "UPDATE gateway_calls SET result=? WHERE request_key=?",
    f.app.services.vault.seal(
      JSON.stringify(result),
      `${f.owner.tenantId}:legacy-private-cache`,
    ),
    "legacy-private-cache",
  );
  const replay = await f.request("legacy-private-cache");
  const text = await replay.text();
  assert.equal(replay.status, 502);
  assert.equal(text.includes(f.vendorKey), false);
  assert.equal(
    (JSON.parse(text) as { error: { code: string } }).error.code,
    "UPSTREAM_PRIVATE",
  );
  assert.equal(f.calls(), 1);
  assert.equal(
    f.app.services.db.get<{ status: string }>("SELECT status FROM ledger")!
      .status,
    "settled",
  );
});
