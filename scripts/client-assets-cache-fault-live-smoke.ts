import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
type Catalog = { skills: { name: string }[] };
type Reference = {
  key: string;
  directory: string;
  asset: { id: string; kind: "skill"; version: number; checksum: string };
};
type ReadyCatalog = { status: "ready"; assets: Reference[]; ownerKey: string };
const clientRoot = resolve("clients/uwork");
const evidence = resolve("evidence/client-assets-cache-fault-20261017");
const load = (path: string) =>
  import(pathToFileURL(join(clientRoot, path)).href);
const source = (path: string) => load(`packages/services/src/${path}`);

async function bounded<T>(work: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("owned cache fault operation timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(t: TestContext, label: string) {
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-cache-fault-")),
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const cleanup: (() => Promise<void> | void)[] = [];
  const traffic: { method: string; route: string; status: number }[] = [];
  const observations: Row[] = [];
  const secrets: string[] = [];
  const ports: number[] = [];
  let children = 0,
    childrenClosed = 0;
  t.after(async () => {
    const errors: string[] = [];
    for (const action of cleanup.reverse()) {
      try {
        await action();
      } catch {
        errors.push("owned_cleanup_failed");
      }
    }
    const portsClosed = await Promise.all(
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
    await rm(temporary, { recursive: true, force: true });
    await writeFile(
      join(evidence, `${label}.json`),
      JSON.stringify(
        {
          boundary:
            "actual TCP/TLS, synthetic public email identity restored into production encrypted identity owner, production Host+bridge and packaged CLI; faults are physical owned filesystem writes after a real Host catalog and before real CLI admission; no mocked HTTP/RPC results",
          fixtureSetup:
            "bootstrap tenant; only fault injection/quarantine write cache bytes directly; all configuration/asset/login business writes use HTTP",
          label,
          node: process.version,
          observations,
          traffic,
          cleanup: {
            portsClosed,
            children,
            childrenClosed,
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
    assert.ok(portsClosed.every(Boolean));
    assert.equal(childrenClosed, children);
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
    maintenanceModule,
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
        throw new Error("excluded WeCom");
      },
      async directory() {
        throw new Error("excluded WeCom");
      },
    },
  });
  cleanup.push(() => app.close());
  app.addHook("onResponse", async (req, reply) => {
    traffic.push({
      method: req.method,
      route: req.routeOptions.url ?? "unknown",
      status: reply.statusCode,
    });
  });
  const password = randomBytes(24).toString("hex");
  secrets.push(password);
  const user = await bootstrap(app.services.db, {
    name: "G03 owned tenant",
    email: "cache-fault@example.test",
    password,
  });
  const upstreamOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  const upstreamPort = Number(new URL(upstreamOrigin).port);
  ports.push(upstreamPort);
  const certificate = join(temporary, "certificate.pem"),
    privateKey = join(temporary, "private.pem");
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
  const server = createServer(
    { cert: await readFile(certificate), key: await readFile(privateKey) },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: upstreamPort,
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
  const origin = `https://127.0.0.1:${port}`;
  async function api<T = Row>(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    status = 200,
  ): Promise<T> {
    assert.ok(!/wecom|connectors|drive/.test(path));
    const response = await fetch(origin + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    const result = await response.json();
    if (typeof result.token === "string") secrets.push(result.token);
    return result as T;
  }
  const issued = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    { tenantId: user.tenantId, email: "cache-fault@example.test", password },
  );
  const path = `/api/tenants/${user.tenantId}/configurations/security`;
  const config = await api(path, "GET", undefined, issued.token);
  const saved = await api(
    path,
    "PUT",
    {
      revision: config.revision,
      data: {
        ...(config.published as Row),
        allowFilesystem: true,
        dangerousSkills: false,
      },
    },
    issued.token,
  );
  await api(
    path + "/publish",
    "POST",
    { revision: saved.revision },
    issued.token,
  );
  const skillText =
    "---\nname: owned-cache-fault\ndescription: G03 immutable approved content\n---\nAPPROVED_G03_CONTENT";
  const attachment = "APPROVED_G03_ATTACHMENT";
  const created = await api(
    `/api/tenants/${user.tenantId}/assets`,
    "POST",
    {
      name: "G03 cache fault",
      kind: "skill",
      scope: { all: true },
      content: {
        files: [
          { path: "SKILL.md", content: skillText },
          { path: "data/reference.txt", content: attachment },
        ],
        highRisk: false,
      },
    },
    issued.token,
    201,
  );
  for (const operation of ["review", "publish"])
    await api(
      `/api/tenants/${user.tenantId}/assets/${created.id}/${operation}`,
      "POST",
      { version: 1, ...(operation === "review" ? { approved: true } : {}) },
      issued.token,
    );
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
    home = join(temporary, "cli-home"),
    foreign = join(temporary, "foreign");
  for (const directory of [storage, workspacePath, home, foreign])
    await mkdir(directory, { recursive: true });
  const sentinel = join(workspacePath, "personal-preserved.txt");
  await writeFile(sentinel, "PERSONAL_PRESERVED");
  await writeFile(join(foreign, "SKILL.md"), skillText);
  await mkdir(join(foreign, "data"));
  await writeFile(join(foreign, "data/reference.txt"), attachment);
  await writeFile(join(foreign, "foreign-preserved.txt"), "FOREIGN_PRESERVED");
  const bundle = join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
  await access(bundle);
  const bundleHash = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex");
  observations.push({ cliBundleSha256: bundleHash });
  async function host(seed = false) {
    const adapter = adapterModule.createUWorkIdentityAdapter({
      backend: "uwork",
      apiBaseUrl: origin,
      callbackUrl: origin + "/api/auth/wecom/callback",
      organizations: [{ orgId: user.tenantId, corpId: "unused", agentId: "1" }],
    });
    const identity = identityModule.createEnterpriseIdentityService({
      credentials,
      adapter,
      sessionStore: store,
    });
    if (seed) {
      const previous = await store.read();
      const restored = await adapter.restore(
        {
          token: issued.token,
          expiresAt: issued.expiresAt,
          issuerOrigin: origin,
          profile: {
            id: user.userId,
            tenantId: user.tenantId,
            provider: "wecom",
            displayName: "G03 synthetic email identity",
          },
        },
        new AbortController().signal,
      );
      assert.ok(restored);
      assert.ok(
        (await store.write(restored, previous.revision, () => true)).accepted,
      );
    }
    const backend = backendModule.createUWorkBackendSession({
      resolveConfig: async () => ({
        backend: "uwork",
        apiBaseUrl: origin,
        organizations: [{ orgId: user.tenantId }],
      }),
      readAuthority: () =>
        lifecycleModule.readEnterpriseIdentityAuthority(identity),
      readPersistedSession: () => store.read(),
      fetchImpl: network.fetch,
    });
    const assets = assetsModule.createEnterpriseAssetsHost({
      backendSession: backend,
      storageDirectory: storage,
    });
    const maintenance = maintenanceModule.attachEnterpriseAssetsLifecycle({
      identity,
      assets,
      readAuthority: () =>
        lifecycleModule.readEnterpriseIdentityAuthority(identity),
    });
    assert.equal((await identity.restoreSession()).status, "authenticated");
    let disposed = false;
    const stop = async () => {
      if (disposed) return;
      disposed = true;
      await maintenance.disposeAllAndWait();
      await lifecycleModule.disposeEnterpriseIdentityService(identity);
    };
    cleanup.push(stop);
    let fault: ((catalog: ReadyCatalog) => Promise<void>) | undefined;
    const admissions: { allowed: boolean; code: string }[] = [];
    // 只在真实目录返回与真实CLI逐次准入之间注入磁盘故障，不替换任何生产结果。
    const instrumentedAssets = {
      ...assets,
      async readCatalog(trace: string, signal?: AbortSignal) {
        const result = await assets.readCatalog(trace, signal);
        if (result.status === "ready" && fault) {
          const inject = fault;
          fault = undefined;
          await inject(result);
        }
        return result;
      },
      async authorizeAsset(...args: unknown[]) {
        const result = await assets.authorizeAsset(...args);
        admissions.push({ allowed: result.allowed, code: result.code });
        return result;
      },
    };
    async function cli() {
      const workspace = {
        workspacePath,
        workspaceIdentity: "g03-owned",
        workspaceKey: "g03-owned",
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
      children++;
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
        assets: instrumentedAssets,
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
          assert.equal(wire.includes(secret), false);
        assert.equal(wire.includes("TAMPERED_G03_CONTENT"), false);
        assert.equal(wire.includes("FOREIGN_PRESERVED"), false);
        observations.push({
          catalogRequests,
          admissionRequests,
          cliExitCode: child.exitCode,
          cliExitSignal: child.signalCode,
          secretLeak: false,
        });
        childrenClosed++;
      };
      cleanup.push(close);
      return {
        close,
        async catalog(): Promise<Catalog> {
          const result = await bounded(
            client.request(
              shared.zcodeProtocolMethods.skillsReferenceCatalog,
              { workspace },
              shared.zcodeSkillsReferenceCatalogResultSchema,
              {
                timeoutMs: 20000,
                lifecycle: "observation",
                trace: { traceId: "g03-cache-fault" },
              },
            ),
          );
          return shared.zcodeSkillsReferenceCatalogResultSchema.parse(
            result,
          ) as Catalog;
        },
      };
    }
    return {
      assets,
      stop,
      cli,
      admissions,
      injectAfterCatalog: (
        operation: (catalog: ReadyCatalog) => Promise<void>,
      ) => {
        fault = operation;
      },
    };
  }
  return {
    host,
    temporary,
    foreign,
    observations,
    skillText,
    attachment,
    id: String(created.id),
    downloads: () =>
      traffic.filter((row) => row.route === "/api/client/assets/:id/download")
        .length,
    async preserve() {
      assert.equal(await readFile(sentinel, "utf8"), "PERSONAL_PRESERVED");
      assert.equal(
        await readFile(join(foreign, "SKILL.md"), "utf8"),
        skillText,
      );
      assert.equal(
        await readFile(join(foreign, "data/reference.txt"), "utf8"),
        attachment,
      );
      assert.equal(
        await readFile(join(foreign, "foreign-preserved.txt"), "utf8"),
        "FOREIGN_PRESERVED",
      );
      assert.equal(
        createHash("sha256")
          .update(await readFile(bundle))
          .digest("hex"),
        bundleHash,
      );
    },
  };
}

async function ready(
  host: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["host"]>>,
): Promise<ReadyCatalog> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await host.assets.readCatalog(`g03-ready-${attempt}`);
    if (result.status === "ready") {
      assert.equal(result.assets.length, 1);
      return result as ReadyCatalog;
    }
    assert.equal(result.code, "enterprise_asset_selection_changed");
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("owned prewarm did not settle");
}

for (const kind of [
  "tampered-bytes",
  "missing-file",
  "symlink-directory",
] as const) {
  test(
    `actual CLI rejects ${kind}; cold Host keeps fault closed and explicit owned quarantine permits fresh recovery`,
    { timeout: 60000 },
    async (t) => {
      const f = await fixture(t, kind),
        warm = await f.host(true),
        initial = await ready(warm),
        cli = await warm.cli();
      assert.deepEqual(
        (await cli.catalog()).skills.map((item) => item.name),
        [`enterprise:${f.id}`],
      );
      assert.ok(warm.admissions.filter((item) => item.allowed).length >= 2);
      const expectedCode = {
        "tampered-bytes": "enterprise_asset_checksum",
        "missing-file": "enterprise_asset_tree_unsafe",
        "symlink-directory": "enterprise_asset_path_unsafe",
      }[kind];
      const reference = initial.assets[0]!,
        content = reference.directory,
        profileRoot = dirname(dirname(content));
      let injected = false;
      const assertFault = async (root = content) => {
        if (kind === "tampered-bytes")
          assert.equal(
            await readFile(join(root, "SKILL.md"), "utf8"),
            "TAMPERED_G03_CONTENT",
          );
        else if (kind === "missing-file") {
          await assert.rejects(access(join(root, "data/reference.txt")), {
            code: "ENOENT",
          });
          assert.equal(
            await readFile(join(root, "SKILL.md"), "utf8"),
            f.skillText,
          );
        } else assert.equal((await lstat(root)).isSymbolicLink(), true);
      };
      warm.injectAfterCatalog(async (catalog) => {
        assert.equal(catalog.assets[0]!.directory, content);
        if (kind === "tampered-bytes")
          await writeFile(join(content, "SKILL.md"), "TAMPERED_G03_CONTENT");
        else if (kind === "missing-file")
          await rm(join(content, "data/reference.txt"));
        else {
          await rename(content, join(f.temporary, "detached-owned-content"));
          await symlink(f.foreign, content, "dir");
        }
        injected = true;
      });
      const downloadsBeforeFault = f.downloads(),
        admissionsBeforeFault = warm.admissions.length;
      await assert.rejects(() => cli.catalog());
      assert.ok(injected);
      assert.ok(
        warm.admissions.length > admissionsBeforeFault,
        "the actual CLI must request current per-load admission after receiving its real catalog",
      );
      assert.deepEqual(warm.admissions.at(-1), {
        allowed: false,
        code: expectedCode,
      });
      const catalogDenied = await warm.assets.readCatalog("g03-corrupted-warm");
      assert.equal(catalogDenied.status, "denied");
      assert.equal(catalogDenied.code, expectedCode);
      const denied = await warm.assets.authorizeAsset(
        reference,
        "g03-corrupted-reference",
        undefined,
        initial.ownerKey,
      );
      assert.equal(denied.allowed, false);
      assert.equal(denied.code, expectedCode);
      await assertFault();
      await f.preserve();
      await cli.close();
      await warm.stop();
      const cold = await f.host(),
        coldCli = await cold.cli();
      const coldCatalog = await cold.assets.readCatalog("g03-corrupted-cold");
      assert.equal(coldCatalog.status, "denied");
      assert.equal(coldCatalog.code, expectedCode);
      assert.equal(
        (await cold.assets.authorizeAsset(reference, "g03-cold-reference"))
          .allowed,
        false,
      );
      await assert.rejects(() => coldCli.catalog());
      await assertFault();
      await f.preserve();
      assert.equal(
        f.downloads(),
        downloadsBeforeFault,
        "corrupt objects must not be silently redownloaded or repaired",
      );
      await coldCli.close();
      await cold.stop();
      // 恢复由测试所有者显式隔离整个坏profile；生产缓存不能自行删除或采用坏对象。
      const quarantine = join(f.temporary, "explicit-owned-quarantine");
      await rename(profileRoot, quarantine);
      const quarantinedContent = join(quarantine, reference.key, "content");
      await assertFault(quarantinedContent);
      const recovered = await f.host(),
        fresh = await ready(recovered),
        recoveredCli = await recovered.cli();
      assert.deepEqual(
        (await recoveredCli.catalog()).skills.map((item) => item.name),
        [`enterprise:${f.id}`],
      );
      assert.equal(
        (
          await recovered.assets.authorizeAsset(
            fresh.assets[0],
            "g03-recovered",
            undefined,
            fresh.ownerKey,
          )
        ).allowed,
        true,
      );
      assert.equal(
        await readFile(join(fresh.assets[0]!.directory, "SKILL.md"), "utf8"),
        f.skillText,
      );
      assert.equal(
        await readFile(
          join(fresh.assets[0]!.directory, "data/reference.txt"),
          "utf8",
        ),
        f.attachment,
      );
      assert.ok(f.downloads() > downloadsBeforeFault);
      await assertFault(quarantinedContent);
      await f.preserve();
      f.observations.push({
        fault: kind,
        actualCliAdmissionDenied: warm.admissions.at(-1),
        warmCatalogDenied: catalogDenied.status,
        warmReferenceDenied: denied.allowed === false,
        coldHostAndCliDenied: true,
        noSilentRepairOrDownload: true,
        explicitOwnerQuarantineRecovery: true,
        quarantinedFaultPreserved: true,
        personalAndForeignPreserved: true,
      });
    },
  );
}
