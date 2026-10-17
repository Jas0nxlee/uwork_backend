import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import { authenticate, inScope, requirePermission } from "./access.js";
import { audit } from "./events.js";
import {
  parseJson,
  scopeSchema,
  text,
  serviceUrl,
  type Actor,
  type Scope,
} from "./core.js";
import {
  createResource,
  getResource,
  listResources,
  updateResource,
  type Resource,
} from "./resources.js";
import { readJson, safeRequest } from "./network.js";
import { activeSubscription } from "./entitlements.js";

export const modelSchema = z
  .object({
    name: text,
    upstreamModel: text,
    baseUrl: serviceUrl,
    credentialId: text,
    contextWindow: z.number().int().min(128).max(2000000).default(128000),
    maxOutputTokens: z.number().int().min(1).max(131072).default(4096),
    inputRate: z.number().int().min(0).max(1000000).default(1000),
    outputRate: z.number().int().min(0).max(1000000).default(1000),
    supportsVision: z.boolean().default(false),
    supportsReasoning: z.boolean().default(false),
    supportsTools: z.boolean().default(false),
    scope: scopeSchema.default({ all: false, members: [], departments: [] }),
    enabled: z.boolean().default(true),
  })
  .strict();
export type ModelData = Omit<
  z.infer<typeof modelSchema>,
  "name" | "scope" | "enabled"
>;
export function allowedResource(
  db: Db,
  actor: Actor,
  family: string,
  resource: Resource<unknown>,
) {
  if (!resource.enabled || !inScope(db, resource.scope, actor)) return false;
  const policies = db.all<{ scope: string; data: string }>(
    "SELECT scope,data FROM policies WHERE tenant_id=? AND family=? AND enabled=1",
    actor.tenantId,
    family,
  );
  for (const p of policies) {
    if (!inScope(db, parseJson<Scope>(p.scope), actor)) continue;
    const d = parseJson<{ mode: string; resourceIds: string[] }>(p.data);
    if (d.mode === "deny" && d.resourceIds.includes(resource.id)) return false;
    if (d.mode === "allow" && !d.resourceIds.includes(resource.id))
      return false;
  }
  return true;
}
export function modelsRoutes(
  app: FastifyInstance,
  db: Db,
  vault: Vault,
  allowPrivate: boolean,
  privateModelOrigins: readonly string[] = [],
) {
  const path = "/api/tenants/:tenantId/models";
  app.get(path, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return listResources<ModelData>(db, a.tenantId, "model");
  });
  app.post(path, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "vault");
    const { name, scope, enabled, ...d } = modelSchema.parse(req.body);
    vault.read(a.tenantId, d.credentialId);
    const modelId = createResource(
      db,
      a.tenantId,
      "model",
      name,
      d,
      scope,
      enabled,
      "published",
    );
    audit(db, a, "model.create", modelId);
    reply.code(201);
    return { id: modelId };
  });
  app.put(`${path}/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    const { revision, name, scope, enabled, ...d } = modelSchema
      .extend({ revision: z.number().int().positive() })
      .parse(req.body);
    const old = getResource<ModelData>(db, a.tenantId, "model", id);
    if (
      old.data.baseUrl !== d.baseUrl ||
      old.data.credentialId !== d.credentialId
    )
      requirePermission(a, "vault");
    vault.read(a.tenantId, d.credentialId);
    updateResource(
      db,
      getResource(db, a.tenantId, "model", id),
      name,
      d,
      scope,
      enabled,
      revision,
    );
    audit(db, a, "model.update", id);
    return { ok: true };
  });
  app.delete(`${path}/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "model", id);
    db.run(
      "UPDATE resources SET enabled=0,revision=revision+1,updated_at=? WHERE tenant_id=? AND id=?",
      Date.now(),
      a.tenantId,
      id,
    );
    audit(db, a, "model.disable", id);
    reply.code(204);
  });
  app.post(`${path}/:id/probe`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    const m = getResource<ModelData>(db, a.tenantId, "model", id);
    const token = vault.read(a.tenantId, m.data.credentialId);
    const start = Date.now();
    const result = await readJson(
      await safeRequest(
        `${m.data.baseUrl.replace(/\/$/, "")}/models`,
        {
          method: "GET",
          token,
          timeout: 15000,
          privateOrigins: privateModelOrigins,
        },
        allowPrivate,
      ),
    );
    audit(db, a, "model.probe", id);
    return {
      reachable: true,
      latencyMs: Date.now() - start,
      modelsEndpoint: z
        .object({ data: z.array(z.object({ id: z.string() })).max(10000) })
        .safeParse(result).success,
    };
  });
  app.get("/v1/models", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    const credentialIds = new Set(
      db
        .all<{
          id: string;
        }>(
          "SELECT id FROM credentials WHERE tenant_id=? AND revoked=0",
          a.tenantId,
        )
        .map((credential) => credential.id),
    );
    return {
      object: "list",
      data: listResources<ModelData>(db, a.tenantId, "model")
        .filter(
          (m) =>
            credentialIds.has(m.data.credentialId) &&
            allowedResource(db, a, "model", m),
        )
        .map((m) => ({
          id: m.id,
          object: "model",
          owned_by: "uwork",
          name: m.name,
          context_window: m.data.contextWindow,
          max_output_tokens: m.data.maxOutputTokens,
          // 自有客户端必须消费真实模型能力，不能按不透明ID继承通用UCAS高能力默认值。
          supports_vision: m.data.supportsVision,
          supports_reasoning: m.data.supportsReasoning,
          supports_tools: m.data.supportsTools,
        })),
    };
  });
}
