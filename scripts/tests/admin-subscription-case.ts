import assert from "node:assert/strict";
import { billingPeriod } from "../../src/entitlements.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminSubscriptionCase(p: AdminUiCasePorts) {
  await p.api(
    p.prefix + "/members",
    "POST",
    {
      name: "Owned subscription seat",
      email: "owned-subscription-seat@example.test",
      password: p.control.password,
      role: "member",
      seat: true,
    },
    201,
  );
  const db = p.app.services.db;
  const subscription = () =>
    db.get<Row>(
      "SELECT * FROM subscriptions WHERE tenant_id=?",
      String(p.control.tenantId),
    )!;
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const members = db.all<Row>("SELECT * FROM members ORDER BY user_id");
  const models = db.all<Row>("SELECT * FROM resources ORDER BY id");
  const original = subscription();
  const initial = counters();
  assert.equal(initial.supplier.length, 0);
  assert.equal(initial.ledger.length, 0);
  p.control.subscriptionStart = Date.now() - 2 * 86400000;
  p.control.subscriptionEnd = Date.now() + 86400000;
  p.control.subscriptionExpiredEnd = Date.now() - 60000;
  await p.saveControl();
  const completion = (label: string, expected = 200) =>
    p.api(
      "/v1/chat/completions",
      "POST",
      {
        model: p.control.modelId,
        messages: [{ role: "user", content: label }],
        max_tokens: 32,
      },
      expected,
    );
  await p.run("subscription-seat-conflict");
  assert.deepEqual(subscription(), original);
  assert.deepEqual(counters(), initial);
  await p.run("subscription-zero");
  assert.equal(subscription().credits, 0);
  assert.equal(subscription().metering, "subscription");
  assert.equal(
    ((await completion("OWNED_SUBSCRIPTION_ZERO", 402)).error as Row).code,
    "QUOTA_EXCEEDED",
  );
  assert.deepEqual(counters(), initial);
  await p.run("subscription-credit-restore");
  await completion("OWNED_SUBSCRIPTION_ALLOWED");
  const first = counters();
  assert.equal(first.supplier.length, 1);
  assert.equal(first.ledger.length, 1);
  assert.equal(first.ledger[0]!.amount, 14);
  await p.run("subscription-expired");
  assert.equal(
    ((await completion("OWNED_SUBSCRIPTION_EXPIRED", 402)).error as Row).code,
    "SUBSCRIPTION_INACTIVE",
  );
  assert.deepEqual(counters(), first);
  await p.run("subscription-renew");
  await completion("OWNED_SUBSCRIPTION_RENEWED");
  const final = counters();
  assert.equal(final.supplier.length, 2);
  assert.equal(final.ledger.length, 2);
  assert.deepEqual(final.ledger[0], first.ledger[0]);
  const period = billingPeriod(
    Date.now(),
    Number(p.control.subscriptionStart),
    "subscription",
  );
  assert.ok(
    final.ledger.every(
      (row) =>
        row.status === "settled" && row.amount === 14 && row.period === period,
    ),
  );
  await p.run("subscription-reloaded");
  assert.deepEqual(counters(), final);
  assert.deepEqual(
    db.all<Row>("SELECT * FROM members ORDER BY user_id"),
    members,
  );
  assert.deepEqual(db.all<Row>("SELECT * FROM resources ORDER BY id"), models);
  const current = await p.api(p.prefix + "/subscription");
  assert.equal(current.period, period);
  assert.equal(current.assignedSeats, 2);
  assert.equal(current.seats, 2);
  assert.equal((current.usage as Row).consumed, 28);
  const writes = p.traffic.filter(
    (row) =>
      row.source === "browser" &&
      row.method === "PUT" &&
      row.route === "/api/tenants/:tenantId/subscription",
  );
  assert.deepEqual(
    writes.map((row) => row.status),
    [409, 200, 200, 200, 200],
  );
  const audits = db.all<Row>(
    "SELECT action FROM audit WHERE action='entitlements.subscription.update'",
  );
  assert.equal(audits.length, 4);
  p.facts.subscription = {
    seatConflictPreserved: true,
    zeroCreditDenied: true,
    expirationDenied: true,
    renewalRestored: true,
    seats: 2,
    consumed: 28,
    period,
    writes,
    auditCount: audits.length,
  };
  p.facts.status = "passed";
}
