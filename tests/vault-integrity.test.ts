import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-vault-integrity-"));
  const database = join(directory, "backend.sqlite");
  const key = randomBytes(32);
  const allowedTokens = new Set<string>();
  let requests = 0;
  const upstream = createServer((req, response) => {
    requests++;
    response.setHeader("content-type", "application/json");
    if (!allowedTokens.has(req.headers.authorization ?? "")) {
      response.writeHead(401);
      response.end(
        JSON.stringify({ error: "controlled authentication denied" }),
      );
      return;
    }
    response.end(JSON.stringify({ data: [{ id: "controlled-model" }] }));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  const options = {
    database,
    masterKey: key,
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  };
  let app = await createApp(options);
  let origin = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
  async function request<T = Record<string, unknown>>(
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
    status = 200,
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.text();
    assert.equal(response.status, status, `${method} ${path}`);
    return (data ? JSON.parse(data) : undefined) as T;
  }
  async function tenant(index: number) {
    const password = randomBytes(24).toString("hex");
    const email = `owner-${index}@example.test`;
    const { tenantId } = await bootstrap(app.services.db, {
      name: `Integrity tenant ${index}`,
      email,
      password,
    });
    const login = await request<{ token: string }>(
      "/api/auth/login",
      "",
      "POST",
      { email, password },
    );
    const p = `/api/tenants/${tenantId}`;
    const token = login.token;
    const secret = randomBytes(24).toString("hex");
    allowedTokens.add(`Bearer ${secret}`);
    const credential = await request<{ id: string }>(
      `${p}/credentials`,
      token,
      "POST",
      { name: "Controlled credential", value: secret },
      201,
    );
    const model = await request<{ id: string }>(
      `${p}/models`,
      token,
      "POST",
      {
        name: "Controlled model",
        upstreamModel: "controlled-model",
        baseUrl: upstreamUrl,
        credentialId: credential.id,
        scope: { all: true },
      },
      201,
    );
    return { p, token, secret, credentialId: credential.id, modelId: model.id };
  }
  return {
    get app() {
      return app;
    },
    tenant,
    request,
    requests: () => requests,
    async reopen(masterKey: Buffer) {
      await app.close();
      app = await createApp({ ...options, masterKey });
      origin = await app.listen({ host: "127.0.0.1", port: 0 });
    },
    key,
  };
}

test("real HTTP model probes fail before dispatch for swapped or tampered vault ciphertext", async (t) => {
  const f = await fixture(t);
  const first = await f.tenant(1);
  const second = await f.tenant(2);
  const other = await f.request<{ id: string }>(
    `${first.p}/credentials`,
    first.token,
    "POST",
    { name: "Other credential", value: randomBytes(24).toString("hex") },
    201,
  );
  const cipher = (id: string) =>
    f.app.services.db.get<{ ciphertext: string }>(
      "SELECT ciphertext FROM credentials WHERE id=?",
      id,
    )!.ciphertext;
  const original = cipher(first.credentialId);
  const parts = original.split(".");
  const tag = Buffer.from(parts[1]!, "base64");
  tag[0] = tag[0]! ^ 1;
  parts[1] = tag.toString("base64");
  // Explicit fault injection touches this isolated database only. All business
  // setup and the observed failure/positive control use actual TCP HTTP.
  for (const invalid of [
    cipher(other.id),
    cipher(second.credentialId),
    parts.join("."),
  ]) {
    f.app.services.db.run(
      "UPDATE credentials SET ciphertext=? WHERE id=?",
      invalid,
      first.credentialId,
    );
    const before = f.requests();
    const result = await f.request<{ error: { code: string } }>(
      `${first.p}/models/${first.modelId}/probe`,
      first.token,
      "POST",
      {},
      503,
    );
    assert.equal(result.error.code, "VAULT_UNAVAILABLE");
    assert.equal(f.requests(), before, "invalid ciphertext must not dispatch");
    assert.ok(!JSON.stringify(result).includes(first.secret));
  }
  f.app.services.db.run(
    "UPDATE credentials SET ciphertext=? WHERE id=?",
    original,
    first.credentialId,
  );
  const result = await f.request<{ reachable: boolean }>(
    `${first.p}/models/${first.modelId}/probe`,
    first.token,
    "POST",
    {},
  );
  assert.equal(result.reachable, true);
  assert.equal(f.requests(), 1);
});

test("persistent vault fails closed with a wrong master key and recovers after reopening with its original key", async (t) => {
  const f = await fixture(t);
  const owner = await f.tenant(1);
  await f.reopen(randomBytes(32));
  const result = await f.request<{ error: { code: string } }>(
    `${owner.p}/models/${owner.modelId}/probe`,
    owner.token,
    "POST",
    {},
    503,
  );
  assert.equal(result.error.code, "VAULT_UNAVAILABLE");
  assert.equal(f.requests(), 0);
  const metadata = await f.request(`${owner.p}/credentials`, owner.token);
  assert.ok(!JSON.stringify(metadata).includes(owner.secret));
  await f.reopen(f.key);
  const restored = await f.request<{ reachable: boolean }>(
    `${owner.p}/models/${owner.modelId}/probe`,
    owner.token,
    "POST",
    {},
  );
  assert.equal(restored.reachable, true);
  assert.equal(f.requests(), 1);
});
