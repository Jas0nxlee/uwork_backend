import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminBindingCase(p: AdminUiCasePorts) {
  for (const name of ["A", "B"]) {
    const member = await p.api(
      p.prefix + "/members",
      "POST",
      {
        name: "Owned binding " + name,
        email: "owned-binding-" + name.toLowerCase() + "@example.test",
        password: p.control.password,
        role: "member",
        seat: false,
      },
      201,
    );
    p.control["bindingMember" + name] = member.id;
  }
  await p.saveControl();
  const db = p.app.services.db;
  const users = db.all<Row>("SELECT * FROM users ORDER BY id");
  const members = db.all<Row>("SELECT * FROM members ORDER BY user_id");
  const credential = db.all<Row>("SELECT * FROM credentials ORDER BY id");
  await p.run("binding-configure");
  const configuration = db.all<Row>("SELECT * FROM enterprise_auth");
  assert.equal(configuration.length, 1);
  assert.equal(configuration[0]!.corp_id, "OWNED_BINDING_CORP");
  assert.equal(configuration[0]!.agent_id, "1000001");
  assert.equal(configuration[0]!.credential_id, p.control.credentialId);
  await p.run("binding-corp-change-rejected");
  assert.deepEqual(db.all<Row>("SELECT * FROM enterprise_auth"), configuration);
  const external = (member: string) =>
    db.get<Row>(
      "SELECT external_id FROM members WHERE user_id=? AND tenant_id=?",
      member,
      String(p.control.tenantId),
    )!.external_id;
  await p.run("binding-settings-a");
  assert.equal(external(String(p.control.bindingMemberA)), "OWNED_BINDING_A");
  const afterFirst = db.all<Row>("SELECT * FROM members ORDER BY user_id");
  await p.run("binding-settings-a-repeat");
  assert.deepEqual(
    db.all<Row>("SELECT * FROM members ORDER BY user_id"),
    afterFirst,
  );
  const sessions = db.all<Row>("SELECT * FROM sessions ORDER BY hash");
  await p.run("binding-row-b-conflict");
  assert.deepEqual(
    db.all<Row>("SELECT * FROM members ORDER BY user_id"),
    afterFirst,
  );
  assert.deepEqual(
    db.all<Row>("SELECT * FROM sessions ORDER BY hash"),
    sessions,
  );
  await p.run("binding-row-b-success");
  assert.equal(external(String(p.control.bindingMemberB)), "OWNED_BINDING_B");
  await p.run("binding-row-a-prefill-reload");
  const expected = members.map((row) => ({
    ...row,
    external_id:
      row.user_id === p.control.bindingMemberA
        ? "OWNED_BINDING_A"
        : row.user_id === p.control.bindingMemberB
          ? "OWNED_BINDING_B"
          : row.external_id,
  }));
  assert.deepEqual(
    db
      .all<Row>("SELECT * FROM members ORDER BY user_id")
      .map((row) => ({ ...row })),
    expected,
  );
  assert.deepEqual(db.all<Row>("SELECT * FROM users ORDER BY id"), users);
  assert.deepEqual(
    db.all<Row>("SELECT * FROM credentials ORDER BY id"),
    credential,
  );
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
  assert.equal(p.supplier.length, 0);
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE action='wecom.member.bind'",
    )!.n,
    3,
  );
  const writes = p.traffic.filter(
    (r) =>
      r.source === "browser" &&
      r.method === "PUT" &&
      String(r.route).includes("wecom"),
  );
  assert.deepEqual(
    writes.map((r) => r.status),
    [200, 409, 200, 200, 409, 200],
  );
  p.facts.binding = {
    syntheticOnly: true,
    bothOriginalEntryPoints: true,
    repeatedBindingIdempotent: true,
    conflictPreservesAccounts: true,
    corpImmutable: true,
    roleSeatSourceAndCredentialsUnchanged: true,
    zeroSupplierLedger: true,
  };
  p.facts.status = "passed";
}
