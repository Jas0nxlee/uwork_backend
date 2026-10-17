import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
const clientRoot = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
assert.ok(
  clientRoot === resolve("clients/uwork"),
  "client source must remain inside this backend repository",
);
const evidence = resolve("evidence/client-live-20261017-keyless-gateway");
const runLabel =
  process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);
const deferred = () => {
  let resolveValue!: () => void;
  const promise = new Promise<void>((done) => {
    resolveValue = done;
  });
  return { promise, resolve: resolveValue };
};

async function liveFixture(t: TestContext, name: string) {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(join(tmpdir(), "uwork-client-live-gateway-"));
  const earlyCleanup: (() => Promise<void> | void)[] = [
    () => rm(directory, { recursive: true, force: true }),
  ];
  let fullCleanupInstalled = false;
  t.after(async () => {
    if (!fullCleanupInstalled)
      for (const clean of earlyCleanup.reverse()) {
        try {
          await clean();
        } catch {
          /* all owned cleanup steps continue */
        }
      }
  });
  const [
    paths,
    credentialModule,
    cipherModule,
    sharedNode,
    sessionModule,
    identityModule,
    lifecycle,
    adapterModule,
    gatewayModule,
    gatewayStoreModule,
    runtimeModule,
    facadeModule,
    backendSessionModule,
    policyModule,
    networkModule,
    relayModule,
  ] = await Promise.all([
    source("paths.ts"),
    source("credential/credentialService.ts"),
    source("credential/providers/credentialCipherProvider.ts"),
    import(pathToFileURL(join(clientRoot, "packages/shared/src/node.ts")).href),
    source("enterprise-identity/identitySessionStore.ts"),
    source("enterprise-identity/enterpriseIdentityService.ts"),
    source("enterprise-identity/identityServiceLifecycle.ts"),
    source("enterprise-identity/uworkIdentityAdapter.ts"),
    source("ucas-gateway/ucasGatewayService.ts"),
    source("ucas-gateway/ucasGatewayStore.ts"),
    source("model-provider/providerRuntime.ts"),
    source("model-provider/providerFacadeServices.ts"),
    source("enterprise-identity/uworkBackendSession.ts"),
    source("model-provider/uworkProviderSettingsPolicy.ts"),
    source("providers/api/nodeApiNetwork.ts"),
    source("enterprise-model-relay/relay.ts"),
  ]);
  paths.setDataBaseDir(join(directory, "client-home"));
  earlyCleanup.push(() => paths.setDataBaseDir(null));
  let modelCalls = 0;
  const provider = createServer(async (req, res) => {
    assert.ok(
      req.headers.authorization === "Bearer live-gateway-synthetic-vendor",
      "controlled provider credential must match without printing request headers",
    );
    let encoded = "";
    for await (const chunk of req) encoded += chunk;
    const input = JSON.parse(encoded);
    modelCalls++;
    if (input.stream) {
      res.setHeader("content-type", "text/event-stream");
      res.write(
        'data: {"id":"synthetic","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"gateway-live-result"},"finish_reason":null}]}\n\n',
      );
      res.end(
        'data: {"id":"synthetic","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      );
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "gateway-live-result" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const providerPort = (provider.address() as { port: number }).port;
  earlyCleanup.push(async () => {
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
  });
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: false,
  });
  earlyCleanup.push(() => app.close());
  const password = "Client-live-synthetic-password!";
  const owner = await bootstrap(app.services.db, {
    name: "Live synthetic A",
    email: "live-gateway-a@example.test",
    password,
  });
  let heldRoute: string | null = null;
  let reached = deferred();
  let release = deferred();
  const requests: { method: string; route: string; status: number }[] = [];
  app.addHook("onSend", async (req, _reply, payload) => {
    if (heldRoute && req.routeOptions.url === heldRoute) {
      heldRoute = null;
      reached.resolve();
      await release.promise;
    }
    return payload;
  });
  app.addHook("onResponse", async (req, reply) => {
    requests.push({
      method: req.method,
      route: req.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
    });
  });
  earlyCleanup.push(() => release.resolve());
  const backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  const certificate = join(directory, "local-cert.pem"),
    privateKey = join(directory, "local-key.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKey,
    "-out",
    certificate,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-days",
    "1",
  ]);
  const previousCAs = getCACertificates("default");
  setDefaultCACertificates([
    ...previousCAs,
    await readFile(certificate, "utf8"),
  ]);
  earlyCleanup.push(() => setDefaultCACertificates(previousCAs));
  const proxy = createHttpsServer(
    { key: await readFile(privateKey), cert: await readFile(certificate) },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: Number(new URL(backendOrigin).port),
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  earlyCleanup.push(async () => {
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
  });
  const origin = `https://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const p = `/api/tenants/${owner.tenantId}`;
  const api = async <T = Row>(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    expected = 200,
  ): Promise<T> => {
    assert.ok(
      !path.includes("/wecom") &&
        !path.includes("/drive") &&
        !path.includes("/connectors"),
    );
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected, `${method} ${path} status`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const adminLogin = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    { email: "live-gateway-a@example.test", password },
  );
  const login = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    { email: "live-gateway-a@example.test", password },
  );
  const credential = await api(
    `${p}/credentials`,
    "POST",
    { name: "Synthetic local vendor", value: "live-gateway-synthetic-vendor" },
    adminLogin.token,
    201,
  );
  const model = await api(
    `${p}/models`,
    "POST",
    {
      name: "Live gateway model",
      upstreamModel: "controlled",
      credentialId: credential.id,
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      scope: { all: true },
      inputRate: 1000,
      outputRate: 2000,
      maxOutputTokens: 16,
    },
    adminLogin.token,
    201,
  );
  const credentials = credentialModule.createCredentialService({
    cipherProvider: cipherModule.createCredentialCipherProvider({
      env: { ZCODE_CREDENTIAL_SECRET: randomBytes(32).toString("hex") },
    }),
  });
  const sessionStore = sessionModule.createSharedIdentitySessionStore(
    credentials,
    <T>(operation: () => Promise<T>) =>
      sharedNode.withFileLock(join(directory, "identity-state"), operation),
  );
  const adapter = adapterModule.createUWorkIdentityAdapter({
    backend: "uwork",
    apiBaseUrl: origin,
    callbackUrl: origin + "/api/auth/wecom/callback",
    organizations: [
      { orgId: owner.tenantId, corpId: "synthetic-not-used", agentId: "1" },
    ],
  });
  // 合成email桥只初始化现有加密store；恢复与退出仍由真正身份所有者和公开HTTP验证。
  const session = {
    token: login.token,
    expiresAt: login.expiresAt,
    issuerOrigin: origin,
    profile: {
      id: owner.userId,
      tenantId: owner.tenantId,
      provider: "wecom",
      displayName: "Live synthetic A",
    },
  };
  const initial = await adapter.restore(session, new AbortController().signal);
  assert.ok(initial);
  assert.ok((await sessionStore.write(initial, 0, () => true)).accepted);
  const identity = identityModule.createEnterpriseIdentityService({
    credentials,
    adapter,
    sessionStore,
  });
  assert.equal((await identity.restoreSession()).status, "authenticated");
  const network = networkModule.createHostApiNetworkTransport(async () => ({
    caCertPath: certificate,
    noProxy: "*",
  }));
  earlyCleanup.push(() => network.disposeAndWait());
  const backend = backendSessionModule.createUWorkBackendSession({
    fetchImpl: network.fetch,
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => sessionStore.read(),
  });
  const personalPath = join(directory, "provider", "personal.json");
  const gatewayPath = join(directory, "gateway.json");
  const gatewayStore = gatewayStoreModule.createUcasGatewayStore({
    filePath: gatewayPath,
  });
  let runtime = runtimeModule.createProviderRuntime({
    zcodeBuiltinFilePath: join(
      clientRoot,
      "config/provider/zcode-builtin.json",
    ),
    personalFilePath: personalPath,
    personalPollingIntervalMs: false,
    watch: false,
    ucasEndpointSource: {
      read: async () => (await gatewayStore.read())?.endpoint.baseUrl,
    },
    settingsPolicy: policyModule.createUWorkProviderSettingsPolicy(
      () => backend,
    ),
  });
  await runtime.start();
  const modelRelay = relayModule.createEnterpriseModelRelay({
    backendSession: backend,
  });
  const modelBinding = {
    runtime: {},
    workspaceKey: "controlled-live-workspace",
    sessionId: "controlled-live-conversation",
  };
  const createGateway = (withAuthority = true) =>
    gatewayModule.createUcasGatewayService({
      store: gatewayStore,
      readIdentitySession: async () => (await sessionStore.read()).session,
      ...(withAuthority
        ? {
            readIdentityAuthority: () =>
              lifecycle.readEnterpriseIdentityAuthority(identity),
          }
        : {}),
      resolveBackend: async () => "uwork",
      resolveApiBaseUrl: async () => origin,
      // 使用真正Host transport，不改写fetch、不把网络请求转成app.inject。
      fetchImpl: network.fetch,
      provisioning: {
        apply: async (input: unknown) => {
          const applied =
            await runtime.providerSettings[
              facadeModule.providerSettingsTrustedGatewayProvisioning
            ](input);
          return {
            apiKeyApplied: applied.apiKeyApplied,
            hasApiKey: applied.hasApiKey,
            modelsAdded: applied.modelsAdded,
            modelsSkipped: applied.modelsSkipped,
          };
        },
        listModels: async () =>
          (await runtime.providerSettings.getView()).providers
            .find((v: { providerId: string }) => v.providerId === "ucas")
            ?.models.map((v: { modelId: string }) => v.modelId) ?? [],
      },
    });
  let gateway = createGateway();
  const checks: string[] = [];
  const check = (value: string) => checks.push(value);
  const personal = () => readFile(personalPath, "utf8");
  const resolved = async () => {
    const resolution = await runtime.providerSettings.resolveModelConfig({
      providerId: "ucas",
      modelId: String(model.id),
    });
    const provider = runtime.registryService.getProvider("ucas");
    assert.ok(
      provider && runtime.registryService.getModel("ucas", String(model.id)),
      "actual executable Registry provider/model must exist",
    );
    return { ...resolution, providerConfig: provider.config };
  };
  const modelRequest = async (
    key = "live-provider-call",
    expected = 200,
    stream = false,
  ) => {
    const config = (await resolved()).providerConfig;
    assert.equal(config.api.baseUrl, origin + "/v1");
    assert.equal(config.access.type, "enterprise-session");
    assert.equal(config.access.apiKey, undefined);
    const ownerProof = await backend.run(
      (scope: { ownerKey: string }) => scope.ownerKey,
    );
    assert.ok(ownerProof.managed);
    const opened = await modelRelay.request({
      ...modelBinding,
      traceId: key,
      request: {
        kind: "open",
        ownerKey: ownerProof.value,
        url: config.api.baseUrl + "/chat/completions",
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: "synthetic local model" }],
          max_tokens: 8,
          ...(stream ? { stream: true } : {}),
        }),
      },
    });
    assert.ok(opened.status === "ok" && opened.streamId);
    assert.equal(opened.httpStatus, expected);
    const parts: Buffer[] = [];
    for (;;) {
      const frame = await modelRelay.request({
        ...modelBinding,
        request: { kind: "read", streamId: opened.streamId },
      });
      assert.equal(frame.status, "ok");
      if (frame.chunk) parts.push(Buffer.from(frame.chunk, "base64"));
      if (frame.done) break;
    }
    const text = Buffer.concat(parts).toString();
    if (stream) {
      assert.match(text, /gateway-live-result/);
      assert.match(text, /\[DONE\]/);
      return text;
    }
    const result = JSON.parse(text);
    if (expected === 200)
      assert.equal(result.choices[0].message.content, "gateway-live-result");
    return result;
  };
  fullCleanupInstalled = true;
  t.after(async () => {
    release.resolve();
    gateway.dispose();
    modelRelay.dispose();
    runtime.dispose();
    await lifecycle.disposeEnterpriseIdentityService(identity);
    await network.disposeAndWait();
    try {
      await api(
        "/api/auth/logout",
        "POST",
        { revokeDevices: true },
        adminLogin.token,
        204,
      );
    } catch {
      /* Logout may already have invalidated this owned session. */
    }
    try {
      await app.close();
    } finally {
      provider.closeAllConnections();
      proxy.closeAllConnections();
      await Promise.all([
        new Promise<void>((done) => provider.close(() => done())),
        new Promise<void>((done) => proxy.close(() => done())),
      ]);
      setDefaultCACertificates(previousCAs);
      await rm(directory, { recursive: true, force: true });
      paths.setDataBaseDir(null);
    }
    const closed = async (port: number) =>
      new Promise<boolean>((done) => {
        const s = createConnection(port, "127.0.0.1");
        s.once("error", () => done(true));
        s.once("connect", () => {
          s.destroy();
          done(false);
        });
      });
    const portsClosed = await Promise.all([
      closed(Number(new URL(origin).port)),
      closed(Number(new URL(backendOrigin).port)),
      closed(providerPort),
    ]);
    assert.ok(portsClosed.every(Boolean));
    await writeFile(
      join(evidence, `${name}-${runLabel}.json`),
      JSON.stringify(
        {
          boundary:
            "real backend temp disk/TCP; actual identity/Gateway/ProviderRuntime/private Host model relay source; email/store bootstrap bridge only; no mocked fetch/WeCom/external MCP/drive/main env/paid vendor",
          checks,
          requests,
          modelCalls,
          node: process.version,
          cleanup: {
            portsClosed,
            ownedDirectoryRemoved: true,
            identityAndProviderDisposed: true,
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  });
  return {
    api,
    p,
    owner,
    origin,
    login: adminLogin,
    model,
    identity,
    adapter,
    session,
    sessionStore,
    gatewayStore,
    gateway: () => gateway,
    createGateway,
    check,
    personal,
    resolved,
    modelRequest,
    calls: () => modelCalls,
    settings: () => runtime.providerSettings,
    seedLegacyModel: () =>
      runtime.providerSettings[
        facadeModule.providerSettingsTrustedGatewayProvisioning
      ]({ baseUrl: origin + "/v1", modelIds: [String(model.id)] }),
    relogin: async () => {
      const issued = await api<{ token: string; expiresAt: number }>(
        "/api/auth/login",
        "POST",
        { email: "live-gateway-a@example.test", password },
      );
      const next = await adapter.restore(
        { ...session, token: issued.token, expiresAt: issued.expiresAt },
        new AbortController().signal,
      );
      assert.ok(next);
      const current = await sessionStore.read();
      assert.ok(
        (await sessionStore.write(next, current.revision, () => true)).accepted,
      );
      assert.equal((await identity.restoreSession()).status, "authenticated");
    },
    delayModels: () => {
      heldRoute = "/v1/models";
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    delayUsage: () => {
      heldRoute = "/api/client/usage";
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    restart: async () => {
      gateway.dispose();
      runtime.dispose();
      runtime = runtimeModule.createProviderRuntime({
        zcodeBuiltinFilePath: join(
          clientRoot,
          "config/provider/zcode-builtin.json",
        ),
        personalFilePath: personalPath,
        personalPollingIntervalMs: false,
        watch: false,
        ucasEndpointSource: {
          read: async () => (await gatewayStore.read())?.endpoint.baseUrl,
        },
        settingsPolicy: policyModule.createUWorkProviderSettingsPolicy(
          () => backend,
        ),
      });
      await runtime.start();
      gateway = createGateway();
    },
    assertSafe: async () => {
      const view = await gateway.getView();
      const record = await sessionStore.read();
      const config = (await resolved()).providerConfig;
      const projection = JSON.stringify({
        view,
        store: await gatewayStore.read(),
      });
      assert.ok(
        !projection.includes(record.session.token) &&
          config.access.type === "enterprise-session" &&
          config.access.apiKey === undefined &&
          !(await personal()).includes(record.session.token) &&
          !projection.includes("live-gateway-synthetic-vendor"),
      );
      const encrypted = await readFile(
        join(paths.getAppConfigDir(), "credentials.json"),
        "utf8",
      );
      assert.ok(!encrypted.includes(record.session.token));
    },
  };
}

test("real UWork Gateway persists keyless Provider configuration, forwards privately and tracks current backend usage", async (t) => {
  const f = await liveFixture(t, "provisioning-usage");
  assert.equal((await f.gateway().getView()).authMode, "enterprise-session");
  const sync = await f.gateway().sync("login");
  assert.ok(sync.committed && !sync.apiKeyApplied && !sync.providerHasApiKey);
  assert.equal(sync.view.authMode, "enterprise-session");
  assert.equal(sync.view.key, null);
  assert.equal(sync.view.status, "ready");
  assert.ok(sync.view.models.available.includes(f.model.id));
  f.check("actual-identity-restore-and-provider-symbol-provision");
  await f.assertSafe();
  f.check("gateway-view-store-and-encrypted-identity-do-not-leak-keys");
  assert.equal((await f.resolved()).providerConfig.access.apiKey, undefined);
  await f.modelRequest();
  assert.equal(f.calls(), 1);
  f.check("actual-ProviderRuntime-config-private-Host-model-generation");
  for (const period of ["7d", "month", "30d"])
    for (const metric of ["requests", "cost", "tokens"]) {
      const view = await f
        .gateway()
        .refreshUsage({ period, metric, force: true });
      assert.equal(view.usage.period, period);
      assert.equal(view.usage.metric, metric);
      assert.equal(view.usage.summary.requestCount, 1);
      assert.equal(view.usage.summary.cost, 9);
      assert.equal(view.usage.summary.totalTokens, 7);
      assert.equal(view.usage.unit, "credits");
      f.check(`current-backend-usage-${period}-${metric}`);
    }
  const ledger = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.items[0]!.status, "settled");
  assert.equal(ledger.items[0]!.amount, 9);
  f.check("usage-agrees-with-actual-backend-ledger");
  assert.ok((await f.gateway().sync("refresh")).committed);
  assert.deepEqual(
    await f.api("/api/auth/device-tokens", "GET", undefined, f.login.token),
    [],
  );
  f.check("repeated-managed-Gateway-sync-issues-zero-device-credentials");
  await f.restart();
  const restored = (await f.resolved()).providerConfig;
  assert.equal(restored.api.baseUrl, f.origin + "/v1");
  assert.equal(restored.access.type, "enterprise-session");
  assert.equal(restored.access.apiKey, undefined);
  assert.equal((await f.gateway().getView()).status, "idle");
  assert.ok((await f.gateway().sync("startup")).committed);
  f.check("new-Gateway-and-ProviderRuntime-restore-disk-state");
  const applied = await f.gateway().applyModels();
  assert.equal(applied.modelsAdded, 0);
  f.check("model-append-is-idempotent");
  // 公开device API保持兼容；显式HTTP申请/吊销与Gateway自动配置完全分离。
  const device = await f.api<{ id: string; token: string }>(
    "/api/auth/device-tokens",
    "POST",
    { ttlHours: 1 },
    f.login.token,
    201,
  );
  await f.api("/v1/models", "GET", undefined, device.token);
  await f.api(
    `/api/auth/device-tokens/${device.id}`,
    "DELETE",
    undefined,
    f.login.token,
    204,
  );
  await f.api("/v1/models", "GET", undefined, device.token, 401);
  assert.equal(f.calls(), 1);
  f.check("explicit-public-device-revoke-still-rejects-old-token");
  await f.modelRequest("after-device-revoke");
  assert.equal(f.calls(), 2);
  f.check("Host-private-session-model-path-does-not-depend-on-device-token");
  const usage = await f
    .gateway()
    .refreshUsage({ period: "month", metric: "cost", force: true });
  assert.equal(usage.usage.summary.requestCount, 2);
  assert.equal(usage.usage.summary.cost, 18);
  f.check("recovered-current-usage-has-two-real-settlements");
  await f.identity.logout();
  assert.equal((await f.gateway().getView()).status, "signed-out");
  f.check("identity-owner-logout-clears-gateway-view");
});

test("a delayed real models HTTP response cannot provision after identity owner logout", async (t) => {
  const f = await liveFixture(t, "late-logout");
  assert.ok((await f.gateway().sync("login")).committed);
  const before = digest(await f.personal());
  const delayed = f.delayModels();
  const syncing = f.gateway().sync("delayed-refresh");
  await delayed.reached;
  await f.identity.logout();
  delayed.release();
  const result = await syncing;
  await writeFile(
    join(evidence, `late-response-reproduction-${runLabel}.json`),
    JSON.stringify(
      {
        expectedCommitted: false,
        observedCommitted: result.committed,
        returnedStatus: result.view.status,
        providerChanged: digest(await f.personal()) !== before,
        remainingOwnedDevices: (
          await f.api<unknown[]>(
            "/api/auth/device-tokens",
            "GET",
            undefined,
            f.login.token,
          )
        ).length,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  assert.equal(
    result.committed,
    false,
    "logout must reject an old accepted HTTP response",
  );
  assert.equal(
    digest(await f.personal()),
    before,
    "stale synchronization must not mutate Provider storage",
  );
  assert.equal((await f.gateway().getView()).status, "signed-out");
  f.check("real-late-model-response-discarded-before-provider-write");
});

test("managed Gateway without its private identity authority never provisions", async (t) => {
  const f = await liveFixture(t, "missing-authority");
  const gateway = f.createGateway(false);
  t.after(() => gateway.dispose());
  const before = digest(await f.personal());
  const result = await gateway.sync("missing-private-port");
  assert.equal(
    result.committed,
    false,
    "managed Gateway must fail closed without the Host authority",
  );
  assert.equal(result.view.authMode, "enterprise-session");
  assert.equal(digest(await f.personal()), before);
  f.check("managed-production-authority-port-missing-refuses-writes");
});

test("late real usage response is discarded after the identity owner logs out", async (t) => {
  const f = await liveFixture(t, "late-usage");
  assert.ok((await f.gateway().sync("login")).committed);
  await f.modelRequest();
  const delayed = f.delayUsage();
  const refreshing = f
    .gateway()
    .refreshUsage({ period: "7d", metric: "cost", force: true });
  await delayed.reached;
  await f.identity.logout();
  delayed.release();
  const result = await refreshing;
  assert.equal(
    result.status,
    "signed-out",
    "late usage must not republish a previous authenticated view",
  );
  assert.equal(result.usage, null);
  f.check("late-real-usage-discarded-after-owner-invalidation");
});

test("applyModels reads the current identity instead of reusing an old ready projection", async (t) => {
  const f = await liveFixture(t, "apply-after-logout");
  assert.ok((await f.gateway().sync("login")).committed);
  const before = digest(await f.personal());
  await f.identity.logout();
  // 不先调用getView清空缓存，验证真实命令自身执行当前身份裁决。
  const result = await f.gateway().applyModels();
  assert.equal(
    result.committed,
    false,
    "cached model list is not authority after logout",
  );
  assert.equal(digest(await f.personal()), before);
  f.check("model-apply-command-refuses-stale-view-after-logout");
});

test("same-profile relogin reacquires the current model catalog before applyModels", async (t) => {
  const f = await liveFixture(t, "relogin-catalog");
  assert.ok((await f.gateway().sync("login")).committed);
  await f.identity.logout();
  const old = (
    await f.api<Row[]>(`${f.p}/models`, "GET", undefined, f.login.token)
  ).find((r) => r.id === f.model.id)!;
  await f.api(
    `${f.p}/models/${f.model.id}`,
    "DELETE",
    undefined,
    f.login.token,
    204,
  );
  const replacement = await f.api(
    `${f.p}/models`,
    "POST",
    { ...(old.data as Row), name: "relogin replacement", scope: { all: true } },
    f.login.token,
    201,
  );
  await f.relogin();
  const result = await f.gateway().applyModels();
  assert.ok(result.committed);
  assert.ok(
    result.view.models.available.includes(replacement.id),
    "new owner must acquire the live replacement catalog",
  );
  assert.ok(
    !result.view.models.available.includes(f.model.id),
    "old model projection must not survive a new identity generation",
  );
  f.check("same-profile-new-generation-resyncs-current-catalog");
});

test("partial refresh after same-profile relogin never mixes old owner projection fields", async (t) => {
  const f = await liveFixture(t, "relogin-partial");
  assert.ok((await f.gateway().sync("login")).committed);
  await f.modelRequest();
  await f.identity.logout();
  await f.relogin();
  const usage = await f
    .gateway()
    .refreshUsage({ period: "month", metric: "cost", force: true });
  assert.equal(usage.usage.summary.cost, 9);
  assert.equal(usage.user, null);
  assert.equal(usage.key, null);
  assert.equal(usage.endpoint, null);
  assert.equal(usage.models, null);
  const models = await f.gateway().refreshModels();
  assert.ok(models.models.available.includes(f.model.id));
  assert.equal(models.user, null);
  assert.equal(models.key, null);
  assert.equal(models.endpoint, null);
  assert.ok((await f.gateway().applyModels()).committed);
  f.check(
    "current-partial-refresh-keeps-old-identity-fields-cleared-until-full-sync",
  );
});

test("current backend descriptors repair old managed metadata without changing personal or legacy UCAS parameters", async (t) => {
  const f = await liveFixture(t, "managed-metadata");
  const legacySeed = await f.seedLegacyModel();
  const legacy = legacySeed.view.providers.find(
    (p: { providerId: string }) => p.providerId === "ucas",
  );
  const wrong = legacy.models.find(
    (m: { modelId: string }) => m.modelId === f.model.id,
  ).effectiveConfig;
  assert.equal(wrong.properties.contextWindow, 1000000);
  assert.equal(wrong.properties.inputFormat.supportsImage, true);
  assert.deepEqual(wrong.optionSpecs.reasoningLevel.values, [
    "low",
    "high",
    "max",
  ]);
  const sentinelBefore = digest(
    JSON.stringify(
      legacy.models.find(
        (m: { modelId: string }) => m.modelId === "ucas-deepseek-flash",
      ).effectiveConfig,
    ),
  );
  const personal = await f.api(
    `${f.p}/configurations/personal`,
    "GET",
    undefined,
    f.login.token,
  );
  const draft = await f.api(
    `${f.p}/configurations/personal`,
    "PUT",
    {
      revision: personal.revision,
      data: { ...(personal.published as Row), models: true },
    },
    f.login.token,
  );
  await f.api(
    `${f.p}/configurations/personal/publish`,
    "POST",
    { revision: draft.revision },
    f.login.token,
  );
  const created = await f.settings().createPersonalProvider({
    providerName: "Untouched personal sentinel",
    initialConfig: {
      api: {
        type: "openai-chat-completions",
        baseUrl: "https://personal-sentinel.example.test/v1",
      },
      access: {
        type: "api-key",
        apiKey: "synthetic-personal-not-dispatched",
      },
    },
  });
  await f.settings().addPersonalModel(
    created.providerId,
    "personal-sentinel",
    {
      properties: { contextWindow: 333333 },
      optionSpecs: {
        reasoningLevel: { values: ["personal-only"], map: "{}" },
      },
    },
    true,
  );
  const personalBefore = digest(
    JSON.stringify(
      (await f.settings().getView()).providers.find(
        (p: { providerId: string }) => p.providerId === created.providerId,
      ).models,
    ),
  );
  const directory = await f.api<{ data: Row[] }>(
    "/v1/models",
    "GET",
    undefined,
    f.login.token,
  );
  const described = directory.data.find((m) => m.id === f.model.id)!;
  assert.equal(described.context_window, 128000);
  assert.equal(described.max_output_tokens, 16);
  assert.equal(described.supports_vision, false);
  assert.equal(described.supports_reasoning, false);
  assert.equal(described.supports_tools, false);
  assert.ok((await f.gateway().sync("metadata-migration")).committed);
  let config = (await f.resolved()).effectiveConfig;
  assert.equal(config.properties.contextWindow, 128000);
  assert.equal(config.properties.inputFormat.supportsImage, false);
  assert.equal(config.properties.supportsToolCall, false);
  assert.equal(config.optionSpecs.maxOutputTokens.max, 16);
  assert.equal(
    config.optionSpecs.maxOutputTokens.map,
    '{"max_tokens": maxOutputTokens}',
  );
  assert.deepEqual(config.optionSpecs.reasoningLevel.values, ["none"]);
  assert.equal(config.optionSpecs.reasoningLevel.map, "{}");
  f.check(
    "old-UCAS-default-metadata-repaired-through-real-Gateway-private-writer",
  );
  assert.equal(
    (await f.resolved()).providerConfig.access.type,
    "enterprise-session",
  );
  const row = (
    await f.api<Row[]>(`${f.p}/models`, "GET", undefined, f.login.token)
  ).find((m) => m.id === f.model.id)!;
  await f.api(
    `${f.p}/models/${f.model.id}`,
    "PUT",
    {
      ...(row.data as Row),
      name: row.name,
      scope: row.scope,
      enabled: row.enabled,
      revision: row.revision,
      contextWindow: 64000,
      maxOutputTokens: 8,
      supportsVision: true,
      supportsReasoning: true,
      supportsTools: true,
    },
    f.login.token,
  );
  assert.ok((await f.gateway().applyModels()).committed);
  config = (await f.resolved()).effectiveConfig;
  assert.equal(config.properties.contextWindow, 64000);
  assert.equal(config.properties.inputFormat.supportsImage, true);
  assert.equal(config.properties.supportsToolCall, true);
  assert.equal(config.optionSpecs.maxOutputTokens.max, 8);
  assert.deepEqual(config.optionSpecs.reasoningLevel.values, [
    "low",
    "medium",
    "high",
  ]);
  assert.ok(
    (await f.resolved()).providerConfig.access.apiKey === undefined,
    "model metadata application must remain keyless",
  );
  f.check("HTTP-updated-same-model-descriptor-applies-without-device-key");
  const forged = {
    id: String(f.model.id),
    contextWindow: 2000000,
    maxOutputTokens: 131072,
    supportsVision: false,
    supportsReasoning: false,
    supportsTools: false,
  };
  await f.settings().applyUcasGatewayProvisioning({
    baseUrl: f.origin + "/v1",
    modelIds: [String(f.model.id)],
    managedModels: [forged],
  });
  assert.equal(
    (await f.resolved()).effectiveConfig.properties.contextWindow,
    64000,
  );
  f.check("public-personal-entry-ignores-forged-managed-metadata");
  const view = await f.settings().getView();
  assert.equal(
    digest(
      JSON.stringify(
        view.providers
          .find((p: { providerId: string }) => p.providerId === "ucas")
          .models.find(
            (m: { modelId: string }) => m.modelId === "ucas-deepseek-flash",
          ).effectiveConfig,
      ),
    ),
    sentinelBefore,
  );
  assert.equal(
    digest(
      JSON.stringify(
        view.providers.find(
          (p: { providerId: string }) => p.providerId === created.providerId,
        ).models,
      ),
    ),
    personalBefore,
  );
  assert.equal(f.calls(), 0);
  f.check(
    "legacy-UCAS-and-personal-model-parameters-unchanged-no-supplier-dispatch",
  );
});

test("real backend JSON and SSE model responses traverse private Host byte streams without any device key", async (t) => {
  const f = await liveFixture(t, "private-sse");
  assert.ok((await f.gateway().sync("login")).committed);
  await f.modelRequest("private-real-sse", 200, true);
  assert.equal(f.calls(), 1);
  assert.deepEqual(
    await f.api("/api/auth/device-tokens", "GET", undefined, f.login.token),
    [],
  );
  await f.assertSafe();
  f.check("actual-backend-SSE-bytes-private-Host-no-device-key");
});
