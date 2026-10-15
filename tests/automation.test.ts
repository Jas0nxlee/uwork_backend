import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";
import { now } from "../src/core.js";

async function deliveryFixture(t: TestContext, status = 200) {
  let received = 0;
  const server = createServer((_req, res) => {
    received++;
    res.writeHead(status);
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(t, "https://provider.example.test/v1");
  const credentialValue = JSON.stringify({
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/webhook`,
    token: "controlled-webhook-token",
  });
  const credential = f.app.services.vault.create(
    f.tenantId,
    "Webhook",
    credentialValue,
  );
  const due = now() + 60000;
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/automations`,
    headers: f.headers,
    payload: {
      name: "Controlled delivery",
      agentId: f.agent,
      input: "hello",
      schedule: { type: "once", at: due },
      webhookCredentialId: credential,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  f.app.services.automation.tick(due);
  f.app.services.db.run(
    "UPDATE runs SET status='succeeded',output=?,finished_at=?",
    f.app.services.vault.seal(
      "controlled-output",
      `${f.tenantId}:${f.app.services.db.get<{ id: string }>("SELECT id FROM runs")!.id}:output`,
    ),
    due,
  );
  return { ...f, credential, credentialValue, due, received: () => received };
}

for (const mutation of ["revoked", "rotated", "member-disabled"] as const)
  test(`webhook dispatch rechecks ${mutation} after asynchronous address resolution`, async (t) => {
    const f = await deliveryFixture(t);
    const delivery = f.app.services.automation.deliver(f.due);
    // safeRequest yields for address resolution before the actual HTTP dispatch.
    if (mutation === "member-disabled")
      f.app.services.db.run(
        "UPDATE members SET status='disabled' WHERE tenant_id=? AND user_id=?",
        f.tenantId,
        f.userId,
      );
    else if (mutation === "revoked")
      f.app.services.db.run(
        "UPDATE credentials SET revoked=1 WHERE id=?",
        f.credential,
      );
    else
      f.app.services.db.run(
        "UPDATE credentials SET ciphertext=?,revision=revision+1 WHERE id=?",
        f.app.services.vault.seal(
          f.credentialValue.replace(
            "controlled-webhook-token",
            "rotated-token",
          ),
          `${f.tenantId}:${f.credential}`,
        ),
        f.credential,
      );
    await delivery;
    assert.equal(f.received(), 0, "stale authorization must not dispatch");
    assert.deepEqual(
      {
        ...f.app.services.db.get<Record<string, unknown>>(
          "SELECT status,attempts,error_code FROM deliveries",
        ),
      },
      { status: "pending", attempts: 1, error_code: "DELIVERY_FAILED" },
    );
  });

test("webhook failure retries only at backoff deadlines and stops after three attempts", async (t) => {
  const f = await deliveryFixture(t, 503);
  await f.app.services.automation.deliver(f.due);
  await f.app.services.automation.deliver(f.due + 59999);
  assert.equal(f.received(), 1);
  await f.app.services.automation.deliver(f.due + 60000);
  await f.app.services.automation.deliver(f.due + 179999);
  assert.equal(f.received(), 2);
  await f.app.services.automation.deliver(f.due + 180000);
  await f.app.services.automation.deliver(f.due + 3600000);
  assert.equal(f.received(), 3);
  assert.deepEqual(
    {
      ...f.app.services.db.get<Record<string, unknown>>(
        "SELECT status,attempts,error_code FROM deliveries",
      ),
    },
    { status: "failed", attempts: 3, error_code: "DELIVERY_FAILED" },
  );
});

test("successful one-shot delivery remains valid after scheduling ends and never repeats", async (t) => {
  const f = await deliveryFixture(t);
  assert.equal(
    f.app.services.db.get<{ enabled: number }>(
      "SELECT enabled FROM automations",
    )!.enabled,
    0,
  );
  await f.app.services.automation.deliver(f.due);
  await f.app.services.automation.deliver(f.due + 3600000);
  assert.equal(f.received(), 1);
  assert.deepEqual(
    {
      ...f.app.services.db.get<Record<string, unknown>>(
        "SELECT status,attempts FROM deliveries",
      ),
    },
    { status: "sent", attempts: 1 },
  );
});

test("recurring automations skip overlapping runs and resume with a unique next trigger", async (t) => {
  const f = await fixture(t, "https://provider.example.test/v1");
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/automations`,
    headers: f.headers,
    payload: {
      name: "Recurring",
      agentId: f.agent,
      input: "hello",
      schedule: { type: "interval", seconds: 60 },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const due = created.json<{ nextAt: number }>().nextAt;
  f.app.services.automation.tick(due);
  f.app.services.automation.tick(due + 60000);
  assert.equal(
    f.app.services.db.get<{ n: number }>("SELECT count(*) n FROM runs")!.n,
    1,
  );
  f.app.services.db.run(
    "UPDATE runs SET status='cancelled',finished_at=?",
    due + 60000,
  );
  f.app.services.automation.tick(due + 120000);
  f.app.services.automation.tick(due + 120000);
  assert.equal(
    f.app.services.db.get<{ n: number }>("SELECT count(*) n FROM runs")!.n,
    2,
  );
  assert.equal(
    f.app.services.db.get<{ n: number }>(
      "SELECT count(DISTINCT trigger_key) n FROM runs",
    )!.n,
    2,
  );
});
