import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminDirectoryCase(p: AdminUiCasePorts) {
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const originalOwner = p.app.services.db.get<Row>(
    "SELECT * FROM members WHERE tenant_id=? AND user_id=?",
    p.control.tenantId as string,
    p.control.userId as string,
  );
  await p.run("create-department");
  const departments = await p.api(p.prefix + "/departments");
  assert.ok(Array.isArray(departments));
  assert.equal(departments.length, 1);
  const department = (departments as Row[])[0]!;
  assert.equal(department.parent_id, null);
  p.control.departmentId = department.id;
  await p.saveControl();
  await p.run("create-member");
  const members = await p.api(p.prefix + "/members");
  const member = (members.items as Row[]).find(
    (row) => row.email === "owned-ui-member@example.test",
  )!;
  assert.ok(member);
  assert.equal(member.seat, 0);
  assert.equal(member.role, "member");
  assert.equal(member.department_id, department.id);
  const login = async () =>
    String(
      (
        await p.api("/api/auth/login", "POST", {
          email: "owned-ui-member@example.test",
          password: p.control.password,
        })
      ).token,
    );
  let token = await login();
  const memberApi = async (
    path: string,
    method = "GET",
    data?: Row,
    expected = 200,
  ): Promise<Row> => {
    const response = await fetch(String(p.control.origin) + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-owned-test-source": "controller",
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(response.status, expected, "controlled member API status");
    return (await response.json()) as Row;
  };
  const completion = (label: string, expected = 200) =>
    memberApi(
      "/v1/chat/completions",
      "POST",
      {
        model: p.control.modelId,
        messages: [{ role: "user", content: label }],
        max_tokens: 32,
      },
      expected,
    );
  const baseline = counters();
  assert.equal(
    ((await completion("OWNED_SEAT_INITIAL", 403)).error as Row).code,
    "NO_SEAT",
  );
  assert.deepEqual(counters(), baseline);
  await p.run("allocate-seat");
  assert.equal((await memberApi("/api/auth/me")).seat, true);
  await completion("OWNED_SEAT_ALLOCATED");
  const first = counters();
  assert.equal(first.ledger.length, 1);
  assert.equal(first.ledger[0]!.user_id, member.id);
  assert.equal(first.ledger[0]!.department_id, department.id);
  assert.equal(first.ledger[0]!.status, "settled");
  assert.equal(first.ledger[0]!.amount, 14);
  await p.run("revoke-seat");
  assert.equal(
    ((await completion("OWNED_SEAT_REVOKED", 403)).error as Row).code,
    "NO_SEAT",
  );
  assert.deepEqual(counters(), first);
  await p.run("disable-member");
  assert.equal(
    ((await memberApi("/api/auth/me", "GET", undefined, 401)).error as Row)
      .code,
    "SESSION_EXPIRED",
  );
  await p.run("reactivate-member");
  assert.equal(
    ((await memberApi("/api/auth/me", "GET", undefined, 401)).error as Row)
      .code,
    "SESSION_EXPIRED",
  );
  token = await login();
  await completion("OWNED_MEMBER_REACTIVATED");
  const second = counters();
  assert.equal(second.supplier.length, 2);
  assert.equal(second.ledger.length, 2);
  assert.ok(
    second.ledger.every(
      (row) =>
        row.user_id === member.id &&
        row.department_id === department.id &&
        row.status === "settled" &&
        row.amount === 14,
    ),
  );
  await p.run("rename-department");
  const projection = (await memberApi("/api/auth/me")).membership as {
    department: { id: string; name: string } | null;
  };
  assert.deepEqual(projection.department, {
    id: department.id,
    name: "Owned UI department revised",
  });
  const renamed = p.app.services.db.get<Row>(
    "SELECT * FROM departments WHERE id=?",
    department.id as string,
  );
  await p.run("delete-in-use-department");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM departments WHERE id=?",
      department.id as string,
    ),
    renamed,
  );
  assert.deepEqual(counters(), second);
  await p.run("clear-member-department");
  assert.equal(
    ((await memberApi("/api/auth/me")).membership as Row).department,
    null,
  );
  await p.run("delete-empty-department");
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT * FROM departments WHERE id=?",
      department.id as string,
    ),
    undefined,
  );
  assert.deepEqual(counters(), second);
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM members WHERE tenant_id=? AND user_id=?",
      p.control.tenantId as string,
      p.control.userId as string,
    ),
    originalOwner,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/departments", 201, 1],
    ["PATCH", "/departments/:id", 200, 1],
    ["DELETE", "/departments/:id", 409, 1],
    ["DELETE", "/departments/:id", 204, 1],
    ["POST", "/members", 201, 1],
    ["PATCH", "/members/:id", 200, 5],
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
  p.facts.status = "passed";
  p.facts.memberSeatStatusLifecycle = true;
  p.facts.retiredSessionNeverReactivated = true;
  p.facts.departmentProjectionAndDeleteGuard = true;
  p.facts.originalOwnerUnchanged = true;
  p.facts.ledger = second.ledger.map(
    ({
      user_id,
      department_id,
      status,
      amount,
      input_tokens,
      output_tokens,
    }) => ({
      user_id,
      department_id,
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.supplier = second.supplier;
}
