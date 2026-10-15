import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { audit, type RetentionPorts } from "./events.js";
import { csv, now, pageSchema, parseJson } from "./core.js";

export const DEFAULT_RETENTION_DAYS = 90;
/** 企业级留存天数：写入 tenants.settings，未配置时为 undefined（调用方决定默认值）。 */
export const retentionSchema = z.object({
  days: z.number().int().min(7).max(3650),
});
export function tenantSettings(
  db: Db,
  tenantId: string,
): Record<string, unknown> {
  const row = db.get<{ settings: string | null }>(
    "SELECT settings FROM tenants WHERE id=?",
    tenantId,
  );
  return row?.settings ? parseJson<Record<string, unknown>>(row.settings) : {};
}
export function tenantRetentionDays(
  db: Db,
  tenantId: string,
): number | undefined {
  const value = tenantSettings(db, tenantId).retentionDays;
  return typeof value === "number" &&
    retentionSchema.shape.days.safeParse(value).success
    ? value
    : undefined;
}
export function purgeTenantTelemetry(
  db: Db,
  retention: RetentionPorts,
  tenantId: string,
  before: number,
): Record<string, number> {
  return db.transaction(() => {
    const counts: Record<string, number> = {};
    for (const table of ["audit", "traces", "client_events"] as const)
      counts[table] = Number(
        db.run(
          `DELETE FROM ${table} WHERE tenant_id=? AND created_at<?`,
          tenantId,
          before,
        ).changes,
      );
    // 计费调用记录保留 1 天用于对账；运行与沙箱执行按企业留存窗口清理。
    counts.gateway_calls = retention.purgeCalls(tenantId, now() - 86400000);
    counts.runs = retention.purgeRuns(tenantId, before);
    counts.sandbox_executions = retention.purgeSandbox(tenantId, before);
    retention.purgeIdentity(now());
    return counts;
  });
}
/**
 * 后台留存巡检：只处理显式配置了留存天数的企业，未配置的企业保持原状，
 * 由管理员显式设置后再进入自动清理，避免默认值静默删除历史。
 */
export function retentionSweep(
  db: Db,
  retention: RetentionPorts,
  time: number,
): { tenants: number; purged: number } {
  const tenants = db.all<{ id: string }>(
    "SELECT id FROM tenants WHERE settings IS NOT NULL",
  );
  let purged = 0,
    swept = 0;
  for (const tenant of tenants) {
    const days = tenantRetentionDays(db, tenant.id);
    if (days === undefined) continue;
    const counts = purgeTenantTelemetry(
      db,
      retention,
      tenant.id,
      time - days * 86400000,
    );
    purged += Object.values(counts).reduce((sum, value) => sum + value, 0);
    swept++;
  }
  return { tenants: swept, purged };
}
export function telemetryRoutes(
  app: FastifyInstance,
  db: Db,
  retention: RetentionPorts,
) {
  const p = "/api/tenants/:tenantId";
  const query = pageSchema.extend({
    from: z.coerce.number().int().nonnegative().default(0),
    to: z.coerce.number().int().positive().default(Number.MAX_SAFE_INTEGER),
    userId: z.string().max(80).optional(),
    application: z.string().max(80).optional(),
    status: z.string().max(30).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  });
  for (const [route, table, dateColumn, columns] of [
    [
      "audit",
      "audit",
      "created_at",
      ["id", "user_id", "action", "target", "created_at"],
    ],
    [
      "traces",
      "traces",
      "created_at",
      [
        "id",
        "user_id",
        "application",
        "model_id",
        "status",
        "input_tokens",
        "output_tokens",
        "duration_ms",
        "error_code",
        "created_at",
      ],
    ],
    [
      "usage",
      "ledger",
      "created_at",
      [
        "id",
        "user_id",
        "department_id",
        "application",
        "model_id",
        "period",
        "amount",
        "reserved",
        "status",
        "input_tokens",
        "output_tokens",
        "created_at",
      ],
    ],
    [
      "client-events",
      "client_events",
      "created_at",
      ["id", "user_id", "type", "created_at"],
    ],
  ] as const) {
    app.get(`${p}/${route}`, async (req, reply) => {
      const a = authenticate(db, req);
      requirePermission(a, "read");
      const q = query.parse(req.query);
      const args: (string | number)[] = [a.tenantId, q.from, q.to];
      let where = `tenant_id=? AND ${dateColumn}>=? AND ${dateColumn}<?`;
      if (q.userId) {
        where += " AND user_id=?";
        args.push(q.userId);
      }
      if ((table === "traces" || table === "ledger") && q.application) {
        where += " AND application=?";
        args.push(q.application);
      }
      if ((table === "traces" || table === "ledger") && q.status) {
        where += " AND status=?";
        args.push(q.status);
      }
      if (q.q) {
        where += ` AND ${table === "audit" ? "action" : table === "client_events" ? "type" : "model_id"} LIKE ?`;
        args.push(`%${q.q}%`);
      }
      const rows = db.all<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY ${dateColumn} DESC,id LIMIT ? OFFSET ?`,
        ...args,
        q.format === "csv" ? 10000 : q.pageSize,
        q.format === "csv" ? 0 : (q.page - 1) * q.pageSize,
      );
      if (q.format === "csv") {
        audit(db, a, `telemetry.${route}.export`, undefined, {
          rows: rows.length,
        });
        return reply
          .type("text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${route}.csv"`)
          .send(csv(rows, [...columns]));
      }
      return {
        items: rows.map((r) => ({
          ...r,
          ...(typeof r.metadata === "string"
            ? { metadata: parseJson<unknown>(r.metadata) }
            : {}),
          ...(typeof r.data === "string"
            ? { data: parseJson<unknown>(r.data) }
            : {}),
        })),
        total: db.get<{ n: number }>(
          `SELECT count(*) n FROM ${table} WHERE ${where}`,
          ...args,
        )!.n,
        ...q,
      };
    });
  }
  app.get(`${p}/metrics`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const q = query.parse(req.query);
    const args: (string | number)[] = [a.tenantId, q.from, q.to];
    let filter = "tenant_id=? AND created_at>=? AND created_at<?";
    if (q.application) {
      filter += " AND application=?";
      args.push(q.application);
    }
    if (q.userId) {
      filter += " AND user_id=?";
      args.push(q.userId);
    }
    return {
      summary: db.get(
        `SELECT count(*) as requests,count(DISTINCT user_id) as activeUsers,coalesce(sum(input_tokens),0) as inputTokens,coalesce(sum(output_tokens),0) as outputTokens,coalesce(avg(duration_ms),0) as averageLatencyMs,coalesce(sum(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) as failures FROM traces WHERE ${filter}`,
        ...args,
      ),
      daily: db.all(
        `SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') as date,count(*) as requests,sum(input_tokens+output_tokens) as tokens,avg(duration_ms) as latencyMs FROM traces WHERE ${filter} GROUP BY date ORDER BY date`,
        ...args,
      ),
      byModel: db.all(
        `SELECT model_id,count(*) as requests,sum(input_tokens+output_tokens) as tokens FROM traces WHERE ${filter} GROUP BY model_id ORDER BY requests DESC`,
        ...args,
      ),
      credits: db.get(
        `SELECT coalesce(sum(amount),0) as consumed,coalesce(sum(CASE WHEN status='reserved' THEN reserved ELSE 0 END),0) as reserved FROM ledger WHERE ${filter}`,
        ...args,
      ),
      attribution: "local-ledger; not upstream invoice",
    };
  });
  app.get(`${p}/usage/aggregates`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const q = query
      .extend({
        groupBy: z
          .enum(["member", "department", "application"])
          .default("member"),
      })
      .parse(req.query);
    const column = {
      member: "user_id",
      department: "department_id",
      application: "application",
    }[q.groupBy];
    const args: (string | number)[] = [a.tenantId, q.from, q.to];
    let filter =
      "tenant_id=? AND created_at>=? AND created_at<? AND status='settled'";
    if (q.userId) {
      filter += " AND user_id=?";
      args.push(q.userId);
    }
    if (q.application) {
      filter += " AND application=?";
      args.push(q.application);
    }
    if (q.q) {
      filter += " AND model_id LIKE ?";
      args.push(`%${q.q}%`);
    }
    if (q.status) {
      filter += " AND status=?";
      args.push(q.status);
    }
    return db.all(
      `SELECT ${column} as subject,sum(amount) as credits,sum(input_tokens) as inputTokens,sum(output_tokens) as outputTokens,count(*) as requests FROM ledger WHERE ${filter} GROUP BY ${column} ORDER BY credits DESC LIMIT 10000`,
      ...args,
    );
  });
  app.get(`${p}/retention`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const days = tenantRetentionDays(db, a.tenantId);
    return {
      days: days ?? DEFAULT_RETENTION_DAYS,
      configured: days !== undefined,
    };
  });
  app.put(`${p}/retention`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = retentionSchema.parse(req.body ?? {});
    const settings = tenantSettings(db, a.tenantId);
    db.run(
      "UPDATE tenants SET settings=? WHERE id=?",
      JSON.stringify({ ...settings, retentionDays: d.days }),
      a.tenantId,
    );
    audit(db, a, "telemetry.retention.update", undefined, { days: d.days });
    return { days: d.days, configured: true };
  });
  app.post(`${p}/retention/purge`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({ days: retentionSchema.shape.days.optional() })
      .strict()
      .parse(req.body ?? {});
    // 未显式给出天数时按企业配置执行；未配置才回退默认值，避免清理口径漂移。
    const days =
      d.days ?? tenantRetentionDays(db, a.tenantId) ?? DEFAULT_RETENTION_DAYS;
    const counts = purgeTenantTelemetry(
      db,
      retention,
      a.tenantId,
      now() - days * 86400000,
    );
    db.transaction(() => {
      audit(db, a, "telemetry.retention.purge", undefined, { days });
    });
    return counts;
  });
}
