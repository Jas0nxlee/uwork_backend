import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mkdtemp, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { eventually } from "./client-native-session-fixture.js";
import type { UWorkBackendSession } from "../clients/uwork/packages/services/src/enterprise-identity/backendSessionContract.js";
import type { EnterpriseAssetsHost } from "../clients/uwork/packages/services/src/enterprise-assets/hostContract.js";
import type { EnterpriseAssetStoreEvent } from "../clients/uwork/packages/services/src/enterprise-assets/contract.js";

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export async function bounded<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("queued cancellation/disposal exceeded bound")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function catalogQueueFixture(
  t: TestContext,
  name: string,
  options: { uncooperativeTransport?: boolean } = {},
) {
  const load = (path: string) =>
    import(
      pathToFileURL(resolve("clients/uwork/packages/services/src", path)).href
    );
  const [identityModule, identityLifecycle, sessionModule, assetModule] =
    await Promise.all([
      load("enterprise-identity/enterpriseIdentityService.ts"),
      load("enterprise-identity/identityServiceLifecycle.ts"),
      load("enterprise-identity/uworkBackendSession.ts"),
      load("enterprise-assets/enterpriseAssetsHost.ts"),
    ]);
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-catalog-fifo-")),
  );
  const gates = new Map<
    string,
    {
      entered: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
      used: boolean;
    }
  >();
  const hosts: EnterpriseAssetsHost[] = [];
  const events: EnterpriseAssetStoreEvent[] = [];
  const requests: { traceId: string; method: string; pathname: string }[] = [];
  const captured = new Set<string>();
  const cleanupState: {
    identity?: ReturnType<
      typeof identityModule.createEnterpriseIdentityService
    >;
    app?: Awaited<ReturnType<typeof createApp>>;
    port?: number;
  } = {};
  t.after(async () => {
    for (const gate of gates.values()) gate.release.resolve();
    await Promise.all(hosts.map((host) => host.disposeAllAndWait()));
    if (cleanupState.identity)
      await identityLifecycle.disposeEnterpriseIdentityService(
        cleanupState.identity,
      );
    await cleanupState.app?.close();
    await rm(directory, { recursive: true, force: true });
    const closed =
      cleanupState.port === undefined ||
      (await new Promise<boolean>((done) => {
        const socket = createConnection(cleanupState.port!, "127.0.0.1");
        socket.once("error", () => done(true));
        socket.once("connect", () => {
          socket.destroy();
          done(false);
        });
      }));
    assert.equal(closed, true);
    const evidence = `evidence/client-assets-catalog-queue-20261017/${process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green"}`;
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, `${name}-boundary.json`),
      JSON.stringify(
        {
          name,
          requests,
          events,
          captured: [...captured],
          cleanup: {
            backendPort: cleanupState.port,
            closed,
            ownedDirectoryRemoved: true,
            hostsDisposed: hosts.length,
          },
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  });
  // Gate hooks must be installed before inject/ready; all configuration and asset handlers stay real.
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 10),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  cleanupState.app = app;
  app.addHook("onResponse", async (req) => {
    requests.push({
      traceId: String(req.headers["x-zcode-trace-id"] ?? ""),
      method: req.method,
      pathname: new URL(req.url, "http://owned.invalid").pathname,
    });
  });
  app.addHook("onSend", async (req, _reply, payload) => {
    const gate = gates.get(String(req.headers["x-zcode-trace-id"] ?? ""));
    if (req.routeOptions.url === "/api/client/assets" && gate && !gate.used) {
      gate.used = true;
      gate.entered.resolve();
      await gate.release.promise;
    }
    return payload;
  });
  const owner = await bootstrap(app.services.db, {
    name: "Owned catalog",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const loggedIn = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  assert.equal(loggedIn.statusCode, 200);
  const f = {
    app,
    tenantId: owner.tenantId,
    userId: owner.userId,
    headers: { authorization: `Bearer ${loggedIn.json().token}` },
    p: `/api/tenants/${owner.tenantId}`,
  };
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const port = Number(new URL(origin).port);
  cleanupState.port = port;
  const call = async (path: string, method = "GET", payload?: unknown) => {
    const response = await f.app.inject({
      url: path,
      method: method as "GET" | "PUT" | "POST",
      headers: f.headers,
      payload: payload as never,
    });
    assert(
      response.statusCode >= 200 && response.statusCode < 300,
      response.body,
    );
    return response.json();
  };
  const config = await call(`${f.p}/configurations/security`);
  const draft = await call(`${f.p}/configurations/security`, "PUT", {
    revision: config.revision,
    data: { ...config.published, allowFilesystem: true },
  });
  await call(`${f.p}/configurations/security/publish`, "POST", {
    revision: draft.revision,
  });
  const content = (version: number) => ({
    instructions: `CATALOG_FIFO_EXPERT_V${version}`,
    profession: "Owned FIFO expert",
  });
  const created = await call(`${f.p}/assets`, "POST", {
    name: "OwnedFifoExpert",
    kind: "expert",
    scope: { all: true },
    content: content(1),
  });
  const publish = async (version: number) => {
    for (const operation of ["review", "publish"])
      await call(`${f.p}/assets/${created.id}/${operation}`, "POST", {
        version,
        ...(operation === "review" ? { approved: true } : {}),
      });
  };
  await publish(1);
  const values = new Map<string, string>();
  const credentials = {
    load: async (key: string) => values.get(key) ?? null,
    save: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  const session = {
    token: f.headers.authorization.slice("Bearer ".length),
    issuerOrigin: origin,
    expiresAt: Date.now() + 60000,
    profile: {
      id: f.userId,
      tenantId: f.tenantId,
      provider: "wecom",
      displayName: "Owned",
    },
  };
  const identity = identityModule.createEnterpriseIdentityService({
    credentials,
    adapter: {
      listOrganizations: () => [{ id: f.tenantId }],
      resolveOrganization: () => ({ id: f.tenantId }),
      start: async () => ({
        id: "owned-fifo",
        callbackUrl: "https://auth.example.test/callback",
        authorizationUrl: "https://auth.example.test/authorize",
        expiresAt: Date.now() + 60000,
      }),
      complete: async () => session,
      restore: async () => session,
    },
  });
  cleanupState.identity = identity;
  const login = async () => {
    const attempt = await identity.beginLogin();
    await identity.completeLogin(
      attempt.id,
      "https://auth.example.test/callback?code=owned&state=owned-fifo",
    );
  };
  await login();
  let alternateSpelling = false;
  const backend: UWorkBackendSession = sessionModule.createUWorkBackendSession({
    resolveConfig: async () => ({
      backend: "uwork",
      apiBaseUrl: origin + (alternateSpelling ? "/" : ""),
    }),
    readAuthority: () =>
      identityLifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: async () => {
      const authority =
        identityLifecycle.readEnterpriseIdentityAuthority(identity);
      return { revision: authority.revision, session: authority.session };
    },
    ...(options.uncooperativeTransport
      ? {
          fetchImpl: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, signal: undefined }),
        }
      : {}),
  });
  const observed: UWorkBackendSession = {
    run(operation, context) {
      return backend.run((scope) => {
        captured.add(context?.traceId ?? "");
        return operation(scope);
      }, context);
    },
  };
  const createHost = (
    backendSession: UWorkBackendSession = observed,
  ): EnterpriseAssetsHost => {
    const host = assetModule.createEnterpriseAssetsHost({
      backendSession,
      storageDirectory: directory,
      onCacheEvent: (event: EnterpriseAssetStoreEvent) => events.push(event),
    });
    hosts.push(host);
    return host;
  };
  const host = createHost();
  return {
    host,
    createHost,
    backend: observed,
    identity,
    login,
    events,
    requests,
    directory,
    gate(traceId: string) {
      const gate = { entered: deferred(), release: deferred(), used: false };
      gates.set(traceId, gate);
      return gate;
    },
    waitCaptured: (traceId: string) =>
      eventually(async () => captured.has(traceId), Boolean),
    replaceConfiguration: () => {
      alternateSpelling = !alternateSpelling;
    },
    async publishVersionTwo() {
      const list = await call(`${f.p}/assets`);
      const asset = list.items.find(
        (item: { id: string }) => item.id === created.id,
      );
      await call(`${f.p}/assets/${created.id}`, "PUT", {
        revision: asset.revision,
        name: "OwnedFifoExpert",
        kind: "expert",
        scope: { all: true },
        content: content(2),
      });
      await publish(2);
    },
  };
}
