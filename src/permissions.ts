import type { Role } from "./core.js";

/** 管理能力词表；enforcement 与 GET /roles 必须共用同一份声明。 */
export type Permission = "read" | "write" | "identity" | "vault" | "execute";

export const PERMISSIONS: readonly Permission[] = [
  "read",
  "write",
  "identity",
  "vault",
  "execute",
];

/**
 * 角色到能力的唯一真值表。
 * requirePermission 与 GET /roles 都从这里读取，避免界面声明与后端裁决漂移。
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  operator: ["read", "write", "execute"],
  auditor: ["read", "execute"],
  member: ["execute"],
};

/** 除角色外还要求激活席位的能力。 */
export const SEAT_REQUIRED: readonly Permission[] = ["execute"];

export interface ActionRestriction {
  permission?: Permission;
  roles?: readonly Role[];
  kind?: "session";
}

/**
 * 能力名无法表达、但后端确实更严的动作限制。
 * 客户端只能消费这里的声明，不能按角色名自行推断。
 */
export const ADMIN_RESTRICTIONS = {
  "subscription.write": { roles: ["owner"], kind: "session" },
} as const satisfies Record<string, ActionRestriction>;
