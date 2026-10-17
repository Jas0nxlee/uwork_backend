import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomBytes } from "node:crypto";
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
const evidence = resolve("evidence/client-user-journey-20261017");
const runLabel = process.env.UWORK_USER_JOURNEY_RUN === "red" ? "red" : "green";
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);
const deferred = () => {
  let resolveValue!: () => void;
  const promise = new Promise<void>((done) => {
    resolveValue = done;
  });
  return { promise, resolve: resolveValue };
};

async function journeyFixture(t: TestContext, name: string) {
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
    wecomProvider: {
      identity: async () => {
        throw new Error("excluded WeCom provider must not run");
      },
      directory: async () => {
        throw new Error("excluded WeCom provider must not run");
      },
    },
  });
  earlyCleanup.push(() => app.close());
  const password = "Client-live-synthetic-password!";
  const owner = await bootstrap(app.services.db, {
    name: "Live synthetic A",
    email: "live-gateway-a@example.test",
    password,
  });
  let heldRoute: string | null = null;
  let failRoute: string | null = null;
  app.addHook("onRequest", async (req, reply) => {
    if (failRoute && req.url.split("?")[0] === failRoute) {
      failRoute = null;
      return reply.code(503).send({
        error: {
          code: "SYNTHETIC_UNAVAILABLE",
          message: "owned fault injection",
        },
      });
    }
  });
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
      (!path.includes("/wecom") ||
        /^\/api\/tenants\/[^/]+(?:\/members\/[^/]+)?\/wecom$/.test(path)) &&
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
  await api(
    `${p}/wecom`,
    "PUT",
    {
      corpId: "synthetic-unused-corp",
      agentId: "1",
      credentialId: credential.id,
    },
    adminLogin.token,
  );
  const chat = await api<Row>(
    `${p}/configurations/new-chat`,
    "GET",
    undefined,
    adminLogin.token,
  );
  const savedChat = await api<Row>(
    `${p}/configurations/new-chat`,
    "PUT",
    {
      revision: chat.revision,
      data: {
        ...(chat.published as Row),
        welcome: "Journey current configuration",
      },
    },
    adminLogin.token,
  );
  await api(
    `${p}/configurations/new-chat/publish`,
    "POST",
    { revision: savedChat.revision },
    adminLogin.token,
  );
  const parent = await api(
    `${p}/departments`,
    "POST",
    { name: "Journey Parent" },
    adminLogin.token,
    201,
  );
  const child = await api(
    `${p}/departments`,
    "POST",
    { name: "Journey Child", parentId: parent.id },
    adminLogin.token,
    201,
  );
  const other = await api(
    `${p}/departments`,
    "POST",
    { name: "Journey Other" },
    adminLogin.token,
    201,
  );
  const restricted = await api(
    `${p}/models`,
    "POST",
    {
      name: "Ancestor department model",
      upstreamModel: "controlled",
      credentialId: credential.id,
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      scope: { departments: [parent.id] },
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
  const network = networkModule.createHostApiNetworkTransport(async () => ({
    caCertPath: certificate,
    noProxy: "*",
  }));
  const clients: { dispose(): Promise<void> }[] = [];
  earlyCleanup.push(async () => {
    for (const client of clients) await client.dispose();
  });
  earlyCleanup.push(() => network.disposeAndWait());
  const checks: string[] = [],
    observations: Row[] = [];
  const check = (label: string) => checks.push(label);
  async function member(label: string, departmentId: string, role: string) {
    const email = `journey-${label}@example.test`;
    const member = await api(
      `${p}/members`,
      "POST",
      {
        email,
        name: `Journey ${label}`,
        password,
        departmentId,
        role,
        seat: true,
      },
      adminLogin.token,
      201,
    );
    const externalId = `synthetic-wecom-${label}`;
    await api(
      `${p}/members/${member.id}/wecom`,
      "PUT",
      { externalId },
      adminLogin.token,
    );
    const login = await api<{ token: string; expiresAt: number }>(
      "/api/auth/login",
      "POST",
      { email, password },
    );
    // 两个合成设备namespace只隔离既有加密凭据键，仍使用真正CredentialService/shared store。
    const scopedCredentials = {
      load: (key: string) => credentials.load(`journey:${label}:${key}`),
      save: (key: string, value: string) =>
        credentials.save(`journey:${label}:${key}`, value),
      delete: (key: string) => credentials.delete(`journey:${label}:${key}`),
    };
    const store = sessionModule.createSharedIdentitySessionStore(
      scopedCredentials,
      <T>(operation: () => Promise<T>) =>
        sharedNode.withFileLock(
          join(directory, `identity-${label}`),
          operation,
        ),
    );
    const adapter = adapterModule.createUWorkIdentityAdapter({
      backend: "uwork",
      apiBaseUrl: origin,
      callbackUrl: origin + "/api/auth/wecom/callback",
      organizations: [
        { orgId: owner.tenantId, corpId: "synthetic-unused", agentId: "1" },
      ],
    });
    const session = {
      token: login.token,
      expiresAt: login.expiresAt,
      issuerOrigin: origin,
      profile: {
        id: member.id,
        tenantId: owner.tenantId,
        provider: "wecom",
        displayName: `Journey ${label}`,
      },
    };
    const restored = await adapter.restore(
      session,
      new AbortController().signal,
    );
    assert.ok(restored);
    assert.ok((await store.write(restored, 0, () => true)).accepted);
    const identity = identityModule.createEnterpriseIdentityService({
      credentials: scopedCredentials,
      adapter,
      sessionStore: store,
    });
    assert.equal((await identity.restoreSession()).status, "authenticated");
    const backend = backendSessionModule.createUWorkBackendSession({
      fetchImpl: network.fetch,
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
      readPersistedSession: () => store.read(),
    });
    const gatewayStore = gatewayStoreModule.createUcasGatewayStore({
      filePath: join(directory, label, "gateway.json"),
    });
    const runtime = runtimeModule.createProviderRuntime({
      zcodeBuiltinFilePath: join(
        clientRoot,
        "config/provider/zcode-builtin.json",
      ),
      personalFilePath: join(directory, label, "provider.json"),
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
    type ClearGate = {
      reached: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    };
    let heldClear: ClearGate | null = null;
    let activeClear: ClearGate | null = null;
    const gateway = gatewayModule.createUcasGatewayService({
      store: gatewayStore,
      readIdentitySession: async () => (await store.read()).session,
      readIdentityAuthority: () =>
        lifecycle.readEnterpriseIdentityAuthority(identity),
      resolveBackend: async () => "uwork",
      resolveApiBaseUrl: async () => origin,
      fetchImpl: network.fetch,
      provisioning: {
        apply: async (input: unknown) => {
          const ids =
            input && typeof input === "object"
              ? (input as { modelIds?: unknown }).modelIds
              : undefined;
          if (heldClear && Array.isArray(ids) && ids.length === 0) {
            const gate = heldClear;
            heldClear = null;
            activeClear = gate;
            gate.reached.resolve();
            await gate.release.promise;
            activeClear = null;
          }
          return runtime.providerSettings[
            facadeModule.providerSettingsTrustedGatewayProvisioning
          ](input);
        },
        listModels: async () =>
          (await runtime.providerSettings.getView()).providers
            .find((item: { providerId: string }) => item.providerId === "ucas")
            ?.models.map((item: { modelId: string }) => item.modelId) ?? [],
      },
    });
    const relay = relayModule.createEnterpriseModelRelay({
      backendSession: backend,
    });
    const binding = {
      runtime: {},
      workspaceKey: `journey-${label}`,
      sessionId: `conversation-${label}`,
    };
    clients.push({
      async dispose() {
        heldClear?.release.resolve();
        activeClear?.release.resolve();
        gateway.dispose();
        relay.dispose();
        runtime.dispose();
        await lifecycle.disposeEnterpriseIdentityService(identity);
      },
    });
    const generate = async (modelId: string, expected = 200) => {
      const opened = await relay.request({
        ...binding,
        request: {
          kind: "open",
          url: origin + "/v1/chat/completions",
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: `synthetic ${label}` }],
            max_tokens: 8,
          }),
        },
      });
      assert.ok(opened.status === "ok" && opened.streamId);
      assert.equal(opened.httpStatus, expected);
      const chunks: Buffer[] = [];
      for (;;) {
        const part = await relay.request({
          ...binding,
          request: { kind: "read", streamId: opened.streamId },
        });
        assert.equal(part.status, "ok");
        if (part.chunk) chunks.push(Buffer.from(part.chunk, "base64"));
        if (part.done) break;
      }
      const result = JSON.parse(Buffer.concat(chunks).toString());
      if (expected === 200)
        assert.equal(result.choices[0].message.content, "gateway-live-result");
      return result;
    };
    return {
      id: String(member.id),
      externalId,
      token: login.token,
      identity,
      gateway,
      runtime,
      backend,
      generate,
      readRestartedSelection: async () => {
        const restoredRuntime = runtimeModule.createProviderRuntime({
          zcodeBuiltinFilePath: join(
            clientRoot,
            "config/provider/zcode-builtin.json",
          ),
          personalFilePath: join(directory, label, "provider.json"),
          personalPollingIntervalMs: false,
          watch: false,
          ucasEndpointSource: {
            read: async () => (await gatewayStore.read())?.endpoint.baseUrl,
          },
          settingsPolicy: policyModule.createUWorkProviderSettingsPolicy(
            () => backend,
          ),
        });
        try {
          await restoredRuntime.start();
          return await restoredRuntime.modelSelection.getView();
        } finally {
          restoredRuntime.dispose();
        }
      },
      holdNextClear: () => {
        const gate = { reached: deferred(), release: deferred() };
        heldClear = gate;
        return { reached: gate.reached.promise, release: gate.release.resolve };
      },
      relogin: async () => {
        const issued = await api<{ token: string; expiresAt: number }>(
          "/api/auth/login",
          "POST",
          { email, password },
        );
        const renewed = await adapter.restore(
          { ...session, token: issued.token, expiresAt: issued.expiresAt },
          new AbortController().signal,
        );
        assert.ok(renewed);
        const before = await store.read();
        assert.ok(
          (await store.write(renewed, before.revision, () => true)).accepted,
        );
        assert.equal((await identity.restoreSession()).status, "authenticated");
      },
      verifyRestoration: () =>
        adapter.restore(session, new AbortController().signal),
      configuration: () =>
        backend.run((scope: { request(path: string): Promise<unknown> }) =>
          scope.request("/api/client/configuration"),
        ),
    };
  }
  const a = await member("a", String(child.id), "operator"),
    b = await member("b", String(other.id), "member");
  fullCleanupInstalled = true;
  t.after(async () => {
    release.resolve();
    try {
      for (const client of clients) await client.dispose();
    } finally {
      try {
        await network.disposeAndWait();
        await api(
          "/api/auth/logout",
          "POST",
          { revokeDevices: true },
          adminLogin.token,
          204,
        );
      } finally {
        await app.close();
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
    }
    const closed = (port: number) =>
      new Promise<boolean>((done) => {
        const socket = createConnection(port, "127.0.0.1");
        socket.once("error", () => done(true));
        socket.once("connect", () => {
          socket.destroy();
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
            "independent SQLite/TCP/real TLS+Host transport; public email sessions+two namespaces in actual encrypted shared store; synthetic admin WeCom UserId binding only, no WeCom provider; no main data/external MCP/drive/paid vendor",
          checks,
          observations,
          requests,
          modelCalls,
          cleanup: { portsClosed, ownedDirectoryRemoved: true },
          node: process.version,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  });
  return {
    a,
    b,
    parent,
    child,
    other,
    model,
    restricted,
    check,
    observations,
    api,
    p,
    adminToken: adminLogin.token,
    calls: () => modelCalls,
    holdEntitlement: () => {
      heldRoute = "/api/client/entitlement";
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    holdModels: () => {
      heldRoute = "/v1/models";
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    holdUsage: () => {
      heldRoute = "/api/client/usage";
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    failNextModels: () => {
      failRoute = "/v1/models";
    },
  };
}

async function synchronized(f: Awaited<ReturnType<typeof journeyFixture>>) {
  const a = await f.a.gateway.sync("login"),
    b = await f.b.gateway.sync("login");
  assert.ok(a.committed && b.committed);
  return { a: a.view, b: b.view };
}

test("two enterprise members receive their actual profile, ancestor-scoped catalog, private configuration and isolated usage", async (t) => {
  const f = await journeyFixture(t, "member-profile-scope"),
    views = await synchronized(f);
  const me = await f.api<Row>("/api/auth/me", "GET", undefined, f.a.token);
  f.observations.push({
    membershipPresent: !!me.membership,
    role: views.a.user.role,
    department: views.a.user.department,
    wecomUserId: views.a.user.wecomUserId,
  });
  assert.equal(views.a.user.role, "operator");
  assert.equal(views.a.user.department, "Journey Child");
  assert.equal(views.a.user.wecomUserId, f.a.externalId);
  assert.equal(views.b.user.id, f.b.id);
  assert.equal(views.b.user.department, "Journey Other");
  assert.ok(views.a.models.available.includes(f.restricted.id));
  assert.ok(!views.b.models.available.includes(f.restricted.id));
  const [ca, cb] = await Promise.all([
    f.a.configuration(),
    f.b.configuration(),
  ]);
  assert.ok(ca.managed && cb.managed);
  assert.equal(ca.value.status, 200);
  assert.equal(cb.value.status, 200);
  assert.equal(ca.value.body.versions["new-chat"], 1);
  assert.equal(
    cb.value.body.configuration["new-chat"].welcome,
    "Journey current configuration",
  );
  await f.a.generate(String(f.restricted.id));
  await f.a.generate(String(f.model.id));
  await f.b.generate(String(f.model.id));
  const au = await f.a.gateway.refreshUsage({
      period: "month",
      metric: "cost",
    }),
    bu = await f.b.gateway.refreshUsage({ period: "month", metric: "cost" });
  assert.equal(au.usage.summary.requestCount, 2);
  assert.equal(bu.usage.summary.requestCount, 1);
  assert.equal(au.usage.summary.cost, 18);
  assert.equal(bu.usage.summary.cost, 9);
  const forged = await f.api<Row>(
    `/api/client/usage?userId=${f.b.id}`,
    "GET",
    undefined,
    f.a.token,
  );
  assert.equal((forged.summary as Row).requestCount, 2);
  f.check("current-profile-role-department-wecom-binding-and-member-only-data");
});

test("department changes and current budget checks affect the same sessions without changing other members", async (t) => {
  const f = await journeyFixture(t, "department-current-policy");
  await synchronized(f);
  await f.api(
    `${f.p}/limits`,
    "PUT",
    { subjectType: "department", subjectId: f.parent.id, amount: 0 },
    f.adminToken,
  );
  const allowanceView = await f.a.gateway.sync("current-allowance");
  const allowance = allowanceView.view.subscriptions[0].effectiveAllowance;
  assert.equal(allowance.application, "uwork");
  assert.equal(allowance.amountRemaining, 0);
  assert.equal(allowance.blocked, true);
  assert.equal(allowance.reason, "quota_exhausted");
  const otherAllowance = (await f.b.gateway.sync("other-allowance")).view
    .subscriptions[0].effectiveAllowance;
  assert.ok(otherAllowance.amountRemaining > 0);
  const denied = await f.a.generate(String(f.restricted.id), 402);
  assert.equal(denied.error.code, "QUOTA_EXCEEDED");
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.a.gateway.getView()).status,
    "ready",
    "a model POST quota402 does not revoke its control-plane directory",
  );
  assert.ok((await f.a.runtime.modelSelection.getView()).preferredSelection);
  await f.b.generate(String(f.model.id));
  assert.equal(f.calls(), 1);
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { departmentId: f.other.id, role: "auditor" },
    f.adminToken,
  );
  const refreshed = await f.a.gateway.sync("department-moved");
  assert.ok(refreshed.committed);
  assert.equal(refreshed.view.user.role, "auditor");
  assert.equal(refreshed.view.user.department, "Journey Other");
  assert.ok(
    refreshed.view.subscriptions[0].effectiveAllowance.amountRemaining > 0,
  );
  assert.ok(!refreshed.view.models.available.includes(f.restricted.id));
  await f.a.generate(String(f.restricted.id), 403);
  await f.a.generate(String(f.model.id));
  assert.equal(f.calls(), 2);
  f.check(
    "ancestor-budget-deny-and-transfer-immediate-same-token-no-cross-member-effect",
  );
});

for (const action of ["seat", "server-session"] as const)
  for (const refresh of ["models", "usage", "sync", "apply"] as const) {
    test(`explicit ${action} ${refresh} rejection removes old authorized Gateway views`, async (t) => {
      const f = await journeyFixture(t, `rejection-${action}-${refresh}`);
      await synchronized(f);
      await f.a.generate(String(f.model.id));
      if (action === "seat")
        await f.api(
          `${f.p}/members/${f.a.id}`,
          "PATCH",
          { seat: false },
          f.adminToken,
        );
      else await f.api("/api/auth/logout", "POST", {}, f.a.token, 204);
      const result =
        refresh === "models"
          ? await f.a.gateway.refreshModels()
          : refresh === "usage"
            ? await f.a.gateway.refreshUsage({
                period: "month",
                metric: "cost",
              })
            : refresh === "sync"
              ? (await f.a.gateway.sync("server-rejected")).view
              : (await f.a.gateway.applyModels()).view;
      f.observations.push({
        status: result.status,
        error: result.error,
        oldModelCount: result.models?.available.length ?? 0,
        oldUsagePresent: !!result.usage,
        oldProfilePresent: !!result.user,
      });
      assert.equal(result.models, null);
      assert.equal(result.usage, null);
      assert.equal(result.status, "error");
      assert.equal(result.authMode, "enterprise-session");
      const usage = await f.a.gateway.refreshUsage({
        period: "month",
        metric: "cost",
      });
      assert.equal(usage.models, null);
      assert.equal(usage.usage, null);
      const b = await f.b.gateway.refreshModels();
      assert.ok(b.models.available.includes(f.model.id));
      assert.equal(f.calls(), 1);
      if (action === "seat") {
        await f.api(
          `${f.p}/members/${f.a.id}`,
          "PATCH",
          { seat: true },
          f.adminToken,
        );
        const partial = await f.a.gateway.refreshUsage({
          period: "month",
          metric: "cost",
        });
        assert.notEqual(partial.status, "ready");
        assert.equal(partial.models, null);
        assert.equal(partial.user, null);
        const restored = await f.a.gateway.sync("seat-restored");
        assert.ok(restored.committed);
        assert.equal(restored.view.status, "ready");
      } else {
        assert.equal(await f.a.verifyRestoration(), null);
        assert.equal(
          (await f.a.identity.restoreSession()).status,
          "authenticated",
          "cached identity owner is not a new authorization grant",
        );
        assert.equal((await f.a.gateway.getView()).user, null);
      }
      f.check(
        "server-explicit-rejection-clears-authorization-projection-only-for-rejected-member",
      );
    });
  }

test("role changes and clearing department project current backend facts on the same identity", async (t) => {
  const f = await journeyFixture(t, "roles-and-null-department");
  await synchronized(f);
  for (const role of ["owner", "admin", "operator", "auditor", "member"]) {
    await f.api(`${f.p}/members/${f.a.id}`, "PATCH", { role }, f.adminToken);
    const result = await f.a.gateway.sync("current-role");
    assert.ok(result.committed);
    assert.equal(result.view.user.role, role);
  }
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { departmentId: null },
    f.adminToken,
  );
  const result = await f.a.gateway.sync("department-removed");
  assert.equal(result.view.user.department, null);
  assert.equal(result.view.user.wecomUserId, f.a.externalId);
  f.check("all-five-platform-roles-and-null-department-without-relogin");
});

test("server revocation between directory and usage cannot publish a new ready snapshot", async (t) => {
  const f = await journeyFixture(t, "revoked-during-stats");
  await synchronized(f);
  const delay = f.holdEntitlement(),
    syncing = f.a.gateway.sync("delayed-entitlement");
  await delay.reached;
  await f.api("/api/auth/logout", "POST", {}, f.a.token, 204);
  delay.release();
  const result = await syncing;
  assert.equal(result.committed, false);
  assert.equal(result.view.status, "error");
  assert.equal(result.view.models, null);
  assert.equal(result.view.usage, null);
  f.check("explicit-authentication-failure-in-stats-is-never-swallowed");
});

test("transient real HTTP failure marks a retained snapshot stale and a successful refresh recovers it", async (t) => {
  const f = await journeyFixture(t, "transient-error-recovery");
  const views = await synchronized(f);
  f.failNextModels();
  const failed = await f.a.gateway.refreshModels();
  assert.equal(failed.status, "error");
  assert.deepEqual(failed.models.available, views.a.models.available);
  const recovered = await f.a.gateway.refreshModels();
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.error, null);
  assert.ok(recovered.models.available.includes(f.restricted.id));
  f.check("owned-HTTP503-fault-and-successful-current-owner-refresh-recovery");
});

test("fresh managed Registry and default use only authoritative IDs, and rejected seats clear candidates", async (t) => {
  const f = await journeyFixture(t, "managed-default-catalog");
  await synchronized(f);
  const registry = f.a.runtime.registryService.getView();
  const provider = registry.providers.find(
    (item: { providerId: string }) => item.providerId === "ucas",
  );
  assert.ok(provider);
  assert.deepEqual(
    provider.models.map((item: { modelId: string }) => item.modelId).sort(),
    [f.model.id, f.restricted.id].sort(),
  );
  const diskSettings = await f.a.runtime.providerSettings.getView();
  assert.ok(
    diskSettings.providers
      .find((item: { providerId: string }) => item.providerId === "ucas")
      .models.some(
        (item: { modelId: string }) => item.modelId === "ucas-deepseek-flash",
      ),
    "legacy configuration remains persisted but is not a managed candidate",
  );
  const selected = await f.a.runtime.modelSelection.getView();
  assert.ok(
    [f.model.id, f.restricted.id].includes(
      selected.preferredSelection?.modelId,
    ),
  );
  await f.a.generate(selected.preferredSelection.modelId);
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { seat: false },
    f.adminToken,
  );
  const rejected = await f.a.gateway.refreshModels();
  assert.equal(rejected.error, "forbidden");
  const after = await f.a.runtime.modelSelection.getView();
  assert.equal(
    after.providers.find(
      (item: { providerId: string }) => item.providerId === "ucas",
    )?.models.length ?? 0,
    0,
  );
  assert.equal(after.preferredSelection, undefined);
  assert.equal(
    (await f.a.readRestartedSelection()).preferredSelection,
    undefined,
  );
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { seat: true },
    f.adminToken,
  );
  await f.a.gateway.sync("recovered-current-catalog");
  assert.ok(
    [f.model.id, f.restricted.id].includes(
      (await f.a.runtime.modelSelection.getView()).preferredSelection?.modelId,
    ),
  );
  f.check(
    "actual-Registry-default-and-private-clear-only-authorized-candidates",
  );
});

test("current successful refresh shrinks and empties managed Registry without deleting legacy disk rules", async (t) => {
  const f = await journeyFixture(t, "managed-catalog-shrink-empty");
  await synchronized(f);
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { departmentId: f.other.id },
    f.adminToken,
  );
  await f.a.gateway.refreshModels();
  let selected = await f.a.runtime.modelSelection.getView();
  assert.deepEqual(
    selected.providers
      .find((item: { providerId: string }) => item.providerId === "ucas")
      .models.map((item: { modelId: string }) => item.modelId),
    [f.model.id],
  );
  await f.api(
    `${f.p}/models/${f.model.id}`,
    "DELETE",
    undefined,
    f.adminToken,
    204,
  );
  await f.a.gateway.refreshModels();
  selected = await f.a.runtime.modelSelection.getView();
  assert.equal(selected.preferredSelection, undefined);
  assert.equal(
    (await f.a.readRestartedSelection()).preferredSelection,
    undefined,
  );
  const disk = await f.a.runtime.providerSettings.getView();
  assert.ok(
    disk.providers
      .find((item: { providerId: string }) => item.providerId === "ucas")
      .models.some(
        (item: { modelId: string }) => item.modelId === "ucas-deepseek-flash",
      ),
  );
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { departmentId: f.child.id },
    f.adminToken,
  );
  await f.a.gateway.sync("restore-authorized-scope");
  assert.equal(
    (await f.a.runtime.modelSelection.getView()).preferredSelection.modelId,
    f.restricted.id,
  );
  f.check("successful-scope-shrink-empty-and-restart-no-phantom-default");
});

test("a current control-plane subscription 402 clears old active allowance and managed candidates without logging out", async (t) => {
  const f = await journeyFixture(t, "expired-subscription-directory");
  const ready = await synchronized(f);
  assert.equal(ready.a.subscriptions[0].status, "active");
  const previous = await f.api<Row>(
    `${f.p}/subscription`,
    "GET",
    undefined,
    f.adminToken,
  );
  await f.api(
    `${f.p}/subscription`,
    "PUT",
    {
      seats: previous.seats,
      credits: previous.credits,
      startsAt: 1,
      endsAt: 2,
      metering: previous.metering,
    },
    f.adminToken,
  );
  const raw = await f.api<Row>("/v1/models", "GET", undefined, f.a.token, 402);
  assert.equal((raw.error as Row).code, "SUBSCRIPTION_INACTIVE");
  const rejected = await f.a.gateway.refreshModels();
  f.observations.push({
    status: rejected.status,
    error: rejected.error,
    oldActivePlans: rejected.subscriptions.filter(
      (plan: { status: string }) => plan.status === "active",
    ).length,
    oldModelCount: rejected.models?.available.length ?? 0,
  });
  assert.equal(rejected.error, "forbidden");
  assert.equal(rejected.status, "error");
  assert.equal(rejected.models, null);
  assert.deepEqual(rejected.subscriptions, []);
  assert.equal(
    (await f.a.runtime.modelSelection.getView()).preferredSelection,
    undefined,
  );
  assert.equal(
    (await f.a.readRestartedSelection()).preferredSelection,
    undefined,
  );
  assert.equal((await f.a.identity.restoreSession()).status, "authenticated");
  await f.api("/api/auth/me", "GET", undefined, f.a.token);
  assert.equal(f.calls(), 0);
  f.check(
    "actual-directory-subscription402-clears-authorized-view-and-default-not-identity",
  );
});

test("usage refresh also reloads current effective allowance using its selected statistics query", async (t) => {
  const f = await journeyFixture(t, "usage-allowance-refresh");
  await synchronized(f);
  await f.a.generate(String(f.model.id));
  await f.api(
    `${f.p}/limits`,
    "PUT",
    { subjectType: "member", subjectId: f.a.id, amount: 100 },
    f.adminToken,
  );
  await f.api(
    `${f.p}/limits`,
    "PUT",
    { subjectType: "department", subjectId: f.parent.id, amount: 0 },
    f.adminToken,
  );
  const blocked = await f.a.gateway.sync("known-zero-allowance");
  assert.equal(
    blocked.view.subscriptions[0].effectiveAllowance.amountRemaining,
    0,
  );
  await f.api(
    `${f.p}/limits`,
    "PUT",
    { subjectType: "department", subjectId: f.parent.id, amount: 200000 },
    f.adminToken,
  );
  const refreshed = await f.a.gateway.refreshUsage({
    period: "7d",
    metric: "tokens",
    force: true,
  });
  assert.equal(
    refreshed.subscriptions[0].effectiveAllowance.amountRemaining,
    91,
  );
  assert.equal(refreshed.subscriptions[0].effectiveAllowance.blocked, false);
  assert.equal(refreshed.usage.period, "7d");
  assert.equal(refreshed.usage.metric, "tokens");
  assert.equal(refreshed.usage.summary.requestCount, 1);
  f.check(
    "single-usage-refresh-reads-current-member-department-allowance-and-selected-query",
  );
});

test("usage-only refresh recognizes inactive subscription without treating quota zero as lost catalog", async (t) => {
  const f = await journeyFixture(t, "usage-inactive-subscription");
  await synchronized(f);
  const previous = await f.api<Row>(
    `${f.p}/subscription`,
    "GET",
    undefined,
    f.adminToken,
  );
  await f.api(
    `${f.p}/subscription`,
    "PUT",
    {
      seats: previous.seats,
      credits: previous.credits,
      startsAt: 1,
      endsAt: 2,
      metering: previous.metering,
    },
    f.adminToken,
  );
  const result = await f.a.gateway.refreshUsage({
    period: "month",
    metric: "cost",
    force: true,
  });
  assert.equal(result.error, "forbidden");
  assert.equal(result.usage, null);
  assert.deepEqual(result.subscriptions, []);
  assert.equal(
    (await f.a.runtime.modelSelection.getView()).preferredSelection,
    undefined,
  );
  f.check("usage-only-refresh-inactive-plan-is-control-plane-rejection");
});

for (const action of ["seat", "session"] as const) {
  test(`late usage 200 cannot restore data after current remote ${action} rejection`, async (t) => {
    const f = await journeyFixture(t, `late-usage-after-${action}-rejection`);
    await synchronized(f);
    await f.a.generate(String(f.model.id));
    const held = f.holdUsage(),
      loading = f.a.gateway.refreshUsage({
        period: "month",
        metric: "cost",
        force: true,
      });
    await held.reached;
    if (action === "seat")
      await f.api(
        `${f.p}/members/${f.a.id}`,
        "PATCH",
        { seat: false },
        f.adminToken,
      );
    else await f.api("/api/auth/logout", "POST", {}, f.a.token, 204);
    const rejected = await f.a.gateway.refreshModels();
    assert.equal(rejected.models, null);
    assert.equal(rejected.usage, null);
    held.release();
    const late = await loading;
    f.observations.push({
      finalStatus: late.status,
      finalError: late.error,
      lateUsagePresent: !!late.usage,
      latePlans: late.subscriptions.length,
    });
    assert.equal(late.usage, null);
    assert.deepEqual(late.subscriptions, []);
    assert.equal(late.models, null);
    assert.equal(late.status, "error");
    assert.equal(late.error, action === "seat" ? "forbidden" : "unauthorized");
    f.check(
      "actual-late-usage200-after-server-rejection-does-not-resurrect-authorized-projection",
    );
  });
}

for (const operation of ["models", "sync"] as const) {
  test(`held ${operation} 200 cannot restore an earlier authorization after another control-plane rejection`, async (t) => {
    const f = await journeyFixture(t, `late-${operation}-after-rejection`);
    await synchronized(f);
    await f.a.generate(String(f.model.id));
    const held = operation === "models" ? f.holdModels() : f.holdUsage();
    const loading =
      operation === "models"
        ? f.a.gateway.refreshModels()
        : f.a.gateway.sync("held-last-stats");
    await held.reached;
    await f.api(
      `${f.p}/members/${f.a.id}`,
      "PATCH",
      { seat: false },
      f.adminToken,
    );
    const rejected =
      operation === "models"
        ? await f.a.gateway.refreshUsage({ period: "month", metric: "cost" })
        : await f.a.gateway.refreshModels();
    assert.equal(rejected.models, null);
    held.release();
    const received = await loading;
    const delivered = received.view ?? received;
    assert.equal(delivered.models, null);
    assert.equal(delivered.user, null);
    assert.notEqual(delivered.status, "ready");
    const after = await f.a.gateway.getView();
    f.observations.push({
      status: after.status,
      oldModels: !!after.models,
      oldUser: !!after.user,
    });
    assert.equal(after.models, null);
    assert.equal(after.user, null);
    assert.notEqual(after.status, "ready");
    assert.equal(
      (await f.a.runtime.modelSelection.getView()).preferredSelection,
      undefined,
    );
    f.check("current-remote-rejection-fences-earlier-models-or-sync-success");
  });
}

test("a new owner with directory503 has no old candidates while same-owner transient sync keeps its snapshot", async (t) => {
  const f = await journeyFixture(t, "new-owner-directory503");
  await synchronized(f);
  f.failNextModels();
  await f.a.gateway.sync("same-owner-503");
  assert.ok((await f.a.runtime.modelSelection.getView()).preferredSelection);
  await f.a.identity.logout();
  await f.a.gateway.getView();
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { departmentId: f.other.id },
    f.adminToken,
  );
  await f.a.relogin();
  f.failNextModels();
  const failed = await f.a.gateway.sync("new-owner-503");
  assert.equal(failed.committed, false);
  assert.equal(failed.view.error, "failed");
  assert.equal(
    (await f.a.runtime.modelSelection.getView()).preferredSelection,
    undefined,
  );
  assert.equal(
    (await f.a.readRestartedSelection()).preferredSelection,
    undefined,
  );
  await f.a.gateway.sync("new-owner-directory-available");
  assert.equal(
    (await f.a.runtime.modelSelection.getView()).preferredSelection.modelId,
    f.model.id,
  );
  f.check(
    "owner-bound-initial-stage-clear-and-same-owner-transient-cache-distinction",
  );
});

test("an older rejected candidate clear cannot erase a newer full-sync admission", async (t) => {
  const f = await journeyFixture(t, "old-clear-after-new-sync");
  await synchronized(f);
  const gate = f.a.holdNextClear();
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { seat: false },
    f.adminToken,
  );
  const clearing = f.a.gateway.refreshModels();
  await gate.reached;
  assert.notEqual(
    (await f.a.gateway.getView()).status,
    "ready",
    "known rejection is visible while candidate IO is pending",
  );
  await f.api(
    `${f.p}/members/${f.a.id}`,
    "PATCH",
    { seat: true },
    f.adminToken,
  );
  const newer = await f.a.gateway.sync("new-current-authorization");
  assert.ok(newer.committed);
  gate.release();
  await clearing;
  const view = await f.a.gateway.getView();
  assert.equal(view.status, "ready");
  assert.ok(view.models.available.includes(f.model.id));
  assert.ok((await f.a.runtime.modelSelection.getView()).preferredSelection);
  f.check(
    "real-late-private-clear-is-admission-bound-and-cannot-erase-new-sync",
  );
});
