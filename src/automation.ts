import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Runtime, Run } from "./runtime.js";
import type { Vault } from "./vault.js";
import { authenticate, requirePermission, currentActor } from "./access.js";
import { audit } from "./events.js";
import { fail, id, now, text } from "./core.js";
import { safeRequest } from "./network.js";

export const scheduleSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("once"), at: z.number().int().positive() })
    .strict(),
  z
    .object({
      type: z.literal("interval"),
      seconds: z.number().int().min(60).max(31536000),
    })
    .strict(),
  z
    .object({ type: z.literal("cron"), expression: z.string().min(9).max(200) })
    .strict(),
]);
export type Schedule = z.infer<typeof scheduleSchema>;
export function nextOccurrence(
  schedule: Schedule,
  timezone: string,
  after: number,
): number | null {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    fail(400, "INVALID_TIMEZONE", "时区不正确");
  }
  if (schedule.type === "once") return schedule.at > after ? schedule.at : null;
  if (schedule.type === "interval") return after + schedule.seconds * 1000;
  try {
    return CronExpressionParser.parse(schedule.expression, {
      tz: timezone,
      currentDate: new Date(after),
    })
      .next()
      .getTime();
  } catch {
    fail(400, "INVALID_CRON", "Cron 表达式不正确");
  }
}
interface Automation {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  agent_id: string;
  input: string;
  schedule: string;
  timezone: string;
  enabled: number;
  next_at: number | null;
  ends_at: number | null;
  webhook_credential_id: string | null;
}
export class AutomationWorker {
  private deliveryWork: Promise<void> | undefined;
  constructor(
    private db: Db,
    private runtime: Runtime,
    private vault: Vault,
    private allowPrivate: boolean,
  ) {}
  tick(time = now()) {
    for (const task of this.db.all<Automation>(
      "SELECT * FROM automations WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 100",
      time,
    )) {
      this.db.transaction(() => {
        const due = task.next_at!;
        const schedule = JSON.parse(task.schedule) as Schedule;
        const next = nextOccurrence(schedule, task.timezone, time);
        this.db.run(
          "UPDATE automations SET next_at=?,enabled=? WHERE id=? AND next_at=?",
          next,
          next && (!task.ends_at || next <= task.ends_at) ? 1 : 0,
          task.id,
          due,
        );
        if (task.ends_at && due > task.ends_at) return;
        if (
          this.db.get(
            "SELECT id FROM runs WHERE tenant_id=? AND trigger_key LIKE ? AND status IN ('queued','running')",
            task.tenant_id,
            `automation:${task.id}:%`,
          )
        )
          return;
        try {
          const actor = currentActor(this.db, task.tenant_id, task.user_id);
          const runId = this.runtime.enqueue(
            actor,
            task.agent_id,
            this.vault.open(
              task.input,
              `${task.tenant_id}:${task.id}:automation`,
            ),
            1800000,
            undefined,
            `automation:${task.id}:${due}`,
          );
          if (task.webhook_credential_id)
            this.db.run(
              "INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?,?,0,?,NULL)",
              id(),
              task.tenant_id,
              runId,
              task.webhook_credential_id,
              "pending",
              time,
            );
        } catch {
          this.db.run("UPDATE automations SET enabled=0 WHERE id=?", task.id);
          audit(
            this.db,
            { tenantId: task.tenant_id, userId: task.user_id },
            "automation.admission.failed",
            task.id,
          );
        }
      });
    }
  }
  deliver(time = now()): Promise<void> {
    if (!this.deliveryWork)
      this.deliveryWork = this.performDelivery(time).finally(() => {
        this.deliveryWork = undefined;
      });
    return this.deliveryWork;
  }
  async stop() {
    await this.deliveryWork;
  }
  private async performDelivery(time: number) {
    const rows = this.db.all<{
      id: string;
      tenant_id: string;
      run_id: string;
      credential_id: string;
      attempts: number;
    }>(
      "SELECT d.* FROM deliveries d JOIN runs r ON r.id=d.run_id WHERE d.status='pending' AND d.next_at<=? AND r.status NOT IN ('queued','running') LIMIT 20",
      time,
    );
    for (const d of rows) {
      try {
        const credential = this.vault.read(d.tenant_id, d.credential_id);
        const target = z
          .object({
            url: z.url(),
            token: z.string().optional(),
            type: z.enum(["webhook", "feishu"]).default("webhook"),
          })
          .parse(JSON.parse(credential));
        const run = this.runtime.decode(
          this.db.get<Run>(
            "SELECT * FROM runs WHERE tenant_id=? AND id=?",
            d.tenant_id,
            d.run_id,
          )!,
        );
        const payload =
          target.type === "feishu"
            ? {
                msg_type: "text",
                content: {
                  text:
                    run.output ?? `任务 ${run.status}: ${run.error_code ?? ""}`,
                },
              }
            : {
                event: "run.completed",
                id: run.id,
                status: run.status,
                output: run.output,
                error: run.error_code,
              };
        const response = await safeRequest(
          target.url,
          {
            method: "POST",
            body: payload,
            token: target.token,
            timeout: 15000,
            onDispatch: () => {
              requirePermission(
                currentActor(this.db, d.tenant_id, run.user_id),
                "execute",
              );
              if (this.vault.read(d.tenant_id, d.credential_id) !== credential)
                fail(409, "CREDENTIAL_CHANGED", "通知凭据在请求前已变更");
            },
          },
          this.allowPrivate,
        );
        try {
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw new Error("delivery rejected");
        } finally {
          await response.close();
        }
        this.db.run(
          "UPDATE deliveries SET status='sent',attempts=attempts+1,error_code=NULL WHERE id=?",
          d.id,
        );
      } catch {
        this.db.run(
          "UPDATE deliveries SET status=?,attempts=attempts+1,next_at=?,error_code=? WHERE id=?",
          d.attempts >= 2 ? "failed" : "pending",
          time + 60000 * 2 ** d.attempts,
          "DELIVERY_FAILED",
          d.id,
        );
      }
    }
  }
}
export function automationRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: Runtime,
  vault: Vault,
) {
  const path = "/api/tenants/:tenantId/automations";
  const schema = z
    .object({
      name: text,
      agentId: text,
      input: z.string().min(1).max(100000),
      schedule: scheduleSchema,
      timezone: z.string().max(80).default("Asia/Shanghai"),
      endsAt: z.number().int().positive().nullable().default(null),
      webhookCredentialId: text.nullable().default(null),
      enabled: z.boolean().default(true),
    })
    .strict();
  app.get(path, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db
      .all<Automation>(
        "SELECT * FROM automations WHERE tenant_id=? ORDER BY created_at DESC",
        a.tenantId,
      )
      .map(({ input, ...r }) => {
        void input;
        return { ...r, schedule: JSON.parse(r.schedule) as Schedule };
      });
  });
  app.post(path, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const d = schema.parse(req.body);
    runtime.agent(a, d.agentId);
    const next = nextOccurrence(d.schedule, d.timezone, now());
    if (!next || (d.endsAt && next > d.endsAt))
      fail(400, "SCHEDULE_EXPIRED", "计划没有有效的未来时间");
    if (d.webhookCredentialId) vault.read(a.tenantId, d.webhookCredentialId);
    const taskId = id();
    db.run(
      "INSERT INTO automations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      taskId,
      a.tenantId,
      a.userId,
      d.name,
      d.agentId,
      vault.seal(d.input, `${a.tenantId}:${taskId}:automation`),
      JSON.stringify(d.schedule),
      d.timezone,
      +d.enabled,
      next,
      d.endsAt,
      d.webhookCredentialId,
      now(),
    );
    audit(db, a, "automation.create", taskId);
    reply.code(201);
    return { id: taskId, nextAt: next };
  });
  app.patch(`${path}/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const task = db.get<Automation>(
      "SELECT * FROM automations WHERE tenant_id=? AND id=?",
      a.tenantId,
      id,
    );
    if (!task) fail(404, "NOT_FOUND", "自动化不存在");
    const next = nextOccurrence(
      JSON.parse(task.schedule) as Schedule,
      task.timezone,
      now(),
    );
    if (enabled && (!next || (task.ends_at && next > task.ends_at)))
      fail(400, "SCHEDULE_EXPIRED", "计划已到期");
    db.run(
      "UPDATE automations SET enabled=?,next_at=? WHERE id=?",
      +enabled,
      next,
      id,
    );
    audit(db, a, "automation.toggle", id);
    return { ok: true };
  });
  app.delete(`${path}/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    if (
      !db.run(
        "DELETE FROM automations WHERE tenant_id=? AND id=?",
        a.tenantId,
        id,
      ).changes
    )
      fail(404, "NOT_FOUND", "自动化不存在");
    audit(db, a, "automation.delete", id);
    reply.code(204);
  });
  app.get("/api/tenants/:tenantId/deliveries", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db.all(
      "SELECT id,run_id,status,attempts,next_at,error_code FROM deliveries WHERE tenant_id=? ORDER BY next_at DESC LIMIT 100",
      a.tenantId,
    );
  });
}
