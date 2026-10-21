import assert from "node:assert/strict";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminSessionsCase(p: AdminUiCasePorts) {
  for (let i = 0; i < 27; i++)
    await p.api(
      p.prefix + "/runs",
      "POST",
      { agentId: p.control.agentId, input: "OWNED_SESSION_PAGE_" + i },
      202,
    );
  const db = p.app.services.db;
  await boundedWait(
    async () => db.all<Row>("SELECT * FROM runs"),
    (rows) => rows.length === 27 && rows.every((r) => r.status === "succeeded"),
    "owned session pagination setup worker",
  );
  const sessions = db.all<Row>(
    "SELECT * FROM runtime_sessions ORDER BY created_at DESC,id DESC",
  );
  const ledger = db.all<Row>("SELECT * FROM ledger ORDER BY id");
  assert.equal(sessions.length, 27);
  assert.equal(ledger.length, 27);
  assert.ok(
    ledger.every((row) => row.status === "settled" && row.amount === 14),
  );
  assert.equal(p.supplier.length, 27);
  p.control.sessionSearch = sessions[13]!.id;
  p.control.sessionAgentId = p.control.agentId;
  await p.saveControl();
  const first = (await p.run("sessions-first")) as Row;
  const second = (await p.run("sessions-next")) as Row;
  const previous = (await p.run("sessions-previous")) as Row;
  assert.deepEqual(previous.rows, first.rows);
  const actualRows = [...(first.rows as Row[]), ...(second.rows as Row[])];
  assert.deepEqual(
    actualRows.map((r) => r.id),
    sessions.map((r) => r.id),
  );
  assert.ok(
    actualRows.every(
      (row) =>
        row.agentId === p.control.agentId &&
        row.userId === p.control.userId &&
        row.runCount === 1,
    ),
  );
  await p.run("sessions-search-detail");
  await p.run("sessions-empty");
  await p.run("sessions-reset-reload");
  assert.deepEqual(
    db.all<Row>(
      "SELECT * FROM runtime_sessions ORDER BY created_at DESC,id DESC",
    ),
    sessions,
  );
  assert.deepEqual(db.all<Row>("SELECT * FROM ledger ORDER BY id"), ledger);
  assert.equal(p.supplier.length, 27);
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM runs")!.n, 27);
  const writes = p.traffic.filter(
    (row) => row.source === "browser" && row.method !== "GET",
  );
  assert.deepEqual(
    writes.map((row) => row.route),
    ["/api/auth/login"],
  );
  p.facts.sessions = {
    exactIdsAndColumns: true,
    total: 27,
    pageSizes: [25, 2],
    originalSearchDetailEmptyReset: true,
    readActionsZeroModelLedgerDelta: true,
    setupModelCalls: 27,
    setupSettledCredit: 378,
  };
  p.facts.status = "passed";
}
