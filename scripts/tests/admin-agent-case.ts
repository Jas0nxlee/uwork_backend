import assert from "node:assert/strict";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminAgentCase(p: AdminUiCasePorts) {
  const db = p.app.services.db;
  const original = db.all<Row>("SELECT * FROM resources ORDER BY id");
  await p.run("agent-create");
  const agent = db.get<Row>(
    "SELECT * FROM resources WHERE name='Owned UI versioned agent'",
  )!;
  assert.ok(agent);
  const agentId = String(agent.id);
  const runs = () =>
    db.all<Row>(
      "SELECT * FROM runs WHERE agent_id=? ORDER BY created_at,id",
      agentId,
    );
  const ledger = () =>
    db.all<Row>("SELECT * FROM ledger ORDER BY created_at,id");
  await p.run("agent-run-unpublished");
  assert.equal(runs().length, 0);
  assert.equal(p.supplier.length, 0);
  assert.equal(ledger().length, 0);
  const versionOne = db.get<Row>(
    "SELECT * FROM resource_versions WHERE resource_id=? AND version=1",
    agentId,
  );
  const execute = async (stage: string, count: number, version: number) => {
    await p.run(stage);
    await boundedWait(
      async () => runs(),
      (rows) =>
        rows.length === count && rows.every((r) => r.status === "succeeded"),
      "original worker finishes UI agent version",
    );
    assert.equal(runs()[count - 1]!.agent_version, version);
    assert.equal(
      p.supplier[count - 1]!.agentInstruction,
      "OWNED_AGENT_SYSTEM_V" + version,
    );
    assert.equal(ledger().length, count);
  };
  await p.run("agent-publish-v1");
  await execute("agent-run-v1", 1, 1);
  const firstLedger = ledger();
  await p.run("agent-edit-v2");
  assert.deepEqual(
    db.get<Row>(
      "SELECT * FROM resource_versions WHERE resource_id=? AND version=1",
      agentId,
    ),
    versionOne,
  );
  assert.equal(
    db.get<Row>("SELECT * FROM resources WHERE id=?", agentId)!
      .published_version,
    1,
  );
  await execute("agent-run-old-v1", 2, 1);
  await p.run("agent-publish-v2");
  await execute("agent-run-v2", 3, 2);
  const finalLedger = ledger();
  assert.deepEqual(
    finalLedger.find((r) => r.id === firstLedger[0]!.id),
    firstLedger[0],
  );
  assert.ok(
    finalLedger.every((r) => r.status === "settled" && r.amount === 14),
  );
  const finalRuns = runs();
  await p.run("agent-disable");
  await p.run("agent-run-disabled");
  assert.deepEqual(runs(), finalRuns);
  assert.deepEqual(ledger(), finalLedger);
  assert.equal(p.supplier.length, 3);
  for (const row of original)
    assert.deepEqual(
      db.get<Row>("SELECT * FROM resources WHERE id=?", String(row.id)),
      row,
    );
  const writes = p.traffic.filter(
    (r) =>
      r.source === "browser" &&
      r.method !== "GET" &&
      (String(r.route).includes("/agents") ||
        String(r.route).endsWith("/runs")),
  );
  assert.deepEqual(
    writes.map((r) => [r.method, r.status]),
    [
      ["POST", 201],
      ["POST", 403],
      ["POST", 200],
      ["POST", 202],
      ["PUT", 200],
      ["POST", 202],
      ["POST", 200],
      ["POST", 202],
      ["DELETE", 204],
      ["POST", 403],
    ],
  );
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE target=? AND action='agent.publish'",
      agentId,
    )!.n,
    2,
  );
  p.facts.agent = {
    versions: [1, 1, 2],
    modelCalls: 3,
    settledCredit: 42,
    draftDoesNotChangePublishedExecution: true,
    deniedRunsZeroDelta: true,
    originalResourcesUnchanged: true,
  };
  p.facts.status = "passed";
}
