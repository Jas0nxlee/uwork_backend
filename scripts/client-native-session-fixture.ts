// 实际 Gateway→Registry→CLI AI SDK 线路；独立临时磁盘与本机 HTTPS/TCP，Native/打包 CLI 验收由对应 smoke 独立证明。
import assert from "node:assert/strict";
import { type TestContext } from "node:test";
import { createHash, randomBytes } from "node:crypto";
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

const runLabel =
  process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green";
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);

export interface ControlledSessionHooks {
  evidenceDirectory?: string;
  reply?: (body: Row) => {
    text?: string;
    toolCall?: { id: string; name: string; arguments: string };
  };
  beforeModelOpen?: (body: Row) => Promise<void>;
  prepareCliWorkspace?: (input: {
    workspacePath: string;
    home: string;
    storageDirectory: string;
  }) => Promise<void>;
  onPermissionRequest?: (params: Row) => Promise<unknown>;
  /** Test-only production maintenance alongside the same packaged runtime asset owner. */
  assetMaintenance?: boolean;
  observeAssetCatalog?: (catalog: {
    status: string;
    code?: string;
    experts?: { name: string }[];
  }) => void;
  beforeAssetManifestResponse?: (traceId: string) => Promise<void>;
  /** This owned bridge test keeps its private root and writes only fixed public facts. */
  preserveOwnedRoot?: boolean;
  ordinaryMember?: boolean;
  projectedEvidenceOnly?: boolean;
  ownedParentDirectory?: string;
  onSupplierFailure?: () => void;
}
export async function liveFixture(
  t: TestContext,
  name: string,
  capabilities = false,
  hooks: ControlledSessionHooks = {},
) {
  const evidence = resolve(
    hooks.evidenceDirectory ?? "evidence/client-live-20261017-relay/stdio",
  );
  await mkdir(evidence, { recursive: true });
  const directory = await realpath(
    await mkdtemp(
      join(
        hooks.ownedParentDirectory ?? tmpdir(),
        "uwork-client-session-relay-",
      ),
    ),
  );
  const earlyCleanup: (() => Promise<void> | void)[] = [
    () =>
      hooks.preserveOwnedRoot
        ? Promise.resolve()
        : rm(directory, { recursive: true, force: true }),
  ];
  let fullCleanupInstalled = false;
  const ownedCliCleanups: (() => Promise<void>)[] = [];
  const cliProcesses: {
    pid?: number;
    sessionId?: string;
    resumed: boolean;
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
    exited?: boolean;
  }[] = [];
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
    let controlled:
      | ReturnType<NonNullable<ControlledSessionHooks["reply"]>>
      | undefined;
    if (hooks.projectedEvidenceOnly) {
      try {
        controlled = hooks.reply?.(input);
      } catch {
        hooks.onSupplierFailure?.();
        res.writeHead(400);
        res.end("CONTROLLED_SUPPLIER_REJECTED");
        return;
      }
    } else controlled = hooks.reply?.(input);
    if (input.stream) {
      res.setHeader("content-type", "text/event-stream");
      if (controlled?.toolCall)
        res.write(
          `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: controlled.toolCall.id, type: "function", function: { name: controlled.toolCall.name, arguments: controlled.toolCall.arguments } }] }, finish_reason: null }] })}\n\n`,
        );
      for (const text of controlled
        ? controlled.text
          ? [controlled.text]
          : []
        : holdAfterHeaders
          ? ["完成。"]
          : ["联动", "测试", "完成。"])
        res.write(
          `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
        );
      res.end(
        `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: controlled?.toolCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
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
              message: {
                role: "assistant",
                content: controlled?.text ?? "联动测试完成。",
              },
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
  const artifacts: {
    source: string;
    staged: string;
    sha256: string;
    bytes: number;
  }[] = [];
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
  if (hooks.beforeAssetManifestResponse)
    app.addHook("onSend", async (req, _reply, payload) => {
      if (req.routeOptions.url === "/api/client/assets")
        await hooks.beforeAssetManifestResponse!(
          String(req.headers["x-zcode-trace-id"] ?? ""),
        );
      return payload;
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
  let subjectUserId = owner.userId;
  let subjectFact = {
    userId: owner.userId,
    tenantId: owner.tenantId,
    role: "owner",
    seat: true,
    adminUserId: owner.userId,
  };
  let subjectEmail = "live-gateway-a@example.test",
    subjectPassword = password;
  if (hooks.ordinaryMember) {
    subjectEmail = "owned-plugin-member@example.test";
    subjectPassword = randomBytes(24).toString("hex");
    const member = await api<{ id: string }>(
      `${p}/members`,
      "POST",
      {
        email: subjectEmail,
        name: "Owned plugin ordinary member",
        password: subjectPassword,
        role: "member",
        seat: true,
      },
      adminLogin.token,
      201,
    );
    subjectUserId = member.id;
  }
  const login = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    { email: subjectEmail, password: subjectPassword },
  );
  if (hooks.ordinaryMember) {
    const me = await api<{
      user: { id: string };
      tenant: { id: string };
      role: string;
      seat: boolean;
    }>("/api/auth/me", "GET", undefined, login.token);
    assert.equal(me.role, "member");
    assert.equal(me.user.id, subjectUserId);
    assert.equal(me.tenant.id, owner.tenantId);
    assert.equal(me.seat, true);
    assert.notEqual(me.user.id, owner.userId);
    subjectFact = {
      userId: me.user.id,
      tenantId: me.tenant.id,
      role: me.role,
      seat: me.seat,
      adminUserId: owner.userId,
    };
  }
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
  const credentialSecret = randomBytes(32).toString("hex");
  const credentials = credentialModule.createCredentialService({
    cipherProvider: cipherModule.createCredentialCipherProvider({
      env: { ZCODE_CREDENTIAL_SECRET: credentialSecret },
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
      id: subjectUserId,
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
  let ledger: Row[] = [];
  fullCleanupInstalled = true;
  t.after(async () => {
    const cliCleanupErrors: unknown[] = [];
    for (const cleanup of ownedCliCleanups) {
      try {
        await cleanup();
      } catch (error) {
        cliCleanupErrors.push(error);
      }
    }
    ledger = (
      await api<{ items: Row[] }>(
        `${p}/usage`,
        "GET",
        undefined,
        adminLogin.token,
      )
    ).items.map((row) => {
      // usage 返回 snake_case；误读驼峰会让 JSON 静默丢掉 Token，无法核验实际账本。
      assert.ok(
        [row.input_tokens, row.output_tokens].every(
          (value) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0,
        ),
        "Usage API token fields must be non-negative integers",
      );
      return {
        status: row.status,
        amount: row.amount,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
      };
    });
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
      if (!hooks.preserveOwnedRoot)
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
          artifacts,
          ...(hooks.projectedEvidenceOnly
            ? {}
            : { wires, configurations, observations, privateFrames }),
          ledger,
          ...(hooks.projectedEvidenceOnly ? {} : { requests }),
          modelCalls,
          cliProcesses,
          node: process.version,
          cleanup: {
            portsClosed,
            ownedDirectoryRemoved: !hooks.preserveOwnedRoot,
            ...(hooks.preserveOwnedRoot
              ? { ownedDirectoryPreserved: true }
              : {}),
            identityAndProviderDisposed: true,
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    assert.equal(
      cliCleanupErrors.length,
      0,
      "CLI cleanup assertions must pass",
    );
  });
  return {
    api,
    p,
    privateFrames,
    requests,
    // PLUGIN_BRIDGE_FACTORY_BEGIN
    realHost: async () => {
      const [
        { createZCodeAgentService },
        { createPluginManagementService },
        { createEnterpriseAssetsHost },
        { createUWorkToolAuthorizationResolver },
      ] = await Promise.all([
        source("zcode-agent/zcodeAgentService.ts"),
        source("plugins/pluginManagementService.ts"),
        source("enterprise-assets/enterpriseAssetsHost.ts"),
        source("enterprise-identity/uworkToolAuthorization.ts"),
      ]);
      const workspacePath = join(directory, "host-workspace"),
        home = join(directory, "host-home"),
        storageDirectory = join(directory, "host-cli-storage"),
        assetDirectory = join(directory, "host-assets");
      for (const path of [
        workspacePath,
        home,
        storageDirectory,
        assetDirectory,
      ])
        await mkdir(path, { mode: 0o700 });
      await promisify(execFile)("/usr/bin/git", [
        "init",
        "--quiet",
        workspacePath,
      ]);
      const bundle = join(
        clientRoot,
        "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
      );
      const cliBytes = await readFile(bundle),
        sourceBytes = await readFile(
          join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
        );
      assert.ok(
        cliBytes.equals(sourceBytes),
        "Normal CLI and staged bytes must match",
      );
      assert.equal(
        createHash("sha256").update(cliBytes).digest("hex"),
        "dd0a2693311cacf7cbf6e3482246761e8a6de7c27b598a8a896a2c791add5196",
      );
      const assets = createEnterpriseAssetsHost({
        backendSession: backend,
        storageDirectory: assetDirectory,
      });
      const agent = createZCodeAgentService({
        commandResolver: () => ({
          command: process.execPath,
          args: [bundle, "app-server", "--stdio"],
          env: {
            HOME: home,
            USERPROFILE: home,
            UWORK_DATA_BASE_DIR: join(directory, "host-cli-data"),
            ZCODE_STORAGE_DIR: storageDirectory,
            ZCODE_ENV: "production",
            ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
            ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(
              clientRoot,
              "config/provider/zcode-builtin.json",
            ),
            ZCODE_ENTERPRISE_POLICY_REQUIRED: "1",
            ZCODE_MODEL_TELEMETRY_ENABLED: "false",
          },
        }),
        enterpriseToolAuthorization: createUWorkToolAuthorizationResolver({
          backendSession: backend,
        }),
        enterpriseAssets: assets,
        enterpriseModels: hostRelay,
        requestTimeoutMs: 20000,
      });
      ownedCliCleanups.push(async () => {
        await agent.disposeAllAndWait();
        await assets.disposeAllAndWait();
      });
      return {
        agent,
        plugins: createPluginManagementService({ zcodeAgentService: agent }),
        workspace: { workspacePath },
        storageDirectory,
        modelSelection: { providerId: "ucas", modelId: String(model.id) },
        ownedPorts: [
          Number(new URL(origin).port),
          Number(new URL(backendOrigin).port),
          providerPort,
        ],
        subject: subjectFact,
        readAccounting: () => ({
          gatewayCalls: app.services.db.all(
            "SELECT tenant_id,request_key,user_id FROM gateway_calls WHERE tenant_id=? AND user_id=? ORDER BY request_key",
            owner.tenantId,
            subjectUserId,
          ),
          ledger: app.services.db.all(
            "SELECT id,tenant_id,request_key,user_id,model_id,status,amount,input_tokens,output_tokens FROM ledger WHERE tenant_id=? AND user_id=? ORDER BY id",
            owner.tenantId,
            subjectUserId,
          ),
          traces: app.services.db.all(
            "SELECT id,tenant_id,user_id,model_id,status,input_tokens,output_tokens FROM traces WHERE tenant_id=? AND user_id=? ORDER BY id",
            owner.tenantId,
            subjectUserId,
          ),
        }),
      };
    },
    // PLUGIN_BRIDGE_FACTORY_END
    packaged: async (
      automaticSelection = false,
      options: {
        resumeSessionId?: string;
        dynamicWorkflowEnabled?: boolean;
      } = {},
    ) => {
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
      await mkdir(workspacePath, { recursive: true });
      await mkdir(home, { recursive: true });
      await hooks.prepareCliWorkspace?.({
        workspacePath,
        home,
        storageDirectory: join(directory, "cli-storage"),
      });
      const workspace = {
        workspacePath,
        workspaceIdentity: "cancel-controlled",
        workspaceKey: "cancel-controlled",
      };
      const sourceArtifact = join(
        clientRoot,
        "apps/zcode-cli/packages/cli/dist/zcode.cjs",
      );
      const stagedArtifact = join(
        clientRoot,
        "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
      );
      const sourceBytes = await readFile(sourceArtifact),
        stagedBytes = await readFile(stagedArtifact);
      assert.ok(
        sourceBytes.equals(stagedBytes),
        "staged CLI must equal current in-repo build",
      );
      artifacts.push({
        source: sourceArtifact,
        staged: stagedArtifact,
        sha256: createHash("sha256").update(stagedBytes).digest("hex"),
        bytes: stagedBytes.length,
      });
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
      const processFact: (typeof cliProcesses)[number] = {
        pid: child.pid,
        resumed: options.resumeSessionId !== undefined,
      };
      cliProcesses.push(processFact);
      const outputSuffix =
        cliProcesses.length === 1 ? "" : `-${cliProcesses.length}`;
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
      // 正式 Host 使用已存在的存储目录；夹具也必须先创建可信父目录，
      // 不能把不存在的 parent 误测成企业目录不可用后的回退行为。
      await mkdir(join(directory, "cli-assets"), {
        recursive: true,
        mode: 0o700,
      });
      const assets = createEnterpriseAssetsHost({
        backendSession: backend,
        storageDirectory: join(directory, "cli-assets"),
      });
      if (hooks.observeAssetCatalog) {
        const readCatalog = assets.readCatalog.bind(assets);
        assets.readCatalog = async (traceId: string, signal?: AbortSignal) => {
          const catalog = await readCatalog(traceId, signal);
          hooks.observeAssetCatalog!(catalog);
          return catalog;
        };
      }
      const assetMaintenance = hooks.assetMaintenance
        ? (
            await source("enterprise-assets/enterpriseAssetsLifecycle.ts")
          ).attachEnterpriseAssetsLifecycle({
            identity,
            assets,
            readAuthority: () =>
              lifecycle.readEnterpriseIdentityAuthority(identity),
          })
        : undefined;
      const bridge = createEnterpriseToolAuthorizationBridge({
        assets,
        models: hostRelay,
        resolver: createUWorkToolAuthorizationResolver({
          backendSession: backend,
        }),
        isCurrent: () => !client.isDisposed,
      });
      client.onRequest(
        (request: {
          id: number;
          method: string;
          params: unknown;
          trace?: { traceId: string };
        }) => {
          privateFrames.push({
            method: request.method,
            params: request.params,
            trace: request.trace,
          });
          if (
            request.method ===
            shared.zcodeProtocolMethods.interactionEnterpriseModelRequest
          )
            void (async () => {
              const params =
                shared.zcodeEnterpriseModelRequestParamsSchema.parse(
                  request.params,
                );
              if (params.request.kind === "open")
                await hooks.beforeModelOpen?.(
                  JSON.parse(params.request.body) as Row,
                );
              await bridge.handleModel(
                client,
                workspace,
                request.id,
                request.params,
                request.trace?.traceId,
              );
            })().catch(() => {});
          else if (
            request.method ===
            shared.zcodeProtocolMethods.interactionReadEnterpriseSkills
          )
            void bridge
              .handleCatalog(
                client,
                workspace,
                request.id,
                request.params,
                request.trace?.traceId,
              )
              .catch(() => {});
          else if (
            request.method ===
            shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
          )
            void bridge
              .handle(
                client,
                workspace,
                request.id,
                request.params,
                request.trace?.traceId,
              )
              .catch(() => {});
          else if (
            request.method ===
              shared.zcodeProtocolMethods.interactionRequestPermission &&
            hooks.onPermissionRequest
          )
            void hooks
              .onPermissionRequest(
                shared.zcodePermissionRequestParamsSchema.parse(request.params),
              )
              .then((result) =>
                client.respond(
                  request.id,
                  shared.zcodePermissionResponseSchema.parse(result),
                ),
              )
              .catch(() =>
                client
                  .respondError(request.id, {
                    code: -32000,
                    message: "Controlled permission response unavailable",
                  })
                  .catch(() => {}),
              );
          else
            void client
              .respondError(request.id, {
                code: -32601,
                message: "Unexpected controlled reverse RPC",
              })
              .catch(() => {});
        },
      );
      let cleanupPromise: Promise<void> | undefined;
      const disposeAndWait = () =>
        (cleanupPromise ??= (async () => {
          let assertionError: unknown;
          const forbidden = [
            credentialSecret,
            adminLogin.token,
            session.token,
            "live-gateway-synthetic-vendor",
          ];
          const sanitize = (value: string) =>
            forbidden.reduce(
              (safe, secret) => safe.replaceAll(secret, "[redacted]"),
              value,
            );
          try {
            const transportText =
              Buffer.concat(stdout).toString("utf8") +
              stderr.join("") +
              JSON.stringify(privateFrames);
            for (const secret of forbidden)
              assert.ok(
                !transportText.includes(secret),
                "CLI streams and Host model RPC frames cannot contain any credential",
              );
            assert.deepEqual(
              runtime.registryService
                .getProvider("ucas")
                ?.config.access.toJSON(),
              {
                type: "enterprise-session",
              },
            );
            assert.ok(
              !(await readFile(personalPath, "utf8")).includes(session.token),
            );
            await writeFile(
              join(
                evidence,
                `${name}-packaged-notifications${outputSuffix}.json`,
              ),
              sanitize(JSON.stringify(notifications)),
              {
                mode: 0o600,
              },
            );
          } catch (error) {
            assertionError = error;
          }
          await client.disposeAndWait();
          if (assetMaintenance) await assetMaintenance.disposeAllAndWait();
          else await assets.disposeAllAndWait();
          if (child.exitCode === null && child.signalCode === null)
            await new Promise<void>((done, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("controlled CLI exit timeout")),
                5000,
              );
              child.once("exit", () => {
                clearTimeout(timeout);
                done();
              });
            });
          processFact.exitCode = child.exitCode;
          processFact.signalCode = child.signalCode;
          processFact.exited =
            child.exitCode !== null || child.signalCode !== null;
          await writeFile(
            join(evidence, `${name}-packaged-stderr${outputSuffix}.log`),
            sanitize(stderr.join("")),
            { mode: 0o600 },
          );
          if (assertionError) throw assertionError;
        })());
      ownedCliCleanups.push(disposeAndWait);
      // 灰度默认关闭；专项验收只经正式 Host→CLI 合同显式打开，不改生产配置。
      if (options.dynamicWorkflowEnabled === true) {
        await client.request(
          shared.zcodeProtocolMethods.workspaceUpdateDynamicWorkflowPolicy,
          { workspace, enabled: true },
          shared.zcodeWorkspaceUpdateDynamicWorkflowPolicyResultSchema,
        );
      }
      const state = options.resumeSessionId
        ? await client.request(
            v4.V4_METHODS.conversationSubscribe,
            {
              connectionId: "cancel-controlled",
              clientMode: "desktop-continuous",
              topic: `conversation/${options.resumeSessionId}`,
              workspace,
            },
            v4.v4ConversationSubscribeResultSchema,
            { timeoutMs: 15000, lifecycle: "observation" },
          )
        : await client.request(
            v4.V4_METHODS.command,
            {
              commandId: randomBytes(16).toString("hex"),
              clientId: "cancel-controlled",
              sessionId: null,
              type: "createSession",
              payload: {
                workspaceId: workspacePath,
                ...(options.dynamicWorkflowEnabled === true
                  ? { dynamicWorkflowEnabled: true }
                  : {}),
                ...(automaticSelection
                  ? {}
                  : {
                      config: {
                        modelSelection: {
                          providerId: "ucas",
                          modelId: String(model.id),
                          options: { reasoningLevel: "high" },
                        },
                      },
                    }),
              },
              issuedAt: Date.now(),
            },
            v4.commandAckSchema,
            { timeoutMs: 15000, lifecycle: "observation" },
          );
      if (!options.resumeSessionId) assert.equal(state.status, "accepted");
      else assert.equal(state.ack.mode, "snapshot");
      const sessionId = options.resumeSessionId ?? state.result.sessionId;
      processFact.sessionId = sessionId;
      let currentRevision = options.resumeSessionId
        ? 0
        : state.revisionAtDecision;
      const workflowCommand = (
        command:
          | {
              type: "startSavedWorkflow";
              payload: {
                name: string;
                scope?: "project" | "global";
                args?: Row;
              };
            }
          | {
              type: "resumeWorkflowRun";
              payload: { workId: string; name?: string };
            }
          | { type: "cancelBackgroundWork"; payload: { workId: string } },
      ) =>
        client.request(
          v4.V4_METHODS.command,
          {
            commandId: randomBytes(16).toString("hex"),
            clientId: "cancel-controlled",
            sessionId,
            ...command,
            issuedAt: Date.now(),
          },
          v4.commandAckSchema,
          { timeoutMs: 15000, lifecycle: "observation" },
        );
      return {
        workspacePath,
        sessionId: sessionId as string,
        disposeAndWait,
        workflow: {
          startSaved: (input: {
            name: string;
            scope?: "project" | "global";
            args?: Row;
          }) => workflowCommand({ type: "startSavedWorkflow", payload: input }),
          resume: (workId: string) =>
            workflowCommand({ type: "resumeWorkflowRun", payload: { workId } }),
          cancel: (workId: string) =>
            workflowCommand({
              type: "cancelBackgroundWork",
              payload: { workId },
            }),
        },
        setMode: async (mode: "build" | "yolo") => {
          let receipt;
          for (let attempt = 0; attempt < 3; attempt++) {
            receipt = await client.request(
              v4.V4_METHODS.command,
              {
                commandId: randomBytes(16).toString("hex"),
                clientId: "cancel-controlled",
                sessionId,
                baseRevision: currentRevision,
                type: "switchCollaborationMode",
                payload: { mode },
                issuedAt: Date.now(),
              },
              v4.commandAckSchema,
              { timeoutMs: 15000, lifecycle: "observation" },
            );
            configurations.push({
              command: "switchCollaborationMode",
              mode,
              baseRevision: currentRevision,
              receipt,
            });
            currentRevision = receipt.revisionAtDecision;
            if (
              receipt.status !== "stale" ||
              receipt.reasonCode !== "proto.staleRevision"
            )
              return receipt;
          }
          return receipt;
        },
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
        send: (text = "Synthetic hold until stopped") =>
          client.request(
            v4.V4_METHODS.command,
            {
              commandId: randomBytes(16).toString("hex"),
              clientId: "cancel-controlled",
              sessionId,
              type: "sendText",
              payload: {
                text,
                ...(automaticSelection
                  ? {}
                  : {
                      modelSelection: {
                        providerId: "ucas",
                        modelId: String(model.id),
                        options: { reasoningLevel: "high" },
                      },
                    }),
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
    ownedDesktopHostBootstrap: () => ({
      directory,
      dataBaseDirectory: join(directory, "client-home"),
      apiBaseUrl: origin,
      certificatePath: certificate,
      credentialSecret,
      assertPrivateOutputSafe(output: string) {
        for (const secret of [
          credentialSecret,
          session.token,
          adminLogin.token,
          "live-gateway-synthetic-vendor",
        ])
          assert.equal(
            output.includes(secret),
            false,
            "private Host material cannot enter output",
          );
      },
    }),
    logoutIdentity: () => identity.logout(),
    model,
    check,
    gateway: () => gateway,
    wires,
    observations,
    providerReached,
    calls: () => modelCalls,
  };
}

export async function eventually<T>(
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
