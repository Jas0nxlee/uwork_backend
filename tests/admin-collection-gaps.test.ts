import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import type { Row } from "../admin/src/api.js";
import type { Capabilities } from "../admin/src/permissions.js";
import { NO_CAPABILITIES, viewAccess } from "../admin/src/permissions.js";
import {
  loadMemberPermissions,
  loadRuntimeCapabilities,
  loadVersions,
  parseVersions,
  publishProblem,
  publishSpec,
  reconcileInput,
  reconcileSpec,
  reviewSpec,
  rowActions,
  submitReconcile,
  submitVersionAction,
  versionPolicy,
  type CollectionAccess,
  type VersionEntry,
} from "../admin/src/collectionActions.js";

const access = (
  overrides: Partial<CollectionAccess> = {},
): CollectionAccess => ({
  read: true,
  create: true,
  update: true,
  remove: true,
  execute: true,
  identity: true,
  vault: true,
  ...overrides,
});
const caps = (overrides: Partial<Capabilities> = {}): Capabilities => ({
  read: true,
  write: true,
  identity: true,
  vault: true,
  execute: true,
  interactive: true,
  subscriptionWrite: true,
  ...overrides,
});
const version = (
  value: number,
  approved: boolean,
  created_at = value,
): VersionEntry => ({ version: value, approved, created_at });
const ids = (actions: { id: string }[]) => actions.map((a) => a.id);

let server: ViteDevServer;
before(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../admin", import.meta.url)),
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
});
after(async () => {
  await server.close();
});
async function load(path: string) {
  return (await server.ssrLoadModule(path)) as Record<string, unknown>;
}
function render(component: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(component as never, props as never),
  ) as string;
}
function buttons(html: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (match) => ({
      attrs: match[1]!,
      text: match[2]!.replace(/<[^>]*>/g, "").trim(),
    }),
  );
}

test("version list normalization keeps real approved flags and rejects non-lists", () => {
  assert.deepEqual(
    parseVersions([
      { version: 2, approved: 0, created_at: 200 },
      { version: 1, approved: 1, created_at: 100 },
      { version: "2", approved: 1, created_at: 5 },
      null,
    ]),
    [version(2, false, 200), version(1, true, 100)],
  );
  assert.throws(() => parseVersions({ items: [] }), /版本列表/);
});

test("review requests carry the explicit decision instead of a fixed approval", () => {
  assert.deepEqual(reviewSpec("/api/tenants/t1", "/assets", "a1", 2, true), {
    url: "/api/tenants/t1/assets/a1/review",
    method: "POST",
    body: { version: 2, approved: true },
  });
  assert.deepEqual(
    reviewSpec("/api/tenants/t1", "/assets", "a1", 2, false).body,
    { version: 2, approved: false },
  );
});

test("publish requests bind the selected version only", () => {
  assert.deepEqual(publishSpec("/api/tenants/t1", "/assets", "a1", 3), {
    url: "/api/tenants/t1/assets/a1/publish",
    method: "POST",
    body: { version: 3 },
  });
  assert.deepEqual(publishSpec("/api/tenants/t1", "/agents", "g1", 4).body, {
    version: 4,
  });
});

test("agents publish without any review gate while assets review requires identity", () => {
  assert.deepEqual(versionPolicy("asset", { identity: true, update: true }), {
    canReview: true,
    canPublish: true,
  });
  assert.deepEqual(versionPolicy("asset", { identity: false, update: true }), {
    canReview: false,
    canPublish: true,
  });
  assert.deepEqual(versionPolicy("agent", { identity: true, update: true }), {
    canReview: false,
    canPublish: true,
  });
  assert.deepEqual(versionPolicy("agent", { identity: true, update: false }), {
    canReview: false,
    canPublish: false,
  });
});

test("publish stays blocked until a real approved version is selected", () => {
  assert.match(publishProblem(null), /选择/);
  assert.match(publishProblem(version(2, false)), /审核/);
  assert.equal(publishProblem(version(2, true)), "");
});

test("reconcile enforces the backend schema and the uncertain window", async () => {
  const entry: Row = {
    id: "l1",
    status: "uncertain",
    reserved: 900,
    amount: 0,
  };
  assert.deepEqual(reconcileInput(entry, 120, "  upstream-invoice-1  "), {
    amount: 120,
    evidenceReference: "upstream-invoice-1",
  });
  assert.throws(() => reconcileInput(entry, 901, "evidence"), /0 到 900/);
  assert.throws(() => reconcileInput(entry, -1, "evidence"), /0 到 900/);
  assert.throws(() => reconcileInput(entry, 1.5, "evidence"), /整数/);
  assert.throws(() => reconcileInput(entry, 120, "   "), /证据/);
  assert.throws(() => reconcileInput(entry, 120, "x".repeat(201)), /200/);
  assert.throws(
    () => reconcileInput({ ...entry, status: "settled" }, 120, "evidence"),
    /待核实/,
  );
  assert.deepEqual(reconcileSpec("/api/tenants/t1", "l/1"), {
    url: "/api/tenants/t1/usage/l%2F1/reconcile",
    method: "PUT",
    body: undefined,
  });
});

test("reconcile submission sends exactly the schema fields and never fires invalid input", async () => {
  const calls: [string, string | undefined, unknown][] = [];
  const request = async (path: string, method?: string, data?: unknown) => {
    calls.push([path, method, data]);
    return undefined;
  };
  await submitReconcile(
    request,
    "/api/tenants/t1",
    { id: "l1", status: "uncertain", reserved: 900 } as Row,
    120,
    "evidence-1",
  );
  assert.deepEqual(calls, [
    [
      "/api/tenants/t1/usage/l1/reconcile",
      "PUT",
      { amount: 120, evidenceReference: "evidence-1" },
    ],
  ]);
  await assert.rejects(
    submitReconcile(
      request,
      "/api/tenants/t1",
      { id: "l2", status: "settled", reserved: 900 } as Row,
      120,
      "evidence-2",
    ),
    /待核实/,
  );
  assert.equal(calls.length, 1);
});

test("version loading and submission use the real endpoint for assets and agents", async () => {
  const seen: string[] = [];
  const request = async (path: string, method?: string) => {
    seen.push(`${method ?? "GET"} ${path}`);
    return [{ version: 1, approved: 1, created_at: 5 }];
  };
  assert.deepEqual(
    await loadVersions(request, "/api/tenants/t1", "/assets", "a1"),
    [version(1, true, 5)],
  );
  assert.deepEqual(
    await loadVersions(request, "/api/tenants/t1", "/agents", "g1"),
    [version(1, true, 5)],
  );
  assert.deepEqual(seen, [
    "GET /api/tenants/t1/assets/a1/versions",
    "GET /api/tenants/t1/agents/g1/versions",
  ]);
  const writes: [string, string | undefined, unknown][] = [];
  await submitVersionAction(
    async (path, method, data) => {
      writes.push([path, method, data]);
    },
    reviewSpec("/api/tenants/t1", "/assets", "a1", 2, false),
  );
  assert.deepEqual(writes, [
    [
      "/api/tenants/t1/assets/a1/review",
      "POST",
      { version: 2, approved: false },
    ],
  ]);
});

test("row actions follow per-endpoint permissions instead of a coarse write flag", () => {
  const asset: Row = {
    id: "a1",
    data: { kind: "skill" },
    status: "published",
    published_version: 2,
    enabled: true,
  };
  assert.deepEqual(
    ids(rowActions("assets", asset, access({ identity: false }), caps())),
    ["detail", "edit", "versions", "delete"],
  );
  assert.deepEqual(
    ids(
      rowActions(
        "assets",
        asset,
        access({
          create: false,
          update: false,
          remove: false,
          execute: false,
          identity: false,
          vault: false,
        }),
        caps(),
      ),
    ),
    ["detail", "versions"],
  );
  const connector: Row = { ...asset, data: { kind: "connector" } };
  assert.ok(
    !ids(
      rowActions(
        "assets",
        connector,
        access({ vault: false }),
        caps({ vault: false }),
      ),
    ).includes("edit"),
  );
  assert.ok(
    ids(
      rowActions("assets", connector, viewAccess("assets", caps()), caps()),
    ).includes("edit"),
  );

  const agent: Row = { id: "g1", status: "published", published_version: 1 };
  const agentActions = rowActions("agents", agent, access(), caps());
  assert.ok(agentActions.some((a) => a.id === "versions"));
  assert.ok(!(ids(agentActions) as string[]).includes("review"));
  assert.ok(
    ids(
      rowActions("agents", agent, access({ execute: false }), caps()),
    ).includes("versions"),
  );
  assert.ok(
    !ids(
      rowActions("agents", agent, access({ execute: false }), caps()),
    ).includes("run"),
  );

  const uncertain: Row = { id: "l1", status: "uncertain", reserved: 900 };
  assert.ok(
    ids(
      rowActions(
        "usage",
        uncertain,
        access({
          update: false,
          create: false,
          remove: false,
          identity: false,
          execute: false,
        }),
        caps(),
      ),
    ).includes("reconcile"),
  );
  assert.ok(
    !ids(
      rowActions("usage", uncertain, access(), caps({ identity: false })),
    ).includes("reconcile"),
  );
  assert.ok(
    !ids(
      rowActions("usage", { id: "l2", status: "settled" }, access(), caps()),
    ).includes("reconcile"),
  );

  assert.deepEqual(
    ids(
      rowActions("credentials", { id: "c1" }, access({ read: false }), caps()),
    ),
    [],
  );
  const credentialActions = ids(
    rowActions("credentials", { id: "c1" }, access(), caps()),
  );
  assert.deepEqual(credentialActions, ["detail", "edit", "delete"]);

  const run: Row = { id: "r1", status: "running" };
  assert.ok(
    ids(rowActions("runs", run, access(), caps())).includes("cancelRun"),
  );
  assert.ok(
    !ids(rowActions("runs", run, access({ update: false }), caps())).includes(
      "cancelRun",
    ),
  );
  assert.ok(
    ids(rowActions("sandbox-executions", run, access(), caps())).includes(
      "cancelRun",
    ),
  );

  const runtime: Row = { id: "rt1", status: "ready" };
  const runtimeActions = rowActions("runtimes", runtime, access(), caps());
  assert.ok(ids(runtimeActions).includes("executions"));
  assert.ok(ids(runtimeActions).includes("stopRuntime"));
  assert.ok(
    !ids(
      rowActions("runtimes", runtime, access({ execute: false }), caps()),
    ).includes("executions"),
  );
  assert.ok(
    !ids(
      rowActions("runtimes", runtime, access({ update: false }), caps()),
    ).includes("stopRuntime"),
  );
  const provisioning = rowActions(
    "runtimes",
    { id: "rt2", status: "provisioning" },
    access(),
    caps(),
  );
  assert.equal(provisioning.find((a) => a.id === "executions")?.disabled, true);

  const member: Row = { id: "u1", name: "Member" };
  assert.deepEqual(
    ids(
      rowActions(
        "members",
        member,
        viewAccess("members", caps({ identity: false })),
        caps({ identity: false }),
      ),
    ),
    ["detail", "permissions"],
  );
  assert.ok(
    ids(
      rowActions("members", member, viewAccess("members", caps()), caps()),
    ).includes("wecom"),
  );
  assert.ok(
    ids(rowActions("models", { id: "m1" }, access(), caps())).includes("probe"),
  );
  assert.ok(
    !ids(
      rowActions("models", { id: "m1" }, access({ execute: false }), caps()),
    ).includes("probe"),
  );
  const policy: Row = { id: "p1", enabled: true };
  assert.equal(
    rowActions("policies", policy, access(), caps()).find(
      (a) => a.id === "toggle",
    )?.label,
    "停用",
  );
  assert.ok(
    !ids(
      rowActions("policies", policy, access({ update: false }), caps()),
    ).includes("toggle"),
  );
});

test("capability and permission loaders hit the real read endpoints", async () => {
  const calls: string[] = [];
  const merged = await loadRuntimeCapabilities(async (path, method) => {
    calls.push(`${method ?? "GET"} ${path}`);
    return path.endsWith("/runtimes/capability")
      ? { available: false, image: "not-configured" }
      : { engine: "model-and-connectors" };
  }, "/api/tenants/t1");
  assert.deepEqual(calls.sort(), [
    "GET /api/tenants/t1/runtime",
    "GET /api/tenants/t1/runtimes/capability",
  ]);
  assert.deepEqual(merged, {
    runtime: { engine: "model-and-connectors" },
    sandbox: { available: false, image: "not-configured" },
  });
  const permissions = await loadMemberPermissions(
    async (path) => {
      calls.push(`GET ${path}`);
      return { status: "active", seat: true, resources: [], security: {} };
    },
    "/api/tenants/t1",
    "u/1",
  );
  assert.equal(permissions.status, "active");
  assert.ok(calls.includes("GET /api/tenants/t1/permissions/u%2F1"));
});

test("version list rendering disables publish for unapproved or unselected versions", async () => {
  const { VersionList } = await load("/src/VersionActions.tsx");
  const baseProps = {
    versions: [version(2, false), version(1, true)],
    canReview: true,
    canPublish: true,
    busy: false,
    onSelect() {},
    onReview() {},
    onPublish() {},
  };
  const unapproved = render(VersionList, {
    ...baseProps,
    selected: version(2, false),
  });
  const unapprovedPublish = buttons(unapproved).find((b) => b.text === "发布");
  assert.ok(unapprovedPublish, "发布 button is rendered");
  assert.match(unapprovedPublish.attrs, /\bdisabled\b/);
  assert.match(unapprovedPublish.attrs, /审核通过/);
  assert.match(unapproved, /未通过/);
  assert.match(unapproved, /已通过/);

  const approved = render(VersionList, {
    ...baseProps,
    selected: version(1, true),
  });
  const approvedPublish = buttons(approved).find((b) => b.text === "发布");
  assert.ok(approvedPublish);
  assert.doesNotMatch(approvedPublish.attrs, /\bdisabled\b/);

  const none = render(VersionList, { ...baseProps, selected: null });
  const nonePublish = buttons(none).find((b) => b.text === "发布");
  assert.match(nonePublish!.attrs, /\bdisabled\b/);
  assert.match(nonePublish!.attrs, /选择/);

  const noReview = render(VersionList, {
    ...baseProps,
    selected: version(1, true),
    canReview: false,
  });
  assert.ok(
    !buttons(noReview).some((b) => b.text === "通过" || b.text === "拒绝"),
  );
  const readOnly = render(VersionList, {
    ...baseProps,
    selected: version(1, true),
    canReview: false,
    canPublish: false,
  });
  assert.match(readOnly, /仅可查看/);
  assert.ok(!buttons(readOnly).some((b) => b.text === "发布"));

  const assetReview = render(VersionList, {
    ...baseProps,
    selected: version(1, true),
    mode: "asset",
  });
  assert.ok(buttons(assetReview).some((b) => b.text === "拒绝"));
});

test("ledger reconcile dialog states the uncertain status, reserved cap and confirm action", async () => {
  const { LedgerReconcile } = await load("/src/LedgerReconcile.tsx");
  const html = render(LedgerReconcile, {
    entry: {
      id: "l1",
      user_id: "u1",
      application: "chat",
      model_id: "m1",
      status: "uncertain",
      reserved: 900,
      amount: 0,
    },
    base: "/api/tenants/t1",
    notify() {},
    onClose() {},
    onDone() {},
  });
  assert.match(html, /uncertain/);
  assert.match(html, /待核实/);
  assert.match(html, /900/);
  assert.match(html, /max="900"/);
  assert.match(html, /实际成本/);
  assert.match(html, /证据引用/);
  const confirm = buttons(html).find((b) => b.text === "确认核实并结算");
  assert.ok(confirm, "explicit confirm button");
  assert.match(confirm.attrs, /\bdisabled\b/);

  const settled = render(LedgerReconcile, {
    entry: { id: "l2", status: "settled", reserved: 900 },
    base: "/api/tenants/t1",
    notify() {},
    onClose() {},
    onDone() {},
  });
  assert.match(settled, /仅待核实账目/);
  assert.ok(!buttons(settled).some((b) => b.text === "确认核实并结算"));
});

test("runtime capability panel reports unavailable sandbox without claiming execution", async () => {
  const { RuntimeCapabilityDetails } = await load("/src/CapabilityViews.tsx");
  const runtime = {
    engine: "model-and-connectors",
    arbitraryCodeExecution: false,
    isolatedCodeExecution: false,
    hostCodeExecution: false,
    agentToolExecution: true,
    controlledConnectorExecution: true,
    toolKinds: ["mcp"],
    maxModelTurns: 20,
    maxToolCalls: 20,
    maxConcurrentRuns: 4,
    maxRunTimeMs: 1800000,
  };
  const unavailable = render(RuntimeCapabilityDetails, {
    runtime,
    sandbox: {
      available: false,
      image: "not-configured",
      maxTenantRuntimes: 4,
      maxConcurrentExecutions: 4,
      maxLifetimeMs: 1800000,
      network: false,
      hostMounts: false,
      credentialInjection: false,
    },
  });
  assert.match(unavailable, /model-and-connectors/);
  assert.match(unavailable, /mcp/);
  assert.match(unavailable, /not-configured/);
  assert.match(unavailable, /不可用/);
  assert.ok(!unavailable.includes("隔离代码执行可用"));

  const available = render(RuntimeCapabilityDetails, {
    runtime: {
      ...runtime,
      engine: "model-and-isolated-code",
      arbitraryCodeExecution: true,
      isolatedCodeExecution: true,
      toolKinds: ["execute_javascript", "mcp"],
    },
    sandbox: {
      available: true,
      image: "uwork/sandbox:1",
      maxTenantRuntimes: 4,
      maxConcurrentExecutions: 4,
      maxLifetimeMs: 1800000,
      network: false,
      hostMounts: false,
      credentialInjection: false,
    },
  });
  assert.match(available, /uwork\/sandbox:1/);
  assert.match(available, /execute_javascript/);
  assert.ok(!/不可用/.test(available));
});

test("member permissions panel shows effective resources and empty state", async () => {
  const { MemberPermissionsDetails } = await load("/src/CapabilityViews.tsx");
  const html = render(MemberPermissionsDetails, {
    data: {
      status: "active",
      seat: true,
      resources: [
        { id: "a1", name: "Example Skill", kind: "asset" },
        { id: "m1", name: "Example Model", kind: "model" },
      ],
      security: { allowShell: false, allowSandbox: false },
    },
  });
  assert.match(html, /active/);
  assert.match(html, /Example Skill/);
  assert.match(html, /Example Model/);
  assert.match(html, /allowSandbox/);
  const empty = render(MemberPermissionsDetails, {
    data: { status: "active", seat: false, resources: [], security: {} },
  });
  assert.match(empty, /无可见资源/);
});

test("deliveries and reconcile entries exist in the real catalog", async () => {
  const { views } = (await load("/src/catalog.ts")) as {
    views: {
      id: string;
      path?: string;
      readonly?: boolean;
      columns?: { key: string }[];
    }[];
  };
  const deliveries = views.find((v) => v.id === "deliveries");
  assert.ok(deliveries, "deliveries view exists");
  assert.equal(deliveries.path, "/deliveries");
  assert.deepEqual(
    deliveries.columns?.map((c) => c.key),
    ["id", "run_id", "status", "attempts", "next_at", "error_code"],
  );
  const usage = views.find((v) => v.id === "usage");
  assert.ok(usage?.columns?.some((c) => c.key === "reserved"));
});

test("Collection fails closed without read access and hides writes for read-only roles", async () => {
  const { Collection } = (await load("/src/Collection.tsx")) as {
    Collection: (props: Record<string, unknown>) => unknown;
  };
  const { views } = (await load("/src/catalog.ts")) as {
    views: { id: string; label: string; path?: string }[];
  };
  const view = (id: string) => {
    const found = views.find((candidate) => candidate.id === id);
    assert.ok(found, `view ${id} exists`);
    return found;
  };
  const denied = render(Collection, {
    view: view("credentials"),
    base: "/api/tenants/t1",
    notify() {},
    capabilities: NO_CAPABILITIES,
  });
  assert.match(denied, /没有查看/);
  assert.ok(!denied.includes("<table"));
  assert.ok(!denied.includes("新建"));

  const readOnly = caps({
    write: false,
    identity: false,
    vault: false,
    execute: false,
  });
  const auditor = render(Collection, {
    view: view("assets"),
    base: "/api/tenants/t1",
    notify() {},
    capabilities: readOnly,
  });
  assert.ok(auditor.includes("<table"));
  assert.ok(!buttons(auditor).some((b) => b.text === "新建"));
  assert.match(auditor, /暂无记录/);

  const runtimes = render(Collection, {
    view: view("runtimes"),
    base: "/api/tenants/t1",
    notify() {},
    capabilities: readOnly,
  });
  assert.ok(buttons(runtimes).some((b) => b.text === "运行能力"));

  const deliveries = render(Collection, {
    view: view("deliveries"),
    base: "/api/tenants/t1",
    notify() {},
    capabilities: caps(),
  });
  assert.match(deliveries, /投递 ID/);
  assert.match(deliveries, /尝试次数/);
});
