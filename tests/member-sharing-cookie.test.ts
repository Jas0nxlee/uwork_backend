import test from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap, issueSession } from "../src/identity.js";

const ORIGIN = "https://sharing.example.test";
const PASSWORD = "owned-sharing-cookie-password";
const EMAIL = "sharing-cookie@example.test";

async function cookieFixture(t: TestContext) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 18),
    publicUrl: ORIGIN,
    wecomProvider: {
      async identity() {
        return "owned-wecom-member";
      },
      async directory() {
        return { departments: [], members: [] };
      },
    },
  });
  t.after(() => app.close());
  const owner = await bootstrap(app.services.db, {
    name: "Owned cookie",
    email: EMAIL,
    password: PASSWORD,
  });
  const headers = {
    authorization: `Bearer ${issueSession(app.services.db, owner.userId, owner.tenantId).token}`,
  };
  async function authorizedAttempt() {
    const p = `/api/tenants/${owner.tenantId}`;
    const credential = await app.inject({
      method: "POST",
      url: `${p}/credentials`,
      headers,
      payload: { name: "Synthetic WeCom", value: "synthetic-provider-only" },
    });
    assert.equal(credential.statusCode, 201, credential.body);
    const config = await app.inject({
      method: "PUT",
      url: `${p}/wecom`,
      headers,
      payload: {
        corpId: "owned-company",
        agentId: "10001",
        credentialId: credential.json().id,
      },
    });
    assert.equal(config.statusCode, 200, config.body);
    const mapping = await app.inject({
      method: "PUT",
      url: `${p}/members/${owner.userId}/wecom`,
      headers,
      payload: { externalId: "owned-wecom-member" },
    });
    assert.equal(mapping.statusCode, 200, mapping.body);
    const attempt = await app.inject({
      method: "POST",
      url: "/api/auth/wecom/attempts",
      payload: { tenantId: owner.tenantId },
    });
    assert.equal(attempt.statusCode, 201, attempt.body);
    const state = new URL(attempt.json().authorizeUrl).searchParams.get(
      "state",
    );
    const callback = await app.inject({
      url: `/api/auth/wecom/callback?state=${state}&code=owned-code`,
    });
    assert.equal(callback.statusCode, 200, callback.body);
    return attempt.json() as { id: string; proof: string };
  }
  return { app, ...owner, authorizedAttempt };
}

function sessionCookie(headers: Record<string, unknown>) {
  const value = headers["set-cookie"];
  assert.equal(typeof value, "string");
  assert.match(value as string, /HttpOnly/);
  assert.match(value as string, /SameSite=Strict/);
  assert.match(value as string, /Secure/);
  return (value as string).split(";")[0]!;
}

async function switchTarget(f: Awaited<ReturnType<typeof cookieFixture>>) {
  const other = await bootstrap(f.app.services.db, {
    name: "Owned switch target",
    email: "owned-switch@example.test",
    password: PASSWORD,
  });
  f.app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'member',0)",
    other.tenantId,
    f.userId,
  );
  return other.tenantId;
}

test("cookie-only organization switch rotates the session without a JSON bearer", async (t) => {
  const f = await cookieFixture(t);
  const tenantId = await switchTarget(f);
  const old = issueSession(f.app.services.db, f.userId, f.tenantId).token;
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/switch",
    headers: { origin: ORIGIN, cookie: `uwork_session=${old}` },
    payload: { tenantId, delivery: "cookie" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal("token" in response.json(), false);
  const cookie = sessionCookie(response.headers);
  const current = await f.app.inject({
    url: "/api/auth/me",
    headers: { cookie },
  });
  assert.equal(current.json().tenant.id, tenantId);
  assert.equal(
    (
      await f.app.inject({
        url: "/api/auth/me",
        headers: { cookie: `uwork_session=${old}` },
      })
    ).statusCode,
    401,
  );
});

test("cookie-only switch without Origin rejects before retiring the old bearer session", async (t) => {
  const f = await cookieFixture(t);
  const tenantId = await switchTarget(f);
  const token = issueSession(f.app.services.db, f.userId, f.tenantId).token;
  const headers = { authorization: `Bearer ${token}` };
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/switch",
    headers,
    payload: { tenantId, delivery: "cookie" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "ORIGIN_REQUIRED");
  const current = await f.app.inject({ url: "/api/auth/me", headers });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().tenant.id, f.tenantId);
});

test("Native organization switch retains default token delivery", async (t) => {
  const f = await cookieFixture(t);
  const tenantId = await switchTarget(f);
  const old = issueSession(f.app.services.db, f.userId, f.tenantId).token;
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/switch",
    headers: { authorization: `Bearer ${old}` },
    payload: { tenantId },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json().token, "string");
  assert.notEqual(response.json().token, old);
});

test("cookie-only password login never sends a bearer token in the JSON body", async (t) => {
  const f = await cookieFixture(t);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { email: EMAIL, password: PASSWORD, delivery: "cookie" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal("token" in response.json(), false);
  assert.equal(typeof response.json().expiresAt, "number");
  const cookie = sessionCookie(response.headers);
  const me = await f.app.inject({ url: "/api/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.id, f.userId);
});

test("cookie-only login requires an explicit same-origin request before issuing a session", async (t) => {
  const f = await cookieFixture(t);
  for (const headers of [{}, { origin: "https://other.example.test" }]) {
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { email: EMAIL, password: PASSWORD, delivery: "cookie" },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.headers["set-cookie"], undefined);
  }
});

test("Native password delivery remains the existing token mode", async (t) => {
  const f = await cookieFixture(t);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: EMAIL, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(typeof response.json().token, "string");
  assert.ok(response.json().token.length > 20);
});

test("cookie-only WeCom claim uses the same proof and membership owner without returning a bearer", async (t) => {
  const f = await cookieFixture(t);
  const attempt = await f.authorizedAttempt();
  const url = `/api/auth/wecom/attempts/${attempt.id}/claim`;
  const response = await f.app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN },
    payload: { proof: attempt.proof, delivery: "cookie" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, "claimed");
  assert.equal("token" in response.json(), false);
  const cookie = sessionCookie(response.headers);
  const me = await f.app.inject({ url: "/api/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.id, f.userId);
  assert.equal(me.json().tenant.id, f.tenantId);
  const replay = await f.app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN },
    payload: { proof: attempt.proof, delivery: "cookie" },
  });
  assert.equal(replay.statusCode, 409, replay.body);
});

test("a cookie claim without Origin does not consume the authorized attempt", async (t) => {
  const f = await cookieFixture(t);
  const attempt = await f.authorizedAttempt();
  const url = `/api/auth/wecom/attempts/${attempt.id}/claim`;
  const first = await f.app.inject({
    method: "POST",
    url,
    payload: { proof: attempt.proof, delivery: "cookie" },
  });
  assert.equal(first.statusCode, 403, first.body);
  assert.equal(first.headers["set-cookie"], undefined);
  const valid = await f.app.inject({
    method: "POST",
    url,
    headers: { origin: ORIGIN },
    payload: { proof: attempt.proof, delivery: "cookie" },
  });
  assert.equal(valid.statusCode, 200, valid.body);
});

test("Native WeCom claim keeps its existing private token delivery", async (t) => {
  const f = await cookieFixture(t);
  const attempt = await f.authorizedAttempt();
  const response = await f.app.inject({
    method: "POST",
    url: `/api/auth/wecom/attempts/${attempt.id}/claim`,
    payload: { proof: attempt.proof },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(typeof response.json().token, "string");
  assert.equal(response.headers["set-cookie"], undefined);
});
