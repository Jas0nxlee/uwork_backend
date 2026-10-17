// 真实UI签发与同一终端凭据的普通读取/吊销；只拥有本次临时后台和浏览器。
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createConnection,
  createServer as createPortReservation,
} from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
const exec = promisify(execFile);
const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const harnessPath = "/Users/ljp/.local/bin/browser-harness";
const run = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const evidence = resolve("evidence/admin-device-token-ui-20261017", run);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const root = await mkdtemp("/tmp/udv-");
const bhRoot = join(root, "bh");
const profile = join(root, "chrome");
const email = "device-ui@example.test";
const password = randomBytes(24).toString("hex");
let interactiveToken = "",
  deviceToken = "",
  deviceId = "";
let origin = "",
  cdpPort: number | undefined,
  daemonPid: number | undefined;
let chrome: ChildProcess | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let failure: string | undefined;
let harnessAttempted = false;
let daemonIdentityVerified = false;
let daemonPidFiles: string[] = [];
const receipts: Row[] = [],
  browser: Row[] = [],
  apiChecks: Row[] = [];
const knownPids = new Set<number>();
const assetFacts: Row[] = [];

const redact = (value: string) => {
  for (const secret of [password, interactiveToken, deviceToken])
    if (secret) value = value.replaceAll(secret, "[REDACTED]");
  return value;
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const closed = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection(port, "127.0.0.1");
    socket.once("error", () => done(true));
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
  });
async function processRows() {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match
      ? [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            pgid: Number(match[3]),
            command: match[4]!,
          },
        ]
      : [];
  });
}
async function rememberOwnedPids() {
  const rows = await processRows();
  for (const row of rows)
    if (
      row.pid === chrome?.pid ||
      row.pgid === chrome?.pid ||
      row.command.includes(profile)
    )
      knownPids.add(row.pid);
  if (daemonPid) {
    const daemon = rows.find((row) => row.pid === daemonPid);
    assert.ok(
      !daemon || daemon.command.includes("browser_harness.daemon"),
      "owned daemon identity changed",
    );
    daemonIdentityVerified = daemonIdentityVerified || !!daemon;
    knownPids.add(daemonPid);
  }
  for (let count = -1; count !== knownPids.size; ) {
    count = knownPids.size;
    for (const row of rows) if (knownPids.has(row.ppid)) knownPids.add(row.pid);
  }
  knownPids.delete(process.pid);
}
async function waitFor<T>(
  operation: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (accept(result)) return result;
    } catch {
      /* bounded setup race */
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const harnessEnvironment = (stage: string): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  delete environment.BU_CDP_WS;
  delete environment.BU_AUTOSPAWN;
  delete environment.BH_DEBUG_CLICKS;
  return {
    ...environment,
    BU_NAME: `device-${run.slice(-6)}`,
    BU_CDP_URL: `http://127.0.0.1:${cdpPort}`,
    BH_HOME: bhRoot,
    BH_CONFIG_DIR: bhRoot,
    BH_RUNTIME_DIR: join(bhRoot, "r"),
    BH_TMP_DIR: join(bhRoot, "t"),
    BH_AGENT_WORKSPACE: join(bhRoot, "w"),
    BH_RECORD: "0",
    BH_TELEMETRY: "0",
    BH_REQUIRE_EXISTING_DAEMON: stage === "issue" ? "0" : "1",
    UWORK_DEVICE_UI_ORIGIN: origin,
    UWORK_DEVICE_UI_STAGE: stage,
    UWORK_DEVICE_UI_EVIDENCE: evidence,
    UWORK_DEVICE_UI_EMAIL: email,
    UWORK_DEVICE_UI_PASSWORD: password,
  };
};
async function runBrowser(stage: string) {
  const source = await readFile(
    resolve("scripts/admin-device-token-ui-browser.py"),
    "utf8",
  );
  const child = spawn(harnessPath, [], {
    env: harnessEnvironment(stage),
    stdio: ["pipe", "pipe", "pipe"],
  });
  harnessAttempted = true;
  if (child.pid) knownPids.add(child.pid);
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45000);
  try {
    child.stdin.end(source);
    const code = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("exit", done);
    });
    const safeOutput = redact(stdout + stderr);
    await writeFile(join(evidence, `browser-${stage}.log`), safeOutput, {
      mode: 0o600,
    });
    assert.equal(code, 0, `owned browser stage failed: ${stage}`);
    const line = stdout
      .split("\n")
      .find((line) => line.startsWith("DEVICE_UI_RESULT="));
    assert.ok(line, "safe browser result missing");
    const result = JSON.parse(line.slice("DEVICE_UI_RESULT=".length)) as Row;
    browser.push(result);
    return result;
  } finally {
    clearTimeout(timeout);
    // 本安装显式BH_RUNTIME_DIR使用bu.pid；同时记录实际目录，不能把未知daemon算清理成功。
    const directory = join(bhRoot, "r");
    daemonPidFiles = await readdir(directory).then(
      (files) =>
        files.filter((file) => /^bu(?:-[A-Za-z0-9_-]+)?\.pid$/.test(file)),
      () => [],
    );
    if (daemonPidFiles.length === 1) {
      const value = Number(
        await readFile(join(directory, daemonPidFiles[0]!), "utf8"),
      );
      if (Number.isInteger(value) && value > 0) daemonPid = value;
    }
    await rememberOwnedPids();
    assert.ok(
      daemonPid && daemonIdentityVerified,
      "owned BH daemon PID was not identified",
    );
  }
}
async function request(path: string, method: string, token: string) {
  assert.ok(
    path.startsWith("/api/") &&
      !path.includes("wecom") &&
      !path.includes("connectors"),
  );
  const response = await fetch(origin + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "uwork-owned-device-ui-api",
    },
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : ((await response.json()) as Row),
  };
}

const cleanup: Row = {};
try {
  const index = await readFile(resolve("admin/dist/index.html"), "utf8");
  const assets = [
    ...index.matchAll(
      /(?:src|href)="(\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css))"/g,
    ),
  ].map((match) => match[1]!);
  assert.ok(
    assets.some((path) => path.endsWith(".js")),
    "existing official admin asset missing",
  );
  for (const path of ["/index.html", ...assets]) {
    const bytes = await readFile(resolve("admin/dist" + path));
    assetFacts.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const scriptAsset = assets.find((path) => path.endsWith(".js"))!;
  const jsBytes = await readFile(resolve("admin/dist" + scriptAsset), "utf8");
  assert.ok(
    ["签发终端凭据", "查看我的终端凭据", "有效小时"].every((text) =>
      jsBytes.includes(text),
    ),
  );
  const assetTime = (await stat(resolve("admin/dist" + scriptAsset))).mtimeMs;
  for (const name of [
    "Settings.tsx",
    "forms.tsx",
    "main.tsx",
    "api.ts",
    "catalog.ts",
  ]) {
    const path = resolve("admin/src", name),
      bytes = await readFile(path);
    assert.ok(
      (await stat(path)).mtimeMs <= assetTime,
      "admin source is newer than existing asset",
    );
    assetFacts.push({
      path: `admin/src/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const reservation = createPortReservation();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  assert.notEqual(port, 3000);
  origin = `http://127.0.0.1:${port}`;
  app = await createApp({
    database: join(root, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: origin,
    worker: false,
  });
  const owner = await bootstrap(app.services.db, {
    name: "Owned device UI",
    email,
    password,
  });
  // 仅观察真实响应，完整凭据留内存；不覆盖fetch、业务响应或后台状态。
  app.addHook("onSend", async (req, reply, payload) => {
    if (
      typeof payload === "string" &&
      reply.statusCode < 300 &&
      req.method === "POST"
    ) {
      if (req.routeOptions.url === "/api/auth/login") {
        const value = JSON.parse(payload) as { token: string };
        interactiveToken = value.token;
      }
      if (req.routeOptions.url === "/api/auth/device-tokens") {
        if (deviceToken) throw new Error("only one UI device issue is allowed");
        const value = JSON.parse(payload) as { token: string; id: string };
        deviceToken = value.token;
        deviceId = value.id;
      }
    }
    return payload;
  });
  app.addHook("onResponse", async (req, reply) => {
    receipts.push({
      method: req.method,
      route: req.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
      channel:
        req.headers["user-agent"] === "uwork-owned-device-ui-api"
          ? "api-verification"
          : "browser-ui",
      ...(req.routeOptions.url === "/api/auth/device-tokens" &&
      req.method === "POST"
        ? { ttlHours: (req.body as Row).ttlHours }
        : {}),
    });
  });
  assert.equal(await app.listen({ host: "127.0.0.1", port }), origin);
  assert.notEqual(new URL(origin).port, "3000");
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--incognito",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-application-cache",
      "--disk-cache-size=0",
      "--media-cache-size=0",
      "--disable-gpu-shader-disk-cache",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--password-store=basic",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  assert.ok(chrome.pid);
  knownPids.add(chrome.pid);
  const portFile = await waitFor(
    () => readFile(join(profile, "DevToolsActivePort"), "utf8"),
    (value) => /^\d+\n/.test(value),
    "owned Chrome CDP",
  );
  cdpPort = Number(portFile.split("\n")[0]);
  const issued = await runBrowser("issue");
  assert.ok(deviceToken && interactiveToken && /^[a-f0-9]{64}$/.test(deviceId));
  assert.equal(issued.uiRevokeButton, false);
  const uiIssues = receipts.filter(
    (r) =>
      r.channel === "browser-ui" &&
      r.method === "POST" &&
      r.route === "/api/auth/device-tokens",
  );
  assert.equal(uiIssues.length, 1);
  assert.equal(uiIssues[0]!.status, 201);
  assert.equal(uiIssues[0]!.ttlHours, 2);
  const metadata = await request(
    "/api/auth/device-tokens",
    "GET",
    interactiveToken,
  );
  assert.equal(metadata.status, 200);
  assert.ok(Array.isArray(metadata.data) && metadata.data.length === 1);
  assert.equal(JSON.stringify(metadata.data).includes(deviceToken), false);
  const configuration = await request(
    "/api/client/configuration",
    "GET",
    deviceToken,
  );
  assert.equal(configuration.status, 200);
  assert.equal(configuration.data?.tenantId, owner.tenantId);
  assert.ok(configuration.data?.configuration && configuration.data?.security);
  apiChecks.push({
    action: "same-ui-issued-device-reads-own-configuration",
    status: configuration.status,
    tenantMatched: true,
    responseKeys: Object.keys(configuration.data!).sort(),
  });
  const revoked = await request(
    `/api/auth/device-tokens/${encodeURIComponent(deviceId)}`,
    "DELETE",
    interactiveToken,
  );
  assert.equal(revoked.status, 204);
  const denied = await request("/api/client/configuration", "GET", deviceToken);
  assert.equal(denied.status, 401);
  apiChecks.push({
    action: "api-revoke-then-identical-device-read",
    revokeStatus: revoked.status,
    readStatus: denied.status,
    errorCode: (denied.data?.error as Row)?.code,
  });
  await runBrowser("revoked");
  assert.equal(
    receipts.some(
      (r) =>
        String(r.route).includes("/v1/") ||
        String(r.route).includes("/wecom/") ||
        String(r.route).includes("connectors"),
    ),
    false,
  );
} catch (error) {
  failure = redact(
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "verification failed",
  );
  process.exitCode = 1;
} finally {
  await rememberOwnedPids().catch(() => {});
  if (chrome?.pid && alive(chrome.pid)) {
    try {
      process.kill(-chrome.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
  if (daemonPid && alive(daemonPid)) {
    try {
      process.kill(daemonPid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
  const deadline = Date.now() + 5000;
  while ([...knownPids].some(alive) && Date.now() < deadline) await delay(100);
  for (const pid of knownPids)
    if (alive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }
  const killDeadline = Date.now() + 5000;
  while ([...knownPids].some(alive) && Date.now() < killDeadline)
    await delay(100);
  if (app) {
    try {
      await app.close();
      cleanup.appClosed = true;
    } catch {
      cleanup.appClosed = false;
      failure = failure ?? "owned backend close failed";
    }
  }
  cleanup.knownPids = [...knownPids].map((pid) => ({
    pid,
    exited: !alive(pid),
  }));
  cleanup.backendPort = origin ? Number(new URL(origin).port) : null;
  cleanup.backendPortClosed = origin
    ? await closed(Number(new URL(origin).port))
    : null;
  cleanup.cdpPort = cdpPort ?? null;
  cleanup.cdpPortClosed = cdpPort ? await closed(cdpPort) : null;
  cleanup.bhDaemonPid = daemonPid ?? null;
  cleanup.bhDaemonExited = daemonPid ? !alive(daemonPid) : null;
  cleanup.bhPidFilesObserved = daemonPidFiles;
  cleanup.bhDaemonIdentityVerified = daemonIdentityVerified;
  if (harnessAttempted && (!daemonPid || !daemonIdentityVerified))
    failure = failure ?? "owned BH daemon PID was not identified";
  const remainingPids = [...knownPids].filter(alive);
  cleanup.rootRemovalSkippedDueLivePids = remainingPids;
  const daemonKnown =
    !harnessAttempted || (daemonPid && daemonIdentityVerified);
  const backendKnownClosed = !app || cleanup.appClosed === true;
  if (
    remainingPids.length === 0 &&
    daemonKnown &&
    backendKnownClosed &&
    cleanup.backendPortClosed !== false &&
    cleanup.cdpPortClosed !== false
  ) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      failure = failure ?? "owned temporary root removal failed";
    }
  } else {
    failure =
      failure ??
      "owned resources remain alive or unidentified; temporary root retained";
  }
  cleanup.temporaryRoot = root;
  cleanup.temporaryRootRemoved = await stat(root).then(
    () => false,
    () => true,
  );
  cleanup.bhHomeRemoved = await stat(bhRoot).then(
    () => false,
    () => true,
  );
  if (
    [...knownPids].some(alive) ||
    cleanup.backendPortClosed === false ||
    cleanup.cdpPortClosed === false
  )
    failure = failure ?? "owned resources did not fully close";
  const resourcesClosed =
    ![...knownPids].some(alive) &&
    cleanup.backendPortClosed !== false &&
    cleanup.cdpPortClosed !== false &&
    !!daemonKnown &&
    cleanup.temporaryRootRemoved === true;
  const result = {
    status: failure ? "failed" : "passed",
    failure,
    boundary:
      "actual production admin assets and DOM login/issue/list; same in-memory UI-issued device token uses real ordinary own configuration GET; API revoke because existing UI has no revoke button; no mocked fetch/React/store, no main env/DB/Vault, no model/Paid/WeCom/MCP/drive/remote probes",
    run,
    fixturePid: process.pid,
    backendNode: process.version,
    browserHarnessRecord: false,
    officialAssetsReused: assetFacts,
    browser,
    apiChecks,
    receipts,
    cleanup,
  };
  const encoded = JSON.stringify(result, null, 2);
  if (encoded !== redact(encoded))
    throw new Error("evidence contains a private credential");
  await writeFile(join(evidence, "result.json"), encoded, { mode: 0o600 });
  deviceToken = "";
  interactiveToken = "";
  console.log(
    JSON.stringify({
      status: result.status,
      evidence,
      failure,
      browserStages: browser.length,
      apiChecks: apiChecks.length,
      resourcesClosed,
    }),
  );
  if (failure) process.exitCode = 1;
}
