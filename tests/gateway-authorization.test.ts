import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";

test("gateway replay rechecks subscription, seat, model access and credentials without rebilling", async (t) => {
  let calls = 0;
  const upstream = createServer((_req, res) => {
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "controlled response" } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const port = (upstream.address() as { port: number }).port;
  const f = await fixture(t, `http://127.0.0.1:${port}/v1`);
  const request = {
    method: "POST" as const,
    url: "/v1/chat/completions",
    headers: { ...f.headers, "idempotency-key": "subscription-replay" },
    payload: {
      model: f.model,
      messages: [{ role: "user", content: "test" }],
    },
  };
  const first = await f.app.inject(request);
  assert.equal(first.statusCode, 200, first.body);
  const replay = await f.app.inject(request);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  const db = f.app.services.db;
  const restrictions = [
    {
      restrict: () =>
        db.run(
          "UPDATE members SET seat=0 WHERE tenant_id=? AND user_id=?",
          f.tenantId,
          f.userId,
        ),
      restore: () =>
        db.run(
          "UPDATE members SET seat=1 WHERE tenant_id=? AND user_id=?",
          f.tenantId,
          f.userId,
        ),
      status: 403,
      code: "NO_SEAT",
    },
    {
      restrict: () =>
        db.run(
          "UPDATE resources SET enabled=0 WHERE tenant_id=? AND id=?",
          f.tenantId,
          f.model,
        ),
      restore: () =>
        db.run(
          "UPDATE resources SET enabled=1 WHERE tenant_id=? AND id=?",
          f.tenantId,
          f.model,
        ),
      status: 403,
      code: "MODEL_DENIED",
    },
    {
      restrict: () =>
        db.run(
          "UPDATE resources SET scope=? WHERE tenant_id=? AND id=?",
          JSON.stringify({ all: false, members: [], departments: [] }),
          f.tenantId,
          f.model,
        ),
      restore: () =>
        db.run(
          "UPDATE resources SET scope=? WHERE tenant_id=? AND id=?",
          JSON.stringify({ all: true, members: [], departments: [] }),
          f.tenantId,
          f.model,
        ),
      status: 403,
      code: "MODEL_DENIED",
    },
    {
      restrict: () =>
        db.run(
          "UPDATE credentials SET revoked=1 WHERE tenant_id=? AND id=?",
          f.tenantId,
          f.credential,
        ),
      restore: () =>
        db.run(
          "UPDATE credentials SET revoked=0 WHERE tenant_id=? AND id=?",
          f.tenantId,
          f.credential,
        ),
      status: 409,
      code: "CREDENTIAL_UNAVAILABLE",
    },
  ];
  for (const restriction of restrictions) {
    restriction.restrict();
    const denied = await f.app.inject(request);
    assert.equal(denied.statusCode, restriction.status, denied.body);
    assert.equal(denied.json().error.code, restriction.code);
    restriction.restore();
  }
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  for (const stream of [false, true]) {
    const denied = await f.app.inject({
      ...request,
      payload: { ...request.payload, stream },
    });
    assert.equal(denied.statusCode, 402, denied.body);
    assert.equal(denied.json().error.code, "SUBSCRIPTION_INACTIVE");
  }
  const models = await f.app.inject({ url: "/v1/models", headers: f.headers });
  assert.equal(models.statusCode, 402, models.body);
  assert.equal(models.json().error.code, "SUBSCRIPTION_INACTIVE");
  assert.equal(calls, 1);
  assert.equal(f.app.services.db.all("SELECT id FROM ledger").length, 1);
});
