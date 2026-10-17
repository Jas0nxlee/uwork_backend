import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCACertificates, setDefaultCACertificates } from "node:tls";

type Row = Record<string, unknown>;
type Init = {
  temporary: string;
  origin: string;
  certificate: string;
  tenantId: string;
  userId: string;
  token: string;
  expiresAt: number;
  credentialSecret: string;
  seed: boolean;
  label: string;
  clientNode: string;
};
const init = await new Promise<Init>((done) => process.once("message", done));
const clientRoot = resolve("clients/uwork");
const load = (path: string) =>
  import(pathToFileURL(join(clientRoot, path)).href);
const source = (path: string) => load(`packages/services/src/${path}`);
const [
  paths,
  credentialModule,
  cipherModule,
  sharedNode,
  sessionModule,
  identityModule,
  lifecycleModule,
  adapterModule,
  backendModule,
  networkModule,
  assetsModule,
  authModule,
  bridgeModule,
  protocolModule,
  transportModule,
  shared,
] = await Promise.all([
  source("paths.ts"),
  source("credential/credentialService.ts"),
  source("credential/providers/credentialCipherProvider.ts"),
  load("packages/shared/src/node.ts"),
  source("enterprise-identity/identitySessionStore.ts"),
  source("enterprise-identity/enterpriseIdentityService.ts"),
  source("enterprise-identity/identityServiceLifecycle.ts"),
  source("enterprise-identity/uworkIdentityAdapter.ts"),
  source("enterprise-identity/uworkBackendSession.ts"),
  source("providers/api/nodeApiNetwork.ts"),
  source("enterprise-assets/enterpriseAssetsHost.ts"),
  source("enterprise-identity/uworkToolAuthorization.ts"),
  source("zcode-agent/enterpriseToolAuthorizationBridge.ts"),
  source("zcode-agent/zcodeProtocolClient.ts"),
  source("zcode-agent/zcodeStdioTransport.ts"),
  load("packages/shared/src/index.ts"),
]);
setDefaultCACertificates([
  ...getCACertificates("default"),
  await readFile(init.certificate, "utf8"),
]);
paths.setDataBaseDir(join(init.temporary, "host-home"));
const credentials = credentialModule.createCredentialService({
  cipherProvider: cipherModule.createCredentialCipherProvider({
    env: { ZCODE_CREDENTIAL_SECRET: init.credentialSecret },
  }),
});
const store = sessionModule.createSharedIdentitySessionStore(
  credentials,
  <T>(operation: () => Promise<T>) =>
    sharedNode.withFileLock(join(init.temporary, "identity-store"), operation),
);
const adapter = adapterModule.createUWorkIdentityAdapter({
  backend: "uwork",
  apiBaseUrl: init.origin,
  callbackUrl: init.origin + "/api/auth/wecom/callback",
  organizations: [{ orgId: init.tenantId, corpId: "unused", agentId: "1" }],
});
const identity = identityModule.createEnterpriseIdentityService({
  credentials,
  adapter,
  sessionStore: store,
});
if (init.seed) {
  const previous = await store.read();
  const restored = await adapter.restore(
    {
      token: init.token,
      expiresAt: init.expiresAt,
      issuerOrigin: init.origin,
      profile: {
        id: init.userId,
        tenantId: init.tenantId,
        provider: "wecom",
        displayName: "Owned email session",
      },
    },
    new AbortController().signal,
  );
  assert.ok(restored);
  assert.equal(
    (await store.write(restored, previous.revision, () => true)).accepted,
    true,
  );
}
assert.equal((await identity.restoreSession()).status, "authenticated");
const network = networkModule.createHostApiNetworkTransport(async () => ({
  caCertPath: init.certificate,
  noProxy: "*",
}));
let crashArmed = false;
function observeStage() {
  if (!crashArmed) return;
  const storage = join(init.temporary, "enterprise-storage");
  for (const root of readdirSync(storage)) {
    if (!root.startsWith("enterprise-assets-")) continue;
    for (const name of readdirSync(join(storage, root))) {
      if (!name.startsWith("stage-")) continue;
      const stage = join(storage, root, name);
      if (
        existsSync(join(stage, "content/payload/020/data.txt")) &&
        existsSync(join(stage, ".ownership.json")) &&
        !existsSync(join(stage, "manifest.json"))
      ) {
        crashArmed = false;
        process.send?.({ staged: join(root, name) });
        process.kill(-process.pid, "SIGSTOP");
      }
    }
  }
}
const backend = backendModule.createUWorkBackendSession({
  resolveConfig: async () => ({
    backend: "uwork",
    apiBaseUrl: init.origin,
    organizations: [{ orgId: init.tenantId }],
  }),
  readAuthority: () => {
    const authority = lifecycleModule.readEnterpriseIdentityAuthority(identity);
    // 测试观察器只读取真实stage；保持真实身份值，精确暂停在产品自己的逐文件fence。
    observeStage();
    return authority;
  },
  readPersistedSession: () => store.read(),
  fetchImpl: network.fetch,
});
const cacheEvents: Row[] = [];
const assets = assetsModule.createEnterpriseAssetsHost({
  backendSession: backend,
  storageDirectory: join(init.temporary, "enterprise-storage"),
  onCacheEvent: (event: Row) => cacheEvents.push(event),
});
let lastCatalog: Row | undefined;
const admissions: Row[] = [];
// 仅记录真实结果，授权与目录均由原Host执行，不替换返回值。
const observedAssets = {
  ...assets,
  async readCatalog(...args: unknown[]) {
    const result = await assets.readCatalog(...args);
    lastCatalog = result;
    return result;
  },
  async authorizeAsset(...args: unknown[]) {
    const result = await assets.authorizeAsset(...args);
    admissions.push(result);
    return result;
  },
};
const workspacePath = join(init.temporary, "workspace");
const workspace = {
  workspacePath,
  workspaceIdentity: "g03-concurrency-owned",
  workspaceKey: "g03-concurrency-owned",
};
const child = spawn(
  init.clientNode,
  [
    join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    "app-server",
    "--stdio",
  ],
  {
    cwd: workspacePath,
    stdio: "pipe",
    env: {
      PATH: process.env.PATH,
      HOME: join(init.temporary, "cli-home"),
      USERPROFILE: join(init.temporary, "cli-home"),
      TMPDIR: process.env.TMPDIR,
      ZCODE_STORAGE_DIR: join(init.temporary, `cli-storage-${init.label}`),
      UWORK_DATA_BASE_DIR: join(init.temporary, `cli-data-${init.label}`),
      ZCODE_DATA_BASE_DIR: join(init.temporary, `cli-data-${init.label}`),
      ZCODE_ENV: "test",
      ZCODE_BASE_URL: init.origin,
      ZCODE_MODEL_TELEMETRY_ENABLED: "false",
      [shared.ZCODE_ENTERPRISE_POLICY_REQUIRED_ENV_KEY]: "1",
      [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: workspace.workspaceIdentity,
    },
  },
);
const cliClosed = new Promise<void>((done) => child.once("exit", () => done()));
let wire = "";
child.stdout.on("data", (chunk: Buffer) => {
  wire = (wire + chunk.toString()).slice(-1000000);
});
const transport = new transportModule.ZCodeStdioTransport(child, {
  onStderrLine: (line: string) => {
    wire = (wire + line).slice(-1000000);
  },
});
const client = new protocolModule.ZCodeProtocolClient(transport, {
  requestTimeoutMs: 20000,
});
const bridge = bridgeModule.createEnterpriseToolAuthorizationBridge({
  assets: observedAssets,
  resolver: authModule.createUWorkToolAuthorizationResolver({
    backendSession: backend,
  }),
  isCurrent: () => !client.isDisposed,
});
let catalogRequests = 0,
  admissionRequests = 0;
client.onRequest(
  (request: {
    id: string | number;
    method: string;
    params: unknown;
    trace?: { traceId: string };
  }) => {
    const args = [
      client,
      workspace,
      request.id,
      request.params,
      request.trace?.traceId,
    ];
    if (
      request.method ===
      shared.zcodeProtocolMethods.interactionReadEnterpriseSkills
    ) {
      catalogRequests++;
      void bridge.handleCatalog(...args).catch(() => {});
    } else if (
      request.method ===
      shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
    ) {
      admissionRequests++;
      void bridge.handle(...args).catch(() => {});
    } else
      void client
        .respondError(request.id, {
          code: -32601,
          message: "unexpected owned request",
        })
        .catch(() => {});
  },
);
client.onNotification((message: { method: string; params: unknown }) => {
  if (
    message.method ===
    shared.zcodeProtocolNotifications.enterpriseToolAuthorizationCancelled
  )
    bridge.cancel(client, workspace, message.params);
});
const stats = () => ({
  catalogRequests,
  admissionRequests,
  admissions,
  cacheEvents,
  secretLeak: wire.includes(init.token) || wire.includes(init.credentialSecret),
});
process.on(
  "message",
  (message: { id: number; command: string; reference?: unknown }) => {
    void (async () => {
      if (message.command === "arm-crash") {
        crashArmed = true;
        process.send?.({ id: message.id, armed: true });
      } else if (message.command === "stop") {
        await client.disposeAndWait();
        await cliClosed;
        await assets.disposeAllAndWait();
        await lifecycleModule.disposeEnterpriseIdentityService(identity);
        await network.disposeAndWait();
        process.send?.({
          id: message.id,
          stats: stats(),
          cliExitCode: child.exitCode,
          cliExitSignal: child.signalCode,
        });
        process.disconnect();
      } else if (message.command === "authorize") {
        const decision = await assets.authorizeAsset(
          message.reference,
          "g03-stale-reference",
        );
        process.send?.({ id: message.id, decision });
      } else {
        let catalog: unknown;
        let rejected = false;
        try {
          catalog = await client.request(
            shared.zcodeProtocolMethods.skillsReferenceCatalog,
            { workspace },
            shared.zcodeSkillsReferenceCatalogResultSchema,
            {
              timeoutMs: 20000,
              lifecycle: "observation",
              trace: { traceId: `g03-${init.label}-${message.id}` },
            },
          );
        } catch {
          rejected = true;
        }
        process.send?.({
          id: message.id,
          rejected,
          catalog,
          hostCatalog: lastCatalog,
          stats: stats(),
        });
      }
    })().catch(() => {
      process.send?.({
        id: message.id,
        harnessError: "owned_worker_command_failed",
      });
    });
  },
);
process.send?.({
  ready: true,
  hostPid: process.pid,
  cliPid: child.pid,
  hostNode: process.version,
});
