/**
 * 管理端能力模型。
 *
 * 事实来源是后端 GET /api/tenants/:tenantId/roles 的声明（src/permissions.ts
 * 与 requirePermission 共享同一常量），本模块只做防御式解析，不按角色名推断能力；
 * 解析不出声明时一律回落到 NO_CAPABILITIES，服务器仍是对权限的唯一强制点。
 */
export type Permission = "read" | "write" | "identity" | "vault" | "execute";

const PERMISSION_NAMES: readonly Permission[] = [
  "read",
  "write",
  "identity",
  "vault",
  "execute",
];
const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSION_NAMES);

export interface Capabilities {
  readonly read: boolean;
  readonly write: boolean;
  readonly identity: boolean;
  readonly vault: boolean;
  /** 具备执行能力且已分配席位；未分配席位时后端返回 NO_SEAT。 */
  readonly execute: boolean;
  /** 交互式登录会话（/api/auth/me 的 kind === "session"），终端凭据不继承。 */
  readonly interactive: boolean;
  /** 后端声明为 owner 交互会话专属的订阅维护。 */
  readonly subscriptionWrite: boolean;
}

export const NO_CAPABILITIES: Capabilities = Object.freeze({
  read: false,
  write: false,
  identity: false,
  vault: false,
  execute: false,
  interactive: false,
  subscriptionWrite: false,
});

export interface AdminIdentityFacts {
  role?: unknown;
  kind?: unknown;
  seat?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** 逐项读取能力；未知权限名忽略，未知权限查询一律拒绝。 */
export function hasPermission(
  capabilities: Capabilities,
  permission: Permission,
): boolean {
  return PERMISSION_SET.has(permission) && capabilities[permission] === true;
}

export function capabilitiesFromRoles(
  payload: unknown,
  identity: AdminIdentityFacts,
): Capabilities {
  const declaration = record(payload);
  const role = typeof identity.role === "string" ? identity.role : "";
  const declared = role ? list(record(declaration?.permissions)?.[role]) : null;
  if (!declared) return NO_CAPABILITIES;
  const granted = new Set(
    declared.filter(
      (value): value is Permission =>
        typeof value === "string" && PERMISSION_SET.has(value),
    ),
  );
  const interactive = identity.kind === "session";
  const seat = identity.seat === true;
  // 席位要求未声明时按最严处理：execute 仍要求席位。
  const seatRequired = list(declaration?.seatRequired);
  const executeNeedsSeat =
    seatRequired === null || seatRequired.includes("execute");
  const holds = (permission: Permission) =>
    permission === "execute"
      ? granted.has("execute") && (!executeNeedsSeat || seat)
      : granted.has(permission);
  const capabilities: Capabilities = {
    read: holds("read"),
    write: holds("write"),
    identity: holds("identity"),
    vault: holds("vault"),
    execute: holds("execute"),
    interactive,
    subscriptionWrite: false,
  };
  return {
    ...capabilities,
    subscriptionWrite: restrictionAllows(
      record(declaration?.restrictions)?.["subscription.write"],
      role,
      interactive,
      holds,
    ),
  };
}

function restrictionAllows(
  rule: unknown,
  role: string,
  interactive: boolean,
  holds: (permission: Permission) => boolean,
): boolean {
  const value = record(rule);
  if (!value) return false;
  const roles = list(value.roles);
  if (roles !== null && (!role || !roles.includes(role))) return false;
  if (value.kind !== undefined && value.kind !== "session") return false;
  if (value.kind === "session" && !interactive) return false;
  if (value.permission === undefined) return true;
  return (
    typeof value.permission === "string" &&
    PERMISSION_SET.has(value.permission) &&
    holds(value.permission as Permission)
  );
}

export interface ViewAccess {
  /** 入口可见性：列表/详情 GET 所需能力。 */
  read: boolean;
  create: boolean;
  update: boolean;
  remove: boolean;
  execute: boolean;
  /** 视图内 identity 专属动作（资产审核、策略、身份绑定、用量对账）。 */
  identity: boolean;
  /** 视图内凭据库动作（凭据管理、模型/连接器凭据）。 */
  vault: boolean;
}

interface ViewRule {
  read?: Permission;
  create?: Permission;
  update?: Permission;
  remove?: Permission;
  execute?: Permission;
  identityAction?: boolean;
  vaultAction?: boolean;
}

// 每个视图对应后端路由的实际 requirePermission，界面不能比它更宽。
const VIEW_RULES: Record<string, ViewRule> = {
  credentials: {
    read: "vault",
    create: "vault",
    update: "vault",
    remove: "vault",
    vaultAction: true,
  },
  models: {
    create: "vault",
    update: "write",
    remove: "write",
    execute: "write",
    vaultAction: true,
  },
  assets: {
    create: "write",
    update: "write",
    remove: "write",
    identityAction: true,
    vaultAction: true,
  },
  categories: { create: "write", update: "write", remove: "write" },
  policies: {
    create: "identity",
    update: "identity",
    remove: "identity",
    identityAction: true,
  },
  security: {
    create: "identity",
    update: "identity",
    remove: "identity",
    identityAction: true,
  },
  configuration: {
    create: "identity",
    update: "identity",
    remove: "identity",
    identityAction: true,
  },
  agents: {
    create: "write",
    update: "write",
    remove: "write",
    execute: "execute",
  },
  // 任务取消对他人任务要求 write；自身任务后端放宽，界面按最严展示。
  runs: { update: "write" },
  runtimes: {
    create: "write",
    update: "write",
    remove: "write",
    execute: "execute",
  },
  "sandbox-executions": { update: "write" },
  automations: { create: "write", update: "write", remove: "write" },
  datasets: { create: "write", remove: "write" },
  evaluations: { create: "write", update: "write" },
  members: { create: "identity", update: "identity", remove: "identity" },
  departments: { create: "identity", update: "identity", remove: "identity" },
};

export function viewAccess(
  viewId: string,
  capabilities: Capabilities,
): ViewAccess {
  const rule = VIEW_RULES[viewId] ?? {};
  const allowed = (permission: Permission | undefined) =>
    permission === undefined ? false : hasPermission(capabilities, permission);
  return {
    read: rule.read ? allowed(rule.read) : capabilities.read,
    create: allowed(rule.create),
    update: allowed(rule.update),
    remove: allowed(rule.remove),
    execute: allowed(rule.execute),
    identity: Boolean(rule.identityAction) && capabilities.identity,
    vault: Boolean(rule.vaultAction) && capabilities.vault,
  };
}

export interface SettingsAccess {
  readRoles: boolean;
  updateEnterprise: boolean;
  updateRetention: boolean;
  purgeRetention: boolean;
  readWecom: boolean;
  configureWecom: boolean;
  bindWecomIdentity: boolean;
  syncWecom: boolean;
  manageDeviceTokens: boolean;
  updateSubscription: boolean;
  updateLimits: boolean;
  configureDrive: boolean;
  updateDriveCapacity: boolean;
}

/** Settings 每个操作对应后端真实要求，逐项裁决。 */
export function settingsAccess(capabilities: Capabilities): SettingsAccess {
  const allowed = (permission: Permission) =>
    hasPermission(capabilities, permission);
  return {
    readRoles: allowed("read"),
    updateEnterprise: allowed("identity"),
    updateRetention: allowed("identity"),
    purgeRetention: allowed("identity"),
    readWecom: allowed("identity"),
    configureWecom: allowed("vault"),
    bindWecomIdentity: allowed("identity"),
    syncWecom: allowed("identity"),
    manageDeviceTokens: capabilities.interactive,
    updateSubscription: capabilities.subscriptionWrite,
    updateLimits: allowed("identity"),
    configureDrive: allowed("vault"),
    updateDriveCapacity: allowed("identity"),
  };
}
