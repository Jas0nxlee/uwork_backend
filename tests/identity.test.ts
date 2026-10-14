import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("login, member access, tenant isolation, session revocation and last owner protection", async () => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 1),
    publicUrl: "http://localhost:3000",
  });
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const other = await bootstrap(app.services.db, {
    name: "Other",
    email: "other@example.test",
    password: "other-password-long",
  });
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/tenants/${tenantId}/members`,
      })
    ).statusCode,
    401,
  );
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const token = login.json().token;
  const headers = { authorization: `Bearer ${token}` };
  const me = (await app.inject({ url: "/api/auth/me", headers })).json();
  assert.equal(me.tenant.id, tenantId);
  assert.equal(
    (
      await app.inject({
        url: `/api/tenants/${other.tenantId}/members`,
        headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/tenants/${tenantId}/members/${me.user.id}`,
        headers,
        payload: { role: "member" },
      })
    ).statusCode,
    409,
  );
  const member = await app.inject({
    method: "POST",
    url: `/api/tenants/${tenantId}/members`,
    headers,
    payload: {
      email: "member@example.test",
      name: "Member",
      password: "member-password-long",
      role: "member",
      seat: true,
    },
  });
  assert.equal(member.statusCode, 201, member.body);
  const memberLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "member@example.test", password: "member-password-long" },
  });
  const memberHeaders = { authorization: `Bearer ${memberLogin.json().token}` };
  assert.equal(
    (
      await app.inject({
        url: `/api/tenants/${tenantId}/members`,
        headers: memberHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/auth/logout", headers }))
      .statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/api/auth/me", headers })).statusCode,
    401,
  );
  await app.close();
});

test("cookie mutations require same origin and login is rate limited", async () => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 2),
    publicUrl: "http://localhost:3000",
  });
  await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie, origin: "https://evil.test" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie, origin: "http://localhost:3000" },
      })
    ).statusCode,
    204,
  );
  for (let i = 0; i < 10; i++)
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "missing@example.test",
        password: "wrong-password-long",
      },
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "missing@example.test",
          password: "wrong-password-long",
        },
      })
    ).statusCode,
    429,
  );
  await app.close();
});
