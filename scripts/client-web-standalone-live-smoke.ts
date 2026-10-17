// 真实 production entry-http 子进程；父进程仅驱动 HTTP/WS 与现有 RPC，不装配业务服务。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;
interface ServiceAccess {
  enterpriseIdentityService: {
    getView(): Promise<Row>;
    restoreSession(): Promise<Row>;
  };
  ucasGatewayService: {
    getView(): Promise<Row>;
    sync(reason: string): Promise<Row>;
  };
  zcodeTaskService: {
    listTasks(input: { workspacePath: string }): Promise<Row[]>;
  };
  modelSelectionService: { getView(): Promise<Row> };
  providerProvisioningTargetService: { apply(input: Row): Promise<Row> };
  fileService: {
    readTextFile(input: { path: string }): Promise<{ content: string }>;
    readWorkspaceFileSearchIgnore(input: {
      rootPath: string;
    }): Promise<{ content: string; source: string }>;
    writeWorkspaceFileSearchIgnore(input: {
      rootPath: string;
      content: string;
    }): Promise<void>;
  };
}

const repository = resolve(import.meta.dirname, "..");
const client = join(repository, "clients/uwork");
const node =
  "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node";
const entry = join(client, "packages/server/dist/entry-http.js");
const cli = join(client, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
const web = join(client, "packages/web/dist");
const evidence = join(repository, "evidence/client-web-standalone-20261017");
const fromClient = (path: string) =>
  import(pathToFileURL(join(client, path)).href);
const rpc = await fromClient("packages/rpc/src/index.ts");
const { connectViaProtocol } = await fromClient("packages/client/src/index.ts");
const requireFromServer = createRequire(
  join(client, "packages/server/package.json"),
);
const wsModule = await import(
  pathToFileURL(requireFromServer.resolve("ws")).href
);
const WebSocket = wsModule.default;
const hash = (body: string | Buffer) =>
  createHash("sha256").update(body).digest("hex");

async function bounded<T>(promise: Promise<T>, label: string, timeout = 10000) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: timeout`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", () => done(true));
  });
}

async function fixture(t: TestContext, name: string) {
  assert.ok(
    (await readFile(entry)).length > 100000,
    "production entry must be a formal tsup bundle, not tsc/source output",
  );
  await mkdir(evidence, { recursive: true });
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-standalone-web-")),
  );
  await chmod(directory, 0o700);
  const home = join(directory, "home");
  const workspace = join(directory, "workspace");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const seed = join(workspace, "owned-rpc.txt");
  await writeFile(seed, "OWNED_STANDALONE_RPC_SEED\n", { mode: 0o600 });
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const token = randomBytes(32).toString("hex");
  const credentialSecret = randomBytes(32).toString("hex");
  const secrets = [token, credentialSecret];
  const sanitize = (value: string) =>
    secrets.reduce(
      (body, secret) => body.replaceAll(secret, "[redacted]"),
      value,
    );
  const base = `http://127.0.0.1:${port}`;
  const cookie = `zcode_lite_token=${token}`;
  const observations: Row[] = [];
  const closers = new Set<() => Promise<void>>();
  let log = "";
  const child = spawn(node, [entry], {
    cwd: workspace,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: `${resolve(node, "..")}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: directory,
      ZCODE_DESKTOP_HOME_DIR: home,
      UWORK_DATA_BASE_DIR: home,
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_STORAGE_DIR: join(home, ".uwork"),
      ZCODE_ENV: "production",
      ZCODE_RUNTIME_ENV: "production",
      NODE_ENV: "production",
      ZCODE_BASE_URL: "https://web-no-external.invalid",
      VITE_ZCODE_BASE_URL: "https://web-no-external.invalid",
      ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
      VITE_ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
      ZCODE_SERVER_HOST: "127.0.0.1",
      PORT: String(port),
      ZCODE_SERVER_WORKSPACE: workspace,
      ZCODE_WEB_STATIC_ROOT: web,
      ZCODE_SERVER_AUTH_TOKEN: token,
      ZCODE_CREDENTIAL_SECRET: credentialSecret,
      ZCODE_AGENT_SERVER_COMMAND: node,
      ZCODE_AGENT_SERVER_ARGS_JSON: JSON.stringify([
        cli,
        "app-server",
        "--stdio",
      ]),
    },
  });
  child.stdout.on("data", (data: Buffer) => {
    log += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    log += data.toString();
  });
  const exited = new Promise<void>((done, reject) => {
    child.once("exit", () => done());
    child.once("error", reject);
  });
  const writeEvidence = async (cleanup: Row) => {
    const sourceFiles = [
      "packages/server/src/entry-http.ts",
      "packages/server/src/http.ts",
      "packages/server/src/hostCapability.ts",
      "packages/services/src/node.ts",
    ];
    const hashes: Row = {};
    for (const file of sourceFiles)
      hashes[file] = hash(await readFile(join(client, file)));
    const serverChunks = (await readdir(resolve(entry, "..")))
      .filter((file) => file.endsWith(".js"))
      .map((file) => join(resolve(entry, ".."), file));
    for (const file of [...serverChunks, cli, join(web, "index.html")])
      hashes[file.slice(client.length + 1)] = hash(await readFile(file));
    await writeFile(
      join(evidence, `${name}.json`),
      JSON.stringify(
        {
          name,
          productionEntry: entry,
          executable: node,
          startup:
            "spawn production entry-http in isolated realpath HOME/workspace/storage",
          syntheticCredentialsOnly: true,
          desktopIdentityInjected: false,
          externalSuppliersInvoked: false,
          observations,
          hashes,
          cleanup,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await writeFile(join(evidence, `${name}-server.log`), sanitize(log), {
      mode: 0o600,
    });
  };
  t.after(async () => {
    const closedSockets = await Promise.allSettled(
      [...closers].map((close) => close()),
    );
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      process.kill(-child.pid, "SIGTERM");
      try {
        await bounded(exited, "owned server TERM", 5000);
      } catch {
        process.kill(-child.pid, "SIGKILL");
        await bounded(exited, "owned server KILL", 5000);
      }
    }
    await exited;
    assert.ok(await portAvailable(port), "owned listener must be closed");
    let groupExited = true;
    if (child.pid) {
      try {
        process.kill(-child.pid, 0);
        groupExited = false;
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      }
    }
    assert.equal(groupExited, true, "owned child process group must exit");
    await rm(directory, { recursive: true, force: true });
    await writeEvidence({
      port,
      pid: child.pid,
      childExitCode: child.exitCode,
      childSignal: child.signalCode,
      listenerClosed: true,
      ownedProcessGroupExited: groupExited,
      tempRemoved: true,
    });
    assert.ok(
      closedSockets.every((result) => result.status === "fulfilled"),
      "all owned WebSockets must close cleanly",
    );
  });
  const readyDeadline = Date.now() + 15000;
  while (await portAvailable(port)) {
    assert.equal(
      child.exitCode,
      null,
      `production startup failed: ${sanitize(log)}`,
    );
    assert.equal(
      child.signalCode,
      null,
      "production server exited before ready",
    );
    assert.ok(
      Date.now() < readyDeadline,
      `production readiness failed: ${sanitize(log)}`,
    );
    await delay(50);
  }
  async function http(path: string, authenticated = true, method = "GET") {
    return fetch(`${base}${path}`, {
      method,
      ...(authenticated ? { headers: { Cookie: cookie } } : {}),
      signal: AbortSignal.timeout(5000),
    });
  }
  async function denied(path: string, headers: Record<string, string> = {}) {
    const socket = new WebSocket(base.replace("http:", "ws:") + path, {
      headers,
    });
    await bounded(
      new Promise<void>((done, reject) => {
        socket.on("error", () => {});
        socket.once("open", () => {
          socket.terminate();
          reject(new Error(`${path} unexpectedly upgraded`));
        });
        socket.once(
          "unexpected-response",
          (
            _request: unknown,
            response: { statusCode: number; resume(): void },
          ) => {
            response.resume();
            socket.terminate();
            try {
              assert.equal(response.statusCode, 401);
              done();
            } catch (error) {
              reject(error);
            }
          },
        );
      }),
      "unauthorized upgrade",
    );
  }
  async function connect(path = "/ws", headers: Record<string, string> = {}) {
    const socket = new WebSocket(base.replace("http:", "ws:") + path, {
      headers: { Cookie: cookie, ...headers },
    });
    const onData = new rpc.Emitter();
    const onClose = new rpc.Emitter();
    const onEnd = new rpc.Emitter();
    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const body = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw);
      onData.fire(rpc.VSBuffer.wrap(new Uint8Array(body)));
    });
    socket.on("close", () => {
      onClose.fire();
      onEnd.fire();
    });
    await bounded(
      new Promise<void>((done, reject) => {
        socket.once("open", done);
        socket.once("error", reject);
      }),
      "authenticated upgrade",
    );
    const protocol = new rpc.SocketProtocol({
      onData: onData.event,
      onClose: onClose.event,
      onEnd: onEnd.event,
      write(buffer: { buffer: Uint8Array }) {
        socket.send(buffer.buffer);
      },
      end() {
        socket.close();
      },
      drain() {
        return Promise.resolve();
      },
      dispose() {
        socket.close();
      },
    });
    const services = connectViaProtocol(protocol) as ServiceAccess;
    const close = async () => {
      if (socket.readyState !== WebSocket.CLOSED) {
        const closed = new Promise<void>((done) => socket.once("close", done));
        socket.close();
        await bounded(closed, "owned WS close");
      }
      protocol.dispose();
      onData.dispose();
      onClose.dispose();
      onEnd.dispose();
      closers.delete(close);
    };
    closers.add(close);
    return { services, close };
  }
  async function ticket() {
    const response = await http("/api/rpc-host-capability", true, "POST");
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      capability: string;
      expiresAt: number;
    };
    secrets.push(result.capability);
    assert.equal(typeof result.capability, "string");
    assert.ok(result.capability.length >= 32);
    return result;
  }
  return {
    http,
    denied,
    connect,
    ticket,
    cookie,
    workspace,
    seed,
    observations,
  };
}

test(
  "production Web token HTTP + real terminal RPC + disk reconnect",
  { timeout: 40000 },
  async (t) => {
    const f = await fixture(t, "web-terminal-reconnect");
    assert.equal((await f.http("/api/server-info", false)).status, 401);
    assert.equal(
      (await f.http("/api/server-info?token=owned-wrong", false)).status,
      401,
    );
    // Query token 只用于一次公开 bootstrap；不在证据、断言信息或 stdout 中输出 URL/header。
    const bootstrap = await f.http(
      `/api/server-info?token=${f.cookie.split("=")[1]}`,
      false,
    );
    assert.equal(bootstrap.status, 200);
    const setCookie = bootstrap.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.ok(setCookie.startsWith("zcode_lite_token="));
    assert.match(setCookie, /; HttpOnly(?:;|$)/);
    assert.match(setCookie, /; SameSite=Lax(?:;|$)/);
    assert.match(setCookie, /; Path=\/(?:;|$)/);
    const infoResponse = await f.http("/api/server-info");
    assert.equal(infoResponse.status, 200);
    const info = (await infoResponse.json()) as Row;
    assert.equal(info.authRequired, true);
    assert.equal(typeof info.protocolVersion, "number");
    assert.deepEqual(info.workspaces, [
      { path: f.workspace, label: "workspace" },
    ]);
    const index = await f.http("/", false);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /text\/html/);
    const html = await index.text();
    const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(script, "production HTML must reference built JS");
    const js = await f.http(script, false);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    const javascript = await js.text();
    assert.ok(javascript.length > 1000);
    await f.denied("/ws");
    const first = await f.connect();
    const services = first.services;
    const identity = await bounded(
      services.enterpriseIdentityService.getView(),
      "identity view",
    );
    const restored = await bounded(
      services.enterpriseIdentityService.restoreSession(),
      "identity restore",
    );
    for (const view of [identity, restored]) {
      assert.equal(view.status, "signed-out");
      assert.equal(view.configured, false);
      assert.equal(view.error, "unconfigured");
      assert.equal(view.profile, null);
      assert.deepEqual(view.organizations, []);
    }
    const gateway = await bounded(
      services.ucasGatewayService.getView(),
      "gateway view",
    );
    const synced = await bounded(
      services.ucasGatewayService.sync("manual"),
      "gateway sync",
    );
    const syncedView = synced.view as Row;
    for (const view of [gateway, syncedView]) {
      assert.equal(view.status, "signed-out");
      assert.equal(view.configured, false);
      for (const key of ["user", "endpoint", "key", "models"])
        assert.equal(view[key], null);
    }
    assert.equal(synced.committed, false);
    const tasks = await bounded(
      services.zcodeTaskService.listTasks({ workspacePath: f.workspace }),
      "owned task list",
    );
    assert.deepEqual(tasks, []);
    const modelView = await bounded(
      services.modelSelectionService.getView(),
      "model selection",
    );
    assert.ok(modelView && typeof modelView === "object");
    assert.ok(Array.isArray(modelView.providers));
    const seed = await bounded(
      services.fileService.readTextFile({ path: f.seed }),
      "seed RPC read",
    );
    assert.equal(seed.content, "OWNED_STANDALONE_RPC_SEED\n");
    const content = "# OWNED_STANDALONE_RPC_WRITE\n*.owned-web-test\n";
    await bounded(
      services.fileService.writeWorkspaceFileSearchIgnore({
        rootPath: f.workspace,
        content,
      }),
      "workspace ignore RPC write",
    );
    assert.equal(
      await readFile(join(f.workspace, ".zcodeignore"), "utf8"),
      content,
    );
    await first.close();
    const second = await f.connect();
    const reread = await bounded(
      second.services.fileService.readWorkspaceFileSearchIgnore({
        rootPath: f.workspace,
      }),
      "reconnected disk RPC read",
    );
    assert.deepEqual(reread, { content, source: "file" });
    assert.deepEqual(
      await bounded(
        second.services.zcodeTaskService.listTasks({
          workspacePath: f.workspace,
        }),
        "reconnected task list",
      ),
      [],
    );
    f.observations.push({
      unauthenticatedHttp: 401,
      wrongTokenHttp: 401,
      queryBootstrapCookie: { httpOnly: true, path: "/", sameSite: "Lax" },
      authenticatedServerInfo: 200,
      protocolVersion: info.protocolVersion,
      productionHtmlAndJavaScript: 200,
      javascriptPath: script,
      servedJavaScriptSha256: hash(javascript),
      unauthenticatedWs: 401,
      identity,
      restored,
      gateway,
      sync: synced,
      taskCount: tasks.length,
      modelViewKeys: Object.keys(modelView),
      modelProviders: (modelView.providers as Row[]).map((provider) => ({
        providerId: provider.providerId,
        modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
      })),
      realRpcSeedRead: true,
      realRpcWritePersistedToDisk: true,
      closedThenReconnectedRpcReadMatchesDisk: true,
    });
  },
);

test(
  "production Host one-use capability TTL + ordinary mode header remains untrusted",
  { timeout: 55000 },
  async (t) => {
    const f = await fixture(t, "host-capability-security");
    assert.equal(
      (await f.http("/api/rpc-host-capability", false, "POST")).status,
      401,
    );
    await f.denied("/ws/host", { Cookie: f.cookie });
    const ordinary = await f.connect("/ws", {
      "x-zcode-client-mode": "desktop-continuous",
      "x-zcode-rpc-client-mode": "desktop-continuous",
    });
    // 空 Envelope 也必须先被 terminal-client 的 Host 权限边界拒绝；不写任何 key/配置。
    await assert.rejects(
      bounded(
        ordinary.services.providerProvisioningTargetService.apply({}),
        "ordinary provisioning",
      ),
      /Provider Provisioning 仅支持受信 Desktop Host/,
    );
    const capability = await f.ticket();
    assert.ok(capability.expiresAt - Date.now() <= 30000);
    assert.ok(capability.expiresAt - Date.now() > 28000);
    const trusted = await f.connect("/ws/host", {
      "x-zcode-rpc-host-capability": capability.capability,
    });
    const read = await bounded(
      trusted.services.fileService.readTextFile({ path: f.seed }),
      "capability-authorized real RPC",
    );
    assert.equal(read.content, "OWNED_STANDALONE_RPC_SEED\n");
    const identity = await bounded(
      trusted.services.enterpriseIdentityService.getView(),
      "trusted standalone identity",
    );
    assert.equal(identity.status, "signed-out");
    assert.equal(identity.configured, false);
    await f.denied("/ws/host", {
      Cookie: f.cookie,
      "x-zcode-rpc-host-capability": capability.capability,
    });
    const expired = await f.ticket();
    const started = Date.now();
    await delay(Math.max(0, expired.expiresAt - Date.now() + 100));
    const waited = Date.now() - started;
    assert.ok(waited >= 29000, "real wall clock TTL must elapse");
    await f.denied("/ws/host", {
      Cookie: f.cookie,
      "x-zcode-rpc-host-capability": expired.capability,
    });
    f.observations.push({
      unauthenticatedTicketIssue: 401,
      authenticatedHostWithoutTicket: 401,
      ordinaryWsWithOldModeHeaders: "provisioning rejected by actual Host",
      firstUseTicket: "real file RPC read succeeded",
      trustedStandaloneIdentity: {
        status: identity.status,
        configured: identity.configured,
      },
      replayTicket: 401,
      actualExpiredTicket: 401,
      capabilityTtlMs: 30000,
      wallClockWaitMs: waited,
      fakeClockUsed: false,
      keysProvisioned: false,
    });
  },
);
