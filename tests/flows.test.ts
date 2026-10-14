import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";
import { currentActor } from "../src/runtime.js";
import { now } from "../src/core.js";

test("SSE finishes with usage and incomplete upstream is a terminal error", async (t) => {
  let incomplete = false;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "hello" }, finish_reason: null }],
        }) +
        "\n\n",
    );
    if (!incomplete)
      res.write(
        "data: " +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }) +
          "\n\ndata: [DONE]\n\n",
      );
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(
    t,
    `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  );
  const body = {
    model: f.model,
    messages: [{ role: "user", content: "hello" }],
    stream: true,
    max_tokens: 32,
  };
  const first = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: body,
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(first.body.includes("hello"));
  assert.ok(first.body.includes('"completion_tokens":2'));
  assert.ok(first.body.endsWith("data: [DONE]\n\n"));
  incomplete = true;
  const second = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload: body,
  });
  assert.ok(second.body.includes("UPSTREAM_INCOMPLETE"));
  assert.ok(second.body.endsWith("data: [DONE]\n\n"));
  const uncertain = f.app.services.db.get<{
    id: string;
    amount: number;
    reserved: number;
  }>("SELECT id,amount,reserved FROM ledger WHERE status='uncertain'")!;
  assert.equal(uncertain.amount, uncertain.reserved);
  assert.ok(uncertain.amount > 0);
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `${f.p}/usage/${uncertain.id}/reconcile`,
        headers: f.headers,
        payload: { amount: 12, evidenceReference: "controlled-upstream-test" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    f.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM ledger WHERE status='reserved'",
    )!.n,
    0,
  );
});

test("quota reservations atomically bound concurrent admission", async (t) => {
  const f = await fixture(t, "https://provider.example.test/v1");
  const actor = currentActor(f.app.services.db, f.tenantId, f.userId);
  f.app.services.db.run(
    "UPDATE subscriptions SET credits=100 WHERE tenant_id=?",
    f.tenantId,
  );
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() =>
        f.app.services.entitlements.reserve(
          actor,
          `request-${i}`,
          f.model,
          "test",
          30,
        ),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  assert.equal(
    f.app.services.db.get<{ n: number }>("SELECT sum(reserved) n FROM ledger")!
      .n,
    90,
  );
});

test("automation trigger is unique and shutdown waits for in-flight webhook delivery", async (t) => {
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entry = new Promise<void>((r) => (entered = r));
  const server = createServer(async (req, res) => {
    if (req.url === "/webhook") {
      entered();
      await gate;
      res.writeHead(200);
      res.end("{}");
    } else {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "done" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 },
        }),
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const f = await fixture(t, `${base}/v1`);
  const cred = f.app.services.vault.create(
    f.tenantId,
    "Webhook",
    JSON.stringify({ url: `${base}/webhook` }),
  );
  const due = now() + 60000;
  const create = await f.app.inject({
    method: "POST",
    url: `${f.p}/automations`,
    headers: f.headers,
    payload: {
      name: "One",
      agentId: f.agent,
      input: "hello",
      schedule: { type: "once", at: due },
      webhookCredentialId: cred,
    },
  });
  assert.equal(create.statusCode, 201, create.body);
  f.app.services.automation.tick(due + 1);
  f.app.services.automation.tick(due + 2);
  assert.equal(
    f.app.services.db.get<{ n: number }>("SELECT count(*) n FROM runs")!.n,
    1,
  );
  await f.app.services.runtime.drain();
  const delivery = f.app.services.automation.deliver(due + 3);
  await entry;
  let closed = false;
  const close = f.app.close().then(() => (closed = true));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, false);
  release();
  await delivery;
  await close;
  assert.equal(closed, true);
});

test("MCP proxy binds sessions to member and published version and enforces allowed tools", async (t) => {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      assert.equal(req.headers.authorization, "Bearer synthetic-only");
      const b = JSON.parse(raw);
      res.setHeader("content-type", "application/json");
      res.setHeader("mcp-session-id", "upstream-session");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: b.id,
          result:
            b.method === "initialize"
              ? {
                  protocolVersion: "2025-03-26",
                  capabilities: { tools: {} },
                  serverInfo: { name: "test", version: "1" },
                }
              : { content: [{ type: "text", text: "done" }] },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(t, "https://provider.example.test/v1");
  const asset = (
    await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "MCP",
        kind: "connector",
        content: {
          url: "https://fixture.example.test/mcp",
          transport: "streamable-http",
          credentialId: f.credential,
          allowedTools: ["echo"],
        },
        scope: { all: true },
      },
    })
  ).json().id;
  // Only this controlled fixture substitutes a loopback transport for the HTTPS production form.
  const row = f.app.services.db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=?",
    asset,
  )!;
  const data = JSON.parse(row.data);
  data.content.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  f.app.services.db.run(
    "UPDATE resource_versions SET data=? WHERE resource_id=?",
    JSON.stringify(data),
    asset,
  );
  await f.app.inject({
    method: "POST",
    url: `${f.p}/assets/${asset}/review`,
    headers: f.headers,
    payload: { version: 1, approved: true },
  });
  await f.app.inject({
    method: "POST",
    url: `${f.p}/assets/${asset}/publish`,
    headers: f.headers,
    payload: { version: 1 },
  });
  const download = await f.app.inject({
    url: `/api/client/assets/${asset}/download`,
    headers: f.headers,
  });
  assert.ok(!download.body.includes("synthetic-only"));
  assert.ok(!download.body.includes(f.credential));
  const init = await f.app.inject({
    method: "POST",
    url: `/api/client/connectors/${asset}/rpc`,
    headers: f.headers,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  assert.equal(init.statusCode, 200, init.body);
  const h = {
    ...f.headers,
    "mcp-session-id": String(init.headers["mcp-session-id"]),
  };
  assert.notEqual(h["mcp-session-id"], "upstream-session");
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/client/connectors/${asset}/rpc`,
        headers: h,
        payload: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "delete", arguments: {} },
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/client/connectors/${asset}/rpc`,
        headers: h,
        payload: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo", arguments: {} },
        },
      })
    ).statusCode,
    200,
  );
  await f.app.inject({
    method: "DELETE",
    url: `${f.p}/assets/${asset}`,
    headers: f.headers,
  });
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/api/client/connectors/${asset}/rpc`,
        headers: h,
        payload: { jsonrpc: "2.0", id: 4, method: "ping" },
      })
    ).statusCode,
    403,
  );
});
