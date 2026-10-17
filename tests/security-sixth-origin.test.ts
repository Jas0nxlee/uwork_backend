import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("cookie mutation cannot bypass Origin using an unsupported Authorization scheme", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-origin-security-"));
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "https://backend.example.test",
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Origin boundary",
    email: "origin-owner@example.test",
    password: "synthetic-origin-password",
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const login = await fetch(`${address}/api/auth/login`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "origin-owner@example.test",
      password: "synthetic-origin-password",
    }),
  });
  assert.equal(login.status, 200);
  const token = ((await login.json()) as { token: string }).token;
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  assert.match(login.headers.get("set-cookie")!, /; Secure/);
  const path = `${address}/api/tenants/${tenantId}/credentials`;
  const create = (headers: Record<string, string>) =>
    fetch(path, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ name: "Controlled", value: "synthetic-only" }),
    });
  for (const authorization of [undefined, "Basic synthetic", "Unsupported"]) {
    const response = await create({
      cookie,
      ...(authorization ? { authorization } : {}),
    });
    assert.equal(response.status, 403, `scheme ${authorization}`);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "ORIGIN_REQUIRED",
    );
  }
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM credentials WHERE tenant_id=?",
      tenantId,
    )!.count,
    0,
  );
  const sameOrigin = await create({
    cookie,
    authorization: "Basic synthetic",
    origin: "https://backend.example.test",
  });
  assert.equal(sameOrigin.status, 201);
  await sameOrigin.json();
  const bearer = await create({ cookie, authorization: `Bearer ${token}` });
  assert.equal(bearer.status, 201);
  await bearer.json();
  const invalidBearer = await create({
    cookie,
    authorization: "Bearer invalid",
  });
  assert.equal(invalidBearer.status, 401);
  await invalidBearer.json();
  const foreignOrigin = await create({
    authorization: `Bearer ${token}`,
    origin: "https://foreign.example.test",
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(
    ((await foreignOrigin.json()) as { error: { code: string } }).error.code,
    "ORIGIN_REJECTED",
  );
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM credentials WHERE tenant_id=?",
      tenantId,
    )!.count,
    2,
  );
});
