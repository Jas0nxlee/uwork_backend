import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

test(
  "actual HTTP backend and existing identity events prewarm, update, revoke and clear Host assets",
  { timeout: 10000 },
  async (t) => {
    const root = resolve(
      process.env.UWORK_CLIENT_PATH ?? "../uwork_backend-client",
    );
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { createUWorkBackendSession } = await load(
      "packages/services/src/enterprise-identity/uworkBackendSession.ts",
    );
    const { createEnterpriseAssetsHost } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsHost.ts",
    );
    const { attachEnterpriseAssetsLifecycle } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsLifecycle.ts",
    );
    const {
      createEnterpriseIdentityService,
      disposeEnterpriseIdentityService,
    } = await load(
      "packages/services/src/enterprise-identity/enterpriseIdentityService.ts",
    );
    const { readEnterpriseIdentityAuthority } = await load(
      "packages/services/src/enterprise-identity/identityServiceLifecycle.ts",
    );
    const { createSharedIdentitySessionStore } = await load(
      "packages/services/src/enterprise-identity/identitySessionStore.ts",
    );
    const f = await fixture(t, "https://upstream.example.test/v1");
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-host-assets-http-")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const securityUrl = `${f.p}/configurations/security`;
    const old = (
      await f.app.inject({ url: securityUrl, headers: f.headers })
    ).json();
    const saved = await f.app.inject({
      method: "PUT",
      url: securityUrl,
      headers: f.headers,
      payload: {
        revision: old.revision,
        data: {
          ...old.published,
          allowFilesystem: true,
          dangerousSkills: false,
        },
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${securityUrl}/publish`,
          headers: f.headers,
          payload: { revision: saved.json().revision },
        })
      ).statusCode,
      200,
    );
    const content = (version: number) => ({
      files: [
        {
          path: "SKILL.md",
          content: `---\nname: controlled\ndescription: Controlled\n---\nVersion ${version}`,
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
        content: content(1),
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id: string = created.json().id;
    const publish = async (version: number) => {
      for (const operation of ["review", "publish"]) {
        const response = await f.app.inject({
          method: "POST",
          url: `${f.p}/assets/${id}/${operation}`,
          headers: f.headers,
          payload: {
            version,
            ...(operation === "review" ? { approved: true } : {}),
          },
        });
        assert.equal(response.statusCode, 200, response.body);
      }
    };
    await publish(1);
    const values = new Map<string, string>();
    const credentials = {
      load: async (key: string) => values.get(key) ?? null,
      save: async (key: string, value: string) => {
        values.set(key, value);
      },
      delete: async (key: string) => {
        values.delete(key);
      },
    };
    let queue: Promise<unknown> = Promise.resolve();
    const store = createSharedIdentitySessionStore(
      credentials,
      <T>(operation: () => Promise<T>) => {
        const result = queue.then(operation, operation);
        queue = result.catch(() => {});
        return result;
      },
    );
    const state = "controlled-state",
      callbackUrl = "https://auth.example.test/callback";
    const session = {
      token: f.headers.authorization.slice("Bearer ".length),
      issuerOrigin: origin,
      expiresAt: Date.now() + 60000,
      profile: {
        id: f.userId,
        tenantId: f.tenantId,
        provider: "wecom",
        displayName: "Controlled",
      },
    };
    const identity = createEnterpriseIdentityService({
      credentials,
      sessionStore: store,
      adapter: {
        listOrganizations: () => [{ id: f.tenantId }],
        resolveOrganization: () => ({ id: f.tenantId }),
        start: async () => ({
          id: state,
          callbackUrl,
          authorizationUrl: `https://login.example.test/?state=${state}`,
          expiresAt: Date.now() + 60000,
        }),
        complete: async () => session,
        restore: async () => session,
      },
    });
    await identity.getView();
    let downloads = 0,
      signedOut = false,
      cleared!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleared = resolve;
    });
    const backendSession = createUWorkBackendSession({
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => readEnterpriseIdentityAuthority(identity),
      readPersistedSession: () => store.read(),
      fetchImpl: async (input: RequestInfo | URL, options?: RequestInit) => {
        if (new URL(String(input)).pathname.endsWith("/download")) downloads++;
        return fetch(input, options);
      },
    });
    const host = createEnterpriseAssetsHost({
      backendSession,
      storageDirectory: directory,
      onCacheEvent: (event: { operation: string; status: string }) => {
        if (
          signedOut &&
          event.operation === "prune" &&
          event.status === "succeeded"
        )
          cleared();
      },
    });
    let warmed!: (value: unknown) => void;
    const prewarm = new Promise<unknown>((resolve) => {
      warmed = resolve;
    });
    const readCatalog = host.readCatalog.bind(host);
    host.readCatalog = async (traceId: string, signal?: AbortSignal) => {
      const result = await readCatalog(traceId, signal);
      if (result.status === "ready") warmed(result);
      return result;
    };
    const lifecycle = attachEnterpriseAssetsLifecycle({
      identity,
      assets: host,
      readAuthority: () => readEnterpriseIdentityAuthority(identity),
    });
    t.after(async () => {
      await lifecycle.disposeAllAndWait();
      await disposeEnterpriseIdentityService(identity);
    });
    const login = await identity.beginLogin();
    await identity.completeLogin(
      login.id,
      `${callbackUrl}?state=${state}&code=controlled`,
    );
    const first = (await prewarm) as {
      status: string;
      assets: { key: string; directory: string }[];
    };
    assert.equal(first.status, "ready");
    assert.equal(first.assets.length, 1);
    assert.equal(downloads, 1);
    assert.match(
      await readFile(join(first.assets[0]!.directory, "SKILL.md"), "utf8"),
      /Version 1/,
    );
    assert.equal(
      (await host.authorizeSkill(first.assets[0], "controlled-first-load"))
        .allowed,
      true,
    );
    await host.readCatalog("controlled-reuse");
    assert.equal(
      downloads,
      1,
      "verified cached bytes are reused, but permission is not cached",
    );
    const row = (
      await f.app.inject({ url: `${f.p}/assets`, headers: f.headers })
    )
      .json()
      .items.find((item: { id: string }) => item.id === id);
    const update = await f.app.inject({
      method: "PUT",
      url: `${f.p}/assets/${id}`,
      headers: f.headers,
      payload: {
        revision: row.revision,
        name: "Controlled",
        kind: "skill",
        scope: { all: true },
        content: content(2),
      },
    });
    assert.equal(update.statusCode, 200, update.body);
    await publish(2);
    const second = await host.readCatalog("controlled-update");
    assert.equal(second.status, "ready");
    assert.equal(downloads, 2);
    assert.equal(
      (await host.authorizeSkill(first.assets[0], "controlled-stale-load"))
        .allowed,
      false,
    );
    assert.match(
      await readFile(join(second.assets[0].directory, "SKILL.md"), "utf8"),
      /Version 2/,
    );
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
      (await host.authorizeSkill(second.assets[0], "controlled-revoked-load"))
        .allowed,
      false,
    );
    signedOut = true;
    await identity.logout();
    await cleanup;
    await assert.rejects(() =>
      readFile(join(second.assets[0].directory, "SKILL.md")),
    );
    assert.equal(
      (
        await host.authorizeSkill(
          second.assets[0],
          "controlled-logged-out-load",
        )
      ).allowed,
      false,
    );
    await lifecycle.disposeAllAndWait();
    await disposeEnterpriseIdentityService(identity);
  },
);
