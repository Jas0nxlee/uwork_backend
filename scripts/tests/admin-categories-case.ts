import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminCategoriesCase(p: AdminUiCasePorts) {
  await p.run("create-category");
  const list = await p.api(p.prefix + "/categories");
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 1);
  const category = (list as Row[])[0]!;
  assert.equal(category.kind, "skill");
  const original = p.app.services.db.get<Row>(
    "SELECT * FROM categories WHERE id=?",
    category.id as string,
  );
  await p.run("duplicate-category");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM categories WHERE id=?",
      category.id as string,
    ),
    original,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM categories")!
      .n,
    1,
  );
  const body = {
    kind: "skill",
    name: "Owned category consumer",
    categoryId: category.id,
    content: {
      files: [
        {
          path: "SKILL.md",
          content: "# Owned category consumer\nStatic functional test.\n",
        },
      ],
    },
    scope: { all: true },
    supportedClients: ["uwork", "agent"],
  };
  const asset = await p.api(p.prefix + "/assets", "POST", body, 201);
  await p.api(`${p.prefix}/assets/${asset.id}/review`, "POST", {
    version: 1,
    approved: true,
  });
  await p.api(`${p.prefix}/assets/${asset.id}/publish`, "POST", { version: 1 });
  const catalog = async () =>
    (await p.api("/api/client/assets")).items as Row[];
  assert.equal((await catalog())[0]!.categoryId, category.id);
  await p.run("delete-current-reference");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM categories WHERE id=?",
      category.id as string,
    ),
    original,
  );
  const assets = await p.api(p.prefix + "/assets");
  const current = (assets.items as Row[]).find((row) => row.id === asset.id)!;
  await p.api(`${p.prefix}/assets/${asset.id}`, "PUT", {
    ...body,
    categoryId: null,
    revision: current.revision,
  });
  assert.equal((await catalog())[0]!.version, 1);
  assert.equal((await catalog())[0]!.categoryId, category.id);
  await p.run("delete-published-reference");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM categories WHERE id=?",
      category.id as string,
    ),
    original,
  );
  await p.api(`${p.prefix}/assets/${asset.id}/review`, "POST", {
    version: 2,
    approved: true,
  });
  await p.api(`${p.prefix}/assets/${asset.id}/publish`, "POST", { version: 2 });
  assert.equal((await catalog())[0]!.categoryId, null);
  const resource = p.app.services.db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    asset.id as string,
  );
  const versions = p.app.services.db.all<Row>(
    "SELECT * FROM resource_versions WHERE resource_id=? ORDER BY version",
    asset.id as string,
  );
  await p.run("delete-category-cancel");
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM categories WHERE id=?",
      category.id as string,
    ),
    original,
  );
  await p.run("delete-category-confirm");
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT * FROM categories WHERE id=?",
      category.id as string,
    ),
    undefined,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM resources WHERE id=?",
      asset.id as string,
    ),
    resource,
  );
  assert.deepEqual(
    p.app.services.db.all<Row>(
      "SELECT * FROM resource_versions WHERE resource_id=? ORDER BY version",
      asset.id as string,
    ),
    versions,
  );
  assert.equal((await catalog())[0]!.categoryId, null);
  assert.equal(p.supplier.length, 0);
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/categories", 201, 1],
    ["POST", "/categories", 409, 1],
    ["DELETE", "/categories/:id", 409, 2],
    ["DELETE", "/categories/:id", 204, 1],
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
    "SELECT action,target,user_id FROM audit WHERE target=? AND action LIKE 'asset.category.%'",
    category.id as string,
  );
  assert.equal(
    audit.filter((row) => row.action === "asset.category.create").length,
    1,
  );
  assert.equal(
    audit.filter((row) => row.action === "asset.category.delete").length,
    1,
  );
  p.facts.status = "passed";
  p.facts.currentAndPublishedReferencesProtected = true;
  p.facts.noDuplicateCategory = true;
  p.facts.assetAndVersionsPreserved = true;
  p.facts.noModelOrMetering = true;
  p.facts.categoryAudit = audit;
}
