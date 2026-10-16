import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("failed durable request admission rolls back its quota reservation before any provider dispatch", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-gateway-admission-"));
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Admission fixture",
    email: "admission@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  let token = "";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    status = 200,
    key?: string,
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  token = String(
    (
      await request("/api/auth/login", "POST", {
        email: "admission@example.test",
        password,
      })
    ).token,
  );
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await request(
    `${p}/credentials`,
    "POST",
    { name: "Synthetic", value: "synthetic-only" },
    201,
  );
  const model = await request(
    `${p}/models`,
    "POST",
    {
      name: "Admission model",
      upstreamModel: "controlled",
      credentialId: credential.id,
      baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
      maxOutputTokens: 8,
      scope: { all: true },
    },
    201,
  );
  const payload = {
    model: model.id,
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 8,
  };
  // Only this temporary database: simulate a storage failure at the durable
  // request marker, after quota admission but strictly before outbound dispatch.
  app.services.db.run(
    "CREATE TRIGGER fail_request_marker BEFORE INSERT ON gateway_calls BEGIN SELECT RAISE(ABORT,'controlled admission storage failure'); END",
  );
  await request(
    "/v1/chat/completions",
    "POST",
    payload,
    500,
    "atomic-admission",
  );
  assert.equal(calls, 0);
  const before = await request(`${p}/usage`);
  assert.equal(
    before.total,
    0,
    "failed admission must not leave a billable reservation",
  );
  assert.equal(
    app.services.db.get<{ n: number }>("SELECT count(*) n FROM gateway_calls")!
      .n,
    0,
  );
  app.services.db.run("DROP TRIGGER fail_request_marker");
  const success = await request(
    "/v1/chat/completions",
    "POST",
    payload,
    200,
    "atomic-admission",
  );
  assert.equal(calls, 1);
  assert.deepEqual(success.usage, {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
  });
  const final = await request(`${p}/usage`);
  assert.equal(final.total, 1);
  const row = (final.items as { status: string; amount: number }[])[0]!;
  assert.equal(row.status, "settled");
  assert.equal(row.amount, 2);
});
