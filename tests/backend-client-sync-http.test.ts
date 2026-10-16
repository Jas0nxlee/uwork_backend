import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import {
  BackendClientError,
  UWorkBackendClient,
} from "../src/backend-client.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-client-sync-"));
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Host sync fixture",
    email: "sync@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  let ownerToken = "";
  async function api<T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
    status = 200,
    token = ownerToken,
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  ownerToken = (
    await api<{ token: string }>("/api/auth/login", "POST", {
      email: "sync@example.test",
      password,
    })
  ).token;
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await api<{ id: string }>(
    `${p}/credentials`,
    "POST",
    { name: "Synthetic credential", value: "synthetic-only" },
    201,
  );
  await api(
    `${p}/models`,
    "POST",
    {
      name: "Sync model",
      upstreamModel: "test",
      baseUrl: "https://provider.example.test/v1",
      credentialId: credential.id,
      scope: { all: true },
    },
    201,
  );
  const payload = (version: number) => ({
    name: "Sync skill",
    kind: "skill",
    content: {
      files: [{ path: "SKILL.md", content: `# Version ${version}` }],
      highRisk: false,
    },
    scope: { all: true },
    supportedClients: ["uwork"],
    enabled: true,
  });
  const asset = await api<{ id: string }>(
    `${p}/assets`,
    "POST",
    payload(1),
    201,
  );
  async function publish(version: number) {
    await api(`${p}/assets/${asset.id}/review`, "POST", {
      version,
      approved: true,
    });
    await api(`${p}/assets/${asset.id}/publish`, "POST", { version });
  }
  await publish(1);
  const first = await api<{ token: string }>(
    "/api/auth/device-tokens",
    "POST",
    { ttlHours: 1 },
    201,
  );
  const second = await api<{ token: string }>(
    "/api/auth/device-tokens",
    "POST",
    { ttlHours: 1 },
    201,
  );
  return {
    app,
    origin,
    api,
    p,
    assetId: asset.id,
    first: first.token,
    second: second.token,
    async nextVersion() {
      const rows = await api<{ items: { id: string; revision: number }[] }>(
        `${p}/assets?pageSize=100`,
      );
      const revision = rows.items.find((r) => r.id === asset.id)!.revision;
      await api(`${p}/assets/${asset.id}`, "PUT", { ...payload(2), revision });
      await publish(2);
    },
  };
}

test("Host synchronization stops when its device identity changes during a policy callback", async (t) => {
  const f = await fixture(t);
  let current = f.first;
  const client = new UWorkBackendClient(f.origin, async () => current);
  const applied: string[] = [];
  await assert.rejects(
    client.synchronize({
      async applyPolicy() {
        applied.push("policy");
        current = f.second;
      },
      async applyModels() {
        applied.push("models");
      },
      async applyAssets() {
        applied.push("assets");
      },
    }),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "IDENTITY_CHANGED",
  );
  assert.deepEqual(applied, ["policy"]);
  assert.equal(
    (await f.api<{ total: number }>(`${f.p}/client-events`)).total,
    0,
  );
});

for (const stage of ["policy", "models"] as const)
  test(`Host synchronization honors cancellation during its ${stage} callback`, async (t) => {
    const f = await fixture(t);
    const controller = new AbortController(),
      reason = new Error("controlled sync cancellation");
    const client = new UWorkBackendClient(f.origin, async () => f.first);
    const applied: string[] = [];
    await assert.rejects(
      client.synchronize(
        {
          async applyPolicy() {
            applied.push("policy");
            if (stage === "policy") controller.abort(reason);
          },
          async applyModels() {
            applied.push("models");
            if (stage === "models") controller.abort(reason);
          },
          async applyAssets() {
            applied.push("assets");
          },
        },
        controller.signal,
      ),
      (error: unknown) => error === reason,
    );
    assert.deepEqual(
      applied,
      stage === "policy" ? ["policy"] : ["policy", "models"],
    );
    assert.equal(
      (await f.api<{ total: number }>(`${f.p}/client-events`)).total,
      0,
    );
  });

test("Host synchronization cannot combine an old tenant snapshot with another tenant's catalog", async (t) => {
  const f = await fixture(t);
  const password = randomBytes(24).toString("hex");
  await bootstrap(f.app.services.db, {
    name: "Other sync tenant",
    email: "other-sync@example.test",
    password,
  });
  const login = await f.api<{ token: string }>("/api/auth/login", "POST", {
    email: "other-sync@example.test",
    password,
  });
  let current = f.first;
  const observed: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    if (
      new URL(input instanceof Request ? input.url : input.toString())
        .pathname === "/api/client/configuration"
    )
      current = login.token;
    return response;
  };
  const client = new UWorkBackendClient(
    f.origin,
    async () => current,
    observed,
  );
  let applied = false;
  await assert.rejects(
    client.synchronize({
      async applyPolicy() {
        applied = true;
      },
      async applyModels() {
        applied = true;
      },
      async applyAssets() {
        applied = true;
      },
    }),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "IDENTITY_CHANGED",
  );
  assert.equal(applied, false);
});

test("Host download callbacks keep their selected asset version and originating identity", async (t) => {
  const f = await fixture(t);
  let current = f.first;
  const client = new UWorkBackendClient(f.origin, async () => current);
  let retained: ((id: string) => Promise<unknown>) | undefined;
  await client.synchronize({
    async applyPolicy() {},
    async applyModels() {},
    async applyAssets({ assets, download }) {
      assert.equal(assets.find((a) => a.id === f.assetId)?.version, 1);
      retained = download;
    },
  });
  const download = retained;
  assert.ok(download);
  await assert.rejects(
    download("not-in-this-synchronization"),
    (error: unknown) =>
      error instanceof BackendClientError &&
      error.code === "ASSET_NOT_SELECTED",
  );
  await f.nextVersion();
  await assert.rejects(
    download(f.assetId),
    (error: unknown) =>
      error instanceof BackendClientError &&
      error.code === "ASSET_VERSION_CHANGED",
  );
  current = f.second;
  await assert.rejects(
    download(f.assetId),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "IDENTITY_CHANGED",
  );
});

test("retained Host downloads discard responses arriving after an identity change", async (t) => {
  const f = await fixture(t);
  let current = f.first,
    changeOnDownload = false;
  const observed: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    if (
      changeOnDownload &&
      new URL(
        input instanceof Request ? input.url : input.toString(),
      ).pathname.endsWith("/download")
    )
      current = f.second;
    return response;
  };
  const client = new UWorkBackendClient(
    f.origin,
    async () => current,
    observed,
  );
  let retained: ((id: string) => Promise<unknown>) | undefined;
  await client.synchronize({
    async applyPolicy() {},
    async applyModels() {},
    async applyAssets({ download }) {
      retained = download;
    },
  });
  const download = retained;
  assert.ok(download);
  changeOnDownload = true;
  await assert.rejects(
    download(f.assetId),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "IDENTITY_CHANGED",
  );
});

test("Host synchronization does not report success after identity changes during its final event response", async (t) => {
  const f = await fixture(t);
  let current = f.first;
  const observed: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    if (
      new URL(input instanceof Request ? input.url : input.toString())
        .pathname === "/api/client/events"
    )
      current = f.second;
    return response;
  };
  const client = new UWorkBackendClient(
    f.origin,
    async () => current,
    observed,
  );
  await assert.rejects(
    client.synchronize({
      async applyPolicy() {},
      async applyModels() {},
      async applyAssets() {},
    }),
    (error: unknown) =>
      error instanceof BackendClientError && error.code === "IDENTITY_CHANGED",
  );
});
