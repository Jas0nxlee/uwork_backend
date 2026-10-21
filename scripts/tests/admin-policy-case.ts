import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminPolicyCase(p: AdminUiCasePorts) {
  const metadata = p.app.services.db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    p.control.modelId as string,
  );
  const catalog = async () => (await p.api("/v1/models")).data as Row[];
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const baseline = counters();
  assert.equal(baseline.supplier.length, 0);
  assert.equal(baseline.ledger.length, 0);
  await p.run("create-deny");
  const rows = await p.api(p.prefix + "/policies");
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  const policy = (rows as Row[])[0]!;
  assert.equal(policy.family, "model");
  assert.equal(policy.enabled, 1);
  assert.deepEqual(policy.data, {
    mode: "deny",
    resourceIds: [p.control.modelId],
  });
  assert.equal(
    (await catalog()).some((row) => row.id === p.control.modelId),
    false,
  );
  const completion = (input: string, expected = 200) =>
    p.api(
      "/v1/chat/completions",
      "POST",
      {
        model: p.control.modelId,
        messages: [{ role: "user", content: input }],
        max_tokens: 32,
      },
      expected,
    );
  const denied = await completion("OWNED_POLICY_DENIED", 403);
  assert.equal((denied.error as Row).code, "MODEL_DENIED");
  assert.deepEqual(counters(), baseline);
  await p.run("disable-policy");
  assert.equal(
    (await catalog()).some((row) => row.id === p.control.modelId),
    true,
  );
  await completion("OWNED_POLICY_ALLOWED");
  const allowed = counters();
  assert.equal(allowed.supplier.length, 1);
  assert.equal(allowed.ledger.length, 1);
  assert.equal(allowed.ledger[0]!.status, "settled");
  assert.equal(allowed.ledger[0]!.amount, 14);
  await p.run("enable-policy");
  assert.equal(
    (await catalog()).some((row) => row.id === p.control.modelId),
    false,
  );
  assert.equal(
    ((await completion("OWNED_POLICY_DENIED_AGAIN", 403)).error as Row).code,
    "MODEL_DENIED",
  );
  assert.deepEqual(counters(), allowed);
  const beforeCancel = p.app.services.db.get<Row>(
    "SELECT * FROM policies WHERE id=?",
    policy.id as string,
  );
  await p.run("delete-policy-cancel");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM policies WHERE id=?",
      policy.id as string,
    ),
    beforeCancel,
  );
  assert.equal(
    (await catalog()).some((row) => row.id === p.control.modelId),
    false,
  );
  assert.deepEqual(counters(), allowed);
  await p.run("delete-policy-confirm");
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT * FROM policies WHERE id=?",
      policy.id as string,
    ),
    undefined,
  );
  assert.equal(
    (await catalog()).some((row) => row.id === p.control.modelId),
    true,
  );
  await completion("OWNED_POLICY_RESTORED");
  const final = counters();
  assert.equal(final.supplier.length, 2);
  assert.equal(final.ledger.length, 2);
  assert.ok(
    final.ledger.every((row) => row.status === "settled" && row.amount === 14),
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      p.control.modelId as string,
    ),
    metadata,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/policies", 201, 1],
    ["PATCH", "/policies/:id", 200, 2],
    ["DELETE", "/policies/:id", 204, 1],
  ] as const) {
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      count,
    );
  }
  const audit = p.app.services.db.all<Row>(
    "SELECT action,target,user_id FROM audit WHERE action LIKE 'policy.%'",
  );
  assert.equal(
    audit.filter(
      (row) => row.action === "policy.create" && row.target === policy.id,
    ).length,
    1,
  );
  assert.equal(
    audit.filter(
      (row) => row.action === "policy.toggle" && row.target === policy.id,
    ).length,
    2,
  );
  assert.equal(
    audit.filter(
      (row) => row.action === "policy.delete" && row.target === policy.id,
    ).length,
    1,
  );
  assert.ok(audit.every((row) => row.user_id === p.control.userId));
  p.facts.status = "passed";
  p.facts.policyTransitions = [
    "deny",
    "disabled/allow",
    "deny",
    "deleted/allow",
  ];
  p.facts.deniedRequestsNoModelOrBilling = true;
  p.facts.modelResourceUnchanged = true;
  p.facts.ledger = final.ledger.map(
    ({ status, amount, input_tokens, output_tokens }) => ({
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.policyAudit = audit;
}
