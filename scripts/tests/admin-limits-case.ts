import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminLimitsCase(p: AdminUiCasePorts) {
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const originalSubscription = p.app.services.db.get<Row>(
    "SELECT * FROM subscriptions WHERE tenant_id=?",
    p.control.tenantId as string,
  );
  const originalModel = p.app.services.db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    p.control.modelId as string,
  );
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
  const initial = counters();
  assert.equal(initial.supplier.length, 0);
  assert.equal(initial.ledger.length, 0);
  await p.run("limit-zero");
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT * FROM limits WHERE tenant_id=? AND subject_type='member' AND subject_id=?",
      p.control.tenantId as string,
      p.control.userId as string,
    )!.amount,
    0,
  );
  assert.equal(
    ((await completion("OWNED_QUOTA_ZERO", 402)).error as Row).code,
    "QUOTA_EXCEEDED",
  );
  assert.deepEqual(counters(), initial);
  await p.run("limit-high");
  await completion("OWNED_QUOTA_ALLOWED");
  const first = counters();
  assert.equal(first.supplier.length, 1);
  assert.equal(first.ledger.length, 1);
  assert.equal(first.ledger[0]!.amount, 14);
  assert.equal(first.ledger[0]!.status, "settled");
  await p.run("limit-at-spent");
  assert.equal(
    ((await completion("OWNED_QUOTA_AT_SPENT", 402)).error as Row).code,
    "QUOTA_EXCEEDED",
  );
  assert.deepEqual(counters(), first);
  await p.run("remove-limit");
  assert.equal(
    p.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM limits WHERE tenant_id=?",
      p.control.tenantId as string,
    )!.n,
    0,
  );
  await completion("OWNED_QUOTA_RESTORED");
  const final = counters();
  assert.equal(final.supplier.length, 2);
  assert.equal(final.ledger.length, 2);
  assert.ok(
    final.ledger.every((row) => row.status === "settled" && row.amount === 14),
  );
  await p.run("quota-usage-reload");
  assert.deepEqual(counters(), final);
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM subscriptions WHERE tenant_id=?",
      p.control.tenantId as string,
    ),
    originalSubscription,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      p.control.modelId as string,
    ),
    originalModel,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "PUT" &&
        row.route === "/api/tenants/:tenantId/limits" &&
        row.status === 200,
    ).length,
    3,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/limits/:type/:id" &&
        row.status === 204,
    ).length,
    1,
  );
  const audits = p.app.services.db.all<Row>(
    "SELECT action,target,user_id FROM audit WHERE action LIKE 'entitlements.limit.%'",
  );
  assert.equal(
    audits.filter(
      (row) =>
        row.action === "entitlements.limit.update" &&
        row.target === p.control.userId,
    ).length,
    3,
  );
  assert.equal(
    audits.filter(
      (row) =>
        row.action === "entitlements.limit.delete" &&
        row.target === p.control.userId,
    ).length,
    1,
  );
  p.facts.status = "passed";
  p.facts.memberQuotaTransitions = [0, 1000, 14, "removed"];
  p.facts.deniedWithoutSupplierOrBilling = true;
  p.facts.subscriptionAndModelUnchanged = true;
  p.facts.ledger = final.ledger.map(
    ({ status, amount, input_tokens, output_tokens }) => ({
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.limitAudit = audits;
}
