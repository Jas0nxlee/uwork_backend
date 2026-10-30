import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_CAPABILITIES,
  capabilitiesFromRoles,
  hasPermission,
  settingsAccess,
  viewAccess,
  type Capabilities,
} from "../admin/src/permissions.js";

const payload = {
  roles: ["owner", "admin", "operator", "auditor", "member"],
  permissions: {
    owner: ["read", "write", "identity", "vault", "execute"],
    admin: ["read", "write", "identity", "vault", "execute"],
    operator: ["read", "write", "execute"],
    auditor: ["read", "execute"],
    member: ["execute"],
  },
  seatRequired: ["execute"],
  restrictions: {
    "subscription.write": { roles: ["owner"], kind: "session" },
  },
};

const capabilities = (
  role: unknown,
  identity: { kind?: unknown; seat?: unknown } = {},
) =>
  capabilitiesFromRoles(payload, {
    role,
    kind: "session",
    seat: true,
    ...identity,
  });

function expectNoCapabilities(actual: Capabilities) {
  assert.deepEqual(actual, NO_CAPABILITIES);
  assert.deepEqual(Object.values(actual), [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
}

test("能力只能来自服务器声明，缺失或异常时一律拒绝", () => {
  expectNoCapabilities(capabilitiesFromRoles(undefined, { role: "owner" }));
  expectNoCapabilities(capabilitiesFromRoles({}, { role: "owner" }));
  expectNoCapabilities(
    capabilitiesFromRoles({ permissions: {} }, { role: "owner" }),
  );
  expectNoCapabilities(
    capabilitiesFromRoles(
      { permissions: { owner: "read" } },
      { role: "owner" },
    ),
  );
  // 伪造的席位值不算已分配席位：只有严格 true 才解锁 execute。
  const forgedSeat = capabilitiesFromRoles(payload, {
    role: "owner",
    kind: "session",
    seat: "yes",
  });
  assert.equal(forgedSeat.read, true);
  assert.equal(forgedSeat.execute, false);
  expectNoCapabilities(capabilitiesFromRoles(payload, { role: "member" }));
  assert.deepEqual(
    capabilitiesFromRoles(payload, { role: "member", seat: true }),
    { ...NO_CAPABILITIES, execute: true },
  );
});

test("未知角色和未知权限名不会凭角色名自行扩权", () => {
  expectNoCapabilities(capabilitiesFromRoles(payload, { role: "superuser" }));
  expectNoCapabilities(capabilitiesFromRoles(payload, { role: 7 }));
  // 服务器收紧后客户端必须跟随：同名角色不再获得历史权限。
  const tightened = capabilitiesFromRoles(
    { permissions: { operator: ["read", "execute"] } },
    { role: "operator", seat: true },
  );
  assert.equal(tightened.read, true);
  assert.equal(tightened.execute, true);
  assert.equal(tightened.write, false);
  assert.equal(tightened.identity, false);
  assert.equal(tightened.vault, false);
  // 服务器声明里的未知权限名被忽略，不会变成任何客户端能力。
  const noisy = capabilitiesFromRoles(
    { permissions: { admin: ["read", "superuser", "*"] } },
    { role: "admin", seat: true },
  );
  assert.equal(noisy.read, true);
  assert.equal(noisy.write, false);
  assert.equal(noisy.identity, false);
  assert.equal(noisy.vault, false);
  assert.equal(noisy.execute, false);
});

test("席位与交互会话是能力的额外必要条件", () => {
  const unseated = capabilities("owner", { seat: false });
  assert.equal(unseated.read, true);
  assert.equal(unseated.write, true);
  assert.equal(unseated.identity, true);
  assert.equal(unseated.vault, true);
  assert.equal(unseated.execute, false);
  assert.equal(capabilities("owner", { seat: true }).execute, true);
  assert.deepEqual(settingsAccess(capabilities("auditor", { seat: true })), {
    readRoles: true,
    updateEnterprise: false,
    updateRetention: false,
    purgeRetention: false,
    readWecom: false,
    configureWecom: false,
    bindWecomIdentity: false,
    syncWecom: false,
    manageDeviceTokens: true,
    updateSubscription: false,
    updateLimits: false,
    configureDrive: false,
    updateDriveCapacity: false,
  });
});

test("owner 交互会话才具备订阅写入，终端凭据不继承", () => {
  assert.equal(capabilities("owner").subscriptionWrite, true);
  assert.equal(
    capabilities("owner", { kind: "session", seat: true }).subscriptionWrite,
    true,
  );
  assert.equal(
    capabilities("owner", { kind: "device", seat: true }).subscriptionWrite,
    false,
  );
  assert.equal(
    capabilities("owner", { kind: undefined, seat: true }).interactive,
    false,
  );
  assert.equal(
    capabilities("owner", { kind: undefined, seat: true }).subscriptionWrite,
    false,
  );
  assert.equal(capabilities("admin").subscriptionWrite, false);
  // 没有 restrictions 声明时不能凭角色名猜测 owner 专属动作。
  const undeclared = capabilitiesFromRoles(payload.permissions, {
    role: "owner",
    kind: "session",
    seat: true,
  });
  assert.equal(undeclared.subscriptionWrite, false);
  assert.equal(
    capabilitiesFromRoles(
      {
        permissions: payload.permissions,
        restrictions: { "subscription.write": { kind: "session" } },
      },
      { role: "owner", kind: "session", seat: true },
    ).subscriptionWrite,
    true,
  );
});

test("hasPermission 逐项读取能力且不接受未知权限", () => {
  const owner = capabilities("owner");
  for (const permission of [
    "read",
    "write",
    "identity",
    "vault",
    "execute",
  ] as const)
    assert.equal(hasPermission(owner, permission), true);
  assert.equal(hasPermission(owner, "superuser" as never), false);
  assert.equal(hasPermission(NO_CAPABILITIES, "read"), false);
});

test("凭据视图只认 vault，身份操作只认 identity", () => {
  const operator = capabilities("operator");
  const credentials = viewAccess("credentials", operator);
  assert.equal(
    credentials.read,
    false,
    "operator 读凭据列表必然 403，入口不可见",
  );
  const vault = viewAccess("credentials", capabilities("admin"));
  assert.deepEqual(vault, {
    read: true,
    create: true,
    update: true,
    remove: true,
    execute: false,
    identity: false,
    vault: true,
  });
  const members = viewAccess("members", operator);
  assert.equal(members.read, true);
  assert.equal(members.create, false);
  assert.equal(members.update, false);
  assert.equal(members.remove, false);
  const admin = viewAccess("members", capabilities("admin"));
  assert.equal(admin.create, true);
  assert.equal(admin.update, true);
  assert.equal(admin.remove, true);
  assert.equal(admin.vault, false);
  for (const view of ["policies", "security"]) {
    assert.equal(viewAccess(view, capabilities("admin")).create, true, view);
    assert.equal(
      viewAccess(view, capabilities("operator")).create,
      false,
      view,
    );
  }
});

test("写操作按后端真实权限分派，auditor 不出现必然 403 动作", () => {
  const auditor = capabilities("auditor");
  for (const view of ["models", "assets", "agents", "automations", "datasets"])
    for (const action of ["create", "update", "remove"] as const)
      assert.equal(
        viewAccess(view, auditor)[action],
        false,
        `${view}.${action}`,
      );
  assert.equal(viewAccess("agents", auditor).execute, true);
  assert.equal(viewAccess("runtimes", auditor).execute, true);
  assert.equal(viewAccess("credentials", auditor).read, false);

  const owner = capabilities("owner");
  assert.equal(viewAccess("models", owner).create, true);
  assert.equal(viewAccess("models", owner).execute, true);
  const withoutVault = capabilitiesFromRoles(
    { permissions: { operator: ["read", "write", "execute"] } },
    { role: "operator", seat: true },
  );
  assert.equal(
    viewAccess("models", withoutVault).create,
    false,
    "POST /models 需要 vault，缺 vault 时不能显示新建",
  );
  assert.equal(viewAccess("models", withoutVault).update, true);
  assert.equal(
    viewAccess(
      "runtimes",
      capabilitiesFromRoles(payload.permissions, {
        role: "auditor",
        seat: false,
      }),
    ).execute,
    false,
    "无席位时执行代码必然 403",
  );
});

test("Settings 逐操作区分 read/write/identity/vault 与 owner 会话", () => {
  const none = settingsAccess(NO_CAPABILITIES);
  assert.deepEqual(Object.values(none), new Array(13).fill(false));
  const owner = settingsAccess(capabilities("owner"));
  assert.deepEqual(owner, {
    readRoles: true,
    updateEnterprise: true,
    updateRetention: true,
    purgeRetention: true,
    readWecom: true,
    configureWecom: true,
    bindWecomIdentity: true,
    syncWecom: true,
    manageDeviceTokens: true,
    updateSubscription: true,
    updateLimits: true,
    configureDrive: true,
    updateDriveCapacity: true,
  });
  const readOnly = settingsAccess(capabilities("auditor"));
  assert.equal(readOnly.readRoles, true);
  assert.equal(readOnly.updateEnterprise, false);
  assert.equal(readOnly.readWecom, false, "GET /wecom 需要 identity");
  const operator = settingsAccess(capabilities("operator"));
  assert.equal(operator.readRoles, true);
  assert.equal(operator.updateLimits, false, "限量写入需要 identity");
  assert.equal(operator.configureWecom, false, "企微配置需要 vault");
  assert.equal(operator.updateSubscription, false, "订阅仅 owner 交互会话");
  assert.equal(operator.manageDeviceTokens, true);
  const deviceOwner = settingsAccess(
    capabilities("owner", { kind: "device", seat: true }),
  );
  assert.equal(deviceOwner.manageDeviceTokens, false);
  assert.equal(deviceOwner.updateSubscription, false);
  assert.equal(deviceOwner.configureWecom, true);
});
