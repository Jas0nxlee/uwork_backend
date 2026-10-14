import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap, issueSession } from "../src/identity.js";

test("operator cannot repoint stored provider credentials to a different destination", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 8),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const owner = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.test", password: "test-password-long" },
    })
  ).json().token;
  const h = { authorization: `Bearer ${owner}` };
  const p = `/api/tenants/${tenantId}`;
  const c = (
    await app.inject({
      method: "POST",
      url: `${p}/credentials`,
      headers: h,
      payload: { name: "Test", value: "synthetic-only" },
    })
  ).json();
  const input = {
    name: "Model",
    baseUrl: "https://provider.example.test/v1",
    upstreamModel: "test",
    credentialId: c.id,
    scope: { all: true },
  };
  const model = (
    await app.inject({
      method: "POST",
      url: `${p}/models`,
      headers: h,
      payload: input,
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/models`,
        headers: h,
        payload: {
          ...input,
          baseUrl: "https://user:synthetic-secret@provider.example.test/v1",
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/models`,
        headers: h,
        payload: {
          ...input,
          baseUrl: "https://provider.example.test/v1?api_key=synthetic-secret",
        },
      })
    ).statusCode,
    400,
  );
  await app.inject({
    method: "POST",
    url: `${p}/members`,
    headers: h,
    payload: {
      name: "Op",
      email: "op@example.test",
      password: "operator-password-long",
      role: "operator",
      seat: true,
    },
  });
  const op = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "op@example.test", password: "operator-password-long" },
    })
  ).json().token;
  const oh = { authorization: `Bearer ${op}` };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/models`,
        headers: oh,
        payload: { ...input, baseUrl: "https://attacker.example.test/v1" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `${p}/models/${model.id}`,
        headers: oh,
        payload: {
          ...input,
          baseUrl: "https://attacker.example.test/v1",
          revision: 1,
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/assets`,
        headers: oh,
        payload: {
          name: "Leak",
          kind: "connector",
          content: {
            url: "https://attacker.example.test/mcp",
            transport: "streamable-http",
            credentialId: c.id,
          },
          scope: { all: true },
        },
      })
    ).statusCode,
    403,
  );
});

test("cancel during WeCom verification cannot issue a token; disabled members never regain old sessions", async (t) => {
  let finish!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => (finish = r)),
    entry = new Promise<void>((r) => (entered = r));
  let active = true;
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 9),
    publicUrl: "http://localhost:3000",
    wecomProvider: {
      async identity() {
        entered();
        await gate;
        return "wx-owner";
      },
      async directory() {
        return {
          departments: [],
          members: [
            { id: "wx-member", name: "Wx Member", departmentId: null, active },
          ],
        };
      },
    },
  });
  t.after(() => app.close());
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const token = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.test", password: "test-password-long" },
    })
  ).json().token;
  const h = { authorization: `Bearer ${token}` };
  const p = `/api/tenants/${tenantId}`;
  const c = (
    await app.inject({
      method: "POST",
      url: `${p}/credentials`,
      headers: h,
      payload: { name: "Wx", value: "synthetic-only" },
    })
  ).json();
  await app.inject({
    method: "PUT",
    url: `${p}/wecom`,
    headers: h,
    payload: { corpId: "test", agentId: "1", credentialId: c.id },
  });
  await app.inject({
    method: "PUT",
    url: `${p}/members/${userId}/wecom`,
    headers: h,
    payload: { externalId: "wx-owner" },
  });
  const a = (
    await app.inject({
      method: "POST",
      url: "/api/auth/wecom/attempts",
      payload: { tenantId },
    })
  ).json();
  const state = new URL(a.authorizeUrl).searchParams.get("state");
  const cb = app.inject({
    url: `/api/auth/wecom/callback?state=${state}&code=synthetic`,
  });
  await entry;
  await app.inject({
    method: "POST",
    url: `/api/auth/wecom/attempts/${a.id}/cancel`,
    payload: { proof: a.proof },
  });
  finish();
  await cb;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/auth/wecom/attempts/${a.id}/claim`,
        payload: { proof: a.proof },
      })
    ).statusCode,
    409,
  );
  await app.inject({ method: "POST", url: `${p}/wecom/sync`, headers: h });
  const uid = app.services.db.get<{ user_id: string }>(
    "SELECT user_id FROM members WHERE source='wecom'",
  )!.user_id;
  const old = issueSession(app.services.db, uid, tenantId).token;
  active = false;
  await app.inject({ method: "POST", url: `${p}/wecom/sync`, headers: h });
  active = true;
  await app.inject({ method: "POST", url: `${p}/wecom/sync`, headers: h });
  assert.equal(
    (
      await app.inject({
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${old}` },
      })
    ).statusCode,
    401,
  );
});
