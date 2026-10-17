import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
type CatalogResult = { skills: { name: string }[] };
const clientRoot = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
assert.equal(
  clientRoot,
  resolve("clients/uwork"),
  "client source must remain inside this repository",
);
const evidence = resolve("evidence/client-assets-identity-20261017");
const load = (path: string) =>
  import(pathToFileURL(join(clientRoot, path)).href);
const source = (path: string) => load(`packages/services/src/${path}`);
const deferred = () => {
  let done!: () => void;
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { promise, resolve: done };
};
async function bounded<T>(work: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("owned asset identity operation timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function fixture(t: TestContext, label: string) {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-assets-identity-")),
  );
  const cleanup: (() => Promise<void> | void)[] = [];
  const checks: string[] = [],
    observations: Row[] = [],
    secrets: string[] = [];
  const traffic: { method: string; route: string; status: number }[] = [];
  let clientsStarted = 0,
    clientsClosed = 0,
    allPortsClosed = false;
  const ports: number[] = [];
  // 所有业务都经真实HTTP；仅bootstrap和已有用户跨租户初始membership由fixture函数/SQL建立。
  t.after(async () => {
    const errors: string[] = [];
    for (const action of cleanup.reverse()) {
      try {
        await action();
      } catch {
        errors.push("owned_cleanup_failed");
      }
    }
    const closed = await Promise.all(
      ports.map(
        (port) =>
          new Promise<boolean>((done) => {
            const socket = createConnection(port, "127.0.0.1");
            socket.once("error", () => done(true));
            socket.once("connect", () => {
              socket.destroy();
              done(false);
            });
          }),
      ),
    );
    allPortsClosed = closed.every(Boolean);
    await rm(temporary, { recursive: true, force: true });
    await writeFile(
      join(evidence, `${label}.json`),
      JSON.stringify(
        {
          boundary:
            "actual TCP/TLS, public email sessions and actual encrypted identity owner; actual Host cache/lifecycle and packaged CLI stdio; two TLS origins for same backend prove issuer partition; no actual WeCom/MCP/drive/models/main env",
          fixtureSetup:
            "bootstrap creates two tenants; one initial membership joins existing A user into B via fixture SQL; all later business writes and switch/logout/login via HTTP",
          checks,
          observations,
          traffic,
          node: process.version,
          cli: { started: clientsStarted, closed: clientsClosed },
          cleanup: {
            portsClosed: closed,
            allPortsClosed,
            ownedDirectoryRemoved: true,
            errors,
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    assert.deepEqual(errors, []);
    assert.ok(allPortsClosed);
    assert.equal(clientsClosed, clientsStarted);
  });
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
    assetsLifecycleModule,
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
    source("enterprise-assets/enterpriseAssetsLifecycle.ts"),
    source("enterprise-identity/uworkToolAuthorization.ts"),
    source("zcode-agent/enterpriseToolAuthorizationBridge.ts"),
    source("zcode-agent/zcodeProtocolClient.ts"),
    source("zcode-agent/zcodeStdioTransport.ts"),
    load("packages/shared/src/index.ts"),
  ]);
  paths.setDataBaseDir(join(temporary, "host-home"));
  cleanup.push(() => paths.setDataBaseDir(null));
  const app = await createApp({
    database: join(temporary, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
    wecomProvider: {
      async identity() {
        throw new Error("excluded WeCom provider");
      },
      async directory() {
        throw new Error("excluded WeCom provider");
      },
    },
  });
  cleanup.push(() => app.close());
  let delayedAsset: string | undefined;
  let reached = deferred(),
    release = deferred();
  cleanup.push(() => release.resolve());
  app.addHook("onSend", async (req, _reply, body) => {
    if (
      delayedAsset &&
      req.url.startsWith(`/api/client/assets/${delayedAsset}/download`)
    ) {
      delayedAsset = undefined;
      reached.resolve();
      await release.promise;
    }
    return body;
  });
  app.addHook("onResponse", async (req, reply) => {
    traffic.push({
      method: req.method,
      route: req.routeOptions.url ?? "unknown",
      status: reply.statusCode,
    });
  });
  const password = randomBytes(24).toString("hex");
  secrets.push(password);
  const a = await bootstrap(app.services.db, {
    name: "Asset tenant A",
    email: "asset-member@example.test",
    password,
  });
  const b = await bootstrap(app.services.db, {
    name: "Asset tenant B",
    email: "asset-admin-b@example.test",
    password,
  });
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'member',1)",
    b.tenantId,
    a.userId,
  );
  const backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  ports.push(Number(new URL(backendOrigin).port));
  const certificate = join(temporary, "certificate.pem"),
    privateKey = join(temporary, "key.pem");
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
  cleanup.push(() => setDefaultCACertificates(previousCAs));
  async function proxy() {
    const server = createHttpsServer(
      { cert: await readFile(certificate), key: await readFile(privateKey) },
      (req, res) => {
        const upstream = httpRequest(
          {
            hostname: "127.0.0.1",
            port: Number(new URL(backendOrigin).port),
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          },
        );
        req.on("aborted", () => upstream.destroy());
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        req.pipe(upstream);
      },
    );
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    ports.push(port);
    cleanup.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    });
    return `https://127.0.0.1:${port}`;
  }
  const primary = await proxy(),
    secondary = await proxy();
  async function api<T = Row>(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    expected = 200,
    origin = primary,
  ): Promise<T> {
    assert.ok(
      !path.includes("wecom") &&
        !path.includes("connectors") &&
        !path.includes("drive"),
    );
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected, `${method} ${path} status`);
    const value = expected === 204 ? undefined : await response.json();
    if (value && typeof value === "object" && typeof value.token === "string")
      secrets.push(value.token);
    return value as T;
  }
  const login = async (
    tenantId: string,
    email = "asset-member@example.test",
    origin = primary,
  ) => {
    const issued = await api<{ token: string; expiresAt: number }>(
      "/api/auth/login",
      "POST",
      { email, password, tenantId },
      undefined,
      200,
      origin,
    );
    secrets.push(issued.token);
    return issued;
  };
  const adminA = await login(a.tenantId),
    adminB = await login(b.tenantId, "asset-admin-b@example.test");
  async function publish(
    tenantId: string,
    token: string,
    kind: string,
    patch: Row,
  ) {
    const path = `/api/tenants/${tenantId}/configurations/${kind}`,
      current = await api(path, "GET", undefined, token);
    const saved = await api(
      path,
      "PUT",
      {
        revision: current.revision,
        data: { ...(current.published as Row), ...patch },
      },
      token,
    );
    await api(path + "/publish", "POST", { revision: saved.revision }, token);
  }
  for (const [tenant, token] of [
    [a.tenantId, adminA.token],
    [b.tenantId, adminB.token],
  ])
    await publish(tenant!, token!, "security", {
      allowFilesystem: true,
      dangerousSkills: false,
    });
  async function skill(tenantId: string, token: string, marker: string) {
    const content = {
      files: [
        {
          path: "SKILL.md",
          content: `---\nname: shared-display-name\ndescription: G01 ${marker}\n---\nAPPROVED_${marker}`,
        },
      ],
      highRisk: false,
    };
    const created = await api(
      `/api/tenants/${tenantId}/assets`,
      "POST",
      {
        name: "Shared display name",
        kind: "skill",
        scope: { all: true },
        content,
      },
      token,
      201,
    );
    for (const operation of ["review", "publish"])
      await api(
        `/api/tenants/${tenantId}/assets/${created.id}/${operation}`,
        "POST",
        { version: 1, ...(operation === "review" ? { approved: true } : {}) },
        token,
      );
    return { id: String(created.id), content };
  }
  const assetA = await skill(a.tenantId, adminA.token, "TENANT_A"),
    assetB = await skill(b.tenantId, adminB.token, "TENANT_B");
  const credentials = credentialModule.createCredentialService({
    cipherProvider: cipherModule.createCredentialCipherProvider({
      env: { ZCODE_CREDENTIAL_SECRET: randomBytes(32).toString("hex") },
    }),
  });
  const store = sessionModule.createSharedIdentitySessionStore(
    credentials,
    <T>(operation: () => Promise<T>) =>
      sharedNode.withFileLock(join(temporary, "identity-store"), operation),
  );
  const network = networkModule.createHostApiNetworkTransport(async () => ({
    caCertPath: certificate,
    noProxy: "*",
  }));
  cleanup.push(() => network.disposeAndWait());
  const storage = join(temporary, "enterprise-storage"),
    workspacePath = join(temporary, "workspace"),
    home = join(temporary, "cli-home");
  for (const path of [storage, workspacePath, home])
    await mkdir(path, { recursive: true });
  const personalSentinel = join(workspacePath, "personal-preserved.txt");
  await writeFile(personalSentinel, "owned personal data must not be pruned");
  const bundle = join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
  await access(bundle);
  const bundleHash = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex");
  observations.push({ cliBundleSha256: bundleHash });
  async function host(origin: string) {
    const adapter = adapterModule.createUWorkIdentityAdapter({
      backend: "uwork",
      apiBaseUrl: origin,
      callbackUrl: origin + "/api/auth/wecom/callback",
      organizations: [
        { orgId: a.tenantId, corpId: "unused-a", agentId: "1" },
        { orgId: b.tenantId, corpId: "unused-b", agentId: "2" },
      ],
    });
    const identity = identityModule.createEnterpriseIdentityService({
      credentials,
      adapter,
      sessionStore: store,
    });
    const backend = backendModule.createUWorkBackendSession({
      resolveConfig: async () => ({
        backend: "uwork",
        apiBaseUrl: origin,
        organizations: [{ orgId: a.tenantId }, { orgId: b.tenantId }],
      }),
      readAuthority: () =>
        lifecycleModule.readEnterpriseIdentityAuthority(identity),
      readPersistedSession: () => store.read(),
      fetchImpl: network.fetch,
    });
    const events: { operation: string; status: string }[] = [];
    const assets = assetsModule.createEnterpriseAssetsHost({
      backendSession: backend,
      storageDirectory: storage,
      onCacheEvent: (event: { operation: string; status: string }) =>
        events.push({ operation: event.operation, status: event.status }),
    });
    const maintenance = assetsLifecycleModule.attachEnterpriseAssetsLifecycle({
      identity,
      assets,
      readAuthority: () =>
        lifecycleModule.readEnterpriseIdentityAuthority(identity),
    });
    let disposed = false;
    const stop = async () => {
      if (disposed) return;
      disposed = true;
      await maintenance.disposeAllAndWait();
      await lifecycleModule.disposeEnterpriseIdentityService(identity);
    };
    cleanup.push(stop);
    async function seed(
      tenantId: string,
      issued: { token: string; expiresAt: number },
    ) {
      const previous = await store.read();
      const session = await adapter.restore(
        {
          token: issued.token,
          expiresAt: issued.expiresAt,
          issuerOrigin: origin,
          profile: {
            id: a.userId,
            tenantId,
            provider: "wecom",
            displayName: "Synthetic asset member",
          },
        },
        new AbortController().signal,
      );
      assert.ok(session);
      assert.ok(
        (await store.write(session, previous.revision, () => true)).accepted,
      );
      assert.equal((await identity.restoreSession()).status, "authenticated");
    }
    async function cli() {
      const workspace = {
        workspacePath,
        workspaceIdentity: "g01-owned",
        workspaceKey: "g01-owned",
      };
      const child = spawn(process.execPath, [bundle, "app-server", "--stdio"], {
        cwd: workspacePath,
        detached: process.platform !== "win32",
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          TMPDIR: process.env.TMPDIR,
          ZCODE_STORAGE_DIR: join(temporary, "cli-storage"),
          UWORK_DATA_BASE_DIR: join(temporary, "cli-data"),
          ZCODE_DATA_BASE_DIR: join(temporary, "cli-data"),
          ZCODE_ENV: "test",
          ZCODE_BASE_URL: origin,
          ZCODE_MODEL_TELEMETRY_ENABLED: "false",
          [shared.ZCODE_ENTERPRISE_POLICY_REQUIRED_ENV_KEY]: "1",
          [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: workspace.workspaceIdentity,
        },
      });
      clientsStarted++;
      const stdout: Buffer[] = [],
        stderr: string[] = [];
      child.stdout.on("data", (chunk: Buffer) =>
        stdout.push(Buffer.from(chunk)),
      );
      const transport = new transportModule.ZCodeStdioTransport(child, {
        onStderrLine: (line: string) => {
          if (stderr.length < 100) stderr.push(line);
        },
        ...(process.platform === "win32"
          ? {}
          : {
              ownedProcessGroupId: child.pid,
              ownedProcessStartedAtMs: Date.now(),
            }),
      });
      const client = new protocolModule.ZCodeProtocolClient(transport, {
        requestTimeoutMs: 20000,
      });
      const bridge = bridgeModule.createEnterpriseToolAuthorizationBridge({
        assets,
        resolver: authModule.createUWorkToolAuthorizationResolver({
          backendSession: backend,
        }),
        isCurrent: () => !client.isDisposed,
      });
      let catalogRequests = 0,
        admissions = 0;
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
            admissions++;
            void bridge.handle(...args).catch(() => {});
          } else
            void client
              .respondError(request.id, {
                code: -32601,
                message: "unexpected controlled request",
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
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await client.disposeAndWait();
        if (child.exitCode === null && child.signalCode === null)
          await bounded(
            new Promise<void>((done) => child.once("exit", () => done())),
            5000,
          );
        const wire = Buffer.concat(stdout).toString() + stderr.join("\n");
        for (const secret of secrets)
          assert.equal(
            wire.includes(secret),
            false,
            "credentials must not reach child protocol/stderr",
          );
        observations.push({
          catalogRequests,
          admissions,
          cliExitCode: child.exitCode,
          cliExitSignal: child.signalCode,
          secretLeak: false,
        });
        clientsClosed++;
      };
      cleanup.push(close);
      return {
        close,
        catalog: async (): Promise<CatalogResult> => {
          const result = await bounded(
            client.request(
              shared.zcodeProtocolMethods.skillsReferenceCatalog,
              { workspace },
              shared.zcodeSkillsReferenceCatalogResultSchema,
              {
                timeoutMs: 20000,
                lifecycle: "observation",
                trace: { traceId: "g01-assets" },
              },
            ),
          );
          return shared.zcodeSkillsReferenceCatalogResultSchema.parse(
            result,
          ) as CatalogResult;
        },
      };
    }
    return { identity, assets, events, seed, cli, stop, origin };
  }
  async function setAssetEnabled(enabled: boolean) {
    const rows = await api<{ items: Row[] }>(
      `/api/tenants/${a.tenantId}/assets`,
      "GET",
      undefined,
      adminA.token,
    );
    const row = rows.items.find((item) => item.id === assetA.id)!;
    await api(
      `/api/tenants/${a.tenantId}/assets/${assetA.id}`,
      "PUT",
      {
        name: "Shared display name",
        kind: "skill",
        scope: { all: true },
        revision: row.revision,
        content: assetA.content,
        enabled,
      },
      adminA.token,
    );
  }
  return {
    a,
    b,
    assetA,
    assetB,
    primary,
    secondary,
    adminA,
    adminB,
    api,
    login,
    host,
    checks,
    observations,
    storage,
    personalSentinel,
    setAssetEnabled,
    delayDownload: (id: string) => {
      delayedAsset = id;
      reached = deferred();
      release = deferred();
      return { reached: reached.promise, release: release.resolve };
    },
    assertSentinel: async () =>
      assert.equal(
        await readFile(personalSentinel, "utf8"),
        "owned personal data must not be pruned",
      ),
    verifyBundle: async () =>
      assert.equal(
        createHash("sha256")
          .update(await readFile(bundle))
          .digest("hex"),
        bundleHash,
      ),
  };
}

async function ready(
  host: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["host"]>>,
  trace: string,
  expectedAssets = 1,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await host.assets.readCatalog(`${trace}-${attempt}`);
    if (result.status === "ready") {
      assert.equal(result.assets.length, expectedAssets);
      return result;
    }
    assert.equal(
      result.code,
      "enterprise_asset_selection_changed",
      `only the documented concurrent-prewarm retry is accepted: ${result.code}`,
    );
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("concurrent prewarm did not settle");
}

test(
  "current identity owner switches tenant assets and rejects delayed prior-owner downloads in the actual CLI",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "tenant-switch"),
      host = await f.host(f.primary);
    await host.seed(f.a.tenantId, await f.login(f.a.tenantId));
    const first = await ready(host, "g01-a-first"),
      cli = await host.cli();
    assert.deepEqual(
      (await cli.catalog()).skills.map((item: { name: string }) => item.name),
      [`enterprise:${f.assetA.id}`],
    );
    assert.match(
      await readFile(join(first.assets[0].directory, "SKILL.md"), "utf8"),
      /APPROVED_TENANT_A/,
    );
    const rows = await f.api<{ items: Row[] }>(
      `/api/tenants/${f.a.tenantId}/assets`,
      "GET",
      undefined,
      f.adminA.token,
    );
    const row = rows.items.find((item) => item.id === f.assetA.id)!;
    await f.api(
      `/api/tenants/${f.a.tenantId}/assets/${f.assetA.id}`,
      "PUT",
      {
        name: "Shared display name",
        kind: "skill",
        scope: { all: true },
        revision: row.revision,
        content: {
          files: [
            {
              path: "SKILL.md",
              content:
                "---\nname: shared-display-name\ndescription: new A\n---\nAPPROVED_A_NEW",
            },
          ],
          highRisk: false,
        },
      },
      f.adminA.token,
    );
    for (const operation of ["review", "publish"])
      await f.api(
        `/api/tenants/${f.a.tenantId}/assets/${f.assetA.id}/${operation}`,
        "POST",
        { version: 2, ...(operation === "review" ? { approved: true } : {}) },
        f.adminA.token,
      );
    const held = f.delayDownload(f.assetA.id),
      loading = host.assets
        .readCatalog("g01-a-held")
        .catch(() => ({ status: "denied" }));
    await bounded(held.reached);
    const currentA = await f.login(f.a.tenantId);
    const switched = await f.api<{ token: string; expiresAt: number }>(
      "/api/auth/switch",
      "POST",
      { tenantId: f.b.tenantId },
      currentA.token,
    );
    await f.api("/api/auth/me", "GET", undefined, currentA.token, 401);
    await host.identity.logout();
    await host.seed(f.b.tenantId, switched);
    const second = await ready(host, "g01-b-current");
    held.release();
    assert.equal((await loading).status, "denied");
    assert.notEqual(
      dirname(first.assets[0].directory),
      dirname(second.assets[0].directory),
    );
    assert.match(
      await readFile(join(second.assets[0].directory, "SKILL.md"), "utf8"),
      /APPROVED_TENANT_B/,
    );
    assert.equal(
      (
        await host.assets.authorizeAsset(
          first.assets[0],
          "g01-old-a",
          undefined,
          first.ownerKey,
        )
      ).allowed,
      false,
    );
    assert.equal(
      (
        await host.assets.authorizeAsset(
          second.assets[0],
          "g01-b-allowed",
          undefined,
          second.ownerKey,
        )
      ).allowed,
      true,
    );
    assert.deepEqual(
      (await cli.catalog()).skills.map((item: { name: string }) => item.name),
      [`enterprise:${f.assetB.id}`],
    );
    assert.match(
      await readFile(join(second.assets[0].directory, "SKILL.md"), "utf8"),
      /APPROVED_TENANT_B/,
    );
    const switchedBack = await f.api<{ token: string; expiresAt: number }>(
      "/api/auth/switch",
      "POST",
      { tenantId: f.a.tenantId },
      switched.token,
    );
    await host.identity.logout();
    await host.seed(f.a.tenantId, switchedBack);
    const returnedA = await ready(host, "g01-back-to-a");
    assert.match(
      await readFile(join(returnedA.assets[0].directory, "SKILL.md"), "utf8"),
      /APPROVED_A_NEW/,
    );
    assert.equal(
      (
        await host.assets.authorizeAsset(
          second.assets[0],
          "g01-old-b",
          undefined,
          second.ownerKey,
        )
      ).allowed,
      false,
    );
    assert.equal(
      (await host.assets.authorizeAsset(first.assets[0], "g01-old-a-version"))
        .allowed,
      false,
    );
    assert.deepEqual(
      (await cli.catalog()).skills.map((item) => item.name),
      [`enterprise:${f.assetA.id}`],
    );
    await f.assertSentinel();
    await f.verifyBundle();
    f.checks.push(
      "real interactive owner and public organization switch partition cache and CLI; late A cannot publish/prune B",
      "switch back to A selects newly published version; stale B and A previous version references remain denied in the same CLI",
    );
  },
);

test(
  "Host cold restart retains only currently admitted cache and issuer partition rejects identical old references",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "issuer-restart-logout"),
      firstHost = await f.host(f.primary);
    await firstHost.seed(f.a.tenantId, await f.login(f.a.tenantId));
    const first = await ready(firstHost, "g01-initial");
    const cli1 = await firstHost.cli();
    await cli1.catalog();
    await cli1.close();
    await firstHost.stop();
    await access(join(first.assets[0].directory, "SKILL.md"));
    await f.setAssetEnabled(false);
    const restarted = await f.host(f.primary);
    assert.equal(
      (await restarted.identity.restoreSession()).status,
      "authenticated",
    );
    await ready(restarted, "g01-cold-restart-revoked", 0);
    assert.equal(
      (
        await restarted.assets.authorizeAsset(
          first.assets[0],
          "g01-restart-revoked",
        )
      ).allowed,
      false,
    );
    const cli2 = await restarted.cli();
    assert.deepEqual((await cli2.catalog()).skills, []);
    f.checks.push(
      "cold restart cannot serve still-cached bytes after actual backend asset disable; Host and CLI current catalog and admission reject",
    );
    await f.setAssetEnabled(true);
    const restored = await ready(restarted, "g01-cold-restart");
    assert.equal(restored.assets[0].directory, first.assets[0].directory);
    assert.equal(
      (
        await restarted.assets.authorizeAsset(
          first.assets[0],
          "g01-restart-current-owner",
          undefined,
          restored.ownerKey,
        )
      ).allowed,
      true,
    );
    assert.deepEqual(
      (await cli2.catalog()).skills.map((item: { name: string }) => item.name),
      [`enterprise:${f.assetA.id}`],
    );
    await cli2.close();
    await restarted.stop();
    const secondHost = await f.host(f.secondary);
    assert.equal(
      (await secondHost.identity.restoreSession()).status,
      "signed-out",
      "a different issuer cannot restore the previous issuer session",
    );
    await secondHost.seed(
      f.a.tenantId,
      await f.login(f.a.tenantId, "asset-member@example.test", f.secondary),
    );
    const otherIssuer = await ready(secondHost, "g01-second-issuer");
    assert.equal(
      otherIssuer.assets[0].key,
      first.assets[0].key,
      "same backend immutable content intentionally shares object key",
    );
    assert.notEqual(
      otherIssuer.assets[0].directory,
      first.assets[0].directory,
      "origin is part of cache ownership",
    );
    assert.equal(
      (
        await secondHost.assets.authorizeAsset(
          first.assets[0],
          "g01-foreign-issuer-path",
        )
      ).allowed,
      false,
    );
    assert.equal(
      (
        await secondHost.assets.authorizeAsset(
          otherIssuer.assets[0],
          "g01-own-issuer",
          undefined,
          otherIssuer.ownerKey,
        )
      ).allowed,
      true,
    );
    const cli3 = await secondHost.cli();
    assert.deepEqual(
      (await cli3.catalog()).skills.map((item: { name: string }) => item.name),
      [`enterprise:${f.assetA.id}`],
    );
    await secondHost.identity.logout();
    await bounded(
      (async () => {
        for (let i = 0; i < 200; i++) {
          try {
            await access(join(otherIssuer.assets[0].directory, "SKILL.md"));
          } catch {
            return;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
        throw new Error("owned logout cache was not pruned");
      })(),
    );
    assert.equal(
      (
        await secondHost.assets.authorizeAsset(
          otherIssuer.assets[0],
          "g01-logged-out",
        )
      ).allowed,
      false,
    );
    await assert.rejects(() => cli3.catalog());
    await f.assertSentinel();
    await f.verifyBundle();
    f.checks.push(
      "real encrypted-store cold restore reauthorizes existing bytes; issuer changes partition identical asset; actual logout removes touched cache and CLI denies",
    );
  },
);
