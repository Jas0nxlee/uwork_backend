import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminAutomationCase(p: AdminUiCasePorts) {
  const readPlans = async () => {
    const rows = await p.api(p.prefix + "/automations");
    assert.ok(Array.isArray(rows));
    return rows as Row[];
  };
  const counters = () => ({
    runs: p.app.services.db.all<Row>("SELECT * FROM runs ORDER BY id"),
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
    supplier: [...p.supplier],
  });
  p.control.pausedDue = Date.now() + 20000;
  await p.saveControl();
  await p.run("create-paused");
  let plans = await readPlans();
  assert.equal(plans.length, 1);
  const paused = plans[0]!;
  assert.equal(paused.enabled, 0);
  assert.equal(paused.next_at, p.control.pausedDue);
  assert.equal(counters().runs.length, 0);
  assert.equal(counters().ledger.length, 0);
  const pausedStored = p.app.services.db.get<Row>(
    "SELECT * FROM automations WHERE id=?",
    paused.id as string,
  )!;
  assert.ok(!String(pausedStored.input).includes("OWNED_AUTOMATION_PAUSED"));
  const beforeDue = counters();
  await delay(Math.max(0, Number(p.control.pausedDue) + 1500 - Date.now()));
  assert.ok(Date.now() >= Number(p.control.pausedDue) + 1500);
  assert.deepEqual(counters(), beforeDue);
  assert.equal(p.supplier.length, 0);
  await p.run("enable-expired");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM automations WHERE id=?",
      paused.id as string,
    ),
    pausedStored,
  );
  assert.deepEqual(counters(), beforeDue);
  p.facts.disabledPastOriginalDue = {
    due: p.control.pausedDue,
    observedAt: Date.now(),
    noDispatch: true,
  };

  p.control.positiveDue = Date.now() + 12000;
  await p.saveControl();
  await p.run("create-positive");
  plans = await readPlans();
  const positive = plans.find((row) => row.name === "Owned scheduled once")!;
  assert.ok(positive);
  assert.equal(positive.next_at, p.control.positiveDue);
  const trigger = `automation:${positive.id}:${p.control.positiveDue}`;
  const run = await boundedWait(
    async () =>
      p.app.services.db.get<Row>(
        "SELECT * FROM runs WHERE trigger_key=?",
        trigger,
      ),
    (row) => row?.status === "succeeded",
    "natural once execution by original worker",
  );
  assert.ok(run);
  assert.equal(run.user_id, p.control.userId);
  assert.equal(run.tenant_id, p.control.tenantId);
  const detail = await p.api(`${p.prefix}/runs/${run.id}`);
  assert.equal(detail.input, "OWNED_AUTOMATION_ONCE");
  assert.equal(detail.output, "OWNED_ADMIN_RESULT");
  assert.equal(p.supplier.length, 1);
  assert.equal(p.supplier[0]!.automationInput, "OWNED_AUTOMATION_ONCE");
  assert.equal(
    p.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM runs WHERE trigger_key=?",
      trigger,
    )!.n,
    1,
  );
  const stored = p.app.services.db.get<Row>(
    "SELECT * FROM automations WHERE id=?",
    positive.id as string,
  )!;
  assert.equal(stored.enabled, 0);
  assert.equal(stored.next_at, null);
  p.control.runId = run.id;
  await p.saveControl();
  await p.run("scheduled-result");
  const successful = counters();
  assert.equal(successful.runs.length, 1);
  assert.equal(successful.ledger.length, 1);
  assert.equal(successful.ledger[0]!.status, "settled");
  assert.equal(successful.ledger[0]!.amount, 14);
  await p.run("delete-cancel");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM automations WHERE id=?",
      paused.id as string,
    ),
    pausedStored,
  );
  assert.deepEqual(counters(), successful);
  await p.run("delete-confirm");
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT * FROM automations WHERE id=?",
      paused.id as string,
    ),
    undefined,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM automations WHERE id=?",
      positive.id as string,
    ),
    stored,
  );
  assert.deepEqual(counters(), successful);
  const audits = p.app.services.db.all<Row>(
    "SELECT action,target,user_id FROM audit WHERE action LIKE 'automation.%' ORDER BY action,target",
  );
  assert.equal(
    audits.filter((row) => row.action === "automation.create").length,
    2,
  );
  assert.equal(
    audits.filter(
      (row) => row.action === "automation.toggle" && row.target === paused.id,
    ).length,
    1,
  );
  assert.equal(
    audits.filter(
      (row) => row.action === "automation.delete" && row.target === paused.id,
    ).length,
    1,
  );
  assert.ok(audits.every((row) => row.user_id === p.control.userId));
  const browser = p.traffic.filter((row) => row.source === "browser");
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "POST" &&
        row.route === "/api/tenants/:tenantId/automations" &&
        row.status === 201,
    ).length,
    2,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "PATCH" &&
        row.route === "/api/tenants/:tenantId/automations/:id" &&
        row.status === 400,
    ).length,
    1,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/automations/:id" &&
        row.status === 204,
    ).length,
    1,
  );
  p.facts.status = "passed";
  p.facts.supplier = p.supplier;
  p.facts.ledger = successful.ledger.map(
    ({ status, amount, input_tokens, output_tokens }) => ({
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.automationAudits = audits;
  p.facts.naturalOnceExecution = { trigger, runId: run.id, count: 1 };
  p.facts.cancelAndConfirmedDeletePreserveOtherState = true;
}
