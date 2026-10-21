import assert from "node:assert/strict";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts } from "./admin-ui-case.js";

export async function runAdminDeletePendingCase(
  p: AdminUiCasePorts & { releaseDeleteReply(): void },
) {
  const make = async (name: string) =>
    p.api(
      p.prefix + "/automations",
      "POST",
      {
        name,
        agentId: p.control.agentId,
        input: "OWNED_DELETE_NO_EXECUTION",
        schedule: { type: "once", at: Date.now() + 3600000 },
        enabled: false,
      },
      201,
    );
  const first = await make("Owned in-flight deletion");
  p.control.planId = first.id;
  await p.saveControl();
  const start = (await p.run("double-confirm-and-escape")) as {
    stage: string;
    confirmDisabled: boolean;
    cancelDisabled: boolean;
    dialogStillOpen: boolean;
  };
  await boundedWait(
    async () => Number(p.facts.deleteReplyAttempts ?? 0),
    (count) => count >= 1,
    "real delete handler reached response gate",
  );
  assert.equal(
    p.facts.deleteReplyAttempts,
    1,
    "in-flight confirmation must issue exactly one original DELETE",
  );
  assert.equal(start.confirmDisabled, true);
  assert.equal(start.cancelDisabled, true);
  assert.equal(start.dialogStillOpen, true);
  assert.equal(
    p.app.services.db.get(
      "SELECT id FROM automations WHERE id=?",
      first.id as string,
    ),
    undefined,
  );
  p.releaseDeleteReply();
  await p.run("delete-completed");
  assert.equal(
    p.traffic.filter(
      (row) =>
        row.source === "browser" &&
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/automations/:id" &&
        row.status === 204,
    ).length,
    1,
  );
  const missing = await make("Owned concurrently removed");
  p.control.planId = missing.id;
  await p.saveControl();
  await p.run("open-concurrent-delete");
  await p.api(
    `${p.prefix}/automations/${missing.id}`,
    "DELETE",
    undefined,
    204,
  );
  await p.run("missing-error-unlocks");
  assert.equal(p.facts.deleteReplyAttempts, 2);
  assert.equal(
    p.traffic.filter(
      (row) =>
        row.source === "browser" &&
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/automations/:id" &&
        row.status === 404,
    ).length,
    1,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM audit WHERE action='automation.delete'",
    )!.n,
    2,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM runs")!.n,
    0,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  assert.equal(p.supplier.length, 0);
  p.facts.status = "passed";
  p.facts.singleInFlightDeleteVerified = true;
  p.facts.errorUnlockVerified = true;
  p.facts.noInferenceOrMetering = true;
}
