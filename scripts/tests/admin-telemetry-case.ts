import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminTelemetryCase(p: AdminUiCasePorts) {
  const db = p.app.services.db;
  const tenantId = p.control.tenantId as string;
  for (const phase of ["old", "recent"]) {
    await p.api("/v1/chat/completions", "POST", {
      model: p.control.modelId,
      messages: [{ role: "user", content: "OWNED_RETENTION_" + phase }],
      max_tokens: 32,
    });
    await p.api(
      "/api/client/events",
      "POST",
      {
        eventKey: "owned-retention-" + phase,
        type: "configuration.applied",
        data: { version: phase === "old" ? 1 : 2 },
      },
      202,
    );
  }
  assert.equal(p.supplier.length, 2);
  // 初次worker巡检与手动清理共用留存所有者；先让首个1秒tick在未配置状态运行。
  // 否则夹具刚老化的记录可能在原按钮点击前已被后台正确清理。
  assert.equal((await p.api(p.prefix + "/retention")).configured, false);
  await delay(1100);
  await p.api(p.prefix + "/retention", "PUT", { days: 7 });
  const foreign = randomUUID();
  db.run(
    "INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)",
    foreign,
    "Owned foreign retention",
    Date.now(),
  );
  const tables = [
    "audit",
    "traces",
    "client_events",
    "gateway_calls",
    "ledger",
  ] as const;
  const all = (table: (typeof tables)[number], tenant: string) =>
    db.all<Row>(
      `SELECT * FROM ${table} WHERE tenant_id=? ORDER BY created_at,id`,
      tenant,
    );
  // gateway_calls uses its request key as the primary key, rather than an id column.
  const rows = (table: (typeof tables)[number], tenant: string) =>
    table === "gateway_calls"
      ? db.all<Row>(
          "SELECT * FROM gateway_calls WHERE tenant_id=? ORDER BY request_key",
          tenant,
        )
      : all(table, tenant);
  const aged: Partial<Record<(typeof tables)[number], Row>> = {};
  const recent: Partial<Record<(typeof tables)[number], Row[]>> = {};
  const foreignRows: Partial<Record<(typeof tables)[number], Row[]>> = {};
  for (const table of tables) {
    const chosen = rows(table, tenantId).find(
      (row) => table !== "audit" || row.action === "vault.create",
    )!;
    assert.ok(chosen, "actual producer record required");
    const key = table === "gateway_calls" ? "request_key" : "id";
    db.run(
      `UPDATE ${table} SET created_at=? WHERE tenant_id=? AND ${key}=?`,
      Date.now() - (table === "gateway_calls" ? 2 : 8) * 86400000,
      tenantId,
      chosen[key] as string,
    );
    aged[table] = rows(table, tenantId).find(
      (row) => row[key] === chosen[key],
    )!;
    recent[table] = rows(table, tenantId).filter(
      (row) => row[key] !== chosen[key],
    );
    const copy = { ...aged[table], tenant_id: foreign, [key]: randomUUID() };
    const columns = Object.keys(copy);
    db.run(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      ...columns.map((column) => copy[column] as string | number | null),
    );
    foreignRows[table] = rows(table, foreign);
  }
  const ledger = db.all<Row>("SELECT * FROM ledger ORDER BY id");
  assert.equal(ledger.length, 3);
  assert.ok(
    ledger.every((row) => row.status === "settled" && row.amount === 14),
  );
  p.facts.preUiTotals = {};
  for (const path of ["usage", "traces", "client-events"]) {
    const data = await p.api(p.prefix + "/" + path);
    (p.facts.preUiTotals as Row)[path] = data.total;
    assert.equal(data.total, 2);
  }
  await p.run("inspect-before-purge");
  await p.run("purge-aged");
  for (const table of tables) {
    assert.deepEqual(rows(table, foreign), foreignRows[table]);
    const after = rows(table, tenantId);
    for (const row of recent[table]!)
      assert.ok(
        after.some((value) => JSON.stringify(value) === JSON.stringify(row)),
        "recent row retained exactly",
      );
    if (table !== "ledger") {
      const key = table === "gateway_calls" ? "request_key" : "id";
      assert.equal(
        after.some((row) => row[key] === aged[table]![key]),
        false,
      );
    }
  }
  assert.deepEqual(db.all<Row>("SELECT * FROM ledger ORDER BY id"), ledger);
  await p.run("inspect-after-purge");
  await p.run("purge-again");
  assert.deepEqual(db.all<Row>("SELECT * FROM ledger ORDER BY id"), ledger);
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE tenant_id=? AND action='telemetry.retention.purge'",
      tenantId,
    )!.n,
    2,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "POST" &&
        row.route === "/api/tenants/:tenantId/retention/purge" &&
        row.status === 200,
    ).length,
    2,
  );
  for (const path of [
    "/usage",
    "/traces",
    "/client-events",
    "/usage/aggregates",
  ])
    assert.ok(
      browser.filter(
        (row) =>
          row.method === "GET" &&
          row.route === "/api/tenants/:tenantId" + path &&
          row.status === 200,
      ).length >= 2,
    );
  assert.equal(p.supplier.length, 2);
  p.facts.status = "passed";
  p.facts.agedRowsDeleted = {
    audit: 1,
    traces: 1,
    client_events: 1,
    gateway_calls: 1,
  };
  p.facts.recentAndOtherTenantRowsUnchanged = true;
  p.facts.ledgerPreservedExactly = true;
  p.facts.currentTenantUsage = {
    requests: 2,
    credits: 28,
    inputTokens: 24,
    outputTokens: 4,
  };
  p.facts.repeatedCleanupIdempotent = true;
}
