import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";
import {
  UWorkBackendClient,
  BackendClientError,
} from "../src/backend-client.js";

test("actual backend downloads materialize into owned immutable cache and load through the existing SkillPort", async (t) => {
  const root = resolve(
    process.env.UWORK_CLIENT_PATH ?? "clients/uwork",
  );
  const { createEnterpriseAssetStore } = await import(
    pathToFileURL(
      join(root, "packages/services/src/enterprise-assets/assetStore.ts"),
    ).href
  );
  const { createNodeSkillAdapter } = await import(
    pathToFileURL(
      join(root, "apps/zcode-cli/packages/adapters/src/skills/index.ts"),
    ).href
  );
  const f = await fixture(t, "https://upstream.example.test/v1");
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-asset-contract-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const device = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers: f.headers,
      payload: { ttlHours: 1 },
    })
  ).json();
  const client = new UWorkBackendClient(origin, async () => device.token);
  const store = createEnterpriseAssetStore({
    root: join(directory, "enterprise-cache"),
  });
  const context = {
    traceId: "controlled-assets-contract",
    isCurrent: () => true,
  };
  const content = (body: string) => ({
    files: [
      {
        path: "SKILL.md",
        content: `---\nname: controlled-enterprise\ndescription: Controlled enterprise fixture\n---\n${body}`,
      },
    ],
    highRisk: false,
  });
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Controlled",
      kind: "skill",
      scope: { all: true },
      content: content("Approved version one"),
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const publish = async (version: number) => {
    for (const operation of ["review", "publish"]) {
      const result = await f.app.inject({
        method: "POST",
        url: `${f.p}/assets/${id}/${operation}`,
        headers: f.headers,
        payload: {
          version,
          ...(operation === "review" ? { approved: true } : {}),
        },
      });
      assert.equal(result.statusCode, 200, result.body);
    }
  };
  await publish(1);
  const manifest = (await client.assets()).find((item) => item.id === id)!;
  assert.equal(manifest.version, 1);
  const first = await store.materialize(
    await client.download(id, manifest.version),
    context,
  );
  assert.equal(
    await client.authorizeAsset(id, first.asset.version, first.asset.checksum),
    true,
  );
  const skillPort = createNodeSkillAdapter({ includeZcodeSkills: false });
  const load = async (reference: { directory: string }) =>
    skillPort.loadSkill({
      name: "controlled-enterprise",
      workingDirectory: directory,
      roots: [
        {
          path: reference.directory,
          scope: "admin",
          source: "remote",
          priority: 0,
        },
      ],
    });
  assert.equal((await load(first)).content, "Approved version one");
  const saved = (
    await f.app.inject({ url: `${f.p}/assets`, headers: f.headers })
  )
    .json()
    .items.find((item: { id: string }) => item.id === id);
  const updated = await f.app.inject({
    method: "PUT",
    url: `${f.p}/assets/${id}`,
    headers: f.headers,
    payload: {
      revision: saved.revision,
      name: "Controlled",
      kind: "skill",
      scope: { all: true },
      content: content("Approved version two"),
    },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  await publish(2);
  await assert.rejects(
    () => client.download(id, 1),
    (error) =>
      error instanceof BackendClientError &&
      error.code === "ASSET_VERSION_CHANGED",
  );
  assert.equal(
    await client.authorizeAsset(id, first.asset.version, first.asset.checksum),
    false,
  );
  const second = await store.materialize(await client.download(id, 2), context);
  assert.equal(
    await client.authorizeAsset(
      id,
      second.asset.version,
      second.asset.checksum,
    ),
    true,
  );
  assert.equal((await load(second)).content, "Approved version two");
  assert.match(
    await readFile(join(first.directory, "SKILL.md"), "utf8"),
    /Approved version one/,
  );
  await store.prune([second.key], context);
  await assert.rejects(() => store.verify(first.key, context));
  const revoke = await f.app.inject({
    method: "POST",
    url: `${f.p}/policies`,
    headers: f.headers,
    payload: {
      name: "Revoke",
      family: "skill",
      mode: "deny",
      resourceIds: [id],
      scope: { all: true },
    },
  });
  assert.equal(revoke.statusCode, 201, revoke.body);
  assert.equal(
    await client.authorizeAsset(
      id,
      second.asset.version,
      second.asset.checksum,
    ),
    false,
  );
  assert.equal(
    (await store.verify(second.key, context)).key,
    second.key,
    "cache presence is explicitly not an authorization",
  );
  await store.prune([], context);
  await assert.rejects(() => store.verify(second.key, context));
});
