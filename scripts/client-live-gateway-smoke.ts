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
const evidence = resolve(
  process.env.UWORK_GATEWAY_EVIDENCE_DIRECTORY ??
    "evidence/client-live-20261017-keyless-gateway",
);
assert.ok(evidence.startsWith(resolve("evidence") + "/"));
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

async function liveFixture(
  t: TestContext,
  name: string,
  ordinaryMember = false,
) {
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
    catalogModule,
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
    source("ucas-gateway/gatewayCatalogLifecycle.ts"),
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
  const identityEmail = ordinaryMember
    ? "live-gateway-member@example.test"
    : "live-gateway-a@example.test";
  const identityUserId = ordinaryMember
    ? String(
        (
          await api(
            `${p}/members`,
            "POST",
            {
              email: identityEmail,
              name: "Live synthetic ordinary member",
              password,
              role: "member",
              seat: true,
            },
            adminLogin.token,
            201,
          )
        ).id,
      )
    : owner.userId;
  const login = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    { email: identityEmail, password },
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
      id: identityUserId,
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
  // 与 Host 组合根（packages/services/src/node.ts）同序接线：目录读侧准入先绑定，
  // 身份事件订阅再交给原 Gateway owner；两者都不是第二份身份或目录写入者。
  const bindCatalogAuthority = () => {
    const authority = gateway[catalogModule.gatewayCatalogAuthority];
    authority.bindIdentityChanges((listener: () => void) =>
      identity.onDidChange(listener),
    );
    runtime.bindGatewayCatalogAuthority(authority);
  };
  bindCatalogAuthority();
  const checks: string[] = [];
  const check = (value: string) => checks.push(value);
  const personal = () => readFile(personalPath, "utf8");
  const resolved = async (modelId = String(model.id)) => {
    const resolution = await runtime.providerSettings.resolveModelConfig({
      providerId: "ucas",
      modelId,
    });
    const provider = runtime.registryService.getProvider("ucas");
    assert.ok(
      provider && runtime.registryService.getModel("ucas", modelId),
      "actual executable Registry provider/model must exist",
    );
    return { ...resolution, providerConfig: provider.config };
  };
  const modelRequest = async (
    key = "live-provider-call",
    expected = 200,
    stream = false,
    modelId = String(model.id),
  ) => {
    const config = (await resolved(modelId)).providerConfig;
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
          model: modelId,
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
    identityUserId,
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
    captureOwner: async () => {
      const scope = await backend.run(
        (value: { ownerKey: string }) => value.ownerKey,
      );
      assert.ok(scope.managed);
      return scope.value;
    },
    openWithOwner: (ownerKey: string, modelId: string) =>
      modelRelay.request({
        ...modelBinding,
        traceId: "cross-organization-denied",
        request: {
          kind: "open",
          ownerKey,
          url: origin + "/v1/chat/completions",
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: "owned isolation check" }],
            max_tokens: 8,
          }),
        },
      }),
    closeStream: (streamId: string) =>
      modelRelay.request({
        ...modelBinding,
        request: { kind: "close", streamId },
      }),
    readStream: (streamId: string) =>
      modelRelay.request({
        ...modelBinding,
        request: { kind: "read", streamId },
      }),
    // 仅夹具初始化第二组织；会话恢复必须通过真实后台与原身份所有者，不能注入投影。
    authenticateOtherOrganization: async () => {
      const other = await bootstrap(app.services.db, {
        name: "Live synthetic B",
        email: "live-gateway-b@example.test",
        password,
      });
      const issued = await api<{ token: string; expiresAt: number }>(
        "/api/auth/login",
        "POST",
        { email: "live-gateway-b@example.test", password },
      );
      const prefix = `/api/tenants/${other.tenantId}`;
      const secret = await api(
        `${prefix}/credentials`,
        "POST",
        { name: "Other local vendor", value: "live-gateway-synthetic-vendor" },
        issued.token,
        201,
      );
      const otherModel = await api(
        `${prefix}/models`,
        "POST",
        {
          name: "Other organization model",
          upstreamModel: "controlled",
          credentialId: secret.id,
          baseUrl: `http://127.0.0.1:${providerPort}/v1`,
          scope: { all: true },
          inputRate: 1000,
          outputRate: 2000,
          maxOutputTokens: 16,
        },
        issued.token,
        201,
      );
      const next = await adapter.restore(
        {
          ...session,
          ...issued,
          profile: {
            ...session.profile,
            id: other.userId,
            tenantId: other.tenantId,
          },
        },
        new AbortController().signal,
      );
      assert.ok(next);
      const current = await sessionStore.read();
      assert.ok(
        (await sessionStore.write(next, current.revision, () => true)).accepted,
      );
      assert.equal((await identity.restoreSession()).status, "authenticated");
      return {
        ...other,
        prefix,
        token: issued.token,
        modelId: String(otherModel.id),
      };
    },
    settings: () => runtime.providerSettings,
    // 原 Registry 的 provider 事实：撤销托管候选不能连提供方规则一起移除。
    registryProvider: () => {
      const provider = runtime.registryService.getProvider("ucas");
      return {
        present: !!provider,
        accessType: provider?.config.access?.type ?? null,
        enterpriseModelIds: provider?.config.enterpriseModelIds ?? null,
      };
    },
    // 身份撤销后原私有 Writer 的异步清盘：等它真正落盘，避免把退出自身的清理误判成迟到写。
    settleCatalogClear: async (timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
      const cleared = (raw: string) => {
        const found: { ids: unknown; names: unknown }[] = [];
        const visit = (value: unknown) => {
          if (Array.isArray(value)) return value.forEach(visit);
          if (!value || typeof value !== "object") return;
          const row = value as Row;
          if ("enterpriseModelIds" in row || "enterpriseModelNames" in row)
            found.push({
              ids: row.enterpriseModelIds,
              names: row.enterpriseModelNames,
            });
          Object.values(row).forEach(visit);
        };
        visit(JSON.parse(raw));
        return (
          found.length > 0 &&
          found.every(
            (row) =>
              Array.isArray(row.ids) &&
              row.ids.length === 0 &&
              Object.keys(row.names ?? {}).length === 0,
          )
        );
      };
      for (;;) {
        const raw = await readFile(personalPath, "utf8");
        if (cleared(raw) || Date.now() >= deadline) return raw;
        await new Promise((done) => setTimeout(done, 25));
      }
    },
    // 原 Registry/ModelSelectionFacade 的当前视图：不复制选型算法，也不读取第二份目录。
    managedCatalog: async () => {
      const view = await runtime.modelSelection.getView();
      const providers = view.providers as readonly {
        providerId: string;
        config: { access?: { type?: string } };
        models: readonly { modelId: string }[];
      }[];
      const managed = providers.filter(
        (provider) =>
          provider.providerId === "ucas" &&
          provider.config.access?.type === "enterprise-session",
      );
      return {
        managedProviders: managed.length,
        modelIds: managed.flatMap((provider) =>
          provider.models.map((entry) => entry.modelId),
        ),
        preferredSelection: view.preferredSelection ?? null,
        effectiveSelection: view.effectiveSelection ?? null,
        selectionIssue: view.selectionIssue ?? null,
      };
    },
    seedLegacyModel: () =>
      runtime.providerSettings[
        facadeModule.providerSettingsTrustedGatewayProvisioning
      ]({ baseUrl: origin + "/v1", modelIds: [String(model.id)] }),
    relogin: async () => {
      const issued = await api<{ token: string; expiresAt: number }>(
        "/api/auth/login",
        "POST",
        { email: identityEmail, password },
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
      bindCatalogAuthority();
    },
    assertSafe: async (modelId = String(model.id)) => {
      const view = await gateway.getView();
      const record = await sessionStore.read();
      const config = (await resolved(modelId)).providerConfig;
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
  // 退出自身的托管候选清盘是当前契约：先等它落定，再释放旧响应，才能只判定迟到写。
  const afterLogoutClear = digest(await f.settleCatalogClear());
  delayed.release();
  const result = await syncing;
  await writeFile(
    join(evidence, `late-response-reproduction-${runLabel}.json`),
    JSON.stringify(
      {
        expectedCommitted: false,
        observedCommitted: result.committed,
        returnedStatus: result.view.status,
        // 与退出清盘落定后的字节比较：这里只表示迟到响应是否写入了任何内容。
        providerChanged: digest(await f.personal()) !== afterLogoutClear,
        logoutClearedManagedCandidates: digest(afterLogoutClear) !== before,
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
    afterLogoutClear,
    "stale synchronization must not mutate Provider storage",
  );
  assert.equal((await f.gateway().getView()).status, "signed-out");
  f.check("real-late-model-response-discarded-before-provider-write");
});

test("real identity owner logout revokes the managed candidates from the current model selection catalog", async (t) => {
  const f = await liveFixture(t, "logout-catalog-revocation");
  assert.ok((await f.gateway().sync("login")).committed);
  const admitted = await f.managedCatalog();
  assert.equal(admitted.managedProviders, 1);
  assert.deepEqual(admitted.modelIds, [String(f.model.id)]);
  f.check("signed-in-catalog-admits-exactly-the-owning-organization-model");

  await f.identity.logout();
  assert.equal((await f.gateway().getView()).status, "signed-out");
  // 同一身份撤销内读侧即失效：不等异步清盘，也不等下一次目录读取。
  const revoked = await f.managedCatalog();
  assert.equal(revoked.managedProviders, 0);
  assert.deepEqual(revoked.modelIds, []);
  assert.equal(
    revoked.effectiveSelection,
    null,
    "a revoked catalog cannot keep an effective managed selection",
  );
  f.check(
    "signed-out-view-offers-no-managed-candidate-and-no-effective-selection",
  );

  // 隐藏读侧不等于清盘：原私有 Writer 必须把持久候选真正清掉，且不动连接与偏好。
  const enterpriseCandidates = (raw: string) => {
    const found: { ids: unknown; names: unknown }[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const row = value as Row;
      if ("enterpriseModelIds" in row || "enterpriseModelNames" in row)
        found.push({
          ids: row.enterpriseModelIds,
          names: row.enterpriseModelNames,
        });
      Object.values(row).forEach(visit);
    };
    visit(JSON.parse(raw));
    return found;
  };
  const clearDeadline = Date.now() + 10000;
  let persisted = await f.personal();
  while (Date.now() < clearDeadline) {
    const candidates = enterpriseCandidates(persisted);
    if (
      candidates.length &&
      candidates.every(
        (row) =>
          Array.isArray(row.ids) &&
          row.ids.length === 0 &&
          Object.keys(row.names ?? {}).length === 0,
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 25));
    persisted = await f.personal();
  }
  const cleared = enterpriseCandidates(persisted);
  assert.ok(
    cleared.length &&
      cleared.every((row) => Array.isArray(row.ids) && row.ids.length === 0),
    "the original private Writer must clear the persisted managed candidates",
  );
  assert.equal((await f.gateway().getView()).authMode, "enterprise-session");
  // 原 Registry 以当前配置为准；空的企业候选目录不再构成可执行提供方。
  const settleRegistry = async () => {
    const deadline = Date.now() + 10000;
    for (;;) {
      const state = f.registryProvider();
      if (!state.present || (state.enterpriseModelIds ?? []).length === 0)
        return state;
      if (Date.now() >= deadline) return state;
      await new Promise((done) => setTimeout(done, 25));
    }
  };
  const settledRegistry = await settleRegistry();
  assert.ok(
    !settledRegistry.present ||
      (settledRegistry.enterpriseModelIds ?? []).length === 0,
    "a revoked managed catalog cannot stay executable in the Registry",
  );
  assert.ok(
    settledRegistry.present
      ? settledRegistry.accessType === "enterprise-session"
      : true,
    "a still present managed provider keeps its enterprise-session access",
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, `logout-catalog-revocation-observation-${runLabel}.json`),
    JSON.stringify(
      {
        boundary:
          "real backend HTTPS/TCP, actual identity owner, Gateway, private Writer and ProviderRuntime Registry; no mocked fetch, no model generation",
        admitted,
        revoked,
        persistedEnterpriseCandidates: cleared,
        registryAfterClear: settledRegistry,
        modelCalls: f.calls(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  f.check("persisted-managed-catalog-cleared-without-changing-the-connection");

  // 仅重新认证不取回旧目录；只有新 owner 自己的完整提交才发布候选。
  await f.relogin();
  const reauthenticated = await f.managedCatalog();
  assert.equal(reauthenticated.managedProviders, 0);
  assert.deepEqual(reauthenticated.modelIds, []);
  f.check("re-authentication-alone-admits-no-catalog");

  assert.ok((await f.gateway().sync("relogin")).committed);
  const restored = await f.managedCatalog();
  assert.equal(restored.managedProviders, 1);
  assert.deepEqual(restored.modelIds, [String(f.model.id)]);
  f.check("only-the-new-owners-own-commit-publishes-candidates");
  assert.equal(f.calls(), 0, "catalog revocation must not call any model");
});

test("same-profile organization change fences old execution authority and settles only the current organization", async (t) => {
  const f = await liveFixture(t, "cross-organization-execution");
  assert.ok((await f.gateway().sync("login")).committed);
  const ownerA = await f.captureOwner();
  await f.modelRequest("organization-a-success");
  assert.equal(f.calls(), 1);
  const aBefore = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(aBefore.items.length, 1);
  assert.equal(aBefore.items[0]!.status, "settled");
  assert.equal(aBefore.items[0]!.amount, 9);
  await f.identity.logout();
  assert.deepEqual((await f.managedCatalog()).modelIds, []);
  const b = await f.authenticateOtherOrganization();
  assert.ok((await f.gateway().sync("other-organization")).committed);
  assert.deepEqual((await f.managedCatalog()).modelIds, [b.modelId]);
  const ownerB = await f.captureOwner();
  assert.notEqual(ownerA, ownerB);
  const stale = await f.openWithOwner(ownerA, b.modelId);
  assert.equal(stale.status, "denied");
  assert.equal(stale.code, "enterprise_identity_changed");
  assert.equal(f.calls(), 1, "old A authority cannot dispatch under B");
  f.check("A-logout-B-restore-stale-owner-denied-before-supplier-dispatch");

  await f.modelRequest("organization-b-success", 200, false, b.modelId);
  assert.equal(f.calls(), 2);
  const usageB = await f
    .gateway()
    .refreshUsage({ period: "month", metric: "cost", force: true });
  assert.equal(usageB.usage.summary.requestCount, 1);
  assert.equal(usageB.usage.summary.totalTokens, 7);
  assert.equal(usageB.usage.summary.cost, 9);
  const foreign = await f.openWithOwner(ownerB, String(f.model.id));
  assert.equal(foreign.status, "ok");
  assert.equal(foreign.httpStatus, 404);
  assert.ok(foreign.streamId);
  await f.closeStream(foreign.streamId);
  assert.equal(f.calls(), 2, "B cannot invoke A's model");
  await f.api(`${f.p}/usage`, "GET", undefined, b.token, 403);
  const aAfter = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.deepEqual(aAfter.items, aBefore.items);
  const bAfter = await f.api<{ items: Row[] }>(
    `${b.prefix}/usage`,
    "GET",
    undefined,
    b.token,
  );
  const settledB = bAfter.items.filter((row) => row.status === "settled");
  assert.equal(settledB.length, 1);
  assert.equal(settledB[0]!.amount, 9);
  assert.notEqual(settledB[0]!.id, aBefore.items[0]!.id);
  await f.assertSafe(b.modelId);
  f.check("B-model-success-own-usage-7-tokens-9-credits-A-ledger-unchanged");
  f.check("B-foreign-model-and-tenant-ledger-denied-without-supplier-dispatch");
});

test("an unread real A model response cannot cross logout into B on the same Host binding", async (t) => {
  const f = await liveFixture(t, "cross-organization-unread-stream");
  assert.ok((await f.gateway().sync("login")).committed);
  const opened = await f.openWithOwner(
    await f.captureOwner(),
    String(f.model.id),
  );
  assert.equal(opened.status, "ok");
  assert.equal(opened.httpStatus, 200);
  assert.ok(opened.streamId);
  assert.equal(f.calls(), 1);
  await f.identity.logout();
  const b = await f.authenticateOtherOrganization();
  assert.ok((await f.gateway().sync("other-organization")).committed);
  const stale = await f.readStream(opened.streamId);
  assert.equal(stale.status, "denied");
  assert.equal(stale.code, "enterprise_model_stream_closed");
  assert.equal(stale.chunk, undefined, "no A response bytes may reach B");
  assert.equal(f.calls(), 1);
  assert.deepEqual(await f.closeStream(opened.streamId), {
    status: "ok",
    done: true,
  });
  await f.modelRequest(
    "organization-b-after-old-stream",
    200,
    false,
    b.modelId,
  );
  assert.equal(f.calls(), 2);
  const usage = await f
    .gateway()
    .refreshUsage({ period: "month", metric: "cost", force: true });
  assert.equal(usage.usage.summary.requestCount, 1);
  assert.equal(usage.usage.summary.cost, 9);
  f.check("unread-A-stream-closed-on-logout-no-bytes-or-request-replayed-to-B");
  f.check("same-Host-binding-B-new-model-call-and-own-ledger-remain-usable");
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
  await f.identity.logout();
  // 退出自身的候选清盘是当前契约；先等它落定，再验证命令不得复用旧投影重写。
  const afterLogoutClear = digest(await f.settleCatalogClear());
  // 不先调用getView清空缓存，验证真实命令自身执行当前身份裁决。
  const result = await f.gateway().applyModels();
  assert.equal(
    result.committed,
    false,
    "cached model list is not authority after logout",
  );
  assert.equal(digest(await f.personal()), afterLogoutClear);
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

test("backend member disable and reenable require a fresh identity before the same Host can execute again", async (t) => {
  const f = await liveFixture(t, "member-disable-reauth-recovery", true);
  assert.ok((await f.gateway().sync("login")).committed);
  await f.modelRequest("member-before-disable");
  assert.equal(f.calls(), 1);
  const before = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(before.items.length, 1);
  assert.equal(before.items[0]!.user_id, f.identityUserId);
  assert.equal(before.items[0]!.amount, 9);
  assert.equal(before.items[0]!.input_tokens, 5);
  assert.equal(before.items[0]!.output_tokens, 2);
  const oldOwner = await f.captureOwner();
  f.check("ordinary-member-real-model-call-settles-nine-credits");

  await f.api(
    `${f.p}/members/${f.identityUserId}`,
    "PATCH",
    { status: "disabled" },
    f.login.token,
  );
  await f.api("/api/auth/me", "GET", undefined, f.session.token, 401);
  const denied = await f.openWithOwner(oldOwner, String(f.model.id));
  assert.equal(denied.status, "ok");
  assert.equal(denied.httpStatus, 401);
  assert.ok(denied.streamId);
  await f.closeStream(denied.streamId);
  assert.equal(f.calls(), 1);
  const rejected = await f.gateway().sync("disabled-member");
  assert.equal(rejected.committed, false);
  assert.equal(rejected.view.error, "unauthorized");
  assert.deepEqual((await f.managedCatalog()).modelIds, []);
  const afterDenial = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.deepEqual(afterDenial.items, before.items);
  f.check(
    "admin-disable-revokes-live-session-clears-catalog-and-dispatches-zero",
  );

  await f.api(
    `${f.p}/members/${f.identityUserId}`,
    "PATCH",
    { status: "active" },
    f.login.token,
  );
  await f.api("/api/auth/me", "GET", undefined, f.session.token, 401);
  assert.equal(
    await f.adapter.restore(f.session, new AbortController().signal),
    null,
  );
  // restoreSession 对已认证 owner 幂等；重新登录沿原退出入口，不把 Gateway 拒绝伪造成身份退出。
  await f.identity.logout();
  assert.equal((await f.identity.getView()).status, "signed-out");
  assert.equal((await f.sessionStore.read()).session, null);
  assert.deepEqual((await f.managedCatalog()).modelIds, []);
  assert.equal(f.calls(), 1);
  f.check("reenable-does-not-resurrect-revoked-token-or-local-candidates");

  await f.relogin();
  assert.deepEqual((await f.managedCatalog()).modelIds, []);
  assert.ok(
    (await f.gateway().sync("reenabled-member-reauthenticated")).committed,
  );
  await f.modelRequest("member-after-reauth");
  assert.equal(f.calls(), 2);
  const after = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(after.items.length, 2);
  assert.ok(
    after.items.every(
      (row) =>
        row.user_id === f.identityUserId &&
        row.status === "settled" &&
        row.amount === 9 &&
        row.input_tokens === 5 &&
        row.output_tokens === 2,
    ),
  );
  assert.deepEqual(
    after.items.find((row) => row.id === before.items[0]!.id),
    before.items[0],
  );
  const usage = await f
    .gateway()
    .refreshUsage({ period: "month", metric: "cost", force: true });
  assert.equal(usage.usage.summary.requestCount, 2);
  assert.equal(usage.usage.summary.cost, 18);
  assert.equal(usage.usage.summary.totalTokens, 14);
  const stale = await f.openWithOwner(oldOwner, String(f.model.id));
  assert.equal(stale.status, "denied");
  assert.equal(stale.code, "enterprise_identity_changed");
  assert.equal(f.calls(), 2);
  await f.assertSafe();
  f.check(
    "fresh-login-original-host-reacquires-catalog-executes-and-settles-only-member",
  );
  f.check("new-login-never-restores-old-private-owner-proof");
  await writeFile(
    join(
      evidence,
      `member-disable-reauth-recovery-observation-${runLabel}.json`,
    ),
    JSON.stringify(
      {
        ordinaryMember: true,
        originalHostAndProfileRetained: true,
        phases: [
          {
            phase: "before-disable",
            calls: 1,
            settled: before.items.length,
            credits: 9,
          },
          {
            phase: "disabled",
            oldTokenHttpStatus: 401,
            privateRelayHttpStatus: denied.httpStatus,
            gatewayError: rejected.view.error,
            catalogModels: 0,
            calls: 1,
            ledgerUnchanged: true,
          },
          {
            phase: "reenabled-with-old-token",
            oldTokenHttpStatus: 401,
            adapterRestore: null,
            catalogModels: 0,
            calls: 1,
          },
          {
            phase: "fresh-login-and-sync",
            calls: f.calls(),
            settled: after.items.length,
            credits: usage.usage.summary.cost,
            originalLedgerRowUnchanged: true,
            allSettlementsBelongToMember: true,
            oldOwnerProofStatus: stale.status,
          },
        ],
        boundary:
          "public admin HTTP member disable/reenable; email/store initialization bridge; original identity/Gateway/ProviderRuntime/private Host relay; actual isolated SQLite and controlled local supplier; not Native login or real WeCom authorization",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
