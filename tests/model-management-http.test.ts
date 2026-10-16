import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function modelFixture(t: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-model-management-http-"),
  );
  const app = await createApp({
    database: join(directory, "models.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = await bootstrap(app.services.db, {
    name: "Model HTTP",
    email: "model-http@example.test",
    password: "Model-http-password!",
  });
  const origin = await app.listen({ port: 0, host: "127.0.0.1" });
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "model-http@example.test",
      password: "Model-http-password!",
    }),
  });
  assert.equal(login.status, 200);
  const { token } = (await login.json()) as { token: string };
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    auth = token,
  ) =>
    fetch(origin + path, {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (
    path: string,
    method = "GET",
    body?: unknown,
    auth = token,
  ) => {
    const response = await request(path, method, body, auth);
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  };
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = async (name: string) =>
    (
      (await json(`${p}/credentials`, "POST", {
        name,
        value: "synthetic-only",
      })) as { id: string }
    ).id;
  const createModel = async (name: string, credentialId: string) => {
    const body = {
      name,
      baseUrl: "http://127.0.0.1:1/v1",
      upstreamModel: "controlled",
      credentialId,
      scope: { all: true },
      contextWindow: 4096,
      maxOutputTokens: 8,
    };
    const response = (await json(`${p}/models`, "POST", body)) as {
      id: string;
    };
    return { id: response.id, body };
  };
  const modelRow = async (id: string) =>
    (
      (await json(`${p}/models`)) as {
        id: string;
        revision: number;
        name: string;
        data: Record<string, unknown>;
        scope: unknown;
        enabled: boolean;
      }[]
    ).find((model) => model.id === id)!;
  return { app, owner, p, request, json, credential, createModel, modelRow };
}

test("client model directory filters known unavailable credential metadata while admin repair records remain visible", async (t) => {
  const f = await modelFixture(t);
  const active = await f.credential("Active");
  const revoked = await f.credential("Revoked");
  const missing = await f.credential("Missing legacy");
  const good = await f.createModel("Good", active);
  const bad = await f.createModel("Revoked", revoked);
  const legacy = await f.createModel("Missing legacy", missing);
  assert.equal(
    (await f.request(`${f.p}/credentials/${revoked}`, "DELETE")).status,
    204,
  );
  // Declared isolated legacy faults: no hard-delete API; directory must not decrypt.
  f.app.services.db.run("DELETE FROM credentials WHERE id=?", missing);
  f.app.services.db.run(
    "UPDATE credentials SET ciphertext='invalid-ciphertext' WHERE id=?",
    active,
  );
  const directory = (await f.json("/v1/models")) as { data: { id: string }[] };
  assert.deepEqual(
    directory.data.map((model) => model.id),
    [good.id],
  );
  const admin = (await f.json(`${f.p}/models`)) as { id: string }[];
  assert.deepEqual(
    new Set(admin.map((model) => model.id)),
    new Set([good.id, bad.id, legacy.id]),
  );
  await f.json(`${f.p}/credentials/${revoked}`, "PUT", {
    value: "synthetic-rotated",
  });
  const restored = (await f.json("/v1/models")) as { data: { id: string }[] };
  assert.deepEqual(
    new Set(restored.data.map((model) => model.id)),
    new Set([good.id, bad.id]),
  );
});

test("operator updates an existing model without gaining credential or endpoint replacement authority over HTTP", async (t) => {
  const f = await modelFixture(t);
  const credential = await f.credential("Original");
  const other = await f.credential("Other");
  const model = await f.createModel("Managed", credential);
  await f.json(`${f.p}/members`, "POST", {
    name: "Operator",
    email: "model-operator@example.test",
    password: "Model-operator-password!",
    role: "operator",
    seat: true,
  });
  const login = (await f.json("/api/auth/login", "POST", {
    email: "model-operator@example.test",
    password: "Model-operator-password!",
  })) as { token: string };
  assert.equal(
    (await f.request(`${f.p}/models`, "POST", model.body, login.token)).status,
    403,
  );
  const original = await f.modelRow(model.id);
  await f.json(
    `${f.p}/models/${model.id}`,
    "PUT",
    { ...model.body, name: "Operator edited", revision: original.revision },
    login.token,
  );
  const updated = await f.modelRow(model.id);
  assert.equal(updated.name, "Operator edited");
  for (const replacement of [
    { baseUrl: "http://127.0.0.1:2/v1" },
    { credentialId: other },
  ]) {
    const response = await f.request(
      `${f.p}/models/${model.id}`,
      "PUT",
      { ...model.body, ...replacement, revision: updated.revision },
      login.token,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await f.modelRow(model.id), updated);
  }
});

test("concurrent same-revision HTTP model updates have one winner and one conflict", async (t) => {
  const f = await modelFixture(t);
  const model = await f.createModel(
    "Concurrent",
    await f.credential("Original"),
  );
  const before = await f.modelRow(model.id);
  const responses = await Promise.all(
    ["Winner A", "Winner B"].map((name) =>
      f.request(`${f.p}/models/${model.id}`, "PUT", {
        ...model.body,
        name,
        revision: before.revision,
      }),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const after = await f.modelRow(model.id);
  assert.equal(after.revision, before.revision + 1);
  assert.ok(["Winner A", "Winner B"].includes(after.name));
});
