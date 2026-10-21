import assert from "node:assert/strict";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminSettingsRaceCase(
  p: AdminUiCasePorts & { releaseReadReply(): void },
) {
  await p.api(p.prefix + "/limits", "PUT", {
    subjectType: "member",
    subjectId: p.control.userId,
    amount: 1000,
  });
  await p.api(p.prefix + "/limits", "PUT", {
    subjectType: "application",
    subjectId: "uwork",
    amount: 1000,
  });
  await p.run("remove-member");
  await boundedWait(
    async () => p.facts.heldLimitReadReady,
    (value) => value === true,
    "old genuine limit snapshot held",
  );
  const remaining = await p.api(p.prefix + "/limits");
  assert.ok(Array.isArray(remaining));
  assert.equal(remaining.length, 1);
  assert.equal((remaining as Row[])[0]!.subject_type, "application");
  const fresh = (await p.run("remove-application")) as Row;
  p.control.completedReadsBeforeRelease = fresh.completedReadsBeforeRelease;
  await p.saveControl();
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM limits")!.n,
    0,
  );
  p.releaseReadReply();
  await boundedWait(
    async () => p.facts.heldLimitReadFinished,
    (value) => value === true,
    "old success reply downstream finish",
  );
  const late = (await p.run("observe-late-reply")) as {
    observations: { rows: number; subjects: string[] }[];
  };
  p.facts.lateReadObservations = late.observations;
  assert.equal(
    Math.max(...late.observations.map((row) => row.rows)),
    0,
    "late Settings response must not resurrect a removed quota rule",
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM limits")!.n,
    0,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  assert.equal(p.supplier.length, 0);
  assert.equal(
    p.traffic.filter(
      (row) =>
        row.source === "browser" &&
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/limits/:type/:id" &&
        row.status === 204,
    ).length,
    2,
  );
  p.facts.status = "passed";
  p.facts.lateDeliveredReadDiscarded = true;
  p.facts.noModelOrMetering = true;
}
