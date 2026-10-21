import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminCredentialsCase(p: AdminUiCasePorts) {
  const initialSeed = p.app.services.db.get<Row>(
    "SELECT * FROM credentials WHERE id=?",
    p.control.credentialId as string,
  );
  const counters = () => ({
    supplier: [...p.supplier],
    ledger: p.app.services.db.all<Row>("SELECT * FROM ledger ORDER BY id"),
  });
  await p.run("create-ui-credential");
  const credentials = await p.api(p.prefix + "/credentials");
  assert.ok(Array.isArray(credentials));
  const created = (credentials as Row[]).find(
    (row) => row.name === "Owned UI gateway key",
  )!;
  assert.ok(created);
  const id = created.id as string;
  const read = () =>
    p.app.services.db.get<Row>("SELECT * FROM credentials WHERE id=?", id)!;
  const first = read();
  assert.equal(first.revision, 1);
  assert.equal(first.revoked, 0);
  for (const key of [
    p.control.keyInitial,
    p.control.keyRotated,
    p.control.keyRestored,
  ])
    assert.ok(!String(first.ciphertext).includes(String(key)));
  const models = await p.api(p.prefix + "/models");
  assert.ok(Array.isArray(models));
  const model = (models as Row[]).find((row) => row.id === p.control.modelId)!;
  await p.api(`${p.prefix}/models/${model.id}`, "PUT", {
    ...(model.data as Row),
    name: model.name,
    scope: model.scope,
    enabled: model.enabled,
    credentialId: id,
    revision: model.revision,
  });
  const reference = p.app.services.db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    p.control.modelId as string,
  );
  const complete = (label: string, expected = 200) =>
    p.api(
      "/v1/chat/completions",
      "POST",
      {
        model: p.control.modelId,
        messages: [{ role: "user", content: label }],
        max_tokens: 32,
      },
      expected,
    );
  await complete("OWNED_VAULT_INITIAL");
  assert.equal(p.supplier[0]!.keyPhase, "initial");
  await p.run("rotate-ui-credential");
  const rotated = read();
  assert.equal(rotated.revision, 2);
  assert.equal(rotated.revoked, 0);
  assert.notEqual(rotated.ciphertext, first.ciphertext);
  await complete("OWNED_VAULT_ROTATED");
  assert.equal(p.supplier[1]!.keyPhase, "rotated");
  const beforeRevoke = counters();
  assert.equal(beforeRevoke.ledger.length, 2);
  await p.run("revoke-cancel");
  assert.deepEqual(read(), rotated);
  assert.deepEqual(counters(), beforeRevoke);
  await p.run("revoke-confirm");
  const revoked = read();
  assert.equal(revoked.revoked, 1);
  assert.equal(revoked.ciphertext, "");
  assert.equal(
    ((await p.api("/v1/models")).data as Row[]).some(
      (row) => row.id === p.control.modelId,
    ),
    false,
  );
  assert.equal(
    ((await complete("OWNED_VAULT_REVOKED", 409)).error as Row).code,
    "CREDENTIAL_UNAVAILABLE",
  );
  assert.deepEqual(counters(), beforeRevoke);
  await p.run("restore-ui-credential");
  const restored = read();
  assert.equal(restored.revoked, 0);
  assert.equal(restored.revision, 3);
  assert.notEqual(restored.ciphertext, rotated.ciphertext);
  assert.equal(
    ((await p.api("/v1/models")).data as Row[]).some(
      (row) => row.id === p.control.modelId,
    ),
    true,
  );
  await complete("OWNED_VAULT_RESTORED");
  assert.equal(p.supplier[2]!.keyPhase, "restored");
  await p.run("public-credential-detail");
  assert.equal(p.supplier.length, 3);
  const final = counters();
  assert.equal(final.ledger.length, 3);
  assert.ok(
    final.ledger.every((row) => row.status === "settled" && row.amount === 14),
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      p.control.modelId as string,
    ),
    reference,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM credentials WHERE id=?",
      p.control.credentialId as string,
    ),
    initialSeed,
  );
  assert.notEqual(p.facts.responseLeakedSupplierSecret, true);
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/credentials", 201, 1],
    ["PUT", "/credentials/:id", 200, 2],
    ["DELETE", "/credentials/:id", 204, 1],
  ] as const)
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      count,
    );
  const audit = p.app.services.db.all<Row>(
    "SELECT action,target,user_id FROM audit WHERE target=? AND action LIKE 'vault.%'",
    id,
  );
  assert.equal(audit.filter((row) => row.action === "vault.create").length, 1);
  assert.equal(audit.filter((row) => row.action === "vault.rotate").length, 2);
  assert.equal(audit.filter((row) => row.action === "vault.revoke").length, 1);
  p.facts.status = "passed";
  p.facts.keyPhases = p.supplier.map((row) => row.keyPhase);
  p.facts.credentialRevisions = [1, 2, 3];
  p.facts.revocationStopsModelAndBilling = true;
  p.facts.onlyPublicCredentialMetadata = true;
  p.facts.originalSeedAndModelReferenceUnchanged = true;
  p.facts.ciphertextHashes = [first, rotated, restored].map((row) =>
    createHash("sha256").update(String(row.ciphertext)).digest("hex"),
  );
  p.facts.ledger = final.ledger.map(
    ({ status, amount, input_tokens, output_tokens }) => ({
      status,
      amount,
      input_tokens,
      output_tokens,
    }),
  );
  p.facts.vaultAudit = audit;
}
