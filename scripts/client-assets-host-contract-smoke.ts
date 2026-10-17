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
      process.env.UWORK_CLIENT_PATH ?? "clients/uwork",
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
    const { createEnterpriseToolAuthorizationBridge } = await load(
      "packages/services/src/zcode-agent/enterpriseToolAuthorizationBridge.ts",
    );
    const { createProtocolEnterpriseSkillsCatalog } = await load(
      "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/enterprise-skills-catalog.ts",
    );
    const { createRootTraceContext } = await load(
      "apps/zcode-cli/packages/contracts/src/index.ts",
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
    const workspace = {
      workspacePath: directory,
      workspaceKey: "controlled",
      workspaceIdentity: "controlled",
    };
    const pending = new Map<number, (value: unknown) => void>();
    let nextId = 0;
    const peer = {
      isDisposed: false,
      onClose: () => ({ dispose() {} }),
      respond: async (id: number, value: unknown) => {
        pending.get(id)!(JSON.parse(JSON.stringify(value)));
      },
      respondError: async () => {
        throw new Error("Unexpected controlled protocol error");
      },
    };
    const bridge = createEnterpriseToolAuthorizationBridge({
      assets: host,
      isCurrent: () => true,
    });
    const protocol = createProtocolEnterpriseSkillsCatalog({
      workspace: () => workspace,
      context: () => ({
        async requestClient(
          method: string,
          params: unknown,
          schema: { parse(value: unknown): unknown },
          options: {
            trace: { traceId: string };
            signal?: AbortSignal;
            timeoutMs: number;
          },
        ) {
          assert.equal(method, "interaction/readEnterpriseSkills");
          assert.equal(options.timeoutMs, 65000);
          const id = ++nextId,
            response = new Promise((resolve) => {
              pending.set(id, resolve);
            });
          try {
            await bridge.handleCatalog(
              peer,
              workspace,
              id,
              JSON.parse(JSON.stringify(params)),
              options.trace.traceId,
            );
            return schema.parse(await response);
          } finally {
            pending.delete(id);
          }
        },
        notify: (value: { params: unknown }) =>
          bridge.cancel(peer, workspace, value.params),
      }),
    });
    const requestCatalog = () =>
      protocol.readCatalog({
        sessionId: "controlled",
        workspacePath: "/untrusted-caller-path",
        traceContext: createRootTraceContext(),
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
      (await host.authorizeAsset(first.assets[0], "controlled-first-load"))
        .allowed,
      true,
    );
    await requestCatalog();
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
    const second = await requestCatalog();
    assert.equal(second.status, "ready");
    assert.equal(downloads, 2);
    assert.equal(
      (await host.authorizeAsset(first.assets[0], "controlled-stale-load"))
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
      (await host.authorizeAsset(second.assets[0], "controlled-revoked-load"))
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
        await host.authorizeAsset(
          second.assets[0],
          "controlled-logged-out-load",
        )
      ).allowed,
      false,
    );
    await lifecycle.disposeAllAndWait();
    await disposeEnterpriseIdentityService(identity);
    assert.equal(pending.size, 0);
  },
);

test(
  "real HTTP backend distributes an expert asset into the same Host cache and admission",
  { timeout: 10000 },
  async (t) => {
    const root = resolve(
      process.env.UWORK_CLIENT_PATH ?? "clients/uwork",
    );
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { createUWorkBackendSession } = await load(
      "packages/services/src/enterprise-identity/uworkBackendSession.ts",
    );
    const { createEnterpriseAssetsHost } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsHost.ts",
    );
    const { withEnterpriseSkillAuthorization } = await load(
      "apps/zcode-cli/packages/adapters/src/skills/enterprise-skills.ts",
    );
    const f = await fixture(t, "https://upstream.example.test/v1");
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-host-expert-http-")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const securityUrl = `${f.p}/configurations/security`,
      old = (
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
    const expert = (instructions: string) => ({
      instructions,
      profession: "受控专家",
    });
    const created = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Expert",
        kind: "expert",
        scope: { all: true },
        content: expert("Controlled expert instructions"),
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id: string = created.json().id;
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
    const authority = {
      generation: 1,
      revision: 1,
      signal: new AbortController().signal,
      session: {
        token: f.headers.authorization.slice("Bearer ".length),
        issuerOrigin: origin,
        expiresAt: Date.now() + 60000,
        profile: {
          id: f.userId,
          tenantId: f.tenantId,
          provider: "wecom",
          displayName: "Controlled",
        },
      },
    };
    const backendSession = createUWorkBackendSession({
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => authority,
      readPersistedSession: async () => ({
        revision: authority.revision,
        session: authority.session,
      }),
    });
    const host = createEnterpriseAssetsHost({
      backendSession,
      storageDirectory: directory,
    });
    t.after(() => host.disposeAllAndWait());
    const catalog = await host.readCatalog("controlled-expert");
    if (catalog.status !== "ready")
      throw new Error(`Expected ready catalog: ${catalog.status}`);
    assert.deepEqual(
      catalog.experts.map((entry: { name: string }) => entry.name),
      ["Controlled Expert"],
    );
    assert.equal(
      (await host.authorizeAsset(catalog.experts[0], "controlled-expert-load"))
        .allowed,
      true,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(catalog.experts[0].directory, "expert.json"),
          "utf8",
        ),
      ),
      expert("Controlled expert instructions"),
    );
    // 技能所有者不能把专家引用当技能加载：同一准入按引用种类拒绝。
    const skillPort = withEnterpriseSkillAuthorization(
      {
        async discoverSkills() {
          throw new Error(
            "Skill reads are not expected for an expert reference",
          );
        },
        async loadSkill() {
          throw new Error(
            "Skill reads are not expected for an expert reference",
          );
        },
      },
      {
        authorization: {
          async authorize() {
            return { allowed: true, code: "allowed" };
          },
        },
        catalog: {
          async readCatalog() {
            return catalog;
          },
        },
        enterprisePort: {} as never,
        sessionId: "controlled",
        workspacePath: directory,
        traceContext: { traceId: "controlled-expert" } as never,
      },
    );
    await assert.rejects(
      () =>
        skillPort.loadSkill({
          name: `enterprise:${id}`,
          workingDirectory: directory,
        }),
      /enterprise_skill_not_found/,
      "the skill namespace never resolves an expert binding",
    );
    const revoke = await f.app.inject({
      method: "POST",
      url: `${f.p}/policies`,
      headers: f.headers,
      payload: {
        name: "Revoke expert",
        family: "expert",
        mode: "deny",
        resourceIds: [id],
        scope: { all: true },
      },
    });
    assert.equal(revoke.statusCode, 201, revoke.body);
    assert.equal(
      (
        await host.authorizeAsset(
          catalog.experts[0],
          "controlled-expert-revoked",
        )
      ).allowed,
      false,
    );
    const after = await host.readCatalog("controlled-expert");
    if (after.status !== "ready") throw new Error("Expected current catalog");
    assert.deepEqual(after.experts, []);
  },
);
