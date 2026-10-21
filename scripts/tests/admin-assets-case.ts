import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminAssetsCase(p: AdminUiCasePorts) {
  p.control.contentV1 = {
    files: [
      { path: "SKILL.md", content: "# Owned UI skill\nVERSION_ONE\n" },
      { path: "notes.txt", content: "owned auxiliary\n" },
    ],
  };
  p.control.contentV2 = {
    files: [
      { path: "SKILL.md", content: "# Owned UI skill\nVERSION_TWO\n" },
      { path: "notes.txt", content: "owned auxiliary\n" },
    ],
  };
  await p.saveControl();
  const catalog = async () =>
    (await p.api("/api/client/assets")).items as Row[];
  await p.run("create-skill");
  const resources = await p.api(p.prefix + "/assets");
  assert.equal((resources.items as Row[]).length, 1);
  const asset = (resources.items as Row[])[0]!;
  const assetId = asset.id as string;
  assert.equal(asset.status, "draft");
  assert.equal((await catalog()).length, 0);
  const baseline = p.app.services.db.get<Row>(
    "SELECT * FROM resources WHERE id=?",
    assetId,
  );
  await p.run("publish-unreviewed");
  assert.deepEqual(
    p.app.services.db.get<Row>("SELECT * FROM resources WHERE id=?", assetId),
    baseline,
  );
  assert.equal((await catalog()).length, 0);
  await p.run("review-v1");
  assert.equal((await catalog()).length, 0);
  await p.run("publish-v1");
  const firstCatalog = await catalog();
  assert.equal(firstCatalog.length, 1);
  assert.equal(firstCatalog[0]!.id, assetId);
  assert.equal(firstCatalog[0]!.version, 1);
  const firstDownload = await p.api(`/api/client/assets/${assetId}/download`);
  assert.deepEqual(
    (firstDownload.content as Row).files,
    (p.control.contentV1 as Row).files,
  );
  assert.equal(
    firstDownload.checksum,
    createHash("sha256")
      .update(JSON.stringify(firstDownload.content))
      .digest("hex"),
  );
  assert.equal(firstDownload.checksum, firstCatalog[0]!.checksum);
  const versionOne = p.app.services.db.get<Row>(
    "SELECT * FROM resource_versions WHERE resource_id=? AND version=1",
    assetId,
  );
  await p.run("edit-skill-v2");
  const versions = await p.api(`${p.prefix}/assets/${assetId}/versions`);
  assert.ok(Array.isArray(versions));
  assert.equal(versions.length, 2);
  assert.equal(
    (versions as Row[]).find((row) => row.version === 2)!.approved,
    0,
  );
  assert.deepEqual(
    p.app.services.db.get<Row>(
      "SELECT * FROM resource_versions WHERE resource_id=? AND version=1",
      assetId,
    ),
    versionOne,
  );
  assert.deepEqual(
    await p.api(`/api/client/assets/${assetId}/download`),
    firstDownload,
  );
  await p.run("review-v2");
  assert.deepEqual(
    await p.api(`/api/client/assets/${assetId}/download`),
    firstDownload,
  );
  await p.run("publish-v2");
  const secondCatalog = await catalog();
  assert.equal(secondCatalog[0]!.id, assetId);
  assert.equal(secondCatalog[0]!.version, 2);
  const secondDownload = await p.api(`/api/client/assets/${assetId}/download`);
  assert.deepEqual(
    (secondDownload.content as Row).files,
    (p.control.contentV2 as Row).files,
  );
  assert.equal(
    secondDownload.checksum,
    createHash("sha256")
      .update(JSON.stringify(secondDownload.content))
      .digest("hex"),
  );
  assert.notEqual(secondDownload.checksum, firstDownload.checksum);
  assert.equal(secondDownload.checksum, secondCatalog[0]!.checksum);
  const stale = await p.api(
    `/api/client/assets/${assetId}/download?version=1`,
    "GET",
    undefined,
    409,
  );
  assert.equal((stale.error as Row).code, "ASSET_VERSION_CHANGED");
  const retainedVersions = p.app.services.db.all<Row>(
    "SELECT * FROM resource_versions WHERE resource_id=? ORDER BY version",
    assetId,
  );
  await p.run("disable-skill");
  assert.equal((await catalog()).length, 0);
  const denied = await p.api(
    `/api/client/assets/${assetId}/download`,
    "GET",
    undefined,
    403,
  );
  assert.equal((denied.error as Row).code, "ASSET_DENIED");
  assert.deepEqual(
    p.app.services.db.all<Row>(
      "SELECT * FROM resource_versions WHERE resource_id=? ORDER BY version",
      assetId,
    ),
    retainedVersions,
  );
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  assert.equal(p.supplier.length, 0);
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/assets", 201, 1],
    ["POST", "/assets/:id/review", 200, 2],
    ["POST", "/assets/:id/publish", 200, 2],
    ["POST", "/assets/:id/publish", 409, 1],
    ["PUT", "/assets/:id", 200, 1],
    ["DELETE", "/assets/:id", 204, 1],
  ] as const) {
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      count,
    );
  }
  const audit = p.app.services.db.all<Row>(
    "SELECT action,target FROM audit WHERE action LIKE 'asset.%'",
  );
  assert.equal(audit.filter((row) => row.action === "asset.review").length, 2);
  assert.equal(audit.filter((row) => row.action === "asset.publish").length, 2);
  p.facts.status = "passed";
  p.facts.clientVersions = [1, 2];
  p.facts.checksums = [firstDownload.checksum, secondDownload.checksum];
  p.facts.unpublishedDraftDoesNotChangeDelivery = true;
  p.facts.immutableVersionOneRetained = true;
  p.facts.disabledDownloadDenied = true;
  p.facts.noModelOrLedgerIncrement = true;
  p.facts.assetAudit = audit;
}
