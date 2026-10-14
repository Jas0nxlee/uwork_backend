import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("asset review, immutable versions, deny precedence and published client policy", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 4),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const p = `/api/tenants/${tenantId}`;
  const asset = await app.inject({
    method: "POST",
    url: `${p}/assets`,
    headers,
    payload: {
      kind: "skill",
      name: "Review",
      content: {
        files: [
          { path: "SKILL.md", content: "# Review\nCheck code carefully." },
        ],
      },
      scope: { all: true },
    },
  });
  assert.equal(asset.statusCode, 201, asset.body);
  const aid = asset.json().id;
  assert.equal(
    (await app.inject({ url: "/api/client/assets", headers })).json().items
      .length,
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/assets/${aid}/publish`,
        headers,
        payload: { version: 1 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/assets/${aid}/review`,
        headers,
        payload: { version: 1, approved: true },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/assets/${aid}/publish`,
        headers,
        payload: { version: 1 },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/client/assets", headers })).json().items
      .length,
    1,
  );
  const denied = await app.inject({
    method: "POST",
    url: `${p}/policies`,
    headers,
    payload: {
      family: "skill",
      name: "Block",
      scope: { members: [userId] },
      mode: "deny",
      resourceIds: [aid],
    },
  });
  assert.equal(denied.statusCode, 201, denied.body);
  assert.equal(
    (await app.inject({ url: `/api/client/assets/${aid}/download`, headers }))
      .statusCode,
    403,
  );
  const before = (
    await app.inject({ url: `${p}/configurations/new-chat`, headers })
  ).json();
  const save = await app.inject({
    method: "PUT",
    url: `${p}/configurations/new-chat`,
    headers,
    payload: {
      revision: before.revision,
      data: { welcome: "欢迎使用", riskNotice: "请核实重要信息" },
    },
  });
  assert.equal(save.statusCode, 200, save.body);
  assert.notEqual(
    (await app.inject({ url: "/api/client/configuration", headers })).json()
      .configuration["new-chat"].welcome,
    "欢迎使用",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/configurations/new-chat/publish`,
        headers,
        payload: { revision: before.revision },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/configurations/new-chat/publish`,
        headers,
        payload: { revision: save.json().revision },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/client/configuration", headers })).json()
      .configuration["new-chat"].welcome,
    "欢迎使用",
  );
  const bad = await app.inject({
    method: "POST",
    url: `${p}/assets`,
    headers,
    payload: {
      kind: "skill",
      name: "Unsafe",
      content: { files: [{ path: "../outside", content: "x" }] },
      scope: { all: true },
    },
  });
  assert.equal(bad.statusCode, 400);
});

test("highest priority security policy wins and CIDR policy enforces deny-all sentinel", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 5),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const p = `/api/tenants/${tenantId}`;
  for (const priority of [1, 10]) {
    const r = await app.inject({
      method: "POST",
      url: `${p}/policies/security`,
      headers,
      payload: {
        name: `P${priority}`,
        priority,
        scope: { all: true },
        data: {
          allowShell: false,
          allowFilesystem: false,
          allowNetwork: priority === 1,
          dangerousSkills: false,
          allowedDomains: [],
        },
      },
    });
    assert.equal(r.statusCode, 201, r.body);
  }
  assert.equal(
    (await app.inject({ url: "/api/client/configuration", headers })).json()
      .security.allowNetwork,
    false,
  );
  const draft = await app.inject({
    method: "PUT",
    url: `${p}/configurations/network`,
    headers,
    payload: { revision: 0, data: { whitelist: ["127.0.0.1"] } },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  await app.inject({
    method: "POST",
    url: `${p}/configurations/network/publish`,
    headers,
    payload: { revision: draft.json().revision },
  });
  assert.equal(
    (await app.inject({ url: "/api/client/configuration", headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: `${p}/configurations/network`, headers }))
      .statusCode,
    200,
  );
});
