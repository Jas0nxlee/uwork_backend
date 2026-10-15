import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Runtime } from "./runtime.js";
import type { Run, AgentData } from "./agent-contract.js";
import { authenticate, requirePermission } from "./access.js";
import { ApiError, fail, pageSchema, text, type Actor } from "./core.js";
import { activeSubscription } from "./entitlements.js";
import {
  assertChannel,
  configuration,
  configurationSchemas,
} from "./policy.js";
import { authorizedAgent } from "./agent-access.js";
import { listResources } from "./resources.js";

function menuDecision(db: Db, actor: Actor, menuId: string) {
  const current = configuration(db, actor.tenantId, "menus");
  const menu = configurationSchemas.menus
    .parse(current.published)
    .items.find((item) => item.id === menuId && item.enabled);
  if (menu?.id === "chat" || menu?.id === "agents")
    assertChannel(db, actor, "local");
  return {
    allowed: !!menu,
    tenantId: actor.tenantId,
    ...(menu ? { menu } : {}),
    version: current.version,
  };
}
function ownRun(db: Db, actor: Actor, runId: string) {
  const run = db.get<Run>(
    "SELECT * FROM runs WHERE tenant_id=? AND user_id=? AND id=?",
    actor.tenantId,
    actor.userId,
    runId,
  );
  if (!run) fail(404, "NOT_FOUND", "任务不存在");
  return run;
}
function runSummary(run: Run) {
  return {
    id: run.id,
    agentId: run.agent_id,
    sessionId: run.session_id,
    status: run.status,
    errorCode: run.error_code,
    createdAt: run.created_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  };
}

/** Client APIs reuse Runtime; Agent权限属于独立执行渠道，不由本地自动化导航菜单裁决。 */
export function clientConsoleRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: Runtime,
) {
  app.post("/api/client/menus/:id/authorize", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    return menuDecision(db, a, text.parse((req.params as { id: string }).id));
  });
  app.get("/api/client/agents", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    assertChannel(db, a, "agents");
    const items = listResources<AgentData>(db, a.tenantId, "agent")
      .filter((item) => {
        try {
          authorizedAgent(db, a, item.id);
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 403) return false;
          throw error;
        }
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        publishedVersion: item.published_version,
      }));
    return { items };
  });
  app.get("/api/client/runs", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    assertChannel(db, a, "agents");
    const q = pageSchema.parse(req.query);
    const rows = db.all<Run>(
      "SELECT * FROM runs WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
      a.tenantId,
      a.userId,
      q.pageSize,
      (q.page - 1) * q.pageSize,
    );
    return {
      items: rows.map(runSummary),
      total: db.get<{ n: number }>(
        "SELECT count(*) n FROM runs WHERE tenant_id=? AND user_id=?",
        a.tenantId,
        a.userId,
      )!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
  app.post("/api/client/runs", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    assertChannel(db, a, "agents");
    const d = z
      .object({
        agentId: text,
        input: z.string().min(1).max(100000),
        timeoutMs: z.number().int().min(100).max(1800000).default(1800000),
        sessionId: text.optional(),
      })
      .strict()
      .parse(req.body);
    const runId = runtime.enqueue(
      a,
      d.agentId,
      d.input,
      d.timeoutMs,
      d.sessionId,
    );
    reply.code(202);
    return runSummary(ownRun(db, a, runId));
  });
  app.get("/api/client/runs/:id", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    assertChannel(db, a, "agents");
    const run = ownRun(db, a, text.parse((req.params as { id: string }).id));
    const decoded = runtime.decode(run);
    return { ...runSummary(run), input: decoded.input, output: decoded.output };
  });
  app.post("/api/client/runs/:id/cancel", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    activeSubscription(db, a.tenantId);
    // 菜单关闭不能阻止用户停止已接受的本人任务；退出和撤席位仍使凭据失效。
    const run = ownRun(db, a, text.parse((req.params as { id: string }).id));
    await runtime.cancel(a, run.id);
    return { ok: true };
  });
}
