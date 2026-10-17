import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("actual UWork identity and gateway adapters negotiate the self-owned backend", async (t) => {
  const root = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
  let failModels = false;
  let failProvisioning = false;
  const { createUWorkIdentityAdapter } = await import(
    pathToFileURL(
      `${root}/packages/services/src/enterprise-identity/uworkIdentityAdapter.ts`,
    ).href
  );
  const { createUcasGatewayService } = await import(
    pathToFileURL(
      `${root}/packages/services/src/ucas-gateway/ucasGatewayService.ts`,
    ).href
  );
  const { createEnterpriseIdentityService, disposeEnterpriseIdentityService } =
    await import(
      pathToFileURL(
        `${root}/packages/services/src/enterprise-identity/enterpriseIdentityService.ts`,
      ).href
    );
  const { createLocalIdentitySessionStore } = await import(
    pathToFileURL(
      `${root}/packages/services/src/enterprise-identity/identitySessionStore.ts`,
    ).href
  );
  const { readEnterpriseIdentityAuthority } = await import(
    pathToFileURL(
      `${root}/packages/services/src/enterprise-identity/identityServiceLifecycle.ts`,
    ).href
  );
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 14),
    publicUrl: "https://fixture.example.test",
    wecomProvider: {
      async identity() {
        return "wx-owner";
      },
      async directory() {
        return { members: [], departments: [] };
      },
    },
  });
  t.after(() => app.close());
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const token = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.test", password: "test-password-long" },
    })
  ).json().token;
  const headers = { authorization: `Bearer ${token}` };
  const p = `/api/tenants/${tenantId}`;
  const credential = (
    await app.inject({
      method: "POST",
      url: `${p}/credentials`,
      headers,
      payload: { name: "Test", value: "synthetic-only" },
    })
  ).json().id;
  await app.inject({
    method: "PUT",
    url: `${p}/wecom`,
    headers,
    payload: { corpId: "ww-test", agentId: "1", credentialId: credential },
  });
  await app.inject({
    method: "PUT",
    url: `${p}/members/${userId}/wecom`,
    headers,
    payload: { externalId: "wx-owner" },
  });
  await app.inject({
    method: "POST",
    url: `${p}/models`,
    headers,
    payload: {
      name: "Test",
      upstreamModel: "test",
      baseUrl: "https://upstream.example.test/v1",
      credentialId: credential,
      scope: { all: true },
    },
  });
  const fetchImpl = async (input: URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (failModels && url.pathname === "/v1/models")
      return new Response("{}", { status: 503 });
    assert.equal(url.origin, "https://fixture.example.test");
    const result = await app.inject({
      method: init.method as "GET" | "POST",
      url: url.pathname + url.search,
      headers: init.headers as Record<string, string>,
      payload: init.body as string | undefined,
    });
    return new Response(result.statusCode === 204 ? null : result.body, {
      status: result.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const adapter = createUWorkIdentityAdapter(
    {
      backend: "uwork",
      apiBaseUrl: "https://fixture.example.test",
      callbackUrl: "https://fixture.example.test/api/auth/wecom/callback",
      organizations: [{ orgId: tenantId, corpId: "ww-test", agentId: "1" }],
    },
    fetchImpl,
  );
  const signal = new AbortController().signal;
  const attempt = await adapter.start(signal, tenantId);
  const session = await adapter.complete("synthetic-code", signal, tenantId);
  assert.equal(session.profile.id, userId);
  assert.ok(!session.token.includes("."));
  assert.equal(
    (await adapter.restore(session, signal)).profile.tenantId,
    tenantId,
  );
  // 旧协议fixture也复用真正身份owner，不能用持久Token或手造generation代替私有准入。
  const privateCredentials = new Map<string, string>();
  const credentials = {
    async load(key: string) {
      return privateCredentials.get(key) ?? null;
    },
    async save(key: string, value: string) {
      privateCredentials.set(key, value);
    },
    async delete(key: string) {
      privateCredentials.delete(key);
    },
  };
  const identityStore = createLocalIdentitySessionStore(credentials);
  await identityStore.write(session, 0, () => true);
  const identityOwner = createEnterpriseIdentityService({
    credentials,
    adapter,
    sessionStore: identityStore,
  });
  t.after(() => disposeEnterpriseIdentityService(identityOwner));
  assert.equal((await identityOwner.restoreSession()).status, "authenticated");
  let providerModels: readonly string[] = [];
  const service = createUcasGatewayService({
    store: {
      async read() {
        return null;
      },
      async write() {},
    },
    async readIdentitySession() {
      return (await identityStore.read()).session;
    },
    readIdentityAuthority: () => readEnterpriseIdentityAuthority(identityOwner),
    async resolveApiBaseUrl() {
      return "https://fixture.example.test";
    },
    async resolveBackend() {
      return "uwork";
    },
    fetchImpl,
    provisioning: {
      async listModels() {
        return providerModels;
      },
      async apply(input: {
        apiKey?: string;
        modelIds?: readonly string[];
        replaceApiKey?: boolean;
        authMode?: "enterprise-session";
      }) {
        if (failProvisioning)
          throw new Error("controlled-provisioning-failure");
        assert.equal(input.authMode, "enterprise-session");
        assert.equal(input.apiKey, undefined);
        assert.equal(input.replaceApiKey, undefined);
        providerModels = input.modelIds ?? providerModels;
        return {
          apiKeyApplied: false,
          hasApiKey: false,
          modelsAdded: providerModels.length,
          modelsSkipped: 0,
        };
      },
    },
  });
  t.after(() => service.dispose());
  const sync = await service.sync("login");
  assert.equal(sync.committed, true, JSON.stringify(sync));
  assert.equal(sync.view.status, "ready");
  assert.equal(sync.view.usage.unit, "credits");
  assert.equal(sync.view.models.available.length, 1);
  assert.equal(sync.view.authMode, "enterprise-session");
  assert.equal(sync.view.key, null);
  assert.ok(!JSON.stringify(sync.view).includes(session.token));
  assert.ok(!JSON.stringify(sync.view).includes("synthetic-only"));
  assert.equal((await service.sync("refresh")).committed, true);
  assert.equal(
    app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM sessions WHERE kind='device'",
    )!.n,
    0,
  );
  const second = await adapter.start(signal, tenantId);
  await adapter.cancel(second.id);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/auth/wecom/callback?state=${second.id}&code=synthetic-code`,
      })
    ).statusCode,
    400,
  );
  const validToken = session.token;
  failModels = true;
  assert.equal(
    (await service.sync("controlled-network-failure")).committed,
    false,
  );
  assert.equal(
    (
      await app.inject({
        url: "/v1/models",
        headers: { authorization: `Bearer ${validToken}` },
      })
    ).statusCode,
    200,
  );
  failModels = false;
  failProvisioning = true;
  assert.equal(
    (await service.sync("controlled-write-failure")).committed,
    false,
  );
  assert.equal(
    (
      await app.inject({
        url: "/v1/models",
        headers: { authorization: `Bearer ${validToken}` },
      })
    ).statusCode,
    200,
  );
  failProvisioning = false;
  const expired = await adapter.start(signal, tenantId);
  app.services.db.run(
    "UPDATE login_attempts SET expires_at=? WHERE id=?",
    Date.now() - 1,
    expired.id,
  );
  const fresh = await adapter.start(signal, tenantId);
  assert.equal(
    (await adapter.complete("fresh-code", signal, tenantId)).profile.id,
    userId,
  );
  assert.equal(
    app.services.db.get<{ status: string }>(
      "SELECT status FROM login_attempts WHERE id=?",
      fresh.id,
    )!.status,
    "claimed",
  );
  await adapter.revoke(session);
  assert.equal(
    (
      await app.inject({
        url: "/v1/models",
        headers: { authorization: `Bearer ${session.token}` },
      })
    ).statusCode,
    401,
  );
  void attempt;
});
