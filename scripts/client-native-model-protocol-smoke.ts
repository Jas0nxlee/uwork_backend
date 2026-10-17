// 实际 Gateway→Registry→CLI AI SDK 线路；独立临时磁盘与本机 HTTPS/TCP，Native/打包 CLI 验收由对应 smoke 独立证明。
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
import { completionSchema } from "../src/gateway.js";

type Row = Record<string, unknown>;
const clientRoot = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
assert.ok(
  clientRoot === resolve("clients/uwork"),
  "client source must remain inside this backend repository",
);
const evidence = resolve("evidence/client-live-20261017-protocol");
const runLabel =
  process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green";
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);

async function liveFixture(t: TestContext, name: string, capabilities = false) {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-client-live-protocol-"),
  );
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
  ]);
  paths.setDataBaseDir(join(directory, "client-home"));
  earlyCleanup.push(() => paths.setDataBaseDir(null));
  let modelCalls = 0;
  const provider = createServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(
      req.headers.authorization,
      "Bearer live-gateway-synthetic-vendor",
    );
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const input = JSON.parse(raw);
    modelCalls++;
    const envelope = {
      id: "synthetic-completion",
      model: "controlled",
      created: 1,
    };
    if (input.stream) {
      res.setHeader("content-type", "text/event-stream");
      for (const text of ["联动", "测试", "完成。"])
        res.write(
          `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
        );
      res.end(
        `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      );
    } else {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ...envelope,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "联动测试完成。" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      );
    }
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
  const requests: { method: string; route: string; status: number }[] = [];
  const wires: Row[] = [];
  const configurations: unknown[] = [];
  app.addHook("preValidation", async (req) => {
    if (req.routeOptions.url !== "/v1/chat/completions") return;
    const body = req.body as Row;
    const parsed = completionSchema.safeParse(body);
    const protocolFields = Object.fromEntries(
      Object.entries(body).filter(
        ([key]) => key !== "messages" && key !== "model",
      ),
    );
    wires.push({
      keys: Object.keys(body).sort(),
      protocolFields,
      valid: parsed.success,
      issues: parsed.success
        ? []
        : parsed.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path,
            ...(issue.code === "unrecognized_keys" ? { keys: issue.keys } : {}),
          })),
    });
  });
  app.addHook("onResponse", async (req, reply) => {
    requests.push({
      method: req.method,
      route: req.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
    });
  });
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
      contextWindow: 128000,
      supportsVision: false,
      supportsReasoning: capabilities,
      supportsTools: capabilities,
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
  const backend = backendSessionModule.createUWorkBackendSession({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => sessionStore.read(),
  });
  const { createEnterpriseModelRelay } = await source(
    "enterprise-model-relay/relay.ts",
  );
  const ownerProof = await backend.run(
    (scope: { ownerKey: string }) => scope.ownerKey,
  );
  assert.ok(ownerProof.managed);
  const hostRelay = createEnterpriseModelRelay({ backendSession: backend });
  const privateFrames: unknown[] = [];
  const runtimeOwner = {};
  const personalPath = join(directory, "provider", "personal.json");
  const gatewayPath = join(directory, "gateway.json");
  const gatewayStore = gatewayStoreModule.createUcasGatewayStore({
    filePath: gatewayPath,
  });
  const runtime = runtimeModule.createProviderRuntime({
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
  const network = networkModule.createHostApiNetworkTransport(async () => ({}));
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
  const gateway = createGateway();
  const checks: string[] = [];
  const check = (value: string) => checks.push(value);
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
    return {
      ...resolution,
      providerConfig: provider.config,
      modelConfig: runtime.registryService.getModel("ucas", String(model.id))
        .config,
    };
  };
  let ledger: Row[] = [];
  fullCleanupInstalled = true;
  t.after(async () => {
    ledger = (
      await api<{ items: Row[] }>(
        `${p}/usage`,
        "GET",
        undefined,
        adminLogin.token,
      )
    ).items.map((row) => ({
      status: row.status,
      amount: row.amount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    }));
    hostRelay.dispose();
    gateway.dispose();
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
    const encodedFrames = JSON.stringify(privateFrames);
    for (const secret of [
      login.token,
      adminLogin.token,
      "live-gateway-synthetic-vendor",
    ])
      assert.ok(
        !encodedFrames.includes(secret),
        "private CLI model frames cannot contain any credential",
      );
    assert.ok(
      !requests.some((r) => r.route === "/api/auth/device-tokens"),
      "Gateway must not request a device/API key",
    );
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
            "real backend temp disk/TCP; actual identity/Gateway/ProviderRuntime/AiSdkModelAdapter+AI SDK source; real Host transport for provisioning; actual private Host relay for all SDK generation HTTP; CLI has no key or network generation path; email/store bootstrap bridge only; actual source adapter (packaged CLI/Native Electron acceptance is separate); no mocked fetch/WeCom/external MCP/drive/main env/paid vendor",
          checks,
          wires,
          configurations,
          ledger,
          privateFrames,
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
    login: adminLogin,
    model,
    check,
    gateway: () => gateway,
    wires,
    calls: () => modelCalls,
    executable: async () => {
      const { AiSdkModelAdapter } = await import(
        pathToFileURL(
          join(
            clientRoot,
            "apps/zcode-cli/packages/adapters/src/model/runner.ts",
          ),
        ).href
      );
      const config = await resolved();
      assert.equal(config.providerConfig.access.type, "enterprise-session");
      assert.deepEqual(config.providerConfig.access.toJSON(), {
        type: "enterprise-session",
      });
      const { createEnterpriseSessionFetch } = await import(
        pathToFileURL(
          join(
            clientRoot,
            "apps/zcode-cli/packages/adapters/src/model/enterprise-session-fetch.ts",
          ),
        ).href
      );
      const contracts = await import(
        pathToFileURL(
          join(clientRoot, "apps/zcode-cli/packages/contracts/src/index.ts"),
        ).href
      );
      const enterpriseSessionFetch = createEnterpriseSessionFetch({
        getOwnerKey: () => ownerProof.value,
        relay: {
          request: async (
            frame: { request: unknown },
            signal?: AbortSignal,
          ) => {
            privateFrames.push(frame);
            return hostRelay.request({
              runtime: runtimeOwner,
              workspaceKey: directory,
              sessionId: "actual-sdk-controlled",
              request: frame.request,
              signal,
            });
          },
        },
        sessionId: "actual-sdk-controlled",
        workspacePath: directory,
        traceContext: contracts.createRootTraceContext({
          sessionId: contracts.createSessionId("actual-sdk-controlled"),
        }),
      });
      configurations.push({
        access: config.providerConfig.access.toJSON(),
        properties: config.modelConfig.properties,
        optionSpecs: config.modelConfig.optionSpecs,
      });
      const runner = new AiSdkModelAdapter({
        enterpriseSessionFetch,
        env: {},
        retry: { maxAttempts: 1 },
      });
      return runner.createModel({
        providerId: "ucas",
        modelId: String(model.id),
        providerConfig: config.providerConfig,
        modelConfig: config.modelConfig,
      });
    },
  };
}

for (const mode of ["json", "sse"] as const) {
  test(`actual CLI AiSdkModelAdapter ${mode} consumes Gateway model metadata and sends a strict backend-compatible body`, async (t) => {
    const f = await liveFixture(t, `actual-sdk-${mode}`);
    assert.ok((await f.gateway().sync("login")).committed);
    const executable = await f.executable();
    const reasoning = executable.optionSpecs.reasoningLevel.values.at(-1);
    const request = {
      messages: [{ role: "user", content: "请回复联动测试完成，不调用工具。" }],
      options: { maxOutputTokens: 8, reasoningLevel: reasoning },
      abortSignal: AbortSignal.timeout(8000),
    };
    let text = "",
      finish: Row | undefined;
    let deltaCount = 0,
      finishCount = 0;
    try {
      if (mode === "json") {
        const result = await executable.generateText(request);
        text = result.text;
        finish = result;
      } else {
        for await (const event of executable.streamText(request)) {
          if (event.type === "error") throw event.error;
          if (event.type === "text_delta") {
            text += event.text;
            deltaCount++;
          }
          if (event.type === "finish") {
            finish = event;
            finishCount++;
          }
        }
      }
    } catch (error) {
      const value = error as { code?: string; statusCode?: number };
      f.check(
        `SDK-failed:${value.code ?? "unknown"}:${value.statusCode ?? "unknown"}`,
      );
      assert.fail(
        `actual SDK ${mode} request failed; sanitized structural wire recorded in evidence`,
      );
    }
    assert.equal(text, "联动测试完成。");
    if (mode === "sse") {
      assert.equal(deltaCount, 3);
      assert.equal(finishCount, 1);
      f.check("actual-SDK-three-text-deltas-one-finish");
    }
    assert.ok(finish);
    assert.equal((finish.usage as Row).inputTokens, 5);
    assert.equal((finish.usage as Row).outputTokens, 2);
    assert.equal((finish.usage as Row).totalTokens, 7);
    assert.equal(f.calls(), 1);
    assert.equal(f.wires.length, 1);
    assert.equal(f.wires[0]!.valid, true);
    const fields = f.wires[0]!.protocolFields as Row;
    assert.equal(fields.max_tokens, 8);
    for (const forbidden of [
      "thinking",
      "enable_thinking",
      "reasoning",
      "reasoning_effort",
      "max_completion_tokens",
    ])
      assert.equal(Object.hasOwn(fields, forbidden), false, forbidden);
    assert.equal(executable.properties.contextWindow, 128000);
    assert.equal(executable.properties.inputFormat.supportsImage, false);
    assert.equal(executable.properties.supportsToolCall, false);
    assert.equal(executable.optionSpecs.maxOutputTokens.max, 16);
    assert.deepEqual(executable.optionSpecs.reasoningLevel.values, ["none"]);
    const ledger = await f.api<{ items: Row[] }>(
      `${f.p}/usage`,
      "GET",
      undefined,
      f.login.token,
    );
    assert.equal(ledger.items.length, 1);
    assert.equal(ledger.items[0]!.status, "settled");
    assert.equal(ledger.items[0]!.amount, 9);
    f.check(
      "actual-SDK-success-body-capabilities-one-vendor-call-settled-ledger",
    );
  });
}

test("actual SDK reasoning and tools use only UWork standard maps at every supported level", async (t) => {
  const f = await liveFixture(t, "actual-sdk-reasoning-tools", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const executable = await f.executable();
  assert.deepEqual(executable.optionSpecs.reasoningLevel.values, [
    "low",
    "medium",
    "high",
  ]);
  assert.equal(executable.properties.supportsToolCall, true);
  for (const reasoningLevel of ["low", "medium", "high"]) {
    const result = await executable.generateText({
      messages: [{ role: "user", content: "请回复联动测试完成，不调用工具。" }],
      tools: [
        {
          name: "synthetic_tool",
          description: "受控测试工具，不执行",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      ],
      options: { maxOutputTokens: 8, reasoningLevel },
      abortSignal: AbortSignal.timeout(8000),
    });
    assert.equal(result.text, "联动测试完成。");
    const wire = f.wires.at(-1)!;
    assert.equal(wire.valid, true);
    const fields = wire.protocolFields as Row;
    assert.equal(fields.reasoning_effort, reasoningLevel);
    assert.equal(fields.max_tokens, 8);
    for (const key of [
      "thinking",
      "enable_thinking",
      "reasoning",
      "max_completion_tokens",
    ])
      assert.equal(Object.hasOwn(fields, key), false);
    assert.equal((fields.tools as Row[]).length, 1);
    assert.equal(fields.tool_choice, "auto");
  }
  assert.equal(f.calls(), 3);
  assert.equal(f.wires.length, 3);
  const ledger = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(ledger.items.length, 3);
  assert.ok(
    ledger.items.every((row) => row.status === "settled" && row.amount === 9),
  );
  f.check(
    "all-three-reasoning-levels-real-function-tools-strict-body-vendor3-ledger3",
  );
});
