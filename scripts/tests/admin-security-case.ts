import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminSecurityCase(p: AdminUiCasePorts) {
  const db = p.app.services.db;
  const models = db.all<Row>("SELECT * FROM resources ORDER BY id");
  const members = db.all<Row>("SELECT * FROM members ORDER BY user_id");
  const configurations = db.all<Row>(
    "SELECT * FROM configurations ORDER BY kind",
  );
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const initial = counters();
  const original = (await p.api("/api/client/configuration")).security;
  const rule = (high: boolean) => ({
    allowShell: !high,
    allowFilesystem: !high,
    allowNetwork: high,
    allowSandbox: !high,
    dangerousSkills: !high,
    allowedDomains: [],
  });
  p.control.securityLow = rule(false);
  p.control.securityHigh = rule(true);
  await p.saveControl();
  const security = async (expected: unknown) => {
    assert.deepEqual(
      (await p.api("/api/client/configuration")).security,
      expected,
    );
    assert.deepEqual(
      (await p.api(p.prefix + "/permissions/" + p.control.userId)).security,
      expected,
    );
  };
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
  const denied = async (
    baseline: ReturnType<typeof counters>,
    label: string,
  ) => {
    assert.equal(
      ((await completion(label, 403)).error as Row).code,
      "NETWORK_DISABLED",
    );
    assert.deepEqual(counters(), baseline);
  };
  await p.run("security-low");
  await security(rule(false));
  await denied(initial, "OWNED_SECURITY_LOW_DENIED");
  await p.run("security-high");
  await security(rule(true));
  await completion("OWNED_SECURITY_HIGH_ALLOWED");
  const first = counters();
  assert.equal(first.ledger.length, 1);
  await p.run("security-high-disable");
  await security(rule(false));
  await denied(first, "OWNED_SECURITY_DISABLED_HIGH_DENIED");
  await p.run("security-high-enable");
  await security(rule(true));
  await p.run("security-delete-high-cancel");
  await security(rule(true));
  await p.run("security-delete-high");
  await security(rule(false));
  await denied(first, "OWNED_SECURITY_HIGH_DELETED_DENIED");
  await p.run("security-delete-low");
  await security(original);
  await completion("OWNED_SECURITY_DEFAULT_RESTORED");
  const final = counters();
  assert.equal(final.ledger.length, 2);
  assert.equal(final.supplier.length, 2);
  assert.deepEqual(final.ledger[0], first.ledger[0]);
  assert.ok(
    final.ledger.every((r) => r.status === "settled" && r.amount === 14),
  );
  assert.deepEqual(db.all<Row>("SELECT * FROM resources ORDER BY id"), models);
  assert.deepEqual(
    db.all<Row>("SELECT * FROM members ORDER BY user_id"),
    members,
  );
  assert.deepEqual(
    db.all<Row>("SELECT * FROM configurations ORDER BY kind"),
    configurations,
  );
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM policies")!.n, 0);
  const writes = p.traffic.filter(
    (r) =>
      r.source === "browser" &&
      r.method !== "GET" &&
      String(r.route).includes("/policies"),
  );
  assert.deepEqual(
    writes.map((r) => [r.method, r.status]),
    [
      ["POST", 201],
      ["POST", 201],
      ["PATCH", 200],
      ["PATCH", 200],
      ["DELETE", 204],
      ["DELETE", 204],
    ],
  );
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE action='security.policy.create'",
    )!.n,
    2,
  );
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE action='policy.toggle'",
    )!.n,
    2,
  );
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE action='policy.delete'",
    )!.n,
    2,
  );
  p.facts.security = {
    wholePolicyWinner: true,
    priorities: [1, 10],
    modelCalls: 2,
    settledCredit: 28,
    deniedHaveZeroDelta: true,
    resourcesUnchanged: true,
  };
  p.facts.status = "passed";
}
