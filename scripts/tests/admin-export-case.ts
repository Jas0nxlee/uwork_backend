import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminExportCase(p: AdminUiCasePorts) {
  for (const phase of [1, 2])
    await p.api("/v1/chat/completions", "POST", {
      model: p.control.modelId,
      messages: [{ role: "user", content: "OWNED_CSV_" + phase }],
      max_tokens: 32,
    });
  for (const type of ["configuration.applied", "asset.installed"])
    await p.api(
      "/api/client/events",
      "POST",
      {
        eventKey: "owned-csv-" + type,
        type,
        data: { version: 1 },
      },
      202,
    );
  const db = p.app.services.db;
  const snapshot = () =>
    Object.fromEntries(
      ["ledger", "traces", "client_events"].map((table) => [
        table,
        db.all<Row>(`SELECT * FROM ${table} ORDER BY id`),
      ]),
    );
  const before = snapshot();
  const result = (await p.run("export-all")) as Row;
  assert.deepEqual(
    (result.downloads as Row[]).map((row) => [row.route, row.rows]),
    [
      ["usage", 2],
      ["traces", 2],
      ["client-events", 1],
      ["audit", 1],
      ["usage", 0],
    ],
  );
  assert.deepEqual(snapshot(), before);
  const exports = db.all<Row>(
    "SELECT action,metadata FROM audit WHERE action LIKE 'telemetry.%.export' ORDER BY created_at,id",
  );
  assert.equal(exports.length, 5);
  const counts = exports.map((row) => [
    row.action,
    JSON.parse(String(row.metadata)).rows,
  ]);
  for (const expected of [
    ["telemetry.usage.export", 2],
    ["telemetry.usage.export", 0],
    ["telemetry.traces.export", 2],
    ["telemetry.client-events.export", 1],
    ["telemetry.audit.export", 1],
  ])
    assert.equal(
      counts.filter((row) => JSON.stringify(row) === JSON.stringify(expected))
        .length,
      1,
    );
  assert.equal(p.supplier.length, 2);
  const traffic = p.traffic.filter((row) => row.source === "browser");
  for (const path of ["usage", "traces", "client-events", "audit"])
    assert.ok(
      traffic.some(
        (row) =>
          row.method === "GET" &&
          row.route === "/api/tenants/:tenantId/" + path &&
          row.status === 200,
      ),
    );
  p.facts.status = "passed";
  p.facts.csvDownloads = result.downloads;
  p.facts.exportAudits = counts;
  p.facts.ledgerTraceEventRowsUnchanged = true;
  p.facts.noAdditionalSupplierOrBilling = true;
}
