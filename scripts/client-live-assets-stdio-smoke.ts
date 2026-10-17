import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { spawn } from "node:child_process";
import {
  access,
  readFile,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const evidence = resolve("evidence/client-live-20261017-assets");
const facts: Record<string, unknown> = {
  status: "running",
  checks: [],
  businessTransport: "actual TCP fetch; no app.inject",
  authentication:
    "actual email/password login then backend-issued device token; no WeCom adapter or callback",
};
const checks = facts.checks as string[];
async function save() {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  await writeFile(
    join(evidence, "runtime-report.json"),
    JSON.stringify(facts, null, 2),
    { mode: 0o600 },
  );
  await chmod(join(evidence, "runtime-report.json"), 0o600);
}
async function bounded<T>(operation: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_r, reject) => {
        timer = setTimeout(
          () => reject(new Error("controlled assets lifecycle timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function liveFixture(t: TestContext) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-client-live-backend-")),
  );
  const masterKey = randomBytes(32),
    app = await createApp({
      database: join(directory, "backend.sqlite"),
      masterKey,
      publicUrl: "http://localhost:3000",
      worker: false,
    });
  const traffic: Record<string, number> = {};
  app.addHook("onResponse", async (req, reply) => {
    const key = `${req.method} ${req.routeOptions.url} ${reply.statusCode}`;
    traffic[key] = (traffic[key] ?? 0) + 1;
  });
  const password = randomBytes(24).toString("hex");
  const initialized = await bootstrap(app.services.db, {
    name: "Client live assets",
    email: "assets-live@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function http(request: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) {
    const response = await fetch(origin + request.url, {
      method: request.method ?? "GET",
      headers: {
        connection: "close",
        ...request.headers,
        ...(request.payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(request.payload === undefined
        ? {}
        : { body: JSON.stringify(request.payload) }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    return {
      statusCode: response.status,
      body,
      json: () => (body ? JSON.parse(body) : undefined),
    };
  }
  const login = await http({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "assets-live@example.test",
      password,
      tenantId: initialized.tenantId,
    },
  });
  assert.equal(login.statusCode, 200);
  const ownerToken = login.json().token as string,
    headers = { authorization: `Bearer ${ownerToken}` };
  const issued = await http({
    method: "POST",
    url: "/api/auth/device-tokens",
    headers,
    payload: { ttlHours: 1 },
  });
  assert.equal(issued.statusCode, 201);
  const device = issued.json() as {
    token: string;
    id: string;
    expiresAt: number;
  };
  const me = await http({
    url: "/api/auth/me",
    headers: { authorization: `Bearer ${device.token}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().kind, "device");
  assert.equal(me.json().user.id, initialized.userId);
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
      facts.backendClosed = true;
      facts.traffic = traffic;
      await save();
    }
  });
  return {
    app,
    origin,
    http,
    headers,
    p: `/api/tenants/${initialized.tenantId}`,
    tenantId: initialized.tenantId,
    userId: initialized.userId,
    deviceToken: device.token,
    deviceId: device.id,
    deviceExpiresAt: device.expiresAt,
    masterKeyForLeakCheck: masterKey.toString("hex"),
  };
}

test(
  "freshly packaged CLI stdio and real device-authenticated HTTP backend install update authorize revoke and clear assets",
  { timeout: 90000 },
  async (t) => {
    const root = resolve("clients/uwork");
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { createUWorkBackendSession } = await load(
      "packages/services/src/enterprise-identity/uworkBackendSession.ts",
    );
    const { createUWorkToolAuthorizationResolver } = await load(
      "packages/services/src/enterprise-identity/uworkToolAuthorization.ts",
    );
    const { createEnterpriseAssetsHost } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsHost.ts",
    );
    const { createEnterpriseToolAuthorizationBridge } = await load(
      "packages/services/src/zcode-agent/enterpriseToolAuthorizationBridge.ts",
    );
    const { ZCodeProtocolClient } = await load(
      "packages/services/src/zcode-agent/zcodeProtocolClient.ts",
    );
    const { ZCodeStdioTransport } = await load(
      "packages/services/src/zcode-agent/zcodeStdioTransport.ts",
    );
    const shared = await load("packages/shared/src/index.ts");
    const bundle = join(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
    await access(bundle);
    const f = await liveFixture(t);
    const origin = f.origin;
    const temporary = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-client-live-assets-")),
    );
    t.after(async () => {
      await rm(temporary, { recursive: true, force: true });
      facts.clientTempRemoved = true;
      await save();
    });
    const workspacePath = join(temporary, "workspace-a"),
      foreignPath = join(temporary, "workspace-b"),
      home = join(temporary, "home"),
      storageDirectory = join(temporary, "host");
    for (const path of [workspacePath, home, storageDirectory])
      await mkdir(path);
    await mkdir(join(foreignPath, ".zcode", "skills", "foreign"), {
      recursive: true,
    });
    await writeFile(
      join(foreignPath, ".zcode", "skills", "foreign", "SKILL.md"),
      "---\nname: ControlledForeign\ndescription: Must not be scanned under another workspace binding\n---\nControlled foreign body",
    );
    const configure = async (kind: string, data: Record<string, unknown>) => {
      const url = `${f.p}/configurations/${kind}`,
        old = (await f.http({ url, headers: f.headers })).json();
      const saved = await f.http({
        method: "PUT",
        url,
        headers: f.headers,
        payload: {
          revision: old.revision,
          data: { ...old.published, ...data },
        },
      });
      assert.equal(saved.statusCode, 200, saved.body);
      const published = await f.http({
        method: "POST",
        url: `${url}/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      });
      assert.equal(published.statusCode, 200, published.body);
    };
    await configure("security", {
      allowFilesystem: true,
      dangerousSkills: false,
    });
    const created = await f.http({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled",
        kind: "skill",
        scope: { all: true },
        content: {
          files: [
            {
              path: "SKILL.md",
              content:
                "---\nname: controlled-enterprise\ndescription: Controlled stdio fixture\n---\nApproved stdio instructions",
            },
          ],
          highRisk: false,
        },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id: string = created.json().id;
    for (const operation of ["review", "publish"]) {
      const response = await f.http({
        method: "POST",
        url: `${f.p}/assets/${id}/${operation}`,
        headers: f.headers,
        payload: {
          version: 1,
          ...(operation === "review" ? { approved: true } : {}),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const expertBody = {
      instructions: "Approved stdio expert instructions",
      profession: "受控专家",
    };
    const expertCreated = await f.http({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Expert",
        kind: "expert",
        scope: { all: true },
        content: expertBody,
      },
    });
    assert.equal(expertCreated.statusCode, 201, expertCreated.body);
    const expertId: string = expertCreated.json().id;
    for (const operation of ["review", "publish"]) {
      const response = await f.http({
        method: "POST",
        url: `${f.p}/assets/${expertId}/${operation}`,
        headers: f.headers,
        payload: {
          version: 1,
          ...(operation === "review" ? { approved: true } : {}),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    // 自定义指令没有 UWork 终端所有者：服务端矩阵本身就必须拒绝下发给 uwork。
    const unsupported = await f.http({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Instruction",
        kind: "instruction",
        scope: { all: true },
        content: { instructions: "Must never reach the client" },
        supportedClients: ["uwork"],
      },
    });
    assert.equal(unsupported.statusCode, 400, unsupported.body);
    assert.equal(unsupported.json().error.code, "CLIENT_UNSUPPORTED");
    let owner = new AbortController();
    let authority = {
      generation: 1,
      revision: 1,
      signal: owner.signal,
      session: {
        token: f.deviceToken,
        issuerOrigin: origin,
        expiresAt: f.deviceExpiresAt,
        profile: {
          id: f.userId,
          tenantId: f.tenantId,
          displayName: "Controlled",
          provider: "wecom",
        },
      },
    };
    const backendSession = createUWorkBackendSession({
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => authority,
      readPersistedSession: async () => ({
        revision: authority.revision,
        session: authority.session,
      }),
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${f.deviceToken}`,
        );
        return fetch(input, init);
      },
    });
    let cacheCleared!: () => void;
    const cleared = new Promise<void>((resolve) => {
      cacheCleared = resolve;
    });
    let signedOut = false;
    const assets = createEnterpriseAssetsHost({
      backendSession,
      storageDirectory,
      onCacheEvent: (event: { operation: string; status: string }) => {
        if (
          signedOut &&
          event.operation === "prune" &&
          event.status === "succeeded"
        )
          cacheCleared();
      },
    });
    const { attachEnterpriseAssetsLifecycle } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsLifecycle.ts",
    );
    const listeners = new Set<(view: { status: string }) => void>();
    const identityPort = {
      getView: async () => ({
        status: signedOut ? "signed-out" : "authenticated",
      }),
      onDidChange: (listener: (view: { status: string }) => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    };
    let warmed!: (value: unknown) => void;
    const warmup = new Promise<unknown>((resolve) => {
      warmed = resolve;
    });
    const originalRead = assets.readCatalog.bind(assets);
    assets.readCatalog = async (...args: unknown[]) => {
      const value = await originalRead(...args);
      if (value.status === "ready") warmed(value);
      return value;
    };
    const lifecycle = attachEnterpriseAssetsLifecycle({
      identity: identityPort,
      assets,
      readAuthority: () => authority,
    });
    const initial = (await bounded(warmup)) as {
      status: string;
      assets: { directory: string; asset: { version: number } }[];
    };
    assert.equal(initial.status, "ready");
    assert.equal(initial.assets.length, 1);
    assert.match(
      await readFile(join(initial.assets[0]!.directory, "SKILL.md"), "utf8"),
      /Approved stdio instructions/,
    );
    checks.push(
      "real HTTP device authority triggered existing Host lifecycle prewarm and installation",
    );
    t.after(() => lifecycle.disposeAllAndWait());
    const workspace = {
      workspacePath,
      workspaceIdentity: "controlled-stdio",
      workspaceKey: "controlled-stdio",
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
        TMP: process.env.TMP,
        TEMP: process.env.TEMP,
        ZCODE_STORAGE_DIR: join(temporary, "client-storage"),
        UWORK_DATA_BASE_DIR: join(temporary, "product-data"),
        ZCODE_DATA_BASE_DIR: join(temporary, "product-data"),
        ZCODE_ENV: "test",
        ZCODE_BASE_URL: origin,
        ZCODE_MODEL_TELEMETRY_ENABLED: "false",
        [shared.ZCODE_ENTERPRISE_POLICY_REQUIRED_ENV_KEY]: "1",
        [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: workspace.workspaceIdentity,
      },
    });
    const stdoutChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) =>
      stdoutChunks.push(Buffer.from(chunk)),
    );
    const stderr: string[] = [];
    const transport = new ZCodeStdioTransport(child, {
      onStderrLine: (line: string) => {
        if (stderr.length < 100) stderr.push(line);
      },
      ...(process.platform !== "win32"
        ? {
            ownedProcessGroupId: child.pid,
            ownedProcessStartedAtMs: Date.now(),
          }
        : {}),
    });
    const client = new ZCodeProtocolClient(transport, {
      requestTimeoutMs: 20000,
    });
    let catalogs = 0,
      admissions = 0;
    const expertAdmissions: {
      id: string;
      version: number;
      checksum: string;
    }[] = [];
    const bridge = createEnterpriseToolAuthorizationBridge({
      assets,
      resolver: createUWorkToolAuthorizationResolver({ backendSession }),
      isCurrent: () => !client.isDisposed,
    });
    client.onRequest(
      (request: {
        id: string | number;
        method: string;
        params: unknown;
        trace?: { traceId: string };
      }) => {
        if (
          request.method ===
          shared.zcodeProtocolMethods.interactionReadEnterpriseSkills
        ) {
          catalogs++;
          void bridge
            .handleCatalog(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => {});
        } else if (
          request.method ===
          shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
        ) {
          admissions++;
          const params = request.params as {
            phase?: string;
            asset?: {
              asset?: {
                id: string;
                kind: string;
                version: number;
                checksum: string;
              };
            };
          };
          if (
            params.phase === "asset_load" &&
            params.asset?.asset?.kind === "expert"
          )
            expertAdmissions.push(structuredClone(params.asset.asset));
          void bridge
            .handle(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => {});
        } else
          void client
            .respondError(request.id, {
              code: -32601,
              message: "Unexpected controlled reverse RPC",
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
    const cleanup = async () => {
      owner.abort();
      await client.disposeAndWait();
      await lifecycle.disposeAllAndWait();
      await assets.disposeAllAndWait();
    };
    t.after(cleanup);
    const catalog = (value = workspace) =>
      client.request(
        shared.zcodeProtocolMethods.skillsReferenceCatalog,
        { workspace: value },
        shared.zcodeSkillsReferenceCatalogResultSchema,
        {
          timeoutMs: 20000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
    try {
      const first = await catalog();
      assert.equal(first.authority, "workspace");
      assert.deepEqual(
        first.skills.map((item: { name: string }) => item.name),
        [`enterprise:${id}`],
        "packaged CLI catalog mismatch",
      );
      assert.ok(catalogs >= 1);
      assert.ok(admissions >= 2);
      checks.push(
        "actual packaged CLI stdio catalog uses Host reverse RPC and before/after asset admissions",
      );
      const currentAssets = (
        await f.http({ url: `${f.p}/assets`, headers: f.headers })
      ).json();
      const selected = currentAssets.items.find(
        (item: { id: string }) => item.id === id,
      );
      const updated = await f.http({
        method: "PUT",
        url: `${f.p}/assets/${id}`,
        headers: f.headers,
        payload: {
          revision: selected.revision,
          name: "Controlled",
          kind: "skill",
          scope: { all: true },
          content: {
            files: [
              {
                path: "SKILL.md",
                content:
                  "---\nname: controlled-enterprise\ndescription: Controlled stdio fixture\n---\nApproved stdio version TWO",
              },
            ],
            highRisk: false,
          },
        },
      });
      assert.equal(updated.statusCode, 200);
      for (const operation of ["review", "publish"]) {
        const response = await f.http({
          method: "POST",
          url: `${f.p}/assets/${id}/${operation}`,
          headers: f.headers,
          payload: {
            version: 2,
            ...(operation === "review" ? { approved: true } : {}),
          },
        });
        assert.equal(response.statusCode, 200);
      }
      const newCatalog = await assets.readCatalog("live-assets-update");
      assert.equal(newCatalog.status, "ready");
      assert.equal(newCatalog.assets[0].asset.version, 2);
      assert.match(
        await readFile(
          join(newCatalog.assets[0].directory, "SKILL.md"),
          "utf8",
        ),
        /Approved stdio version TWO/,
      );
      assert.equal(
        (await assets.authorizeAsset(initial.assets[0], "live-assets-old-load"))
          .allowed,
        false,
      );
      assert.deepEqual(
        (await catalog()).skills.map((item: { name: string }) => item.name),
        [`enterprise:${id}`],
      );
      checks.push(
        "published version2 is installed and CLI re-reads catalog; old reference cannot load",
      );
      const revoke = await f.http({
        method: "POST",
        url: `${f.p}/policies`,
        headers: f.headers,
        payload: {
          name: "Revoke",
          family: "skill",
          mode: "deny",
          resourceIds: [id],
          scope: { all: true },
        },
      });
      assert.equal(revoke.statusCode, 201, revoke.body);
      assert.equal((await catalog()).skills.length, 0);
      assert.equal(
        (
          await assets.authorizeAsset(
            newCatalog.assets[0],
            "live-assets-revoked-load",
          )
        ).allowed,
        false,
      );
      checks.push(
        "actual HTTP policy revocation removes skill from CLI catalog and denies old cached reference",
      );
      await configure("personal", { skills: true });
      await configure("security", {
        allowFilesystem: true,
        dangerousSkills: true,
      });
      const before = catalogs;
      await assert.rejects(async () => {
        const result = await catalog({
          workspacePath: foreignPath,
          workspaceIdentity: "controlled-foreign",
          workspaceKey: "controlled-foreign",
        });
        assert.fail(
          `Forged workspace unexpectedly returned: ${JSON.stringify(result.skills.map((item: { name: string }) => item.name))}`,
        );
      }, /enterprise_workspace_mismatch/);
      assert.equal(
        catalogs,
        before,
        "a forged draft must be rejected before any private catalog or filesystem read",
      );
      assert.equal(
        (await catalog()).skills.some(
          (item: { name: string }) => item.name === "ControlledForeign",
        ),
        false,
      );
      const currentExpert = (
        await f.http({
          url: `/api/client/assets/${expertId}/download`,
          headers: f.headers,
        })
      ).json();
      assert.equal(
        expertAdmissions.length,
        0,
        "the draft catalog never loads expert bodies",
      );
      await client.request(
        shared.zcodeProtocolMethods.sessionCreate,
        { workspace },
        shared.zcodeSessionStateSnapshotSchema,
        {
          timeoutMs: 30000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
      assert.ok(
        expertAdmissions.length >= 2,
        "managed runtime must load expert through reverse RPC",
      );
      for (const admission of expertAdmissions)
        assert.deepEqual(admission, {
          id: expertId,
          kind: "expert",
          version: 1,
          checksum: currentExpert.checksum,
        });
      const revokeExpert = await f.http({
        method: "POST",
        url: `${f.p}/policies`,
        headers: f.headers,
        payload: {
          name: "Revoke expert",
          family: "expert",
          mode: "deny",
          resourceIds: [expertId],
          scope: { all: true },
        },
      });
      assert.equal(revokeExpert.statusCode, 201, revokeExpert.body);
      const catalogReads = catalogs,
        admitted = expertAdmissions.length;
      const after = await client.request(
        shared.zcodeProtocolMethods.sessionCreate,
        { workspace },
        shared.zcodeSessionStateSnapshotSchema,
        {
          timeoutMs: 30000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
      assert.equal(typeof after.session.sessionId, "string");
      assert.ok(
        catalogs > catalogReads,
        "a new managed runtime re-reads the current catalog before applying experts",
      );
      assert.equal(
        expertAdmissions.length,
        admitted,
        "a revoked expert is never requested again",
      );
      checks.push(
        "packaged CLI session loads expert via before/after authorization; revoked expert never requested again",
      );
      // Restore current skill visibility before logout, so cleanup proves removal
      // of a present installation rather than merely observing an empty cache.
      const policies = (
        await f.http({ url: `${f.p}/policies`, headers: f.headers })
      ).json();
      for (const policy of policies) {
        const response = await f.http({
          method: "DELETE",
          url: `${f.p}/policies/${policy.id}`,
          headers: f.headers,
        });
        assert.equal(response.statusCode, 204);
      }
      const beforeLogout = await assets.readCatalog(
        "live-assets-before-logout",
      );
      assert.equal(beforeLogout.status, "ready");
      assert.equal(beforeLogout.assets.length, 1);
      const installed = join(beforeLogout.assets[0].directory, "SKILL.md");
      await access(installed);
      const revoked = await f.http({
        method: "DELETE",
        url: `/api/auth/device-tokens/${f.deviceId}`,
        headers: f.headers,
      });
      assert.equal(revoked.statusCode, 204);
      const rejected = await f.http({
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${f.deviceToken}` },
      });
      assert.equal(rejected.statusCode, 401);
      signedOut = true;
      owner.abort();
      owner = new AbortController();
      authority = {
        generation: 2,
        revision: 2,
        signal: owner.signal,
        session: null,
      } as unknown as typeof authority;
      for (const listener of listeners) listener({ status: "signed-out" });
      await bounded(cleared);
      await assert.rejects(() => access(installed));
      assert.equal(
        (
          await assets.authorizeAsset(
            beforeLogout.assets[0],
            "live-assets-logged-out-load",
          )
        ).allowed,
        false,
      );
      await assert.rejects(
        () => catalog(),
        /enterprise_(identity_changed|identity_unavailable|policy_unavailable)/,
      );
      checks.push(
        "real device revocation returns401 and existing signed-out Host lifecycle removes installed owned bytes",
      );
      const wire =
        Buffer.concat(stdoutChunks).toString("utf8") + stderr.join("\n");
      for (const secret of [
        f.deviceToken,
        f.headers.authorization.slice(7),
        f.masterKeyForLeakCheck,
      ])
        assert.equal(
          wire.includes(secret),
          false,
          "private credential must never enter CLI protocol or stderr",
        );
      facts.protocol = {
        catalogRequests: catalogs,
        assetAdmissions: admissions,
        expertAdmissions: expertAdmissions.length,
        stdoutBytes: Buffer.concat(stdoutChunks).length,
        secretLeaks: false,
      };
      facts.status = "passed";
      facts.cliArtifact = bundle;
      facts.ownerInitializationBoundary =
        "Actual device token seeded only into existing private Host backend-session authority; provider enum wecom is legacy schema labeling, no WeCom authentication adapter was invoked";
      await save();
    } catch (error) {
      facts.status = "failed";
      facts.errorName = error instanceof Error ? error.name : "unknown";
      await save();
      throw error;
    } finally {
      await cleanup();
      if (child.exitCode === null && child.signalCode === null)
        await bounded(
          new Promise<void>((resolve) => child.once("exit", () => resolve())),
          5000,
        );
      facts.cliExit = { code: child.exitCode, signal: child.signalCode };
      facts.identityListenerCount = listeners.size;
      assert.equal(listeners.size, 0);
      await save();
    }
  },
);
