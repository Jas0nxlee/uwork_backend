import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { requirePermission } from "../src/access.js";
import { capabilitiesFromRoles } from "../admin/src/permissions.js";
import {
  ApiError,
  role as roleSchema,
  type Actor,
  type Role,
} from "../src/core.js";
import {
  ADMIN_RESTRICTIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SEAT_REQUIRED,
  type ActionRestriction,
  type Permission,
} from "../src/permissions.js";

function actor(role: Role, seat = true, kind = "session"): Actor {
  return {
    tenantId: "tenant",
    userId: "user",
    role,
    departmentId: null,
    seat,
    sessionHash: "",
    kind,
    scopes: ["execute"],
  };
}

function allowed(role: Role, permission: Permission, seat = true) {
  try {
    requirePermission(actor(role, seat), permission);
    return true;
  } catch (error) {
    assert.ok(error instanceof ApiError, "拒绝必须经过 fail() 的 ApiError");
    return false;
  }
}

// 独立真值表：权限共享声明可以重构，enforcement 的行为不能跟着漂移。
const EXPECTED: Record<Role, Permission[]> = {
  owner: ["read", "write", "identity", "vault", "execute"],
  admin: ["read", "write", "identity", "vault", "execute"],
  operator: ["read", "write", "execute"],
  auditor: ["read", "execute"],
  member: ["execute"],
};

test("requirePermission 的裁决与角色权限声明逐格一致", () => {
  assert.deepEqual(
    Object.keys(ROLE_PERMISSIONS).sort(),
    [...roleSchema.options].sort(),
  );
  for (const role of roleSchema.options) {
    assert.deepEqual(
      [...ROLE_PERMISSIONS[role]].sort(),
      [...EXPECTED[role]].sort(),
      `${role} 的角色声明`,
    );
    for (const permission of PERMISSIONS) {
      const declared = EXPECTED[role].includes(permission);
      assert.equal(
        allowed(role, permission),
        declared,
        `${role} × ${permission} 必须与声明一致`,
      );
    }
  }
});

test("execute 额外要求席位，且执行范围声明由后端给出", () => {
  assert.deepEqual(SEAT_REQUIRED, ["execute"]);
  for (const role of roleSchema.options) {
    if (!EXPECTED[role].includes("execute")) continue;
    assert.equal(allowed(role, "execute", false), false, `${role} 无席位`);
    assert.equal(allowed(role, "execute", true), true, `${role} 有席位`);
  }
});

test("权限清单覆盖全部管理能力，未知角色不获得任何声明", () => {
  assert.deepEqual(PERMISSIONS, [
    "read",
    "write",
    "identity",
    "vault",
    "execute",
  ]);
  for (const permissions of Object.values(ROLE_PERMISSIONS))
    for (const permission of permissions)
      assert.ok(PERMISSIONS.includes(permission));
  assert.equal(
    Object.values<ActionRestriction>(ADMIN_RESTRICTIONS).every(
      (rule) =>
        rule.permission === undefined || PERMISSIONS.includes(rule.permission),
    ),
    true,
  );
});

async function fixture(t: TestContext) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 23),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  t.after(() => app.close());
  const owner = {
    name: "Permission owner",
    email: "permission-owner@example.test",
    password: "Permission-owner-password!",
  };
  const { tenantId } = await bootstrap(app.services.db, owner);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const login = async (email: string, password: string) => {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { token: string }).token;
  };
  const ownerToken = await login(owner.email, owner.password);
  const call = (token: string, path: string, method = "GET", body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const createMember = async (email: string, role: string) => {
    const password = `${role}-permission-password!`;
    const created = await call(
      ownerToken,
      `/api/tenants/${tenantId}/members`,
      "POST",
      {
        email,
        name: `${role} member`,
        password,
        role,
        seat: true,
      },
    );
    assert.equal(created.status, 201, await created.clone().text());
    return login(email, password);
  };
  return { tenantId, ownerToken, createMember, call };
}

test("GET /roles 交付与 enforcement 同源的权限声明，fail-closed 到具体动作", async (t) => {
  const f = await fixture(t);
  const response = await f.call(
    f.ownerToken,
    `/api/tenants/${f.tenantId}/roles`,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const payload = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(payload.roles, [...roleSchema.options]);
  assert.deepEqual(payload.permissions, ROLE_PERMISSIONS);
  assert.deepEqual(payload.seatRequired, SEAT_REQUIRED);
  assert.deepEqual(payload.restrictions, ADMIN_RESTRICTIONS);
});

test("真实 GET /roles 响应可被管理端能力解析器消费", async (t) => {
  const f = await fixture(t);
  const payload = (await (
    await f.call(f.ownerToken, `/api/tenants/${f.tenantId}/roles`)
  ).json()) as unknown;
  assert.deepEqual(
    capabilitiesFromRoles(payload, {
      role: "owner",
      kind: "session",
      seat: true,
    }),
    {
      read: true,
      write: true,
      identity: true,
      vault: true,
      execute: true,
      interactive: true,
      subscriptionWrite: true,
    },
  );
  const auditorToken = await f.createMember(
    "permission-auditor@example.test",
    "auditor",
  );
  const auditorPayload = (await (
    await f.call(auditorToken, `/api/tenants/${f.tenantId}/roles`)
  ).json()) as unknown;
  assert.deepEqual(
    capabilitiesFromRoles(auditorPayload, {
      role: "auditor",
      kind: "session",
      seat: true,
    }),
    {
      read: true,
      write: false,
      identity: false,
      vault: false,
      execute: true,
      interactive: true,
      subscriptionWrite: false,
    },
  );
  // 未分配席位时同一份声明不再给出 execute。
  assert.equal(
    capabilitiesFromRoles(auditorPayload, {
      role: "auditor",
      kind: "session",
      seat: false,
    }).execute,
    false,
  );
});

test("成员读不到权限声明，admin 也拿不到 owner 专属订阅写入", async (t) => {
  const f = await fixture(t);
  const adminToken = await f.createMember(
    "permission-admin@example.test",
    "admin",
  );
  const memberToken = await f.createMember(
    "permission-member@example.test",
    "member",
  );
  const memberRoles = await f.call(
    memberToken,
    `/api/tenants/${f.tenantId}/roles`,
  );
  assert.equal(memberRoles.status, 403);

  const body = {
    seats: 5,
    credits: 1000,
    startsAt: 1,
    endsAt: 2,
    metering: "calendar",
  };
  const asAdmin = await f.call(
    adminToken,
    `/api/tenants/${f.tenantId}/subscription`,
    "PUT",
    body,
  );
  assert.equal(asAdmin.status, 403);
  const asOwner = await f.call(
    f.ownerToken,
    `/api/tenants/${f.tenantId}/subscription`,
    "PUT",
    body,
  );
  assert.equal(asOwner.status, 200, await asOwner.clone().text());
});
