import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function directoryFixture(t: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-directory-policy-http-"),
  );
  const app = await createApp({
    database: join(directory, "directory.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = await bootstrap(app.services.db, {
    name: "Directory policy HTTP",
    email: "directory-policy@example.test",
    password: "Directory-policy-password!",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "directory-policy@example.test",
      password: "Directory-policy-password!",
    }),
  });
  assert.equal(login.status, 200);
  const { token } = (await login.json()) as { token: string };
  const request = (path: string, method = "GET", body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const p = `/api/tenants/${owner.tenantId}`;
  const json = async (path: string, method = "GET", body?: unknown) => {
    const response = await request(path, method, body);
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  };
  const oldCategory = (
    (await json(`${p}/categories`, "POST", {
      name: "Published",
      kind: "skill",
    })) as { id: string }
  ).id;
  const newCategory = (
    (await json(`${p}/categories`, "POST", {
      name: "Draft",
      kind: "skill",
    })) as { id: string }
  ).id;
  const body = {
    name: "Selected category reference",
    kind: "skill",
    categoryId: oldCategory,
    content: { files: [{ path: "SKILL.md", content: "# controlled" }] },
    scope: { all: true },
    enabled: true,
  };
  const asset = (await json(`${p}/assets`, "POST", body)) as { id: string };
  await json(`${p}/assets/${asset.id}/review`, "POST", {
    version: 1,
    approved: true,
  });
  await json(`${p}/assets/${asset.id}/publish`, "POST", { version: 1 });
  const resource = async () => {
    const list = (await json(`${p}/assets`)) as {
      items: {
        id: string;
        revision: number;
        enabled: boolean;
        published_version: number | null;
      }[];
    };
    return list.items.find((item) => item.id === asset.id)!;
  };
  const moveDraft = async (enabled: boolean) =>
    json(`${p}/assets/${asset.id}`, "PUT", {
      ...body,
      categoryId: newCategory,
      enabled,
      revision: (await resource()).revision,
    });
  return {
    app,
    request,
    json,
    p,
    body,
    asset: asset.id,
    oldCategory,
    newCategory,
    resource,
    moveDraft,
  };
}

for (const enabled of [true, false]) {
  test(`category deletion protects the selected published version after draft reassignment, enabled=${enabled}`, async (t) => {
    const f = await directoryFixture(t);
    await f.moveDraft(enabled);
    const response = await f.request(
      `${f.p}/categories/${f.oldCategory}`,
      "DELETE",
    );
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "CATEGORY_IN_USE",
    );
    assert.equal((await f.resource()).published_version, 1);
    const categories = (await f.json(`${f.p}/categories`)) as { id: string }[];
    assert.ok(categories.some((category) => category.id === f.oldCategory));
  });
}

test("deleting an unselected historical category is allowed but republishing that immutable version is rejected", async (t) => {
  const f = await directoryFixture(t);
  await f.moveDraft(true);
  await f.json(`${f.p}/assets/${f.asset}/review`, "POST", {
    version: 2,
    approved: true,
  });
  await f.json(`${f.p}/assets/${f.asset}/publish`, "POST", { version: 2 });
  assert.equal(
    (await f.request(`${f.p}/categories/${f.oldCategory}`, "DELETE")).status,
    204,
  );
  const before = await f.resource();
  const historical = f.app.services.db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=? AND version=1",
    f.asset,
  )!.data;
  const response = await f.request(`${f.p}/assets/${f.asset}/publish`, "POST", {
    version: 1,
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "INVALID_CATEGORY",
  );
  assert.deepEqual(await f.resource(), before);
  assert.equal(
    f.app.services.db.get<{ data: string }>(
      "SELECT data FROM resource_versions WHERE resource_id=? AND version=1",
      f.asset,
    )!.data,
    historical,
  );
});

test("reenabling a legacy disabled asset cannot expose a selected version whose category disappeared", async (t) => {
  const f = await directoryFixture(t);
  await f.moveDraft(false);
  // Explicit isolated legacy-data fault setup; business mutations remain HTTP.
  f.app.services.db.run("DELETE FROM categories WHERE id=?", f.oldCategory);
  const before = await f.resource();
  const response = await f.request(`${f.p}/assets/${f.asset}`, "PUT", {
    ...f.body,
    categoryId: f.newCategory,
    enabled: true,
    revision: before.revision,
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "INVALID_CATEGORY",
  );
  assert.deepEqual(await f.resource(), before);
  const manifest = (await f.json("/api/client/assets")) as {
    items: { id: string }[];
  };
  assert.ok(!manifest.items.some((asset) => asset.id === f.asset));
});
