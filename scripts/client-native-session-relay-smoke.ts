// 实际 Gateway→Registry→CLI AI SDK 线路；独立临时磁盘与本机 HTTPS/TCP，Native/打包 CLI 验收由对应 smoke 独立证明。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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
const evidence = resolve("evidence/client-live-20261017-relay/stdio");
const runLabel =
  process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green";
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);

async function liveFixture(t: TestContext, name: string, capabilities = false) {
  await mkdir(evidence, { recursive: true });
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-client-session-relay-")),
  );
  const earlyCleanup: (() => Promise<void> | void)[] = [
    () => rm(directory, { recursive: true, force: true }),
  ];
  let fullCleanupInstalled = false;
  const ownedCliCleanups: (() => Promise<void>)[] = [];
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
  const privateFrames: unknown[] = [];
  const hold = name.includes("cancel");
  const holdAfterHeaders = name.includes("cancel-read");
  const observations: Record<string, number> = {};
  let reached!: () => void;
  const providerReached = new Promise<void>((done) => {
    reached = done;
  });
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
    const envelope = {
      id: "synthetic-completion",
      model: "controlled",
      created: 1,
    };
    if (holdAfterHeaders) {
      res.setHeader("content-type", "text/event-stream");
      for (const text of ["联动", "测试"])
        res.write(
          `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
        );
    }
    modelCalls++;
    observations.supplierReceivedAt = Date.now();
    reached();
    if (hold)
      await new Promise<void>((done) => {
        const timer = setTimeout(
          done,
          Number(process.env.UWORK_CANCEL_DELAY_MS ?? 0) + 5000,
        );
        res.once("close", () => {
          observations.supplierClosedAt = Date.now();
          clearTimeout(timer);
          done();
        });
      });
    if (res.destroyed) return;
    if (input.stream) {
      res.setHeader("content-type", "text/event-stream");
      for (const text of holdAfterHeaders
        ? ["完成。"]
        : ["联动", "测试", "完成。"])
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
  const appFactory: typeof createApp =
    process.env.UWORK_CANCEL_COMPILED_BACKEND === "1"
      ? (await import(pathToFileURL(resolve("dist/app.js")).href)).createApp
      : createApp;
  const app = await appFactory({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: process.env.UWORK_CANCEL_COMPILED_BACKEND === "1",
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
  app.addHook("preValidation", async (req, reply) => {
    if (req.routeOptions.url !== "/v1/chat/completions") return;
    reply.raw.once("close", () => {
      observations.backendClosedAt = Date.now();
    });
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
      res.once("close", () => {
        if (req.url === "/v1/chat/completions")
          observations.proxyClosedAt = Date.now();
        upstream.destroy();
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
  const hostRelay = createEnterpriseModelRelay({ backendSession: backend });
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
    for (const cleanup of ownedCliCleanups) await cleanup();
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
            "real backend temp disk/TCP; actual identity/Gateway/ProviderRuntime/AiSdkModelAdapter+AI SDK source; real Host model relay HTTP; actual packaged CLI stdio without identity/vendor key or direct model network path; email/store bootstrap bridge only; actual packaged CLI acceptance (Native Electron is separate); no mocked fetch/WeCom/external MCP/drive/main env/paid vendor",
          checks,
          wires,
          configurations,
          observations,
          privateFrames,
          ledger,
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
    packaged: async () => {
      const { ZCodeProtocolClient } = await source(
        "zcode-agent/zcodeProtocolClient.ts",
      );
      const { ZCodeStdioTransport } = await source(
        "zcode-agent/zcodeStdioTransport.ts",
      );
      const { createEnterpriseToolAuthorizationBridge } = await source(
        "zcode-agent/enterpriseToolAuthorizationBridge.ts",
      );
      const { createUWorkToolAuthorizationResolver } = await source(
        "enterprise-identity/uworkToolAuthorization.ts",
      );
      const { createEnterpriseAssetsHost } = await source(
        "enterprise-assets/enterpriseAssetsHost.ts",
      );
      const shared = await import(
        pathToFileURL(join(clientRoot, "packages/shared/src/index.ts")).href
      );
      const v4 = await import(
        pathToFileURL(
          join(clientRoot, "packages/shared/src/zcode-protocol-v4/index.ts"),
        ).href
      );
      const workspacePath = join(directory, "cli-workspace"),
        home = join(directory, "cli-home");
      await mkdir(workspacePath);
      await mkdir(home);
      const workspace = {
        workspacePath,
        workspaceIdentity: "cancel-controlled",
        workspaceKey: "cancel-controlled",
      };
      const child = spawn(
        process.env.UWORK_CANCEL_NODE_RUNTIME ?? process.execPath,
        [
          join(
            clientRoot,
            "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
          ),
          "app-server",
          "--stdio",
        ],
        {
          cwd: workspacePath,
          stdio: "pipe",
          env: {
            PATH: process.env.PATH,
            ...(process.env.UWORK_CANCEL_NODE_RUNTIME
              ? { ELECTRON_RUN_AS_NODE: "1" }
              : {}),
            HOME: home,
            USERPROFILE: home,
            ZCODE_ENV: "test",
            UWORK_DATA_BASE_DIR: join(directory, "cli-data"),
            ZCODE_STORAGE_DIR: join(directory, "cli-storage"),
            ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
            ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(
              clientRoot,
              "config/provider/zcode-builtin.json",
            ),
            [shared.ZCODE_ENTERPRISE_POLICY_REQUIRED_ENV_KEY]: "1",
            [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: workspace.workspaceIdentity,
            ZCODE_MODEL_TELEMETRY_ENABLED: "false",
          },
        },
      );
      const notifications: { method: string; params: Row }[] = [];
      const stdout: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) =>
        stdout.push(Buffer.from(chunk)),
      );
      const stderr: string[] = [];
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk.toString());
      });
      const transport = new ZCodeStdioTransport(child, {
        onStderrLine: () => {},
      });
      const client = new ZCodeProtocolClient(transport, {
        requestTimeoutMs: 15000,
      });
      client.onNotification(
        (notification: { method: string; params: unknown }) => {
          if (
            notification.params !== null &&
            typeof notification.params === "object" &&
            !Array.isArray(notification.params)
          )
            notifications.push({
              method: notification.method,
              params: notification.params as Row,
            });
          if (
            notification.method ===
            shared.zcodeProtocolNotifications
              .enterpriseToolAuthorizationCancelled
          )
            bridge.cancel(client, workspace, notification.params);
        },
      );
      client.onClose(() => hostRelay.closeRuntime(client));
      const assets = createEnterpriseAssetsHost({
        backendSession: backend,
        storageDirectory: join(directory, "cli-assets"),
      });
      const bridge = createEnterpriseToolAuthorizationBridge({
        assets,
        models: hostRelay,
        resolver: createUWorkToolAuthorizationResolver({
          backendSession: backend,
        }),
        isCurrent: () => !client.isDisposed,
      });
      client.onRequest(
        (request: { id: number; method: string; params: unknown }) => {
          privateFrames.push({
            method: request.method,
            params: request.params,
          });
          if (
            request.method ===
            shared.zcodeProtocolMethods.interactionEnterpriseModelRequest
          )
            void bridge
              .handleModel(client, workspace, request.id, request.params)
              .catch(() => {});
          else if (
            request.method ===
            shared.zcodeProtocolMethods.interactionReadEnterpriseSkills
          )
            void bridge
              .handleCatalog(client, workspace, request.id, request.params)
              .catch(() => {});
          else if (
            request.method ===
            shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
          )
            void bridge
              .handle(client, workspace, request.id, request.params)
              .catch(() => {});
          else
            void client
              .respondError(request.id, {
                code: -32601,
                message: "Unexpected controlled reverse RPC",
              })
              .catch(() => {});
        },
      );
      ownedCliCleanups.push(async () => {
        const forbidden = [
          adminLogin.token,
          session.token,
          "live-gateway-synthetic-vendor",
        ];
        const transportText =
          Buffer.concat(stdout).toString("utf8") +
          JSON.stringify(privateFrames);
        for (const secret of forbidden)
          assert.ok(
            !transportText.includes(secret),
            "CLI stdout and Host model RPC frames cannot contain any credential",
          );
        assert.deepEqual((await resolved()).providerConfig.access.toJSON(), {
          type: "enterprise-session",
        });
        assert.ok(
          !(await readFile(personalPath, "utf8")).includes(session.token),
        );
        let safe = JSON.stringify(notifications);
        for (const secret of forbidden)
          if (secret) safe = safe.replaceAll(secret, "[redacted]");
        await writeFile(
          join(evidence, `${name}-packaged-notifications.json`),
          safe,
          {
            mode: 0o600,
          },
        );
        await client.disposeAndWait();
        await assets.disposeAllAndWait();
        await writeFile(
          join(evidence, `${name}-packaged-stderr.log`),
          stderr.join(""),
          { mode: 0o600 },
        );
      });
      const state = await client.request(
        v4.V4_METHODS.command,
        {
          commandId: randomBytes(16).toString("hex"),
          clientId: "cancel-controlled",
          sessionId: null,
          type: "createSession",
          payload: {
            workspaceId: workspacePath,
            config: {
              modelSelection: {
                providerId: "ucas",
                modelId: String(model.id),
                options: { reasoningLevel: "high" },
              },
            },
          },
          issuedAt: Date.now(),
        },
        v4.commandAckSchema,
        { timeoutMs: 15000, lifecycle: "observation" },
      );
      assert.equal(state.status, "accepted");
      const sessionId = state.result.sessionId;
      return {
        json: () =>
          client.request(
            shared.zcodeProtocolMethods.workspaceGenerateText,
            {
              workspace,
              selection: {
                providerId: "ucas",
                modelId: String(model.id),
                options: { reasoningLevel: "high" },
              },
              prompt: "Synthetic JSON result",
              querySource: "controlled-json",
              maxOutputTokens: 8,
              operationId: "controlled-json",
            },
            shared.zcodeWorkspaceGenerateTextResultSchema,
            { timeoutMs: 15000, lifecycle: "observation" },
          ),
        notifications,
        send: () =>
          client.request(
            v4.V4_METHODS.command,
            {
              commandId: randomBytes(16).toString("hex"),
              clientId: "cancel-controlled",
              sessionId,
              type: "sendText",
              payload: {
                text: "Synthetic hold until stopped",
                modelSelection: {
                  providerId: "ucas",
                  modelId: String(model.id),
                  options: { reasoningLevel: "high" },
                },
              },
              issuedAt: Date.now(),
            },
            v4.commandAckSchema,
            { timeoutMs: 15000, lifecycle: "observation" },
          ),
        stop: () =>
          client.request(
            v4.V4_METHODS.command,
            {
              commandId: randomBytes(16).toString("hex"),
              clientId: "cancel-controlled",
              sessionId,
              type: "stop",
              payload: {},
              issuedAt: Date.now(),
            },
            v4.commandAckSchema,
            { timeoutMs: 15000, lifecycle: "observation" },
          ),
      };
    },
    login: adminLogin,
    model,
    check,
    gateway: () => gateway,
    wires,
    observations,
    providerReached,
    calls: () => modelCalls,
  };
}

async function eventually<T>(
  operation: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 5000,
): Promise<T> {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await operation();
    if (accept(value)) return value;
    if (Date.now() > until) throw new Error("controlled relay result timeout");
    await new Promise((done) => setTimeout(done, 10));
  }
}

test("packaged CLI JSON uses private Host model relay without any key exchange", async (t) => {
  const f = await liveFixture(t, "stdio-json", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  const result = await cli.json();
  assert.equal(result.text, "联动测试完成。");
  assert.equal(result.usage.totalTokens, 7);
  const usage = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  assert.equal(usage.items[0]!.status, "settled");
  assert.equal(usage.items[0]!.amount, 9);
  f.check("actual-packaged-JSON-private-relay-vendor1-settled1-no-secret");
});

test("packaged CLI V4 SSE and title settle through the same private relay", async (t) => {
  const f = await liveFixture(t, "stdio-sse", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 2 &&
      value.items.every((row) => row.status === "settled"),
  );
  assert.equal(f.calls(), 2);
  assert.ok(usage.items.every((row) => row.amount === 9));
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v: { method: string; params: Row }) =>
          v.method === "v4/telemetry/event" &&
          v.params.kind === "turn.terminal" &&
          v.params.status === "success",
      ),
  );
  const chunks = cli.notifications.filter(
    (v: { method: string; params: Row }) =>
      v.method === "v4/telemetry/event" &&
      v.params.kind === "stream.chunk" &&
      v.params.channel === "text",
  );
  assert.deepEqual(
    chunks.map((v: { params: Row }) => v.params.chunkLength),
    [2, 2, 3],
  );
  f.check(
    "actual-packaged-SSE-3delta-success-main-plus-auto-title-vendor2-ledger2-no-secret",
  );
});

test("packaged CLI stop cancels pending Host open and closes actual backend upstream", async (t) => {
  const f = await liveFixture(t, "stdio-cancel", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierReceivedAt,
  );
  f.observations.abortAt = Date.now();
  assert.equal((await cli.stop()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierClosedAt,
    2000,
  );
  assert.ok(f.observations.proxyClosedAt && f.observations.backendClosedAt);
  assert.ok(f.observations.supplierClosedAt);
  assert.ok(f.observations.supplierClosedAt - f.observations.abortAt < 2000);
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 1 && value.items[0]!.status === "uncertain",
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  f.check(
    "packaged-V4-stop-cancel-notice-closes-pending-open-all3hops-uncertain-not-refund",
  );
});

test("packaged CLI stop during an admitted Host read closes streamed SSE", async (t) => {
  const f = await liveFixture(t, "stdio-cancel-read", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v: { method: string; params: Row }) =>
          v.method === "v4/telemetry/event" && v.params.kind === "stream.chunk",
      ),
  );
  f.observations.abortAt = Date.now();
  assert.equal((await cli.stop()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierClosedAt,
    2000,
  );
  assert.ok(f.observations.supplierClosedAt);
  assert.ok(f.observations.supplierClosedAt - f.observations.abortAt < 2000);
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 1 && value.items[0]!.status === "uncertain",
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  f.check(
    "packaged-stop-active-read-closes-3hops-uncertain-partial-SSE-no-refund",
  );
});
