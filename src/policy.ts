import { z } from "zod";
import ipaddr from "ipaddr.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, inScope, requirePermission } from "./access.js";
import { audit } from "./identity.js";
import {
  fail,
  id,
  now,
  parseJson,
  scopeSchema,
  text,
  type Actor,
  type Scope,
} from "./core.js";

export const securitySchema = z
  .object({
    allowShell: z.boolean().default(false),
    allowFilesystem: z.boolean().default(false),
    allowNetwork: z.boolean().default(true),
    dangerousSkills: z.boolean().default(false),
    allowedDomains: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z0-9.-]+$/)
          .max(253),
      )
      .max(200)
      .default([]),
  })
  .strict();
const menu = z
  .object({
    id: text,
    name: text,
    nameEn: text,
    enabled: z.boolean(),
    builtin: z.boolean(),
    url: z
      .url()
      .refine((s) => s.startsWith("https://"))
      .optional(),
    icon: z
      .enum(["message", "bot", "library", "globe", "folder"])
      .default("globe"),
  })
  .strict()
  .refine((d) => d.builtin || !!d.url, "自建菜单需要 HTTPS 地址");
const ipRange = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      if (v.includes("/")) ipaddr.parseCIDR(v);
      else ipaddr.parse(v);
      return true;
    } catch {
      return false;
    }
  }, "IP 或 CIDR 格式错误");
export const configurationSchemas = {
  menus: z
    .object({ items: z.array(menu).max(50) })
    .strict()
    .refine(
      (d) =>
        new Set(d.items.map((m) => m.id)).size === d.items.length &&
        ["chat", "agents", "assets"].every((id) =>
          d.items.some((m) => m.id === id && m.builtin),
        ) &&
        d.items.every(
          (m) => m.builtin === ["chat", "agents", "assets"].includes(m.id),
        ),
      "内置菜单必须保留，菜单 ID 不能重复",
    ),
  "new-chat": z
    .object({
      welcome: z.string().max(2000),
      riskNotice: z.string().min(1).max(2000),
    })
    .strict(),
  assistants: z
    .object({
      enabled: z.boolean(),
      local: z.boolean(),
      cloud: z.boolean(),
      agents: z.boolean(),
      mobile: z.boolean(),
      scope: scopeSchema,
    })
    .strict(),
  sharing: z
    .object({
      publish: z.enum(["organization", "internet", "disabled"]),
      collaborate: z.enum(["organization", "internet", "disabled"]),
      files: z.boolean(),
      wechat: z.boolean(),
      wecom: z.boolean(),
    })
    .strict(),
  personal: z
    .object({
      models: z.boolean(),
      skills: z.boolean(),
      connectors: z.boolean(),
      mcpHub: z
        .url()
        .refine((s) => s.startsWith("https://"))
        .nullable()
        .default(null),
    })
    .strict(),
  network: z.object({ whitelist: z.array(ipRange).max(200) }).strict(),
  security: securitySchema,
};
export type ConfigKind = keyof typeof configurationSchemas;
export const configKind = z.enum([
  "menus",
  "new-chat",
  "assistants",
  "sharing",
  "personal",
  "network",
  "security",
]);
export const defaults: Record<ConfigKind, unknown> = {
  menus: {
    items: [
      {
        id: "chat",
        name: "对话",
        nameEn: "Chat",
        enabled: true,
        builtin: true,
        icon: "message",
      },
      {
        id: "agents",
        name: "智能体",
        nameEn: "Agents",
        enabled: true,
        builtin: true,
        icon: "bot",
      },
      {
        id: "assets",
        name: "资源",
        nameEn: "Assets",
        enabled: true,
        builtin: true,
        icon: "library",
      },
    ],
  },
  "new-chat": {
    welcome: "你好，有什么可以帮你？",
    riskNotice: "重要信息请核实。",
  },
  assistants: {
    enabled: true,
    local: true,
    cloud: true,
    agents: true,
    mobile: true,
    scope: { all: true, members: [], departments: [] },
  },
  sharing: {
    publish: "organization",
    collaborate: "organization",
    files: false,
    wechat: false,
    wecom: false,
  },
  personal: { models: false, skills: false, connectors: false, mcpHub: null },
  network: { whitelist: [] },
  security: securitySchema.parse({}),
};
export function configuration(db: Db, tenantId: string, kind: ConfigKind) {
  const row = db.get<{
    draft: string;
    published: string;
    version: number;
    revision: number;
    updated_at: number;
  }>(
    "SELECT * FROM configurations WHERE tenant_id=? AND kind=?",
    tenantId,
    kind,
  );
  return row
    ? {
        draft: parseJson<unknown>(row.draft),
        published: parseJson<unknown>(row.published),
        version: row.version,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : {
        draft: defaults[kind],
        published: defaults[kind],
        version: 0,
        revision: 0,
        updatedAt: 0,
      };
}
export function effectiveSecurity(db: Db, a: Actor) {
  const base = securitySchema.parse(
    configuration(db, a.tenantId, "security").published,
  );
  const matching = db
    .all<{
      scope: string;
      data: string;
    }>("SELECT scope,data FROM policies WHERE tenant_id=? AND family='security' AND enabled=1 ORDER BY priority DESC,created_at DESC,id", a.tenantId)
    .find((p) => inScope(db, parseJson<Scope>(p.scope), a));
  return matching
    ? securitySchema.parse(parseJson<unknown>(matching.data))
    : base;
}
export function ipAllowed(db: Db, a: Actor, ip: string) {
  const { whitelist } = configurationSchemas.network.parse(
    configuration(db, a.tenantId, "network").published,
  );
  if (!whitelist.length) return true;
  if (whitelist.length === 1 && whitelist[0] === "127.0.0.1") return false;
  try {
    const address = ipaddr.process(ip);
    return whitelist.some((v) => {
      const [net, bits] = v.includes("/")
        ? ipaddr.parseCIDR(v)
        : ([ipaddr.parse(v), v.includes(":") ? 128 : 32] as const);
      return address.kind() === net.kind() && address.match(net, bits);
    });
  } catch {
    return false;
  }
}
export function assertExecution(
  db: Db,
  a: Actor,
  kind: "local" | "agents" | "cloud",
  upstreamUrl?: string,
) {
  const assistant = configurationSchemas.assistants.parse(
    configuration(db, a.tenantId, "assistants").published,
  );
  if (
    !assistant.enabled ||
    !assistant[kind] ||
    !inScope(db, assistant.scope, a)
  )
    fail(403, "CHANNEL_DISABLED", "助理渠道已关闭或未授权");
  const security = effectiveSecurity(db, a);
  if (!security.allowNetwork)
    fail(403, "NETWORK_DISABLED", "企业安全策略禁止网络访问");
  if (
    upstreamUrl &&
    security.allowedDomains.length &&
    !security.allowedDomains.includes(new URL(upstreamUrl).hostname)
  )
    fail(403, "DOMAIN_DENIED", "企业安全策略未允许此域名");
}
export function policyRoutes(app: FastifyInstance, db: Db) {
  const prefix = "/api/tenants/:tenantId";
  app.get(`${prefix}/policies`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db
      .all<{
        scope: string;
        data: string;
      }>("SELECT * FROM policies WHERE tenant_id=? ORDER BY priority DESC,created_at DESC", a.tenantId)
      .map((p) => ({
        ...p,
        scope: parseJson<unknown>(p.scope),
        data: parseJson<unknown>(p.data),
      }));
  });
  app.post(`${prefix}/policies`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({
        family: z.enum([
          "model",
          "skill",
          "expert",
          "connector",
          "playbook",
          "instruction",
        ]),
        name: text,
        scope: scopeSchema,
        mode: z.enum(["allow", "deny", "distribute"]),
        resourceIds: z.array(text).max(1000),
        enabled: z.boolean().default(true),
      })
      .strict()
      .parse(req.body);
    for (const rid of d.resourceIds) {
      const row = db.get<{ kind: string; data: string }>(
        "SELECT kind,data FROM resources WHERE tenant_id=? AND id=?",
        a.tenantId,
        rid,
      );
      if (
        !row ||
        (d.family === "model"
          ? row.kind !== "model"
          : row.kind !== "asset" ||
            parseJson<{ kind: string }>(row.data).kind !== d.family)
      )
        fail(400, "INVALID_RESOURCE", "策略资源不存在或类型不匹配");
    }
    const policyId = id();
    db.run(
      "INSERT INTO policies VALUES(?,?,?,?,?,?,0,?,?)",
      policyId,
      a.tenantId,
      d.family,
      d.name,
      JSON.stringify(d.scope),
      JSON.stringify({ mode: d.mode, resourceIds: d.resourceIds }),
      +d.enabled,
      now(),
    );
    audit(db, a, "policy.create", policyId);
    reply.code(201);
    return { id: policyId };
  });
  app.post(`${prefix}/policies/security`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({
        name: text,
        scope: scopeSchema,
        priority: z.number().int().min(0).max(1000000),
        enabled: z.boolean().default(true),
        data: securitySchema,
      })
      .strict()
      .parse(req.body);
    const policyId = id();
    db.run(
      "INSERT INTO policies VALUES(?,?,?,?,?,?,?,?,?)",
      policyId,
      a.tenantId,
      "security",
      d.name,
      JSON.stringify(d.scope),
      JSON.stringify(d.data),
      d.priority,
      +d.enabled,
      now(),
    );
    audit(db, a, "security.policy.create", policyId);
    reply.code(201);
    return { id: policyId };
  });
  app.patch(`${prefix}/policies/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const { id } = req.params as { id: string };
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    if (
      !db.run(
        "UPDATE policies SET enabled=? WHERE tenant_id=? AND id=?",
        +enabled,
        a.tenantId,
        id,
      ).changes
    )
      fail(404, "NOT_FOUND", "策略不存在");
    audit(db, a, "policy.toggle", id);
    return { ok: true };
  });
  app.delete(`${prefix}/policies/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const { id } = req.params as { id: string };
    if (
      !db.run("DELETE FROM policies WHERE tenant_id=? AND id=?", a.tenantId, id)
        .changes
    )
      fail(404, "NOT_FOUND", "策略不存在");
    audit(db, a, "policy.delete", id);
    reply.code(204);
  });
  app.get(`${prefix}/permissions/:userId`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const { userId } = req.params as { userId: string };
    const member = db.get<{
      role: Actor["role"];
      department_id: string | null;
      seat: number;
      status: string;
    }>(
      "SELECT * FROM members WHERE tenant_id=? AND user_id=?",
      a.tenantId,
      userId,
    );
    if (!member) fail(404, "NOT_FOUND", "成员不存在");
    const { listResources } = await import("./resources.js");
    const { allowedResource } = await import("./models.js");
    const subject: Actor = {
      ...a,
      userId,
      role: member.role,
      departmentId: member.department_id,
      seat: !!member.seat,
    };
    const assets = [
      ...listResources<Record<string, unknown>>(db, a.tenantId, "asset"),
      ...listResources<Record<string, unknown>>(db, a.tenantId, "model"),
    ];
    return {
      status: member.status,
      seat: subject.seat,
      resources: assets
        .filter((r) =>
          allowedResource(
            db,
            subject,
            r.kind === "model" ? "model" : String(r.data.kind),
            r,
          ),
        )
        .map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
      security: effectiveSecurity(db, subject),
    };
  });
  app.get(`${prefix}/configurations/:kind`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const kind = configKind.parse((req.params as { kind: string }).kind);
    return configuration(db, a.tenantId, kind);
  });
  app.put(`${prefix}/configurations/:kind`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const kind = configKind.parse((req.params as { kind: string }).kind);
    const d = z
      .object({ revision: z.number().int().nonnegative(), data: z.unknown() })
      .strict()
      .parse(req.body);
    const data = configurationSchemas[kind].parse(d.data);
    return db.transaction(() => {
      const previous = configuration(db, a.tenantId, kind);
      if (previous.revision !== d.revision)
        fail(409, "REVISION_CONFLICT", "配置已被修改，请刷新");
      const revision = d.revision + 1;
      db.run(
        "INSERT INTO configurations VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,kind) DO UPDATE SET draft=excluded.draft,revision=excluded.revision,updated_at=excluded.updated_at",
        a.tenantId,
        kind,
        JSON.stringify(data),
        JSON.stringify(previous.published),
        revision,
        previous.version,
        now(),
      );
      audit(db, a, "configuration.draft.save", kind);
      return { revision };
    });
  });
  app.post(`${prefix}/configurations/:kind/publish`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const kind = configKind.parse((req.params as { kind: string }).kind);
    const { revision } = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    return db.transaction(() => {
      const c = configuration(db, a.tenantId, kind);
      if (c.revision !== revision)
        fail(409, "REVISION_CONFLICT", "草稿已被修改，请刷新");
      db.run(
        "UPDATE configurations SET published=draft,version=version+1,revision=revision+1,updated_at=? WHERE tenant_id=? AND kind=? AND revision=?",
        now(),
        a.tenantId,
        kind,
        revision,
      );
      db.run(
        "INSERT INTO configuration_history VALUES(?,?,?,?,?)",
        a.tenantId,
        kind,
        c.version + 1,
        JSON.stringify(c.draft),
        now(),
      );
      audit(db, a, "configuration.publish", kind, { version: c.version + 1 });
      return { version: c.version + 1, revision: revision + 1 };
    });
  });
  app.delete(`${prefix}/configurations/:kind/draft`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const kind = configKind.parse((req.params as { kind: string }).kind);
    db.run(
      "UPDATE configurations SET draft=published,revision=revision+1,updated_at=? WHERE tenant_id=? AND kind=?",
      now(),
      a.tenantId,
      kind,
    );
    audit(db, a, "configuration.draft.discard", kind);
    return configuration(db, a.tenantId, kind);
  });
}
