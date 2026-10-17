import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { billingPeriod, type Entitlements } from "./entitlements.js";
import { now } from "./core.js";
export function clientUsageRoutes(
  app: FastifyInstance,
  db: Db,
  entitlements: Entitlements,
) {
  app.get("/api/client/entitlement", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    const s = db.get<{
      credits: number;
      starts_at: number;
      ends_at: number;
      metering: string;
    }>("SELECT * FROM subscriptions WHERE tenant_id=?", a.tenantId)!;
    const period = billingPeriod(now(), s.starts_at, s.metering);
    const member = db.get<{ amount: number }>(
      "SELECT amount FROM limits WHERE tenant_id=? AND subject_type='member' AND subject_id=?",
      a.tenantId,
      a.userId,
    );
    const used = db.get<{ n: number }>(
      "SELECT coalesce(sum(amount),0) n FROM ledger WHERE tenant_id=? AND user_id=? AND period=? AND status IN ('settled','uncertain')",
      a.tenantId,
      a.userId,
      period,
    )!.n;
    return {
      planId: a.tenantId,
      planTitle: "成员 Credit（共享企业上限）",
      amountTotal: member?.amount ?? s.credits,
      amountUsed: used,
      nextResetTime: null,
      status: s.starts_at <= now() && now() < s.ends_at ? "active" : "inactive",
      unit: "credits",
      effectiveAllowance: entitlements.effectiveAllowance(a, "uwork"),
    };
  });
  app.get("/api/client/usage", async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    const q = z
      .object({
        period: z.enum(["7d", "month", "30d"]).default("month"),
        metric: z.enum(["requests", "cost", "tokens"]).default("requests"),
      })
      .parse(req.query);
    const end = now();
    const from =
      q.period === "month"
        ? Date.UTC(
            new Date(end).getUTCFullYear(),
            new Date(end).getUTCMonth(),
            1,
          )
        : end - (q.period === "7d" ? 7 : 30) * 86400000;
    const args = [a.tenantId, a.userId, from, end];
    const summary = db.get<{
      requestCount: number;
      successCount: number;
      promptTokens: number;
      completionTokens: number;
    }>(
      "SELECT count(*) requestCount,coalesce(sum(CASE WHEN status='succeeded' THEN 1 ELSE 0 END),0) successCount,coalesce(sum(input_tokens),0) promptTokens,coalesce(sum(output_tokens),0) completionTokens FROM traces WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<?",
      ...args,
    )!;
    const cost = db.get<{ n: number }>(
      "SELECT coalesce(sum(amount),0) n FROM ledger WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<?",
      ...args,
    )!.n;
    const daily = db.all<{
      date: string;
      requestCount: number;
      tokens: number;
    }>(
      "SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') date,count(*) requestCount,sum(input_tokens+output_tokens) tokens FROM traces WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<? GROUP BY date ORDER BY date",
      ...args,
    );
    const costs = db.all<{ date: string; cost: number }>(
      "SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') date,sum(amount) cost FROM ledger WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<? GROUP BY date",
      ...args,
    );
    const models = db.all<{
      model: string;
      requestCount: number;
      cost: number;
    }>(
      `WITH facts AS (
        SELECT model_id model,1 requestCount,0 cost FROM traces
        WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<?
        UNION ALL
        SELECT model_id model,0 requestCount,amount cost FROM ledger
        WHERE tenant_id=? AND user_id=? AND created_at>=? AND created_at<?
      )
      SELECT model,sum(requestCount) requestCount,sum(cost) cost FROM facts
      GROUP BY model ORDER BY requestCount DESC,model LIMIT 400`,
      ...args,
      ...args,
    );
    const trend = new Map(daily.map((day) => [day.date, { ...day, cost: 0 }]));
    for (const day of costs) {
      const row = trend.get(day.date) ?? {
        date: day.date,
        requestCount: 0,
        tokens: 0,
        cost: 0,
      };
      row.cost = day.cost;
      trend.set(day.date, row);
    }
    return {
      ...q,
      from: new Date(from).toISOString(),
      until: new Date(end).toISOString(),
      unit: "credits",
      summary: {
        ...summary,
        successRate: summary.requestCount
          ? summary.successCount / summary.requestCount
          : 0,
        cost,
        averageCost: summary.requestCount ? cost / summary.requestCount : 0,
        totalTokens: summary.promptTokens + summary.completionTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)),
      models: models.map((m) => ({
        ...m,
        share: summary.requestCount ? m.requestCount / summary.requestCount : 0,
      })),
    };
  });
}
