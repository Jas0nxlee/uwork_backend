// 只读诊断：真实 owned HTTP→Gateway→Registry→ModelSelectionService→selector；独立临时磁盘、零模型推理，不导入或构建 CLI/Native 产物。
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
const evidence = resolve("evidence/client-model-label-20261017/live");
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
  const password = "Model-label-synthetic-password!";
  const owner = await bootstrap(app.services.db, {
    name: "Live synthetic A",
    email: "live-gateway-a@example.test",
    password,
  });
  const requests: { method: string; route: string; status: number }[] = [];
  let omitModelNames = false;
  app.addHook("onSend", async (req, _reply, payload) => {
    // 只在受控HTTP夹具模拟旧owned目录缺字段；模型身份/能力和真实路由不变。
    if (
      omitModelNames &&
      req.routeOptions.url === "/v1/models" &&
      typeof payload === "string"
    ) {
      const directory = JSON.parse(payload);
      for (const model of directory.data) delete model.name;
      return JSON.stringify(directory);
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
      name: "联动受控模型",
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
  const personalPath = join(directory, "provider", "personal.json");
  const gatewayPath = join(directory, "gateway.json");
  const gatewayStore = gatewayStoreModule.createUcasGatewayStore({
    filePath: gatewayPath,
  });
  const runtimeOptions = {
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
  };
  let runtime = runtimeModule.createProviderRuntime(runtimeOptions);
  await runtime.start();
  const network = networkModule.createHostApiNetworkTransport(async () => ({}));
  const provisioningFrames: Row[] = [];
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
          const frame = input as Row;
          provisioningFrames.push({
            modelIds: frame.modelIds,
            managedModels: frame.managedModels,
            current:
              typeof frame.isCurrent === "function" ? frame.isCurrent() : null,
          });
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

  const snapshots: Row[] = [];
  let activeLogin = login,
    currentMemberId = owner.userId;
  fullCleanupInstalled = true;
  t.after(async () => {
    gateway.dispose();
    runtime.dispose();
    await lifecycle.disposeEnterpriseIdentityService(identity);
    await network.disposeAndWait();
    for (const clean of earlyCleanup.reverse()) {
      try {
        await clean();
      } catch {
        /* all owned cleanup steps continue */
      }
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
    assert.equal(modelCalls, 0);
    assert.equal(
      requests.some((r) => r.route === "/api/auth/device-tokens"),
      false,
    );
    const encoded = JSON.stringify(
      {
        boundary:
          "actual owned backend temp disk/TCP/TLS; actual EnterpriseIdentityService and Gateway owner; real Host transport, ProviderRuntime, ModelSelectionService and actual UI selector/trigger; controlled email/store bootstrap only; missing-name compatibility uses local onSend omission; no main env/DB/Vault, paid/external provider, generation, CLI/out/build or Native acceptance",
        snapshots,
        provisioningFrames,
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
    );
    for (const secret of [
      login.token,
      activeLogin.token,
      adminLogin.token,
      "live-gateway-synthetic-vendor",
    ])
      assert.equal(
        encoded.includes(secret),
        false,
        "no private credential may enter evidence",
      );
    await writeFile(join(evidence, `${name}.json`), encoded, { mode: 0o600 });
  });
  const ui = await import(
    pathToFileURL(
      join(clientRoot, "packages/ui/src/lib/modelSelectionGroups.ts"),
    ).href
  );
  const trigger = await import(
    pathToFileURL(
      join(clientRoot, "packages/ui/src/v4/composer/modelTriggerDisplay.ts"),
    ).href
  );
  const shared = await import(
    pathToFileURL(join(clientRoot, "packages/shared/src/index.ts")).href
  );
  const snapshot = async (stage: string) => {
    const selectionView = await runtime.modelSelection.getView();
    const groups = ui.buildRegistryModelSelectGroups("glm", selectionView);
    const group = groups.find((g: Row) => g.key === "registry-provider:ucas");
    const selected = group?.items.find(
      (i: Row) =>
        i.value === shared.encodeCustomModelValue("ucas", String(model.id)),
    );
    const display = trigger.resolveV4ModelTriggerDisplay({
      modelGroups: groups,
      normalizedValue: shared.encodeCustomModelValue("ucas", String(model.id)),
      fallbackLabel: String(model.id),
      providerId: "ucas",
      providerName: "ucas",
    });
    const persisted = JSON.parse(await readFile(personalPath, "utf8"));
    const state = {
      stage,
      selectionView,
      selectorGroup: group ?? null,
      selected: selected ?? null,
      composerDisplay: display,
      apiModelId: model.id,
      storedNames: persisted.config.providerConfigRules.providerRules.find(
        (p: Row) => p.providerId === "ucas",
      ).config.enterpriseModelNames,
    };
    snapshots.push(state);
    return state;
  };
  const rename = async (name: string) => {
    const rows = await api<Row[]>(
      `${p}/models`,
      "GET",
      undefined,
      adminLogin.token,
    );
    const current = rows.find((r) => r.id === model.id);
    assert.ok(current);
    await api(
      `${p}/models/${model.id}`,
      "PUT",
      {
        ...(current.data as Row),
        name,
        scope: current.scope,
        enabled: current.enabled,
        revision: current.revision,
      },
      adminLogin.token,
    );
  };
  return {
    api,
    p,
    adminLogin,
    model,
    gateway,
    snapshot,
    rename,
    currentLogin: () => activeLogin,
    currentMember: () => currentMemberId,
    omitNames: (value: boolean) => {
      omitModelNames = value;
    },
    restartProvider: async () => {
      runtime.dispose();
      runtime = runtimeModule.createProviderRuntime(runtimeOptions);
      await runtime.start();
    },
    changeOwner: async () => {
      const scopeModule = await source("ucas-gateway/gatewayIdentityScope.ts");
      const old = scopeModule.createGatewayIdentityScope(
        {
          readIdentitySession: async () => (await sessionStore.read()).session,
          readIdentityAuthority: () =>
            lifecycle.readEnterpriseIdentityAuthority(identity),
          resolveApiBaseUrl: async () => origin,
          resolveBackend: async () => "uwork",
        },
        (await sessionStore.read()).session,
        origin,
        "uwork",
        () => false,
      );
      await identity.logout();
      const member = await api(
        `${p}/members`,
        "POST",
        {
          name: "Current synthetic member",
          email: "model-label-member@example.test",
          password,
          role: "member",
          seat: true,
        },
        adminLogin.token,
        201,
      );
      activeLogin = await api<{ token: string; expiresAt: number }>(
        "/api/auth/login",
        "POST",
        { email: "model-label-member@example.test", password },
      );
      const restored = await adapter.restore(
        {
          token: activeLogin.token,
          expiresAt: activeLogin.expiresAt,
          issuerOrigin: origin,
          profile: {
            id: member.id,
            tenantId: owner.tenantId,
            provider: "wecom",
            displayName: "Current synthetic member",
          },
        },
        new AbortController().signal,
      );
      assert.ok(restored);
      assert.ok(
        (
          await sessionStore.write(
            restored,
            (await sessionStore.read()).revision,
            () => true,
          )
        ).accepted,
      );
      assert.equal((await identity.restoreSession()).status, "authenticated");
      currentMemberId = String(member.id);
      assert.equal(old.isCurrent(), false);
      return async () => {
        await assert.rejects(
          runtime.providerSettings[
            facadeModule.providerSettingsTrustedGatewayProvisioning
          ]({
            baseUrl: origin + "/v1",
            authMode: "enterprise-session",
            modelIds: [],
            managedModels: [],
            isCurrent: old.isCurrent,
          }),
          /enterprise_identity_changed/,
        );
      };
    },
  };
}

test("actual owned directory names and same-ID rename reach selector without changing execution identity", async (t) => {
  const f = await liveFixture(t, "source-green");
  const before = await f.api(
    "/v1/models",
    "GET",
    undefined,
    f.currentLogin().token,
  );
  assert.equal((before.data as Row[])[0]!.name, "联动受控模型");
  assert.ok((await f.gateway.sync("model-label-initial")).committed);
  const initial = await f.snapshot("initial-admin-name");
  assert.equal(initial.selected?.name, "联动受控模型");
  assert.equal(initial.composerDisplay.fullLabel, "ucas/联动受控模型");
  await f.rename("联动受控模型-已改名");
  await f.gateway.refreshModels();
  const renamed = await f.snapshot("same-id-admin-rename");
  assert.equal(renamed.selected?.name, "联动受控模型-已改名");
  assert.equal(renamed.selected?.value, initial.selected?.value);
  assert.deepEqual(
    renamed.selectionView.preferredSelection,
    initial.selectionView.preferredSelection,
  );
  f.omitNames(true);
  await f.gateway.refreshModels();
  const missing = await f.snapshot("old-owned-metadata-missing-name");
  assert.equal(missing.selected?.name, f.model.id);
  assert.deepEqual(missing.storedNames, {});
  f.omitNames(false);
  await f.gateway.refreshModels();
  await f.rename("当前成员的模型名称");
  const oldClear = await f.changeOwner();
  assert.ok((await f.gateway.sync("model-label-new-owner")).committed);
  const changed = await f.snapshot("same-id-new-identity-owner");
  assert.equal(changed.selected?.name, "当前成员的模型名称");
  assert.equal(changed.selected?.value, initial.selected?.value);
  await oldClear();
  assert.equal(
    (await f.snapshot("late-old-owner-clear-rejected")).selected?.name,
    "当前成员的模型名称",
  );

  const subscription = await f.api(
    `${f.p}/subscription`,
    "GET",
    undefined,
    f.adminLogin.token,
  );
  const setSubscription = (startsAt: number, endsAt: number) =>
    f.api(
      `${f.p}/subscription`,
      "PUT",
      {
        seats: subscription.seats,
        credits: subscription.credits,
        metering: subscription.metering,
        startsAt,
        endsAt,
      },
      f.adminLogin.token,
    );
  for (const status of [403, 402, 401]) {
    if (status === 403)
      await f.api(
        `${f.p}/members/${f.currentMember()}`,
        "PATCH",
        { seat: false },
        f.adminLogin.token,
      );
    if (status === 402) await setSubscription(1, 2);
    if (status === 401)
      await f.api(
        "/api/auth/logout",
        "POST",
        { revokeDevices: true },
        f.currentLogin().token,
        204,
      );
    await f.api("/v1/models", "GET", undefined, f.currentLogin().token, status);
    await f.gateway.refreshModels();
    const denied = await f.snapshot(`server-${status}-clear`);
    assert.equal(denied.selectorGroup, null);
    assert.deepEqual(denied.storedNames, {});
    await f.restartProvider();
    const restarted = await f.snapshot(`server-${status}-restart`);
    assert.equal(restarted.selectorGroup, null);
    assert.deepEqual(restarted.storedNames, {});
    if (status === 403)
      await f.api(
        `${f.p}/members/${f.currentMember()}`,
        "PATCH",
        { seat: true },
        f.adminLogin.token,
      );
    if (status === 402)
      await setSubscription(
        Number(subscription.starts_at),
        Number(subscription.ends_at),
      );
    if (status !== 401) {
      assert.ok((await f.gateway.sync(`restore-${status}`)).committed);
      assert.equal(
        (await f.snapshot(`server-${status}-recovered`)).selected?.name,
        "当前成员的模型名称",
      );
    }
  }
});
