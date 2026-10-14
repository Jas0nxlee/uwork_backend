import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { audit, type RetentionPorts } from "./events.js";
import { csv, now, pageSchema, parseJson } from "./core.js";

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
    return db.all(
      `SELECT ${column} as subject,sum(amount) as credits,sum(input_tokens) as inputTokens,sum(output_tokens) as outputTokens,count(*) as requests FROM ledger WHERE tenant_id=? AND created_at>=? AND created_at<? AND status='settled' GROUP BY ${column} ORDER BY credits DESC LIMIT 10000`,
      a.tenantId,
      q.from,
      q.to,
    );
  });
  app.post(`${p}/retention/purge`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({ days: z.number().int().min(7).max(3650).default(90) })
      .strict()
      .parse(req.body ?? {});
    const before = now() - d.days * 86400000;
    return db.transaction(() => {
      const counts: Record<string, number> = {};
      for (const table of ["audit", "traces", "client_events"] as const)
        counts[table] = Number(
          db.run(
            `DELETE FROM ${table} WHERE tenant_id=? AND created_at<?`,
            a.tenantId,
            before,
          ).changes,
        );
      counts.gateway_calls = retention.purgeCalls(a.tenantId, now() - 86400000);
      counts.runs = retention.purgeRuns(a.tenantId, before);
      counts.sandbox_executions = retention.purgeSandbox(a.tenantId, before);
      retention.purgeIdentity(now());
      audit(db, a, "telemetry.retention.purge", undefined, { days: d.days });
      return counts;
    });
  });
}
