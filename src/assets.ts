import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { audit } from "./events.js";
import {
  fail,
  hash,
  id,
  now,
  pageSchema,
  scopeSchema,
  text,
  serviceUrl,
  type Actor,
} from "./core.js";
import {
  createResource,
  getResource,
  listResources,
  updateResource,
  type Resource,
} from "./resources.js";
import { allowedResource } from "./models.js";
import {
  isPortableAssetPath,
  hasUnambiguousAssetPaths,
} from "./asset-paths.js";

export const assetKind = z.enum([
  "skill",
  "expert",
  "connector",
  "playbook",
  "instruction",
]);
const filePath = z
  .string()
  .min(1)
  .max(240)
  .refine(isPortableAssetPath, "必须是安全相对路径");
export const contentSchemas = {
  skill: z
    .object({
      files: z
        .array(
          z
            .object({ path: filePath, content: z.string().max(500000) })
            .strict(),
        )
        .min(1)
        .max(100),
      highRisk: z.boolean().default(false),
    })
    .strict()
    .refine(
      (c) =>
        c.files.some((f) => f.path === "SKILL.md") &&
        hasUnambiguousAssetPaths(c.files),
      "必须包含 SKILL.md 且路径无重复或文件目录冲突",
    ),
  expert: z
    .object({
      instructions: z.string().min(1).max(100000),
      profession: text.optional(),
      modelId: text.optional(),
    })
    .strict(),
  connector: z
    .object({
      url: serviceUrl.refine((s) => s.startsWith("https://")),
      transport: z.literal("streamable-http"),
      credentialId: text.optional(),
      description: z.string().max(2000).default(""),
      allowedTools: z.array(text).max(100).default([]),
    })
    .strict(),
  playbook: z.object({ markdown: z.string().min(1).max(100000) }).strict(),
  instruction: z
    .object({ instructions: z.string().min(1).max(100000) })
    .strict(),
};
export interface AssetData {
  kind: z.infer<typeof assetKind>;
  categoryId: string | null;
  content: unknown;
  checksum: string;
  supportedClients: string[];
}
const clientSupport: Record<
  z.infer<typeof assetKind>,
  readonly ("uwork" | "agent")[]
> = {
  skill: ["uwork", "agent"],
  expert: ["uwork", "agent"],
  connector: ["uwork", "agent"],
  // 控制台证据：自定义指令页对 WorkBuddy 标注“暂不支持”，Playbook 页是只读 Cookbook
  // （无创建/上传请求），因此这两个类型不向 uwork 终端下发；终端所有者接入前保持仅企业智能体。
  playbook: ["agent"],
  instruction: ["agent"],
};
const assetSchema = z
  .object({
    kind: assetKind,
    name: text,
    categoryId: text.nullable().default(null),
    content: z.unknown(),
    scope: scopeSchema.default({ all: false, members: [], departments: [] }),
    enabled: z.boolean().default(true),
    supportedClients: z
      .array(z.enum(["uwork", "agent"]))
      .min(1)
      .optional(),
  })
  .strict();
function assetData(
  db: Db,
  tenantId: string,
  d: z.infer<typeof assetSchema>,
): AssetData {
  const content = contentSchemas[d.kind].parse(d.content);
  const supportedClients = d.supportedClients ?? [...clientSupport[d.kind]];
  const unsupported = supportedClients.filter(
    (client) => !clientSupport[d.kind].includes(client),
  );
  if (unsupported.length)
    fail(
      400,
      "CLIENT_UNSUPPORTED",
      `${d.kind} 不支持下发到 ${unsupported.join("/")} 终端`,
    );
  if (Buffer.byteLength(JSON.stringify(content)) > 1024 * 1024)
    fail(400, "ASSET_TOO_LARGE", "资产超过 1 MiB");
  if (
    d.categoryId &&
    !db.get(
      "SELECT id FROM categories WHERE tenant_id=? AND id=? AND kind=?",
      tenantId,
      d.categoryId,
      d.kind,
    )
  )
    fail(400, "INVALID_CATEGORY", "分类不存在");
  if (d.kind === "connector") {
    const c = content as z.infer<typeof contentSchemas.connector>;
    if (
      c.credentialId &&
      !db.get(
        "SELECT id FROM credentials WHERE tenant_id=? AND id=? AND revoked=0",
        tenantId,
        c.credentialId,
      )
    )
      fail(400, "INVALID_CREDENTIAL", "凭据不可用");
  }
  return {
    kind: d.kind,
    categoryId: d.categoryId,
    content,
    checksum: hash(JSON.stringify(content)),
    supportedClients,
  };
}
export function visibleAssets(
  db: Db,
  actor: Actor,
  client: "uwork" | "agent" = "uwork",
) {
  return listResources<AssetData>(db, actor.tenantId, "asset").filter(
    (a) =>
      a.status === "published" &&
      a.published_version !== null &&
      publishedAsset(db, a).supportedClients.includes(client) &&
      allowedResource(db, actor, a.data.kind, a),
  );
}
export function publishedAsset(db: Db, a: Resource<AssetData>) {
  const v = db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=? AND version=? AND approved=1",
    a.id,
    a.published_version,
  );
  if (!v) fail(409, "VERSION_UNAVAILABLE", "已发布版本不可用");
  return JSON.parse(v.data) as AssetData;
}
export function assetRoutes(app: FastifyInstance, db: Db) {
  const path = "/api/tenants/:tenantId/assets";
  app.get(path, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const p = pageSchema
      .extend({ kind: assetKind.optional() })
      .parse(req.query);
    const rows = listResources<AssetData>(db, a.tenantId, "asset").filter(
      (r) => (!p.kind || r.data.kind === p.kind) && r.name.includes(p.q),
    );
    return {
      items: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
      total: rows.length,
      ...p,
    };
  });
  app.post(path, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const d = assetSchema.parse(req.body);
    if (d.kind === "connector") requirePermission(a, "vault");
    const data = assetData(db, a.tenantId, d);
    const assetId = db.transaction(() => {
      const aid = createResource(
        db,
        a.tenantId,
        "asset",
        d.name,
        data,
        d.scope,
        d.enabled,
      );
      db.run(
        "INSERT INTO resource_versions VALUES(?,1,?,0,?)",
        aid,
        JSON.stringify(data),
        now(),
      );
      audit(db, a, "asset.create", aid);
      return aid;
    });
    reply.code(201);
    return { id: assetId, version: 1 };
  });
  app.put(`${path}/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    const { revision, ...d } = assetSchema
      .extend({ revision: z.number().int().positive() })
      .parse(req.body);
    if (d.kind === "connector") requirePermission(a, "vault");
    const old = getResource<AssetData>(db, a.tenantId, "asset", id);
    if (old.data.kind !== d.kind)
      fail(400, "KIND_IMMUTABLE", "资产类型不能修改");
    const data = assetData(db, a.tenantId, d);
    return db.transaction(() => {
      updateResource(db, old, d.name, data, d.scope, d.enabled, revision);
      const version = db.get<{ n: number }>(
        "SELECT max(version)+1 n FROM resource_versions WHERE resource_id=?",
        id,
      )!.n;
      db.run(
        "INSERT INTO resource_versions VALUES(?,?,?,0,?)",
        id,
        version,
        JSON.stringify(data),
        now(),
      );
      audit(db, a, "asset.version.create", id, { version });
      return { version, revision: revision + 1 };
    });
  });
  app.get(`${path}/:id/versions`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "asset", id);
    return db.all(
      "SELECT version,approved,created_at FROM resource_versions WHERE resource_id=? ORDER BY version DESC",
      id,
    );
  });
  app.post(`${path}/:id/review`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "asset", id);
    const d = z
      .object({ version: z.number().int().positive(), approved: z.boolean() })
      .strict()
      .parse(req.body);
    db.transaction(() => {
      if (
        !db.run(
          "UPDATE resource_versions SET approved=? WHERE resource_id=? AND version=?",
          +d.approved,
          id,
          d.version,
        ).changes
      )
        fail(404, "NOT_FOUND", "版本不存在");
      if (!d.approved)
        db.run(
          "UPDATE resources SET status='draft',published_version=NULL WHERE id=? AND published_version=?",
          id,
          d.version,
        );
      audit(db, a, "asset.review", id, {
        version: d.version,
        approved: d.approved,
      });
    });
    return { ok: true };
  });
  app.post(`${path}/:id/publish`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "asset", id);
    const { version } = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    if (
      !db.get(
        "SELECT version FROM resource_versions WHERE resource_id=? AND version=? AND approved=1",
        id,
        version,
      )
    )
      fail(409, "REVIEW_REQUIRED", "版本必须审核通过");
    db.run(
      "UPDATE resources SET status='published',published_version=?,revision=revision+1,updated_at=? WHERE id=?",
      version,
      now(),
      id,
    );
    audit(db, a, "asset.publish", id, { version });
    return { ok: true };
  });
  app.delete(`${path}/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "asset", id);
    db.run(
      "UPDATE resources SET enabled=0,revision=revision+1,updated_at=? WHERE id=?",
      now(),
      id,
    );
    audit(db, a, "asset.disable", id);
    reply.code(204);
  });
  app.get("/api/tenants/:tenantId/categories", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db.all(
      "SELECT id,kind,name FROM categories WHERE tenant_id=? ORDER BY kind,name",
      a.tenantId,
    );
  });
  app.post("/api/tenants/:tenantId/categories", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const d = z
      .object({ kind: assetKind, name: text })
      .strict()
      .parse(req.body);
    const categoryId = id();
    if (
      db.get(
        "SELECT id FROM categories WHERE tenant_id=? AND kind=? AND name=?",
        a.tenantId,
        d.kind,
        d.name,
      )
    )
      fail(409, "CATEGORY_EXISTS", "分类已存在");
    db.run(
      "INSERT INTO categories VALUES(?,?,?,?)",
      categoryId,
      a.tenantId,
      d.kind,
      d.name,
    );
    audit(db, a, "asset.category.create", categoryId);
    reply.code(201);
    return { id: categoryId };
  });
  app.delete("/api/tenants/:tenantId/categories/:id", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    if (
      listResources<AssetData>(db, a.tenantId, "asset").some(
        (r) => r.data.categoryId === id,
      )
    )
      fail(409, "CATEGORY_IN_USE", "分类仍有资产");
    if (
      !db.run(
        "DELETE FROM categories WHERE tenant_id=? AND id=?",
        a.tenantId,
        id,
      ).changes
    )
      fail(404, "NOT_FOUND", "分类不存在");
    audit(db, a, "asset.category.delete", id);
    reply.code(204);
  });
}
