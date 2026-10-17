import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("real HTTP me exposes only the current membership after organization and department changes", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 17),
    publicUrl: "http://localhost:3000",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const first = await bootstrap(app.services.db, {
    name: "First",
    email: "profile-a@example.test",
    password: "synthetic-profile-password",
  });
  const second = await bootstrap(app.services.db, {
    name: "Second",
    email: "profile-b@example.test",
    password: "synthetic-other-password",
  });
  const db = app.services.db;
  for (const [tenant, name] of [
    [first.tenantId, "部门 A"],
    [second.tenantId, "部门 B"],
  ])
    db.run(
      "INSERT INTO departments(id,tenant_id,name) VALUES(?,?,?)",
      "same-department-id",
      tenant!,
      name!,
    );
  db.run(
    "UPDATE members SET department_id=?,external_id=? WHERE tenant_id=? AND user_id=?",
    "same-department-id",
    "wecom-a",
    first.tenantId,
    first.userId,
  );
  db.run(
    "INSERT INTO members(tenant_id,user_id,role,department_id,seat,external_id) VALUES(?,?,?,?,?,?)",
    second.tenantId,
    first.userId,
    "auditor",
    "same-department-id",
    1,
    "wecom-b",
  );
  const login = await fetch(origin + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "profile-a@example.test",
      password: "synthetic-profile-password",
      tenantId: first.tenantId,
    }),
  });
  assert.equal(login.status, 200);
  const { token } = (await login.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  const me = (await (
    await fetch(origin + "/api/auth/me", { headers })
  ).json()) as Record<string, unknown>;
  assert.deepEqual(me.membership, {
    source: "local",
    externalId: "wecom-a",
    department: { id: "same-department-id", name: "部门 A" },
  });
  const switched = await fetch(origin + "/api/auth/switch", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ tenantId: second.tenantId }),
  });
  assert.equal(switched.status, 200);
  const next = (await switched.json()) as { token: string };
  assert.equal((await fetch(origin + "/api/auth/me", { headers })).status, 401);
  const nextHeaders = { authorization: `Bearer ${next.token}` };
  const current = (await (
    await fetch(
      origin +
        "/api/auth/me?tenantId=" +
        first.tenantId +
        "&userId=" +
        second.userId,
      { headers: nextHeaders },
    )
  ).json()) as Record<string, unknown>;
  assert.equal(current.role, "auditor");
  assert.deepEqual(current.membership, {
    source: "local",
    externalId: "wecom-b",
    department: { id: "same-department-id", name: "部门 B" },
  });
  db.run(
    "UPDATE members SET department_id=NULL WHERE tenant_id=? AND user_id=?",
    second.tenantId,
    first.userId,
  );
  const moved = (await (
    await fetch(origin + "/api/auth/me", { headers: nextHeaders })
  ).json()) as { membership: { department: unknown } };
  assert.equal(moved.membership.department, null);
  await fetch(origin + "/api/auth/logout", {
    method: "POST",
    headers: nextHeaders,
  });
});
