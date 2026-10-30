import type { Row } from "./api.js";
import type { Capabilities } from "./permissions.js";

/** 与 permissions.ts 的 ViewAccess 结构一致；Collection 只消费 viewAccess 的结果。 */
export interface CollectionAccess {
  read: boolean;
  create: boolean;
  update: boolean;
  remove: boolean;
  execute: boolean;
  identity: boolean;
  vault: boolean;
}

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface RequestSpec {
  url: string;
  method: RequestMethod;
  body?: unknown;
}
export type Requester = (
  path: string,
  method?: string,
  data?: unknown,
) => Promise<unknown>;

export interface VersionEntry {
  version: number;
  approved: boolean;
  created_at: number;
}

export type VersionMode = "asset" | "agent";

const integerVersion = (value: number) => {
  if (!Number.isInteger(value) || value < 1)
    throw new Error("版本号必须为正整数");
};

/** 只接受后端版本历史响应；approve 标记按真实值归一，不默认通过。 */
export function parseVersions(value: unknown): VersionEntry[] {
  if (!Array.isArray(value)) throw new Error("版本列表格式不正确");
  const versions: VersionEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Row;
    if (
      typeof entry.version !== "number" ||
      !Number.isInteger(entry.version) ||
      entry.version < 1
    )
      continue;
    versions.push({
      version: entry.version,
      approved: entry.approved === true || entry.approved === 1,
      created_at: typeof entry.created_at === "number" ? entry.created_at : 0,
    });
  }
  return versions.sort((left, right) => right.version - left.version);
}

export function versionsUrl(base: string, path: string, id: string) {
  return `${base}${path}/${encodeURIComponent(id)}/versions`;
}

export async function loadVersions(
  request: Requester,
  base: string,
  path: string,
  id: string,
) {
  return parseVersions(await request(versionsUrl(base, path, id)));
}

export function reviewSpec(
  base: string,
  path: string,
  id: string,
  version: number,
  approved: boolean,
): RequestSpec {
  integerVersion(version);
  return {
    url: `${base}${path}/${encodeURIComponent(id)}/review`,
    method: "POST",
    body: { version, approved },
  };
}

export function publishSpec(
  base: string,
  path: string,
  id: string,
  version: number,
): RequestSpec {
  integerVersion(version);
  return {
    url: `${base}${path}/${encodeURIComponent(id)}/publish`,
    method: "POST",
    body: { version },
  };
}

export async function submitVersionAction(
  request: Requester,
  spec: RequestSpec,
) {
  await request(spec.url, spec.method, spec.body);
}

/** 资产有审核环节；智能体后端没有审核，只允许选择已有版本发布。 */
export function versionPolicy(
  mode: VersionMode,
  access: Pick<CollectionAccess, "identity" | "update">,
) {
  return {
    canReview: mode === "asset" && access.identity,
    canPublish: access.update,
  };
}

export function publishProblem(
  selected: VersionEntry | null,
  canPublish = true,
): string {
  if (!canPublish) return "当前角色没有发布权限";
  if (!selected) return "请选择要发布的版本";
  if (!selected.approved) return "该版本尚未审核通过，不能发布";
  return "";
}

export interface ReconcileInput {
  amount: number;
  evidenceReference: string;
}

/** 对齐 PUT /usage/:id/reconcile 的 strict schema 与 uncertain 前提。 */
export function reconcileInput(
  entry: Row,
  amount: number,
  evidenceReference: string,
): ReconcileInput {
  if (entry.status !== "uncertain") throw new Error("仅待核实账目可以人工核实");
  const reserved = Number(entry.reserved);
  if (!Number.isInteger(reserved) || reserved < 0)
    throw new Error("账目预留额度无效");
  if (!Number.isInteger(amount)) throw new Error("实际成本必须是整数 Credit");
  if (amount < 0 || amount > reserved)
    throw new Error(`实际成本需为 0 到 ${reserved} 的整数 Credit`);
  const evidence = String(evidenceReference ?? "").trim();
  if (!evidence) throw new Error("请填写核实证据引用");
  if (evidence.length > 200) throw new Error("核实证据引用不能超过 200 个字符");
  return { amount, evidenceReference: evidence };
}

export function reconcileSpec(base: string, ledgerId: string): RequestSpec {
  if (!ledgerId) throw new Error("账目 ID 缺失");
  return {
    url: `${base}/usage/${encodeURIComponent(ledgerId)}/reconcile`,
    method: "PUT",
    body: undefined,
  };
}

export async function submitReconcile(
  request: Requester,
  base: string,
  entry: Row,
  amount: number,
  evidenceReference: string,
) {
  const input = reconcileInput(entry, amount, evidenceReference);
  const spec = reconcileSpec(base, String(entry.id ?? ""));
  await request(spec.url, spec.method, input);
}

export async function loadRuntimeCapabilities(
  request: Requester,
  base: string,
) {
  const [runtime, sandbox] = await Promise.all([
    request(`${base}/runtime`),
    request(`${base}/runtimes/capability`),
  ]);
  return { runtime: runtime as Row, sandbox: sandbox as Row };
}

export async function loadMemberPermissions(
  request: Requester,
  base: string,
  userId: string,
) {
  return (await request(
    `${base}/permissions/${encodeURIComponent(userId)}`,
  )) as Row;
}

export type RowActionId =
  | "detail"
  | "edit"
  | "probe"
  | "versions"
  | "run"
  | "executions"
  | "stopRuntime"
  | "cancelRun"
  | "toggle"
  | "delete"
  | "wecom"
  | "permissions"
  | "reconcile";

export interface RowAction {
  id: RowActionId;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
}

const EDITABLE = [
  "models",
  "assets",
  "agents",
  "members",
  "departments",
  "credentials",
  "runtimes",
];
const UNDELETABLE = [
  "members",
  "runs",
  "evaluations",
  "sandbox-executions",
  "usage",
  "usage-aggregates",
  "traces",
  "audit",
  "client-events",
  "sessions",
  "deliveries",
];

/**
 * 行内操作按后端逐端点权限生成；没有 read 的视图不产生任何操作。
 * access 由 permissions.ts 的 viewAccess 计算，capabilities 用于视图规则
 * 未覆盖的 identity 动作（成员企微绑定、用量对账）。
 */
export function rowActions(
  viewId: string,
  row: Row,
  access: CollectionAccess,
  capabilities: Pick<Capabilities, "identity">,
): RowAction[] {
  if (!access.read) return [];
  const actions: RowAction[] = [{ id: "detail", label: "详情" }];
  if (viewId === "members") {
    if (capabilities.identity === true)
      actions.push({ id: "wecom", label: "绑定企微身份" });
    actions.push({ id: "permissions", label: "有效权限" });
  }
  if (access.update === true && EDITABLE.includes(viewId)) {
    const connector =
      viewId === "assets" &&
      (row.data as Row | undefined)?.kind === "connector";
    // 连接器更新需要 vault；无 vault 时连编辑入口也不展示。
    if (!connector || access.vault === true)
      actions.push({ id: "edit", label: "编辑" });
  }
  if (viewId === "models" && access.execute === true)
    actions.push({ id: "probe", label: "测试连接" });
  if (viewId === "assets" || viewId === "agents")
    actions.push({ id: "versions", label: "版本与发布" });
  if (viewId === "agents" && access.execute === true)
    actions.push({ id: "run", label: "执行" });
  if (viewId === "runtimes") {
    if (access.execute === true) {
      const ready = row.status === "ready";
      actions.push({
        id: "executions",
        label: "执行代码",
        disabled: !ready,
        reason: ready ? undefined : "Runtime 未就绪",
      });
    }
    // 停止 Runtime 是 write，不是 execute；auditor 有 execute 但无 write。
    if (
      access.update === true &&
      ["ready", "busy"].includes(String(row.status))
    )
      actions.push({ id: "stopRuntime", label: "停止 Runtime", danger: true });
  }
  if (
    ["runs", "evaluations", "sandbox-executions"].includes(viewId) &&
    access.update === true &&
    ["running", "queued"].includes(String(row.status))
  )
    actions.push({ id: "cancelRun", label: "取消执行", danger: true });
  if (
    ["policies", "security", "automations"].includes(viewId) &&
    access.update === true
  )
    actions.push({ id: "toggle", label: row.enabled ? "停用" : "启用" });
  if (
    viewId === "usage" &&
    row.status === "uncertain" &&
    capabilities.identity === true
  )
    actions.push({ id: "reconcile", label: "人工核实" });
  if (access.remove === true && !UNDELETABLE.includes(viewId))
    actions.push({ id: "delete", label: "停用或删除", danger: true });
  return actions;
}
