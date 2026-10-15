import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, inScope, requirePermission } from "./access.js";
import { fail, hash, id, now, parseJson, type Scope } from "./core.js";
import {
  configuration,
  configurationSchemas,
  defaults,
  effectiveSecurity,
  ipAllowed,
  assertChannel,
  type ConfigKind,
} from "./policy.js";
import { getResource } from "./resources.js";
import { publishedAsset, visibleAssets, type AssetData } from "./assets.js";
import { allowedResource } from "./models.js";
import { activeSubscription } from "./entitlements.js";

export function clientRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/client/configuration", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    if (!ipAllowed(db, a, req.ip))
      fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
    const config: Record<string, unknown> = {},
      versions: Record<string, number> = {};
    for (const kind of Object.keys(defaults) as ConfigKind[]) {
      const c = configuration(db, a.tenantId, kind);
      config[kind] = c.published;
      versions[kind] = c.version;
    }
    const etag = hash(
      JSON.stringify({ versions, security: effectiveSecurity(db, a) }),
    );
    reply.header("etag", `"${etag}"`);
    if (req.headers["if-none-match"] === `"${etag}"`)
      return reply.code(304).send();
    return {
      tenantId: a.tenantId,
      versions,
      configuration: config,
      security: effectiveSecurity(db, a),
      riskPrefix: "内容由 AI 生成",
      fetchedAt: now(),
    };
  });
  app.get("/api/client/assets", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    if (!ipAllowed(db, a, req.ip))
      fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
    const items = visibleAssets(db, a).map((r) => {
      const data = publishedAsset(db, r);
      const distributed = db
        .all<{
          scope: string;
          data: string;
        }>(
          "SELECT scope,data FROM policies WHERE tenant_id=? AND family=? AND enabled=1",
          a.tenantId,
          data.kind,
        )
        .some((p) => {
          const d = parseJson<{ mode: string; resourceIds: string[] }>(p.data);
          return (
            d.mode === "distribute" &&
            d.resourceIds.includes(r.id) &&
            inScope(db, parseJson<Scope>(p.scope), a)
          );
        });
      return {
        id: r.id,
        name: r.name,
        kind: data.kind,
        version: r.published_version,
        checksum: data.checksum,
        categoryId: data.categoryId,
        distributed,
      };
    });
    return { items };
  });
  app.get("/api/client/assets/:id/download", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    if (!ipAllowed(db, a, req.ip))
      fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
    const { id } = req.params as { id: string };
    const query = z
      .object({ version: z.coerce.number().int().positive().optional() })
      .strict()
      .parse(req.query);
    const asset = getResource<AssetData>(db, a.tenantId, "asset", id);
    if (
      !visibleAssets(db, a).some((r) => r.id === id) ||
      !allowedResource(db, a, asset.data.kind, asset)
    )
      fail(403, "ASSET_DENIED", "资产未发布或未授权");
    const data = publishedAsset(db, asset);
    if (
      query.version !== undefined &&
      query.version !== asset.published_version
    )
      fail(409, "ASSET_VERSION_CHANGED", "资产发布版本已变更，请重新同步");
    if (data.kind === "connector") {
      const c = data.content as {
        url: string;
        transport: string;
        description: string;
      };
      return {
        id,
        kind: data.kind,
        version: asset.published_version,
        content: { transport: c.transport, description: c.description },
        gatewayUrl: `/api/client/connectors/${id}/rpc`,
      };
    }
    return {
      id,
      kind: data.kind,
      version: asset.published_version,
      content: data.content,
      checksum: data.checksum,
    };
  });
  app.post("/api/client/events", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    const d = z
      .object({
        eventKey: z.string().min(1).max(128),
        type: z.enum([
          "configuration.applied",
          "asset.installed",
          "asset.removed",
          "execution.denied",
          "client.error",
        ]),
        data: z
          .object({
            resourceId: z.string().max(80).optional(),
            version: z.number().int().nonnegative().optional(),
            code: z.string().max(80).optional(),
          })
          .strict(),
      })
      .strict()
      .parse(req.body);
    db.run(
      "INSERT OR IGNORE INTO client_events VALUES(?,?,?,?,?,?,?)",
      id(),
      a.tenantId,
      a.userId,
      d.eventKey,
      d.type,
      JSON.stringify(d.data),
      now(),
    );
    reply.code(202);
    return { accepted: true };
  });
  app.post("/api/client/authorize", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    if (!ipAllowed(db, a, req.ip))
      fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
    const d = z
      .object({
        channel: z.enum(["local", "agents", "cloud"]).default("local"),
        action: z.enum([
          "execution",
          "asset",
          "shell",
          "filesystem",
          "network",
          "share",
        ]),
        target: z.string().max(2048).default(""),
        assetVersion: z.number().int().positive().optional(),
        assetChecksum: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
        stricter: z
          .object({
            allowShell: z.boolean().optional(),
            allowFilesystem: z.boolean().optional(),
            allowNetwork: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (input) =>
          input.action !== "asset" ||
          (!!input.target &&
            input.assetVersion !== undefined &&
            input.assetChecksum !== undefined),
        "资产准入必须绑定 ID、发布版本与校验和",
      )
      .parse(req.body);
    assertChannel(db, a, d.channel);
    const s = effectiveSecurity(db, a);
    let allowed = false;
    if (d.action === "execution") allowed = true;
    if (d.action === "asset") {
      const asset = visibleAssets(db, a).find(
        (resource) => resource.id === d.target,
      );
      if (asset) {
        const data = publishedAsset(db, asset);
        allowed =
          asset.published_version === d.assetVersion &&
          data.checksum === d.assetChecksum &&
          (data.kind !== "skill" ||
            (data.content as { highRisk: boolean }).highRisk !== true ||
            s.dangerousSkills);
      }
    }
    if (d.action === "shell")
      allowed = s.allowShell && d.stricter?.allowShell !== false;
    if (d.action === "filesystem")
      allowed = s.allowFilesystem && d.stricter?.allowFilesystem !== false;
    if (d.action === "network") {
      let host = "";
      try {
        host = new URL(d.target).hostname;
      } catch {
        fail(400, "INVALID_URL", "网络目标需要有效 URL");
      }
      allowed =
        s.allowNetwork &&
        d.stricter?.allowNetwork !== false &&
        (!s.allowedDomains.length || s.allowedDomains.includes(host));
    }
    if (d.action === "share") {
      const sharing = configurationSchemas.sharing.parse(
        configuration(db, a.tenantId, "sharing").published,
      );
      allowed =
        sharing.publish !== "disabled" &&
        (d.target !== "internet" || sharing.publish === "internet");
    }
    const personal =
      d.action === "execution"
        ? configurationSchemas.personal.parse(
            configuration(db, a.tenantId, "personal").published,
          )
        : undefined;
    return {
      allowed,
      security: s,
      tenantId: a.tenantId,
      ...(personal
        ? {
            personal: {
              models: personal.models,
              skills: personal.skills,
              connectors: personal.connectors,
            },
          }
        : {}),
    };
  });
}
