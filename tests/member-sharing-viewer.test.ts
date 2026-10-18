import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { shareFixture } from "./member-sharing-fixture.js";

test("the private sharing page exposes no conversation before the authenticated fetch", async (t) => {
  const f = await shareFixture(t);
  for (const prefix of ["", "/cn"]) {
    const response = await f.app.inject({
      url: `${prefix}/share/${"a".repeat(32)}`,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(String(response.headers["content-type"]), /^text\/html/);
    assert.match(
      String(response.headers["content-security-policy"]),
      /default-src 'none'/,
    );
    assert.match(
      String(response.headers["content-security-policy"]),
      /script-src 'self'/,
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(response.body.includes('data-testid="share-viewer"'));
    assert.equal(response.body.includes("OWNED_MEMBER_SHARE"), false);
    assert.equal(response.body.includes("sharing-owner@example.test"), false);
    assert.equal(response.body.includes("<script>"), false);
  }
});

test("sharing viewer assets are same-origin, syntactically valid and keep untrusted content as text", async (t) => {
  const f = await shareFixture(t);
  const response = await f.app.inject({ url: "/share/assets/viewer.js" });
  assert.equal(response.statusCode, 200, response.body);
  new Script(response.body, { filename: "sharing-viewer.js" });
  assert.equal(
    /innerHTML|insertAdjacentHTML|localStorage|sessionStorage/u.test(
      response.body,
    ),
    false,
  );
  const css = await f.app.inject({ url: "/share/assets/viewer.css" });
  assert.equal(css.statusCode, 200, css.body);
  assert.match(String(css.headers["content-type"]), /^text\/css/);
});

test("the public share login context discloses only the tenant locator and closes after revocation", async (t) => {
  const f = await shareFixture(t);
  const share = await f.confirm(await f.prepare());
  const context = `/api/auth/shares/${share.share_code}/context`;
  const response = await f.app.inject({ url: context });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { tenantId: f.tenantId });
  const revoked = await f.app.inject({
    method: "DELETE",
    url: `/api/client/shares/${share.share_code}`,
    headers: f.headers,
  });
  assert.equal(revoked.statusCode, 204, revoked.body);
  const closed = await f.app.inject({ url: context });
  assert.equal(closed.statusCode, 404, closed.body);
  assert.equal(closed.body.includes("Owned enterprise conversation"), false);
});
