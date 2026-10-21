import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminViewportCase(p: AdminUiCasePorts) {
  const db = p.app.services.db;
  const model = db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    p.control.modelId as string,
  );
  if (process.env.UWORK_VIEWPORT_CAPTURE_ONLY === "1") {
    await p.run("narrow-capture-only");
    assert.equal(
      db.get<{ n: number }>("SELECT count(*) n FROM categories")!.n,
      0,
    );
    assert.equal(p.supplier.length, 0);
    assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
    assert.deepEqual(
      db.get<Row>(
        "SELECT * FROM resources WHERE id=?",
        p.control.modelId as string,
      ),
      model,
    );
    p.facts.status = "passed";
    p.facts.stableCaptureOnly = true;
    return;
  }
  await p.run("narrow-create");
  const category = db.get<Row>(
    "SELECT * FROM categories WHERE tenant_id=? AND name=?",
    p.control.tenantId as string,
    "Owned narrow category",
  );
  assert.ok(category);
  await p.run("narrow-model-form-cancel");
  assert.deepEqual(
    db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      p.control.modelId as string,
    ),
    model,
  );
  await p.run("tablet-delete-cancel");
  assert.deepEqual(
    db.get<Row>("SELECT * FROM categories WHERE id=?", category.id as string),
    category,
  );
  await p.run("tablet-delete-confirm");
  assert.equal(
    db.get<Row>("SELECT * FROM categories WHERE id=?", category.id as string),
    undefined,
  );
  const audit = db
    .all<Row>(
      "SELECT action,target FROM audit WHERE action LIKE 'asset.category.%' ORDER BY created_at,id",
    )
    .map(({ action, target }) => ({ action, target }));
  assert.deepEqual(audit, [
    { action: "asset.category.create", target: category.id },
    { action: "asset.category.delete", target: category.id },
  ]);
  assert.equal(p.supplier.length, 0);
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
  const browser = p.traffic.filter((row) => row.source === "browser");
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "POST" &&
        row.route === "/api/tenants/:tenantId/categories" &&
        row.status === 201,
    ).length,
    1,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "DELETE" &&
        row.route === "/api/tenants/:tenantId/categories/:id" &&
        row.status === 204,
    ).length,
    1,
  );
  assert.equal(
    browser.filter(
      (row) =>
        row.method === "PUT" &&
        row.route === "/api/tenants/:tenantId/models/:id",
    ).length,
    0,
  );
  p.facts.status = "passed";
  p.facts.widths = [320, 768];
  p.facts.modelUnchangedAndNoMetering = true;
  p.facts.originalCategoryCreatedAndDeleted = true;
}
