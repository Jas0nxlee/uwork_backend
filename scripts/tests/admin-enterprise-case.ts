import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminEnterpriseCase(p: AdminUiCasePorts) {
  const member = p.app.services.db.get<Row>(
    "SELECT * FROM members WHERE tenant_id=? AND user_id=?",
    p.control.tenantId as string,
    p.control.userId as string,
  );
  const renamed = (await p.run("rename-enterprise")) as Row;
  assert.equal(renamed.enterpriseLabel, "Owned enterprise revised");
  assert.equal(renamed.selectedTenantId, p.control.tenantId);
  assert.equal(renamed.profileName, "Owned run UI");
  const server = await p.api(p.prefix);
  assert.equal(server.name, "Owned enterprise revised");
  assert.equal(
    JSON.parse(String(server.settings)).contact,
    "owned-contact@example.test",
  );
  const me = await p.api("/api/auth/me");
  assert.equal((me.tenant as Row).name, "Owned enterprise revised");
  p.facts.enterpriseHeaderBeforeReload = {
    page: renamed.enterpriseLabel,
    header: renamed.selectedTenantName,
    backend: (me.tenant as Row).name,
  };
  assert.equal(
    renamed.selectedTenantName,
    "Owned enterprise revised",
    "current organization label must follow the saved enterprise metadata",
  );
  await p.run("enterprise-reload-roles");
  await p.run("set-retention");
  const retention = await p.api(p.prefix + "/retention");
  assert.equal(retention.configured, true);
  assert.equal(retention.days, 7);
  const settings = JSON.parse(String((await p.api(p.prefix)).settings));
  assert.equal(settings.contact, "owned-contact@example.test");
  assert.equal(settings.retentionDays, 7);
  const audits = p.app.services.db.all<Row>("SELECT * FROM audit ORDER BY id");
  await p.run("purge-recent-only");
  const after = p.app.services.db.all<Row>("SELECT * FROM audit ORDER BY id");
  for (const row of audits)
    assert.deepEqual(
      after.find((value) => value.id === row.id),
      row,
    );
  assert.equal(
    after.filter((row) => row.action === "telemetry.retention.purge").length,
    1,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM members WHERE tenant_id=? AND user_id=?",
      p.control.tenantId as string,
      p.control.userId as string,
    ),
    member,
  );
  assert.equal(p.supplier.length, 0);
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["PATCH", "", 200, 1],
    ["GET", "/roles", 200, 1],
    ["PUT", "/retention", 200, 1],
    ["POST", "/retention/purge", 200, 1],
  ] as const)
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      count,
    );
  p.facts.status = "passed";
  p.facts.enterpriseLabelsConsistent = true;
  p.facts.rolesAndMemberUnchanged = true;
  p.facts.retentionAndContactPreserved = true;
  p.facts.recentAuditsRetained = true;
  p.facts.noModelOrMetering = true;
}
