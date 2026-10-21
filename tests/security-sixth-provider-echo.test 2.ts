import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("provider credential echoed in model output remains behind backend boundary", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-provider-key-echo-"));
  const vendorKey = randomBytes(32).toString("hex");
  let calls = 0;
  const provider = createServer((req, res) => {
    req.resume();
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: vendorKey }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }));
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const app = await createApp({ database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32), publicUrl: "http://localhost:3000", allowPrivateUpstreams: true });
  t.after(async () => {
    try { await app.close(); } finally {
      try {
        provider.closeAllConnections();
        await new Promise<void>((done) => provider.close(() => done()));
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  const owner = await bootstrap(app.services.db, {
    name: "Synthetic key echo", email: "key-echo@example.test", password: "Synthetic-key-echo-password!",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function post(path: string, body: unknown, token?: string) {
    const response = await fetch(origin + path, { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() as Record<string, unknown> };
  }
  const login = await post("/api/auth/login", { email: "key-echo@example.test", password: "Synthetic-key-echo-password!" });
  assert.equal(login.status, 200);
  const token = String(login.value.token);
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await post(`${p}/credentials`, { name: "Synthetic vendor", value: vendorKey }, token);
  assert.equal(credential.status, 201);
  const model = await post(`${p}/models`, { name: "Controlled echo model", upstreamModel: "synthetic",
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
    credentialId: credential.value.id, scope: { all: true } }, token);
  assert.equal(model.status, 201);
  const result = await post("/v1/chat/completions", { model: model.value.id,
    messages: [{ role: "user", content: "Controlled test" }], max_tokens: 16 }, token);
  assert.equal(calls, 1);
  const leaked = JSON.stringify(result.value).includes(vendorKey);
  assert.equal(leaked, false, "a supplier echo must not expose the server-only vendor key");
  assert.equal(result.status, 502);
  assert.equal((result.value.error as { code: string }).code, "UPSTREAM_PRIVATE");
  assert.equal(app.services.db.get<{ status: string }>("SELECT status FROM ledger")!.status, "uncertain");
  assert.equal(app.services.db.get<{ result: string | null }>("SELECT result FROM gateway_calls")!.result, null);
});
