import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Gateway } from "./gateway.js";
import type { Vault } from "./vault.js";
import { authenticate, requirePermission, currentActor } from "./access.js";
import { audit } from "./events.js";
import {
  ApiError,
  fail,
  id,
  now,
  pageSchema,
  scopeSchema,
  text,
  type Actor,
} from "./core.js";
import {
  createResource,
  getResource,
  listResources,
  updateResource,
  type Resource,
} from "./resources.js";
import { allowedResource, type ModelData } from "./models.js";
import { assertExecution, effectiveSecurity } from "./policy.js";
import { publishedAsset, visibleAssets, type AssetData } from "./assets.js";

export const agentSchema = z
  .object({
    name: text,
    modelId: text,
    instructions: z.string().min(1).max(50000),
    assetIds: z.array(text).max(20).default([]),
    maxOutputTokens: z.number().int().min(1).max(131072).default(4096),
    scope: scopeSchema,
    enabled: z.boolean().default(true),
  })
  .strict();
export type AgentData = Omit<
  z.infer<typeof agentSchema>,
  "name" | "scope" | "enabled"
>;
export interface Run {
  id: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
  agent_id: string;
  agent_version: number;
  status: string;
  input: string;
  output: string | null;
  error_code: string | null;
  timeout_ms: number;
  trigger_key: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}
export class Runtime {
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<void>; sessionId: string }
  >();
  private stopped = false;
  constructor(
    private db: Db,
    private gateway: Gateway,
    private vault: Vault,
  ) {
    db.run(
      "UPDATE runs SET status='failed',error_code='PROCESS_RESTARTED',finished_at=? WHERE status='running'",
      now(),
    );
  }
  agent(actor: Actor, agentId: string): Resource<AgentData> {
    const agent = getResource<AgentData>(
      this.db,
      actor.tenantId,
      "agent",
      agentId,
    );
    if (
      !agent.enabled ||
      agent.status !== "published" ||
      !agent.published_version ||
      !allowedResource(this.db, actor, "agent", agent)
    )
      fail(403, "AGENT_DENIED", "智能体未发布或未授权");
    return agent;
  }
  enqueue(
    actor: Actor,
    agentId: string,
    input: string,
    timeoutMs = 1800000,
    sessionId?: string,
    triggerKey?: string,
  ) {
    requirePermission(actor, "execute");
    assertExecution(this.db, actor, "agents");
    const agent = this.agent(actor, agentId);
    return this.db.transaction(() => {
      if (triggerKey) {
        const prior = this.db.get<{ id: string }>(
          "SELECT id FROM runs WHERE tenant_id=? AND trigger_key=?",
          actor.tenantId,
          triggerKey,
        );
        if (prior) return prior.id;
      }
      const queued = this.db.get<{ n: number }>(
        "SELECT count(*) n FROM runs WHERE tenant_id=? AND status IN ('queued','running')",
        actor.tenantId,
      )!.n;
      if (queued >= 100) fail(429, "QUEUE_FULL", "运行队列已满");
      const session = sessionId ?? id();
      if (sessionId) {
        if (
          !this.db.get(
            "SELECT id FROM runtime_sessions WHERE id=? AND tenant_id=? AND user_id=? AND agent_id=?",
            session,
            actor.tenantId,
            actor.userId,
            agentId,
          )
        )
          fail(404, "NOT_FOUND", "会话不存在");
      } else
        this.db.run(
          "INSERT INTO runtime_sessions VALUES(?,?,?,?,?)",
          session,
          actor.tenantId,
          actor.userId,
          agentId,
          now(),
        );
      const runId = id();
      this.db.run(
        "INSERT INTO runs(id,tenant_id,user_id,session_id,agent_id,agent_version,status,input,timeout_ms,trigger_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        runId,
        actor.tenantId,
        actor.userId,
        session,
        agentId,
        agent.published_version,
        "queued",
        this.vault.seal(input, `${actor.tenantId}:${runId}:input`),
        timeoutMs,
        triggerKey ?? null,
        now(),
      );
      audit(this.db, actor, "runtime.enqueue", runId);
      return runId;
    });
  }
  decode(run: Run) {
    return {
      ...run,
      input: this.vault.open(run.input, `${run.tenant_id}:${run.id}:input`),
      output: run.output
        ? this.vault.open(run.output, `${run.tenant_id}:${run.id}:output`)
        : null,
    };
  }
  cancel(actor: Actor, runId: string) {
    const run = this.db.get<Run>(
      "SELECT * FROM runs WHERE tenant_id=? AND id=?",
      actor.tenantId,
      runId,
    );
    if (!run) fail(404, "NOT_FOUND", "任务不存在");
    if (run.user_id !== actor.userId) requirePermission(actor, "write");
    this.db.run(
      "UPDATE runs SET status='cancelled',error_code='CANCELLED',finished_at=? WHERE id=? AND status IN ('queued','running')",
      now(),
      runId,
    );
    this.active.get(runId)?.controller.abort("cancelled");
    audit(this.db, actor, "runtime.cancel", runId);
  }
  pump() {
    if (this.stopped) return;
    const queued = this.db.all<Run>(
      "SELECT * FROM runs WHERE status='queued' ORDER BY created_at,id LIMIT 100",
    );
    for (const run of queued) {
      if (this.active.size >= 4) break;
      if ([...this.active.values()].some((r) => r.sessionId === run.session_id))
        continue;
      if (
        !this.db.run(
          "UPDATE runs SET status='running',started_at=? WHERE id=? AND status='queued'",
          now(),
          run.id,
        ).changes
      )
        continue;
      const controller = new AbortController();
      const promise = this.execute(run, controller).finally(() => {
        this.active.delete(run.id);
      });
      this.active.set(run.id, {
        controller,
        promise,
        sessionId: run.session_id,
      });
    }
  }
  async drain() {
    while (!this.stopped) {
      this.pump();
      if (!this.active.size) break;
      await Promise.all([...this.active.values()].map((r) => r.promise));
    }
  }
  async stop() {
    this.stopped = true;
    for (const r of this.active.values()) r.controller.abort("shutdown");
    await Promise.all([...this.active.values()].map((r) => r.promise));
  }
  purgeFinished(tenantId: string, before: number) {
    return Number(
      this.db.run(
        "DELETE FROM runs WHERE tenant_id=? AND finished_at<? AND status NOT IN ('queued','running') AND trigger_key IS NULL AND id NOT IN (SELECT run_id FROM deliveries)",
        tenantId,
        before,
      ).changes,
    );
  }
  private async execute(run: Run, controller: AbortController) {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, run.timeout_ms);
    try {
      const actor = currentActor(this.db, run.tenant_id, run.user_id);
      this.agent(actor, run.agent_id);
      const stored = this.db.get<{ data: string }>(
        "SELECT data FROM resource_versions WHERE resource_id=? AND version=?",
        run.agent_id,
        run.agent_version,
      );
      if (!stored) fail(409, "VERSION_UNAVAILABLE", "智能体版本不可用");
      const agent = JSON.parse(stored.data) as AgentData;
      const model = getResource<ModelData>(
        this.db,
        actor.tenantId,
        "model",
        agent.modelId,
      );
      assertExecution(this.db, actor, "agents", model.data.baseUrl);
      let system = agent.instructions;
      for (const assetId of agent.assetIds) {
        const asset = visibleAssets(this.db, actor, "agent").find(
          (a) => a.id === assetId,
        );
        if (!asset) fail(403, "ASSET_DENIED", "智能体资源已撤销授权");
        const published = publishedAsset(this.db, asset);
        const content = published.content as {
          instructions?: string;
          markdown?: string;
          files?: { path: string; content: string }[];
          highRisk?: boolean;
        };
        if (
          content.highRisk &&
          !effectiveSecurity(this.db, actor).dangerousSkills
        )
          fail(403, "HIGH_RISK_SKILL", "高风险技能已被企业禁止");
        if (published.kind === "connector")
          fail(
            409,
            "CONNECTOR_TOOL_REQUIRED",
            "连接器使用独立的受控 RPC 接口，不能注入提示词执行",
          );
        system += `\n\n${content.instructions ?? content.markdown ?? content.files?.find((f) => f.path === "SKILL.md")?.content ?? ""}`;
      }
      const input = this.vault.open(
        run.input,
        `${run.tenant_id}:${run.id}:input`,
      );
      const previous = this.db
        .all<Run>(
          "SELECT * FROM runs WHERE tenant_id=? AND session_id=? AND status='succeeded' AND created_at<=? ORDER BY created_at DESC LIMIT 10",
          run.tenant_id,
          run.session_id,
          run.created_at,
        )
        .reverse();
      const messages: {
        role: "system" | "user" | "assistant";
        content: string;
      }[] = [{ role: "system", content: system }];
      for (const prev of previous) {
        const p = this.decode(prev);
        messages.push(
          { role: "user", content: p.input },
          { role: "assistant", content: p.output ?? "" },
        );
      }
      messages.push({ role: "user", content: input });
      const result = await this.gateway.complete(
        actor,
        {
          model: agent.modelId,
          messages,
          max_tokens: agent.maxOutputTokens,
          temperature: 0.7,
          stream: false,
        },
        `run:${run.id}`,
        "agent-runtime",
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new ApiError(499, "CANCELLED", "任务已取消");
      this.db.run(
        "UPDATE runs SET status='succeeded',output=?,finished_at=? WHERE id=? AND status='running'",
        this.vault.seal(
          result.choices[0]!.message.content,
          `${run.tenant_id}:${run.id}:output`,
        ),
        now(),
        run.id,
      );
    } catch (error) {
      const status = timedOut
        ? "timed_out"
        : controller.signal.aborted
          ? "cancelled"
          : "failed";
      const code = timedOut
        ? "TIMEOUT"
        : controller.signal.aborted
          ? "CANCELLED"
          : error instanceof ApiError
            ? error.code
            : "RUNTIME_FAILURE";
      this.db.run(
        "UPDATE runs SET status=?,error_code=?,finished_at=? WHERE id=? AND status='running'",
        status,
        code,
        now(),
        run.id,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
export function runtimeRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: Runtime,
  readSandboxCapability: () => Promise<boolean>,
) {
  const p = "/api/tenants/:tenantId";
  app.get(`${p}/agents`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return listResources<AgentData>(db, a.tenantId, "agent");
  });
  const validateAgent = (tenantId: string, d: AgentData) => {
    getResource(db, tenantId, "model", d.modelId);
    for (const assetId of d.assetIds)
      getResource<AssetData>(db, tenantId, "asset", assetId);
  };
  app.post(`${p}/agents`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { name, scope, enabled, ...d } = agentSchema.parse(req.body);
    validateAgent(a.tenantId, d);
    const agentId = db.transaction(() => {
      const aid = createResource(
        db,
        a.tenantId,
        "agent",
        name,
        d,
        scope,
        enabled,
      );
      db.run(
        "INSERT INTO resource_versions VALUES(?,1,?,1,?)",
        aid,
        JSON.stringify(d),
        now(),
      );
      audit(db, a, "agent.create", aid);
      return aid;
    });
    reply.code(201);
    return { id: agentId, version: 1 };
  });
  app.put(`${p}/agents/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    const { revision, name, scope, enabled, ...d } = agentSchema
      .extend({ revision: z.number().int().positive() })
      .parse(req.body);
    validateAgent(a.tenantId, d);
    return db.transaction(() => {
      updateResource(
        db,
        getResource(db, a.tenantId, "agent", id),
        name,
        d,
        scope,
        enabled,
        revision,
      );
      const version = db.get<{ n: number }>(
        "SELECT max(version)+1 n FROM resource_versions WHERE resource_id=?",
        id,
      )!.n;
      db.run(
        "INSERT INTO resource_versions VALUES(?,?,?,1,?)",
        id,
        version,
        JSON.stringify(d),
        now(),
      );
      audit(db, a, "agent.version.create", id);
      return { version };
    });
  });
  app.post(`${p}/agents/:id/publish`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "agent", id);
    const { version } = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    if (
      !db.get(
        "SELECT version FROM resource_versions WHERE resource_id=? AND version=?",
        id,
        version,
      )
    )
      fail(404, "NOT_FOUND", "版本不存在");
    db.run(
      "UPDATE resources SET published_version=?,status='published',revision=revision+1,updated_at=? WHERE id=?",
      version,
      now(),
      id,
    );
    audit(db, a, "agent.publish", id, { version });
    return { ok: true };
  });
  app.delete(`${p}/agents/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    getResource(db, a.tenantId, "agent", id);
    db.run("UPDATE resources SET enabled=0,revision=revision+1 WHERE id=?", id);
    audit(db, a, "agent.disable", id);
    reply.code(204);
  });
  app.post(`${p}/runs`, async (req, reply) => {
    const a = authenticate(db, req);
    const d = z
      .object({
        agentId: text,
        input: z.string().min(1).max(100000),
        sessionId: text.optional(),
        timeoutMs: z.number().int().min(100).max(1800000).default(1800000),
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
    return { id: runId };
  });
  app.get(`${p}/runs`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const query = pageSchema
      .extend({
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
        sessionId: text.optional(),
      })
      .parse(req.query);
    const params = [
      a.tenantId,
      ...(query.status ? [query.status] : []),
      ...(query.sessionId ? [query.sessionId] : []),
    ];
    const where = `tenant_id=?${query.status ? " AND status=?" : ""}${query.sessionId ? " AND session_id=?" : ""}`;
    return {
      items: db.all<Omit<Run, "input" | "output">>(
        `SELECT id,tenant_id,user_id,session_id,agent_id,agent_version,status,error_code,timeout_ms,created_at,started_at,finished_at FROM runs WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        ...params,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ),
      total: db.get<{ n: number }>(
        `SELECT count(*) n FROM runs WHERE ${where}`,
        ...params,
      )!.n,
      ...query,
    };
  });
  app.get(`${p}/runs/:id`, async (req) => {
    const a = authenticate(db, req);
    const { id } = req.params as { id: string };
    const run = db.get<Run>(
      "SELECT * FROM runs WHERE tenant_id=? AND id=?",
      a.tenantId,
      id,
    );
    if (!run) fail(404, "NOT_FOUND", "任务不存在");
    if (run.user_id !== a.userId) requirePermission(a, "read");
    return runtime.decode(run);
  });
  app.post(`${p}/runs/:id/cancel`, async (req) => {
    const a = authenticate(db, req);
    runtime.cancel(a, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.get(`${p}/sessions`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const q = pageSchema.parse(req.query);
    return {
      items: db.all(
        "SELECT s.*,count(r.id) as run_count FROM runtime_sessions s LEFT JOIN runs r ON r.session_id=s.id WHERE s.tenant_id=? GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?",
        a.tenantId,
        q.pageSize,
        (q.page - 1) * q.pageSize,
      ),
      total: db.get<{ n: number }>(
        "SELECT count(*) n FROM runtime_sessions WHERE tenant_id=?",
        a.tenantId,
      )!.n,
      ...q,
    };
  });
  app.get(`${p}/runtime`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const sandboxAvailable = await readSandboxCapability();
    return {
      engine: sandboxAvailable ? "model-and-isolated-code" : "model-only",
      arbitraryCodeExecution: sandboxAvailable,
      isolatedCodeExecution: sandboxAvailable,
      hostCodeExecution: false,
      agentToolExecution: false,
      maxConcurrentRuns: 4,
      maxRunTimeMs: 1800000,
      statuses: db.all(
        "SELECT status,count(*) as count FROM runs WHERE tenant_id=? GROUP BY status",
        a.tenantId,
      ),
    };
  });
}
