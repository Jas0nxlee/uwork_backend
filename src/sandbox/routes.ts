import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { authenticate, requirePermission } from "../access.js";
import { pageSchema, scopeSchema, text } from "../core.js";
import { rateLimit } from "../identity.js";
import type { SandboxService } from "./service.js";
export function sandboxRoutes(
  app: FastifyInstance,
  db: Db,
  sandbox: SandboxService,
) {
  const path = "/api/tenants/:tenantId";
  app.get(`${path}/runtimes/capability`, async (req) => {
    const actor = authenticate(db, req);
    requirePermission(actor, "read");
    return {
      ...(await sandbox.health()),
      maxTenantRuntimes: 4,
      maxConcurrentExecutions: 4,
      maxLifetimeMs: 1800000,
      network: false,
      hostMounts: false,
      credentialInjection: false,
    };
  });
  app.get(`${path}/runtimes`, async (req) => {
    const actor = authenticate(db, req);
    const q = pageSchema
      .extend({
        status: z
          .enum(["provisioning", "ready", "busy", "stopped", "failed"])
          .optional(),
      })
      .parse(req.query);
    return sandbox.list(actor, q.page, q.pageSize, q.q, q.status);
  });
  app.post(`${path}/runtimes`, async (req, reply) => {
    const actor = authenticate(db, req);
    rateLimit(
      db,
      `sandbox-create:${actor.tenantId}:${actor.userId}`,
      30,
      60000,
    );
    const data = z
      .object({
        name: text,
        scope: scopeSchema.optional(),
        ttlMinutes: z.number().int().min(1).max(30).default(30),
      })
      .strict()
      .parse(req.body);
    const result = await sandbox.create(
      actor,
      data.name,
      data.scope ?? { all: false, members: [actor.userId], departments: [] },
      data.ttlMinutes,
    );
    return reply.code(201).send(result);
  });
  app.get(`${path}/runtimes/:id`, async (req) =>
    sandbox.view(authenticate(db, req), (req.params as { id: string }).id),
  );
  app.patch(`${path}/runtimes/:id`, async (req) => {
    const a = authenticate(db, req);
    const d = z
      .object({
        name: text,
        scope: scopeSchema,
        revision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    return sandbox.update(
      a,
      (req.params as { id: string }).id,
      d.name,
      d.scope,
      d.revision,
    );
  });
  app.post(`${path}/runtimes/:id/stop`, async (req) => {
    await sandbox.stopRuntime(
      authenticate(db, req),
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });
  app.delete(`${path}/runtimes/:id`, async (req, reply) => {
    await sandbox.stopRuntime(
      authenticate(db, req),
      (req.params as { id: string }).id,
      true,
    );
    return reply.code(204).send();
  });
  app.post(`${path}/runtimes/:id/executions`, async (req, reply) => {
    const actor = authenticate(db, req);
    rateLimit(db, `sandbox-exec:${actor.tenantId}:${actor.userId}`, 60, 60000);
    const data = z
      .object({
        code: z.string().min(1).max(100000),
        timeoutMs: z.number().int().min(100).max(1800000).default(30000),
      })
      .strict()
      .parse(req.body);
    const executionId = await sandbox.enqueue(
      actor,
      (req.params as { id: string }).id,
      data.code,
      data.timeoutMs,
    );
    return reply.code(202).send({ id: executionId });
  });
  app.get(`${path}/sandbox-executions`, async (req) => {
    const actor = authenticate(db, req);
    const q = pageSchema
      .extend({
        runtimeId: text.optional(),
        status: z
          .enum([
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled",
            "timed_out",
          ])
          .optional(),
      })
      .parse(req.query);
    return sandbox.executions(actor, q.page, q.pageSize, q.runtimeId, q.status);
  });
  app.get(`${path}/sandbox-executions/:id`, async (req) =>
    sandbox.getExecution(
      authenticate(db, req),
      (req.params as { id: string }).id,
    ),
  );
  app.post(`${path}/sandbox-executions/:id/cancel`, async (req) =>
    sandbox.cancel(authenticate(db, req), (req.params as { id: string }).id),
  );
}
