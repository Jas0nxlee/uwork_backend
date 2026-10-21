import assert from "node:assert/strict";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminModelCase(p: AdminUiCasePorts) {
  const readModel = async () => {
    const rows = await p.api(p.prefix + "/models");
    assert.ok(Array.isArray(rows));
    return (rows as Row[]).find((row) => row.id === p.control.modelId)!;
  };
  const catalog = async () => (await p.api("/v1/models")).data as Row[];
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  const credential = p.app.services.db.get<Row>(
    "SELECT * FROM credentials WHERE id=?",
    p.control.credentialId as string,
  );
  await p.run("probe-and-edit");
  let model = await readModel();
  assert.equal(model.name, "Owned model revised");
  assert.equal(model.revision, 2);
  const updated = model.data as Row;
  assert.equal(updated.maxOutputTokens, 256);
  assert.equal(updated.inputRate, 2000);
  assert.equal(updated.outputRate, 3000);
  const selected = (await catalog()).find((row) => row.id === model.id)!;
  assert.equal(selected.name, "Owned model revised");
  assert.equal(selected.max_output_tokens, 256);
  const queued = await p.api(
    p.prefix + "/runs",
    "POST",
    { agentId: p.control.agentId, input: "OWNED_MODEL_REVISION" },
    202,
  );
  await boundedWait(
    () => p.api(`${p.prefix}/runs/${queued.id}`),
    (row) => row.status === "succeeded",
    "updated UI model consumed by original worker",
  );
  let snapshot = counters();
  assert.equal(snapshot.supplier.length, 1);
  assert.equal(snapshot.ledger.length, 1);
  assert.equal(snapshot.ledger[0]!.status, "settled");
  assert.equal(snapshot.ledger[0]!.amount, 30);
  await p.run("disable-cancel");
  assert.deepEqual(await readModel(), model);
  assert.deepEqual(counters(), snapshot);
  await p.run("disable-confirm");
  model = await readModel();
  assert.equal(model.enabled, false);
  assert.equal(model.revision, 3);
  assert.equal(
    (await catalog()).some((row) => row.id === model.id),
    false,
  );
  const denied = await p.api(
    "/v1/chat/completions",
    "POST",
    {
      model: model.id,
      messages: [{ role: "user", content: "OWNED_MODEL_BLOCKED" }],
      max_tokens: 32,
    },
    403,
  );
  assert.equal((denied.error as Row).code, "MODEL_DENIED");
  assert.deepEqual(counters(), snapshot);
  await p.run("restore-edit");
  model = await readModel();
  assert.equal(model.enabled, true);
  assert.equal(model.revision, 4);
  assert.deepEqual(model.data, updated);
  assert.equal(
    (await catalog()).some((row) => row.id === model.id),
    true,
  );
  await p.api("/v1/chat/completions", "POST", {
    model: model.id,
    messages: [{ role: "user", content: "OWNED_MODEL_RESTORED" }],
    max_tokens: 32,
  });
  snapshot = counters();
  assert.equal(snapshot.supplier.length, 2);
  assert.equal(snapshot.ledger.length, 2);
  assert.ok(
    snapshot.ledger.every(
      (row) => row.status === "settled" && row.amount === 30,
    ),
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM credentials WHERE id=?",
      p.control.credentialId as string,
    ),
    credential,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  assert.equal(
    browser.filter(
      (row) =>
        row.route === "/api/tenants/:tenantId/models/:id/probe" &&
        row.method === "POST" &&
        row.status === 200,
    ).length,
    1,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.route === "/api/tenants/:tenantId/models/:id" &&
        row.method === "PUT" &&
        row.status === 200,
    ).length,
    2,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.route === "/api/tenants/:tenantId/models/:id" &&
        row.method === "DELETE" &&
        row.status === 204,
    ).length,
    1,
  );
  assert.equal(p.facts.supplierDiscoveryCalls, 1);
  assert.notEqual(p.facts.responseLeakedSupplierSecret, true);
  p.facts.status = "passed";
  p.facts.supplier = p.supplier;
  p.facts.ledger = snapshot.ledger.map(
    ({ status, amount, input_tokens, output_tokens }) => ({
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.modelRevisions = [1, 2, 3, 4];
  p.facts.disabledModelDeniedWithoutMetering = true;
  p.facts.credentialUnchanged = true;
}
