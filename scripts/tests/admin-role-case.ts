import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminRoleCase(p: AdminUiCasePorts) {
  const subject = await p.api(
    p.prefix + "/members",
    "POST",
    {
      name: "Owned role subject",
      email: "owned-role-subject@example.test",
      password: p.control.password,
      role: "admin",
      seat: true,
    },
    201,
  );
  p.control.email = "owned-role-subject@example.test";
  p.control.roleSubjectId = subject.id;
  await p.saveControl();
  const db = p.app.services.db;
  const resource = db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    p.control.modelId as string,
  );
  const tenant = db.get<Row>(
    "SELECT * FROM tenants WHERE id=?",
    p.control.tenantId as string,
  );
  const credentials = db.all<Row>("SELECT * FROM credentials ORDER BY id");
  await p.run("admin-open-stale-editor");
  const sessions = () =>
    db.all<Row>(
      "SELECT * FROM sessions WHERE user_id=? ORDER BY hash",
      subject.id as string,
    );
  const session = sessions();
  assert.equal(session.length, 1);
  const updateRole = (role: string) =>
    p.api(p.prefix + "/members/" + subject.id, "PATCH", { role });
  await updateRole("auditor");
  await p.run("reject-stale-admin-write");
  assert.deepEqual(
    db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      p.control.modelId as string,
    ),
    resource,
  );
  assert.deepEqual(sessions(), session);
  await p.run("auditor-readonly-controls");
  await p.run("auditor-protected-enterprise-and-vault");
  assert.deepEqual(
    db.get<Row>(
      "SELECT * FROM tenants WHERE id=?",
      p.control.tenantId as string,
    ),
    tenant,
  );
  assert.deepEqual(
    db.all<Row>("SELECT * FROM credentials ORDER BY id"),
    credentials,
  );
  assert.deepEqual(sessions(), session);
  await updateRole("operator");
  await p.run("operator-permitted-category-write");
  const category = db.get<Row>(
    "SELECT * FROM categories WHERE tenant_id=? AND name=?",
    p.control.tenantId as string,
    "Owned operator category",
  );
  assert.ok(category);
  const audit = db
    .all<Row>(
      "SELECT action,target FROM audit WHERE user_id=? ORDER BY created_at,id",
      subject.id as string,
    )
    .map(({ action, target }) => ({ action, target }));
  p.facts.subjectAudits = audit;
  assert.deepEqual(audit, [
    { action: "identity.login", target: null },
    { action: "asset.category.create", target: category.id },
  ]);
  await updateRole("member");
  const managementBefore = p.traffic.filter(
    (row) =>
      row.source === "browser" && String(row.route).startsWith("/api/tenants/"),
  ).length;
  await p.run("member-no-admin-consumer");
  assert.equal(
    p.traffic.filter(
      (row) =>
        row.source === "browser" &&
        String(row.route).startsWith("/api/tenants/"),
    ).length,
    managementBefore,
  );
  assert.deepEqual(sessions(), session);
  assert.equal(p.supplier.length, 0);
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status] of [
    ["PUT", "/models/:id", 403],
    ["PATCH", "", 403],
    ["POST", "/categories", 201],
  ] as const)
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      1,
    );
  const vaultReads = browser.filter(
    (row) =>
      row.method === "GET" &&
      row.route === "/api/tenants/:tenantId/credentials",
  );
  assert.ok(vaultReads.length > 0);
  assert.ok(vaultReads.every((row) => row.status === 403));
  p.facts.credentialReadStatuses = vaultReads.map((row) => row.status);
  p.facts.status = "passed";
  p.facts.originalSessionSurvivesRoleChanges = true;
  p.facts.staleWriteRejectedWithoutMutation = true;
  p.facts.auditorReadAndVaultBoundary = true;
  p.facts.operatorWriteAttributedToSubject = true;
  p.facts.memberDoesNotMountManagementConsumer = true;
  p.facts.noSupplierOrMetering = true;
}
