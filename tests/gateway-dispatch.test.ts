import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { fixture } from "./fixtures.js";
import { currentActor } from "../src/access.js";
import { completionSchema } from "../src/gateway.js";
import { ApiError } from "../src/core.js";

async function paused(t: TestContext, phase: "dns" | "response") {
  let calls = 0;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const server = createServer((_req, res) => {
    calls++;
    const respond = () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "controlled late response" } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );
    };
    if (phase === "response") {
      finish = respond;
      entered();
    } else respond();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as { port: number }).port;
  const host = phase === "dns" ? "controlled.example.test" : "127.0.0.1";
  const f = await fixture(t, `http://${host}:${port}/v1`);
  if (phase === "dns") {
    const dnsMock = t.mock.method(dns, "lookup", async () => {
      const resumed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      entered();
      await resumed;
      return [{ address: "127.0.0.1", family: 4 }];
    });
    syncBuiltinESMExports();
    t.after(() => {
      dnsMock.mock.restore();
      syncBuiltinESMExports();
    });
  }
  return { ...f, started, resume: () => finish(), calls: () => calls };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const restrictions = [
  {
    name: "disabled model",
    status: 403,
    code: "MODEL_DENIED",
    apply: async (f: Fixture) => {
      const result = await f.app.inject({
        method: "DELETE",
        url: `${f.p}/models/${f.model}`,
        headers: f.headers,
      });
      assert.equal(result.statusCode, 204, result.body);
    },
  },
  {
    name: "withdrawn model scope",
    status: 403,
    code: "MODEL_DENIED",
    apply: (f: Fixture) =>
      f.app.services.db.run(
        "UPDATE resources SET scope=? WHERE tenant_id=? AND id=?",
        JSON.stringify({ all: false, members: [], departments: [] }),
        f.tenantId,
        f.model,
      ),
  },
  {
    name: "expired subscription",
    status: 402,
    code: "SUBSCRIPTION_INACTIVE",
    apply: (f: Fixture) =>
      f.app.services.db.run(
        "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
        Date.now() - 1,
        f.tenantId,
      ),
  },
  {
    name: "removed seat",
    status: 403,
    code: "NO_SEAT",
    apply: (f: Fixture) =>
      f.app.services.db.run(
        "UPDATE members SET seat=0 WHERE tenant_id=? AND user_id=?",
        f.tenantId,
        f.userId,
      ),
  },
  {
    name: "expired session",
    status: 401,
    code: "SESSION_EXPIRED",
    apply: (f: Fixture) =>
      f.app.services.db.run(
        "UPDATE sessions SET expires_at=? WHERE tenant_id=? AND user_id=?",
        Date.now() - 1,
        f.tenantId,
        f.userId,
      ),
  },
  {
    name: "revoked credential",
    status: 409,
    code: "CREDENTIAL_UNAVAILABLE",
    apply: async (f: Fixture) => {
      const result = await f.app.inject({
        method: "DELETE",
        url: `${f.p}/credentials/${f.credential}`,
        headers: f.headers,
      });
      assert.equal(result.statusCode, 204, result.body);
    },
  },
  {
    name: "rotated credential",
    status: 409,
    code: "CREDENTIAL_CHANGED",
    apply: async (f: Fixture) => {
      const result = await f.app.inject({
        method: "PUT",
        url: `${f.p}/credentials/${f.credential}`,
        headers: f.headers,
        payload: { value: "synthetic-rotated" },
      });
      assert.equal(result.statusCode, 200, result.body);
    },
  },
  {
    name: "changed model revision",
    status: 409,
    code: "REQUEST_CONTEXT_CHANGED",
    apply: (f: Fixture) =>
      f.app.services.db.run(
        "UPDATE resources SET revision=revision+1 WHERE tenant_id=? AND id=?",
        f.tenantId,
        f.model,
      ),
  },
];

for (const phase of ["dns", "response"] as const) {
  for (const restriction of restrictions) {
    test(`gateway rejects ${restriction.name} during ${phase} without leaking a late success`, async (t) => {
      const f = await paused(t, phase);
      const key = `${phase}:${restriction.name}`;
      const pending = f.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { ...f.headers, "idempotency-key": key },
        payload: {
          model: f.model,
          messages: [{ role: "user", content: "controlled" }],
        },
      });
      await f.started;
      await restriction.apply(f);
      f.resume();
      const result = await pending;
      assert.equal(result.statusCode, restriction.status, result.body);
      assert.equal(result.json().error.code, restriction.code);
      assert.equal(result.body.includes("controlled late response"), false);
      assert.equal(f.calls(), phase === "dns" ? 0 : 1);
      const ledger = f.app.services.db.get<{ status: string; amount: number }>(
        "SELECT status,amount FROM ledger WHERE request_key=?",
        key,
      );
      assert.equal(ledger?.status, phase === "dns" ? "released" : "settled");
      assert.equal(ledger?.amount, phase === "dns" ? 0 : 8);
      assert.equal(
        f.app.services.db.get<{ result: string | null }>(
          "SELECT result FROM gateway_calls WHERE request_key=?",
          key,
        )?.result,
        null,
      );
    });
  }
}

test("a live SSE stream ends with a denial instead of emitting text received after revocation", async (t) => {
  let finish!: () => void;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "already visible" } }] })}\n\n`,
    );
    finish = () =>
      res.end(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: { content: "late forbidden text" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        })}\n\ndata: [DONE]\n\n`,
      );
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
  await f.app.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(
    `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        ...f.headers,
        "content-type": "application/json",
        "idempotency-key": "live-stream-revoked",
      },
      body: JSON.stringify({
        model: f.model,
        messages: [{ role: "user", content: "controlled" }],
        stream: true,
      }),
    },
  );
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.ok(new TextDecoder().decode(first.value).includes("already visible"));
  const denied = await f.app.inject({
    method: "DELETE",
    url: `${f.p}/models/${f.model}`,
    headers: f.headers,
  });
  assert.equal(denied.statusCode, 204, denied.body);
  finish();
  let rest = "";
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    rest += decoder.decode(chunk.value, { stream: true });
  }
  assert.equal(rest.includes("late forbidden text"), false);
  assert.ok(rest.includes("MODEL_DENIED"));
  assert.ok(rest.endsWith("data: [DONE]\n\n"));
  const ledger = f.app.services.db.get<{
    status: string;
    amount: number;
    reserved: number;
  }>(
    "SELECT status,amount,reserved FROM ledger WHERE request_key=?",
    "live-stream-revoked",
  );
  assert.equal(ledger?.status, "uncertain");
  assert.equal(ledger?.amount, ledger?.reserved);
});

test("streamed tools are withheld when the subscription expires before a complete HTTP response", async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const server = createServer((_req, res) => {
    finish = () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "controlled-call",
                    type: "function",
                    function: { name: "controlled_tool", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        })}\n\ndata: [DONE]\n\n`,
      );
    };
    entered();
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
  const db = f.app.services.db;
  const row = db.get<{ data: string }>(
    "SELECT data FROM resources WHERE id=?",
    f.model,
  )!;
  db.run(
    "UPDATE resources SET data=? WHERE id=?",
    JSON.stringify({ ...JSON.parse(row.data), supportsTools: true }),
    f.model,
  );
  let toolDeltas = 0;
  const pending = f.app.services.gateway.complete(
    currentActor(db, f.tenantId, f.userId),
    completionSchema.parse({
      model: f.model,
      messages: [{ role: "user", content: "controlled" }],
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "controlled_tool",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
    }),
    "expired-stream-tool",
    "uwork",
    undefined,
    undefined,
    () => {
      toolDeltas++;
    },
  );
  const rejected = assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof ApiError && error.code === "SUBSCRIPTION_INACTIVE",
  );
  await started;
  db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  finish();
  await rejected;
  assert.equal(toolDeltas, 0);
  const ledger = db.get<{ status: string; amount: number }>(
    "SELECT status,amount FROM ledger WHERE request_key=?",
    "expired-stream-tool",
  );
  assert.equal(ledger?.status, "settled");
  assert.equal(ledger?.amount, 8);
});
