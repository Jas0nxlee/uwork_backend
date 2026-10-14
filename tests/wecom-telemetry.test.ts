import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("WeCom state is once-only, claims require proof and sync cannot escalate roles", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 7),
    publicUrl: "http://localhost:3000",
    wecomProvider: {
      async identity() {
        return "wx-owner";
      },
      async directory() {
        return {
          departments: [{ id: "1", name: "Root", parentId: null }],
          members: [
            {
              id: "wx-member",
              name: "Synced Member",
              departmentId: "1",
              active: true,
            },
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
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const p = `/api/tenants/${tenantId}`;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/wecom/attempts",
        payload: { tenantId },
      })
    ).statusCode,
    503,
  );
  const credential = await app.inject({
    method: "POST",
    url: `${p}/credentials`,
    headers,
    payload: { name: "WeCom", value: "test-credential" },
  });
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `${p}/wecom`,
        headers,
        payload: {
          corpId: "test-corp",
          agentId: "10001",
          credentialId: credential.json().id,
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `${p}/members/${userId}/wecom`,
        headers,
        payload: { externalId: "wx-owner" },
      })
    ).statusCode,
    200,
  );
  const attempt = (
    await app.inject({
      method: "POST",
      url: "/api/auth/wecom/attempts",
      payload: { tenantId },
    })
  ).json();
  const state = new URL(attempt.authorizeUrl).searchParams.get("state");
  assert.equal(
    (
      await app.inject({
        url: `/api/auth/wecom/callback?state=${state}&code=test-code`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/auth/wecom/callback?state=${state}&code=test-code`,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/auth/wecom/attempts/${attempt.id}/claim`,
        payload: { proof: "wrong" },
      })
    ).statusCode,
    400,
  );
  const claimed = await app.inject({
    method: "POST",
    url: `/api/auth/wecom/attempts/${attempt.id}/claim`,
    payload: { proof: attempt.proof },
  });
  assert.equal(claimed.statusCode, 200, claimed.body);
  assert.ok(claimed.json().token);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/auth/wecom/attempts/${attempt.id}/claim`,
        payload: { proof: attempt.proof },
      })
    ).statusCode,
    409,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await app.inject({ method: "POST", url: `${p}/wecom/sync`, headers }))
        .statusCode,
      200,
    );
  const members = (await app.inject({ url: `${p}/members`, headers })).json();
  assert.equal(members.total, 2);
  assert.equal(
    members.items.find((m: { source: string }) => m.source === "wecom").seat,
    0,
  );
  const audit = await app.inject({ url: `${p}/audit?format=csv`, headers });
  assert.equal(audit.statusCode, 200);
  assert.ok(audit.body.includes("wecom.authorized"));
  assert.ok(!audit.body.includes("test-credential"));
  assert.equal(
    (await app.inject({ url: `${p}/integrations/drive/capacity`, headers }))
      .statusCode,
    503,
  );
});
