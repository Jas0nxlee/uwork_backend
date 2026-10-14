import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, departmentsOf, requirePermission } from "./access.js";
import { audit } from "./events.js";
import { fail, id, now, text, type Actor } from "./core.js";

interface Subscription {
  seats: number;
  credits: number;
  starts_at: number;
  ends_at: number;
  metering: string;
}
export function billingPeriod(time: number, startsAt: number, mode: string) {
  const current = new Date(time);
  const anchor = new Date(startsAt);
  if (mode === "calendar")
    return String(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const anniversary = (year: number, month: number) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    );
  };
  const thisMonth = anniversary(
    current.getUTCFullYear(),
    current.getUTCMonth(),
  );
  return String(
    time >= thisMonth
      ? thisMonth
      : anniversary(current.getUTCFullYear(), current.getUTCMonth() - 1),
  );
}
export class Entitlements {
  constructor(private db: Db) {}
  recoverPending() {
    this.db.run(
      "UPDATE ledger SET status='uncertain',amount=reserved,settled_at=? WHERE status='reserved'",
      now(),
    );
  }
  subscription(tenantId: string, time = now()) {
    const s = this.db.get<Subscription>(
      "SELECT * FROM subscriptions WHERE tenant_id=?",
      tenantId,
    );
    if (!s || time < s.starts_at || time >= s.ends_at)
      fail(402, "SUBSCRIPTION_INACTIVE", "订阅未生效或已过期");
    return s;
  }
  reserve(
    actor: Actor,
    key: string,
    modelId: string,
    application: string,
    amount: number,
  ) {
    return this.db.transaction(() => {
      const s = this.subscription(actor.tenantId);
      const pending = this.db.get<{ n: number }>(
        "SELECT count(*) n FROM ledger WHERE tenant_id=? AND status='reserved'",
        actor.tenantId,
      )!.n;
      if (pending >= 16) fail(429, "CONCURRENCY_LIMIT", "组织并发调用已达上限");
      if (!actor.seat) fail(403, "NO_SEAT", "未分配席位");
      if (
        this.db.get(
          "SELECT id FROM ledger WHERE tenant_id=? AND request_key=?",
          actor.tenantId,
          key,
        )
      )
        fail(409, "REQUEST_EXISTS", "请求已经处理或正在处理");
      const period = billingPeriod(now(), s.starts_at, s.metering);
      const limits = [
        {
          subject_type: "tenant",
          subject_id: actor.tenantId,
          amount: s.credits,
        },
        ...this.db.all<{
          subject_type: string;
          subject_id: string;
          amount: number;
        }>("SELECT * FROM limits WHERE tenant_id=?", actor.tenantId),
      ];
      const ancestors = departmentsOf(
        this.db,
        actor.tenantId,
        actor.departmentId,
      );
      for (const limit of limits) {
        let condition = "",
          args: string[] = [];
        if (limit.subject_type === "member") {
          if (limit.subject_id !== actor.userId) continue;
          condition = " AND user_id=?";
          args = [actor.userId];
        } else if (limit.subject_type === "application") {
          if (limit.subject_id !== application) continue;
          condition = " AND application=?";
          args = [application];
        } else if (limit.subject_type === "department") {
          if (!ancestors.includes(limit.subject_id)) continue;
          const all = this.db
            .all<{ id: string }>(
              "SELECT id FROM departments WHERE tenant_id=?",
              actor.tenantId,
            )
            .filter((d) =>
              departmentsOf(this.db, actor.tenantId, d.id).includes(
                limit.subject_id,
              ),
            )
            .map((d) => d.id);
          condition = ` AND department_id IN (${all.map(() => "?").join(",")})`;
          args = all;
        }
        const used = this.db.get<{ used: number }>(
          `SELECT coalesce(sum(CASE WHEN status='reserved' THEN reserved ELSE amount END),0) as used FROM ledger WHERE tenant_id=? AND period=? AND status IN ('reserved','settled','uncertain')${condition}`,
          actor.tenantId,
          period,
          ...args,
        )!.used;
        if (used + amount > limit.amount)
          fail(402, "QUOTA_EXCEEDED", "可用额度不足");
      }
      const reservationId = id();
      this.db.run(
        "INSERT INTO ledger(id,tenant_id,request_key,user_id,department_id,application,model_id,period,amount,reserved,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        reservationId,
        actor.tenantId,
        key,
        actor.userId,
        actor.departmentId,
        application,
        modelId,
        period,
        0,
        amount,
        "reserved",
        now(),
      );
      return reservationId;
    });
  }
  settle(
    reservationId: string,
    amount: number,
    inputTokens: number,
    outputTokens: number,
  ) {
    this.db.transaction(() => {
      const entry = this.db.get<{ status: string; reserved: number }>(
        "SELECT status,reserved FROM ledger WHERE id=?",
        reservationId,
      );
      if (!entry || entry.status !== "reserved") return;
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > entry.reserved
      )
        fail(502, "METERING_INVALID", "上游消费超出预留限制");
      this.db.run(
        "UPDATE ledger SET status='settled',amount=?,input_tokens=?,output_tokens=?,settled_at=? WHERE id=? AND status='reserved'",
        amount,
        inputTokens,
        outputTokens,
        now(),
        reservationId,
      );
    });
  }
  release(reservationId: string) {
    this.db.run(
      "UPDATE ledger SET status='released',settled_at=? WHERE id=? AND status='reserved'",
      now(),
      reservationId,
    );
  }
  uncertain(reservationId: string) {
    this.db.run(
      "UPDATE ledger SET status='uncertain',amount=reserved,settled_at=? WHERE id=? AND status='reserved'",
      now(),
      reservationId,
    );
  }
}
export function entitlementRoutes(app: FastifyInstance, db: Db) {
  const path = "/api/tenants/:tenantId";
  app.get(`${path}/subscription`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const s = db.get<Subscription>(
      "SELECT * FROM subscriptions WHERE tenant_id=?",
      a.tenantId,
    )!;
    const period = billingPeriod(now(), s.starts_at, s.metering);
    return {
      ...s,
      period,
      assignedSeats: db.get<{ n: number }>(
        "SELECT count(*) n FROM members WHERE tenant_id=? AND seat=1",
        a.tenantId,
      )!.n,
      usage: db.get(
        "SELECT coalesce(sum(amount),0) as consumed,coalesce(sum(CASE WHEN status='reserved' THEN reserved ELSE 0 END),0) as reserved FROM ledger WHERE tenant_id=? AND period=?",
        a.tenantId,
        period,
      ),
      billingProvider: "local-ledger",
    };
  });
  app.put(`${path}/subscription`, async (req) => {
    const a = authenticate(db, req);
    if (a.role !== "owner" || a.kind !== "session")
      fail(403, "FORBIDDEN", "仅所有者可维护本地订阅");
    const d = z
      .object({
        seats: z.number().int().min(1).max(1000000),
        credits: z.number().int().min(0).max(1e12),
        startsAt: z.number().int().nonnegative(),
        endsAt: z.number().int().positive(),
        metering: z.enum(["calendar", "subscription"]),
      })
      .strict()
      .refine((d) => d.endsAt > d.startsAt)
      .parse(req.body);
    const assigned = db.get<{ n: number }>(
      "SELECT count(*) n FROM members WHERE tenant_id=? AND seat=1",
      a.tenantId,
    )!.n;
    if (d.seats < assigned) fail(409, "SEATS_ASSIGNED", "席位数小于已分配数量");
    db.run(
      "UPDATE subscriptions SET seats=?,credits=?,starts_at=?,ends_at=?,metering=? WHERE tenant_id=?",
      d.seats,
      d.credits,
      d.startsAt,
      d.endsAt,
      d.metering,
      a.tenantId,
    );
    audit(db, a, "entitlements.subscription.update");
    return { ok: true };
  });
  app.get(`${path}/limits`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db.all(
      "SELECT subject_type,subject_id,amount FROM limits WHERE tenant_id=?",
      a.tenantId,
    );
  });
  app.put(`${path}/limits`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({
        subjectType: z.enum(["tenant", "member", "department", "application"]),
        subjectId: text,
        amount: z.number().int().min(0).max(1e12),
      })
      .strict()
      .parse(req.body);
    if (
      (d.subjectType === "tenant" && d.subjectId !== a.tenantId) ||
      (d.subjectType === "member" &&
        !db.get(
          "SELECT user_id FROM members WHERE tenant_id=? AND user_id=?",
          a.tenantId,
          d.subjectId,
        )) ||
      (d.subjectType === "department" &&
        !db.get(
          "SELECT id FROM departments WHERE tenant_id=? AND id=?",
          a.tenantId,
          d.subjectId,
        ))
    )
      fail(400, "INVALID_SUBJECT", "限量对象不存在");
    db.run(
      "INSERT INTO limits VALUES(?,?,?,?) ON CONFLICT(tenant_id,subject_type,subject_id) DO UPDATE SET amount=excluded.amount",
      a.tenantId,
      d.subjectType,
      d.subjectId,
      d.amount,
    );
    audit(db, a, "entitlements.limit.update", d.subjectId);
    return { ok: true };
  });
  app.delete(`${path}/limits/:type/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const p = req.params as { type: string; id: string };
    db.run(
      "DELETE FROM limits WHERE tenant_id=? AND subject_type=? AND subject_id=?",
      a.tenantId,
      p.type,
      p.id,
    );
    audit(db, a, "entitlements.limit.delete", p.id);
    reply.code(204);
  });
  app.put(`${path}/usage/:id/reconcile`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({
        amount: z.number().int().min(0).max(1e12),
        evidenceReference: text,
      })
      .strict()
      .parse(req.body);
    const entryId = (req.params as { id: string }).id;
    db.transaction(() => {
      const entry = db.get<{ status: string; reserved: number }>(
        "SELECT status,reserved FROM ledger WHERE tenant_id=? AND id=?",
        a.tenantId,
        entryId,
      );
      if (!entry) fail(404, "NOT_FOUND", "账目不存在");
      if (entry.status !== "uncertain" || d.amount > entry.reserved)
        fail(
          409,
          "RECONCILIATION_CONFLICT",
          "仅可对待核实账目在预留范围内核实",
        );
      db.run(
        "UPDATE ledger SET status='settled',amount=?,settled_at=? WHERE tenant_id=? AND id=? AND status='uncertain'",
        d.amount,
        now(),
        a.tenantId,
        entryId,
      );
      audit(db, a, "entitlements.reconcile", entryId, {
        amount: d.amount,
        evidenceReference: d.evidenceReference,
      });
    });
    return { ok: true };
  });
}
