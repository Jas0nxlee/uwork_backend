import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.js";
import {
  UWorkBackendClient,
  BackendClientError,
} from "../src/backend-client.js";

test("asset admission binds current reviewed authorization to immutable version and checksum", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const create = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Controlled",
      kind: "skill",
      scope: { all: true },
      content: { files: [{ path: "SKILL.md", content: "# Controlled" }] },
    },
  });
  assert.equal(create.statusCode, 201, create.body);
  const id = create.json().id;
  const publish = async (version: number) => {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.p}/assets/${id}/review`,
          headers: f.headers,
          payload: { version, approved: true },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.p}/assets/${id}/publish`,
          headers: f.headers,
          payload: { version },
        })
      ).statusCode,
      200,
    );
  };
  await publish(1);
  const first = (
    await f.app.inject({
      url: `/api/client/assets/${id}/download?version=1`,
      headers: f.headers,
    })
  ).json();
  assert.equal(first.kind, "skill");
  const authorize = (version = 1, checksum = first.checksum) =>
    f.app.inject({
      method: "POST",
      url: "/api/client/authorize",
      headers: f.headers,
      payload: {
        action: "asset",
        target: id,
        assetVersion: version,
        assetChecksum: checksum,
      },
    });
  const allowed = await authorize();
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json().allowed, true);
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const client = new UWorkBackendClient(origin, async () =>
    f.headers.authorization.slice(7),
  );
  assert.equal(await client.authorizeAsset(id, 1, first.checksum), true);
  assert.equal((await authorize(1, "0".repeat(64))).json().allowed, false);
  const resource = (
    await f.app.inject({ url: `${f.p}/assets`, headers: f.headers })
  ).json().items[0];
  const update = await f.app.inject({
    method: "PUT",
    url: `${f.p}/assets/${id}`,
    headers: f.headers,
    payload: {
      revision: resource.revision,
      name: "Controlled",
      kind: "skill",
      scope: { all: true },
      content: { files: [{ path: "SKILL.md", content: "# Version 2" }] },
    },
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal(
    (await authorize()).json().allowed,
    true,
    "unpublished draft must not change the published binding",
  );
  await publish(2);
  const oldDownload = await f.app.inject({
    url: `/api/client/assets/${id}/download?version=1`,
    headers: f.headers,
  });
  assert.equal(oldDownload.statusCode, 409, oldDownload.body);
  assert.equal(oldDownload.json().error.code, "ASSET_VERSION_CHANGED");
  await assert.rejects(
    () => client.download(id, 1),
    (error) =>
      error instanceof BackendClientError &&
      error.code === "ASSET_VERSION_CHANGED",
  );
  assert.equal((await authorize()).json().allowed, false);
  const current = (
    await f.app.inject({
      url: `/api/client/assets/${id}/download?version=2`,
      headers: f.headers,
    })
  ).json();
  assert.equal((await authorize(2, current.checksum)).json().allowed, true);
  const denied = await f.app.inject({
    method: "POST",
    url: `${f.p}/policies`,
    headers: f.headers,
    payload: {
      family: "skill",
      name: "Revoke",
      mode: "deny",
      resourceIds: [id],
      scope: { members: [f.userId] },
    },
  });
  assert.equal(denied.statusCode, 201, denied.body);
  assert.equal((await authorize(2, current.checksum)).json().allowed, false);
  assert.equal(await client.authorizeAsset(id, 2, current.checksum), false);
});

test("asset admission rejects missing bindings, high-risk skills and revoked review", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Risk",
      kind: "skill",
      scope: { all: true },
      content: {
        highRisk: true,
        files: [{ path: "SKILL.md", content: "# Risk" }],
      },
    },
  });
  const id = created.json().id;
  for (const operation of ["review", "publish"])
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.p}/assets/${id}/${operation}`,
          headers: f.headers,
          payload: {
            version: 1,
            ...(operation === "review" ? { approved: true } : {}),
          },
        })
      ).statusCode,
      200,
    );
  const content = (
    await f.app.inject({
      url: `/api/client/assets/${id}/download`,
      headers: f.headers,
    })
  ).json();
  const payload = {
    action: "asset",
    target: id,
    assetVersion: 1,
    assetChecksum: content.checksum,
  };
  const admission = () =>
    f.app.inject({
      method: "POST",
      url: "/api/client/authorize",
      headers: f.headers,
      payload,
    });
  assert.equal((await admission()).json().allowed, false);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/client/authorize",
        headers: f.headers,
        payload: { action: "asset", target: id },
      })
    ).statusCode,
    400,
  );
  const saved = await f.app.inject({
    method: "PUT",
    url: `${f.p}/configurations/security`,
    headers: f.headers,
    payload: { revision: 0, data: { dangerousSkills: true } },
  });
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `${f.p}/configurations/security/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      })
    ).statusCode,
    200,
  );
  assert.equal((await admission()).json().allowed, true);
  await f.app.inject({
    method: "POST",
    url: `${f.p}/assets/${id}/review`,
    headers: f.headers,
    payload: { version: 1, approved: false },
  });
  assert.equal((await admission()).json().allowed, false);
});

test("skill bundles reject nonportable paths and file/directory or case collisions before persistence", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const paths = [
    "notes\u0000.txt",
    "notes\u0085.txt",
    "\ud800.txt",
    "CON.txt",
    "nested/lpt1",
    "file.",
    "file ",
    " leading.txt",
    "CON .txt",
    "CONIN$",
    "cafe\u0301.txt",
  ];
  const bundles = paths.map((path) => [{ path, content: "x" }]);
  bundles.push([
    { path: "readme.txt", content: "x" },
    { path: "README.txt", content: "x" },
  ]);
  bundles.push([
    { path: "scripts", content: "x" },
    { path: "scripts/run.ts", content: "x" },
  ]);
  bundles.push([
    { path: "\u03c3.txt", content: "x" },
    { path: "\u03c2.txt", content: "x" },
  ]);
  bundles.push([
    { path: "\u017f.txt", content: "x" },
    { path: "s.txt", content: "x" },
  ]);
  bundles.push([
    { path: "\u03c3", content: "x" },
    { path: "\u03c2/run.ts", content: "x" },
  ]);
  for (const files of bundles) {
    const result = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Unsafe",
        kind: "skill",
        scope: { all: true },
        content: { files: [{ path: "SKILL.md", content: "# Safe" }, ...files] },
      },
    });
    assert.equal(
      result.statusCode,
      400,
      JSON.stringify({
        paths: files.map((file) => file.path),
        response: result.body,
      }),
    );
  }
  assert.equal(
    (await f.app.inject({ url: `${f.p}/assets`, headers: f.headers })).json()
      .total,
    0,
  );
  const valid = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Portable",
      kind: "skill",
      content: {
        files: [
          { path: "SKILL.md", content: "# Safe" },
          {
            path: "notes/\u4e2d\u6587-\u{1f680}.txt",
            content: "valid paired Unicode",
          },
        ],
      },
    },
  });
  assert.equal(valid.statusCode, 201, valid.body);
});

test("asset listing and downloads enforce current subscription and IP admission before releasing content", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Controlled",
      kind: "instruction",
      scope: { all: true },
      content: { instructions: "Controlled content" },
    },
  });
  const id = created.json().id;
  for (const operation of ["review", "publish"])
    await f.app.inject({
      method: "POST",
      url: `${f.p}/assets/${id}/${operation}`,
      headers: f.headers,
      payload: {
        version: 1,
        ...(operation === "review" ? { approved: true } : {}),
      },
    });
  const paths = ["/api/client/assets", `/api/client/assets/${id}/download`];
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  for (const url of paths)
    assert.equal(
      (await f.app.inject({ url, headers: f.headers })).statusCode,
      402,
    );
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() + 60000,
    f.tenantId,
  );
  const saved = await f.app.inject({
    method: "PUT",
    url: `${f.p}/configurations/network`,
    headers: f.headers,
    payload: { revision: 0, data: { whitelist: ["127.0.0.1"] } },
  });
  await f.app.inject({
    method: "POST",
    url: `${f.p}/configurations/network/publish`,
    headers: f.headers,
    payload: { revision: saved.json().revision },
  });
  for (const url of paths)
    assert.equal(
      (await f.app.inject({ url, headers: f.headers })).statusCode,
      403,
    );
});
