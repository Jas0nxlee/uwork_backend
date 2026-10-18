import test from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_API,
  canonical,
  publication,
  sha,
  shareFixture,
} from "./member-sharing-fixture.js";

test("organization sharing publishes selected content for another active member without a model seat", async (t) => {
  const f = await shareFixture(t);
  const caps = await f.app.inject({
    url: `${SHARE_API}/capabilities`,
    headers: f.headers,
  });
  assert.equal(caps.statusCode, 200, caps.body);
  assert.deepEqual(caps.json().access_modes, ["organization"]);
  assert.equal(caps.json().max_rows, 2000);
  const prepared = await f.prepare();
  const share = await f.confirm(prepared);
  assert.equal(share.access_mode, "organization");
  assert.equal(new URL(share.share_url).origin, "http://localhost:3000");
  const preview = await f.app.inject({
    url: `${SHARE_API}/${share.share_code}/preview`,
    headers: f.member,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual(preview.json().rows, prepared.confirm.projection.rows);
  assert.deepEqual(preview.json().integrity, prepared.confirm.integrity);
  assert.equal(
    f.app.services.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger")!.n,
    0,
  );
});

test("share codes confer no anonymous, cross-tenant or device access and cannot import", async (t) => {
  const f = await shareFixture(t);
  const share = await f.confirm(await f.prepare());
  const url = `${SHARE_API}/${share.share_code}/preview`;
  for (const [headers, status] of [
    [undefined, 401],
    [f.outsider, 404],
    [f.device, 403],
  ] as const) {
    const response = await f.app.inject({
      url,
      ...(headers ? { headers } : {}),
    });
    assert.equal(response.statusCode, status, response.body);
    assert.equal(response.body.includes("OWNED_MEMBER_SHARE"), false);
    assert.equal(
      response.body.includes("Owned enterprise conversation"),
      false,
    );
  }
  const continuation = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/${share.share_code}/continuation`,
    headers: f.member,
    payload: { schema_version: 1, client_request_id: "owned-import-attempt" },
  });
  assert.equal(continuation.statusCode, 403, continuation.body);
});

test("prepare and confirm retries preserve one share while changed intent and foreign preparations fail", async (t) => {
  const f = await shareFixture(t);
  const input = publication();
  const prepared = await f.prepare(input);
  const repeated = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations`,
    headers: f.headers,
    payload: input.preparation,
  });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().preparation_id, prepared.preparationId);
  const changed = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations`,
    headers: f.headers,
    payload: { ...input.preparation, title: "different intent" },
  });
  assert.equal(changed.statusCode, 409, changed.body);
  const foreign = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations/${prepared.preparationId}/confirm`,
    headers: f.outsider,
    payload: input.confirm,
  });
  assert.equal(foreign.statusCode, 404, foreign.body);
  const first = await f.confirm(prepared);
  const second = await f.confirm(prepared);
  assert.deepEqual(second, first);
  const after = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations`,
    headers: f.headers,
    payload: input.preparation,
  });
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().status, "confirmed");
  assert.equal(after.json().share.share_code, first.share_code);
});

test("disabled policy immediately denies reads but the owner can still revoke after all publication gates close", async (t) => {
  const f = await shareFixture(t);
  const share = await f.confirm(await f.prepare());
  await f.configure("sharing", { publish: "disabled" });
  await f.configure("assistants", { local: false });
  f.app.services.db.run(
    "UPDATE members SET seat=0 WHERE tenant_id=? AND user_id=?",
    f.tenantId,
    f.userId,
  );
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  const denied = await f.app.inject({
    url: `${SHARE_API}/${share.share_code}/preview`,
    headers: f.member,
  });
  assert.equal(denied.statusCode, 403, denied.body);
  for (let repeat = 0; repeat < 2; repeat++) {
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `${SHARE_API}/${share.share_code}`,
      headers: f.headers,
    });
    assert.equal(revoked.statusCode, 204, revoked.body);
  }
  await f.configure("sharing", { publish: "organization" });
  const absent = await f.app.inject({
    url: `${SHARE_API}/${share.share_code}/preview`,
    headers: f.member,
  });
  assert.equal(absent.statusCode, 404, absent.body);
});

test("reader membership, session logout and IP restrictions are checked on every view", async (t) => {
  const f = await shareFixture(t);
  const share = await f.confirm(await f.prepare());
  const url = `${SHARE_API}/${share.share_code}/preview`;
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    200,
  );
  f.app.services.db.run(
    "UPDATE members SET status='disabled' WHERE tenant_id=? AND user_id=?",
    f.tenantId,
    f.memberId,
  );
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    401,
  );
  f.app.services.db.run(
    "UPDATE members SET status='active' WHERE tenant_id=? AND user_id=?",
    f.tenantId,
    f.memberId,
  );
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    200,
  );
  await f.configure("network", { whitelist: ["203.0.113.0/24"] });
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    403,
  );
  await f.configure("network", { whitelist: [] });
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    200,
  );
  const logout = await f.app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: f.member,
  });
  assert.equal(logout.statusCode, 204, logout.body);
  assert.equal(
    (await f.app.inject({ url, headers: f.member })).statusCode,
    401,
  );
});

test("confirm rejects changed content, digest mismatch and missing disclosure before making a readable share", async (t) => {
  const f = await shareFixture(t);
  const prepared = await f.prepare();
  for (const confirm of [
    {
      ...prepared.confirm,
      disclosure_confirmation: {
        ...prepared.confirm.disclosure_confirmation,
        acknowledged_no_secret_detection: false,
      },
    },
    {
      ...prepared.confirm,
      integrity: {
        ...prepared.confirm.integrity,
        projection_sha256: "0".repeat(64),
      },
    },
    {
      ...prepared.confirm,
      projection: { rows: prepared.confirm.projection.rows.slice(1) },
    },
  ]) {
    const response = await f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations/${prepared.preparationId}/confirm`,
      headers: f.headers,
      payload: confirm,
    });
    assert.ok(
      response.statusCode >= 400 && response.statusCode < 500,
      response.body,
    );
  }
  const share = await f.confirm(prepared);
  const changed = structuredClone(prepared.confirm);
  changed.projection.rows[1]!.text = "changed after publication";
  changed.integrity.projection_sha256 = sha(canonical(changed.projection.rows));
  const response = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations/${prepared.preparationId}/confirm`,
    headers: f.headers,
    payload: changed,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(
    (
      await f.app.inject({
        url: `${SHARE_API}/${share.share_code}/preview`,
        headers: f.member,
      })
    ).statusCode,
    200,
  );
});

test("publication requires an interactive seated publisher and current channel, sharing and subscription gates", async (t) => {
  const f = await shareFixture(t);
  const input = publication();
  const request = (headers = f.headers) =>
    f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations`,
      headers,
      payload: input.preparation,
    });
  assert.equal((await request(f.member)).statusCode, 403);
  assert.equal((await request(f.device)).statusCode, 403);
  await f.configure("assistants", { local: false });
  assert.equal((await request()).statusCode, 403);
  await f.configure("assistants", { local: true });
  await f.configure("sharing", { publish: "disabled" });
  assert.equal((await request()).statusCode, 403);
  await f.configure("sharing", { publish: "organization" });
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  assert.equal((await request()).statusCode, 402);
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() + 86_400_000,
    f.tenantId,
  );
  const firstAccepted = await request();
  assert.equal(firstAccepted.statusCode, 201, firstAccepted.body);
  for (const access_mode of [
    "private",
    "public_readonly",
    "public_importable",
  ]) {
    const response = await f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations`,
      headers: f.headers,
      payload: { ...input.preparation, access_mode },
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});
