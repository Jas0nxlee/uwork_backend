import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function telemetryFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-telemetry-http-"));
  const app = await createApp({
    database: join(directory, "telemetry.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = await bootstrap(app.services.db, {
    name: "Telemetry regression",
    email: "telemetry-regression@example.test",
    password: "Telemetry-regression-password!",
  });
  const origin = await app.listen({ port: 0, host: "127.0.0.1" });
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "telemetry-regression@example.test",
      password: "Telemetry-regression-password!",
    }),
  });
  assert.equal(login.status, 200);
  const { token } = (await login.json()) as { token: string };
  const get = async (path: string) => {
    const response = await fetch(`${origin}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  // Explicit reporting/fault fixtures only; no upstream calls or main database.
  const timestamp = Date.now() - 1000;
  const trace = (id: string, model: string, status = "succeeded") =>
    app.services.db.run(
      "INSERT INTO traces VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      owner.tenantId,
      owner.userId,
      "uwork",
      model,
      status,
      10,
      2,
      100,
      null,
      timestamp,
    );
  const ledger = (
    id: string,
    model: string,
    status: string,
    amount: number,
    createdAt = timestamp,
  ) =>
    app.services.db.run(
      "INSERT INTO ledger(id,tenant_id,request_key,user_id,application,model_id,period,amount,reserved,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      owner.tenantId,
      id,
      owner.userId,
      "uwork",
      model,
      "synthetic-period",
      amount,
      status === "reserved" ? 100 : amount,
      status,
      createdAt,
    );
  return {
    get,
    trace,
    ledger,
    timestamp,
    userId: owner.userId,
    p: `/api/tenants/${owner.tenantId}`,
  };
}

test("metrics apply the same combined model/status/member/application/time filters as each detail table over TCP", async (t) => {
  const f = await telemetryFixture(t);
  f.trace("chosen", "chosen-model");
  f.trace("failed", "chosen-model", "failed");
  f.trace("other", "other-model");
  f.ledger("chosen", "chosen-model", "settled", 7);
  f.ledger("uncertain", "chosen-model", "uncertain", 29);
  f.ledger("other", "other-model", "settled", 11);
  const filters = new URLSearchParams({
    q: "chosen-model",
    userId: f.userId,
    application: "uwork",
    from: String(f.timestamp),
    to: String(f.timestamp + 1),
  });
  const traces = (await f.get(`${f.p}/traces?${filters}`)) as { total: number };
  const usage = (await f.get(`${f.p}/usage?${filters}`)) as {
    items: { amount: number }[];
  };
  const metrics = (await f.get(`${f.p}/metrics?${filters}`)) as {
    summary: { requests: number };
    credits: { consumed: number };
  };
  assert.equal(metrics.summary.requests, traces.total);
  assert.equal(
    metrics.credits.consumed,
    usage.items.reduce((n, r) => n + r.amount, 0),
  );
  filters.set("status", "failed");
  const failed = (await f.get(`${f.p}/traces?${filters}`)) as { total: number };
  const failedUsage = (await f.get(`${f.p}/usage?${filters}`)) as {
    total: number;
  };
  const failedMetrics = (await f.get(`${f.p}/metrics?${filters}`)) as {
    summary: { requests: number };
    credits: { consumed: number };
  };
  assert.equal(failedMetrics.summary.requests, failed.total);
  assert.equal(failedUsage.total, 0);
  assert.equal(failedMetrics.credits.consumed, 0);
});

test("client model requests and shares count traces rather than reserved/uncertain/released ledger rows", async (t) => {
  const f = await telemetryFixture(t);
  f.trace("completed", "chosen-model");
  f.ledger("settled", "chosen-model", "settled", 7);
  f.ledger("pending", "chosen-model", "reserved", 0);
  f.ledger("uncertain", "chosen-model", "uncertain", 29);
  f.ledger("released", "chosen-model", "released", 0);
  const usage = (await f.get("/api/client/usage?period=30d")) as {
    summary: { requestCount: number; cost: number };
    models: {
      model: string;
      requestCount: number;
      cost: number;
      share: number;
    }[];
  };
  assert.equal(usage.summary.requestCount, 1);
  assert.equal(usage.summary.cost, 36);
  assert.deepEqual(usage.models, [
    { model: "chosen-model", requestCount: 1, cost: 36, share: 1 },
  ]);
});

test("client usage preserves cost-only dates/models and trace-only models without inventing requests", async (t) => {
  const f = await telemetryFixture(t);
  f.trace("trace-only", "trace-only-model");
  f.ledger(
    "cost-only",
    "cost-only-model",
    "uncertain",
    37,
    f.timestamp - 86400000,
  );
  const usage = (await f.get("/api/client/usage?period=30d")) as {
    summary: { requestCount: number; cost: number };
    trend: {
      date: string;
      requestCount: number;
      tokens: number;
      cost: number;
    }[];
    models: {
      model: string;
      requestCount: number;
      cost: number;
      share: number;
    }[];
  };
  assert.equal(usage.summary.requestCount, 1);
  assert.equal(usage.summary.cost, 37);
  assert.equal(
    usage.trend.reduce((n, d) => n + d.cost, 0),
    37,
  );
  const costDate = new Date(f.timestamp - 86400000).toISOString().slice(0, 10);
  assert.deepEqual(
    usage.trend.find((d) => d.date === costDate),
    {
      date: costDate,
      requestCount: 0,
      tokens: 0,
      cost: 37,
    },
  );
  assert.deepEqual(usage.models, [
    { model: "trace-only-model", requestCount: 1, cost: 0, share: 1 },
    { model: "cost-only-model", requestCount: 0, cost: 37, share: 0 },
  ]);
});
