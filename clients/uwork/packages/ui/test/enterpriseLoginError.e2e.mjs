import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createPortProbe } from "node:net";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Shared React UI only. A new localhost server, Chrome profile, CDP and BH per run.
const client = resolve(import.meta.dirname, "../../..");
assert.ok(process.argv[2], "Pass a new evidence directory; existing evidence is never reused");
const evidence = resolve(process.argv[2]);
const cases = process.argv[3] ?? "reopen";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await access(chromePath);
await mkdir(dirname(evidence), { recursive: true });
await mkdir(evidence, { mode: 0o700 });
const scratch = await mkdtemp(join(tmpdir(), "uwork-login-error-"));
const daemonHome = await mkdtemp(join(tmpdir(), "bh-login-"));
const fixture = join(client, "packages/ui/test/enterprise-login-error/main.tsx");
await writeFile(
  join(scratch, "index.html"),
  `<!doctype html><html><head><title>Owned login error fixture</title></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
);
const portProbe = createPortProbe();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const fixturePort = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const server = await createServer({
  configFile: false,
  envFile: false,
  envDir: scratch,
  root: scratch,
  cacheDir: join(scratch, "vite-cache"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": join(client, "packages/ui/src") } },
  server: {
    host: "127.0.0.1",
    port: fixturePort,
    strictPort: true,
    fs: { allow: [client, scratch] },
  },
  logLevel: "error",
});
const children = new Map();
function processRows() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,lstart=,command="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
      return match
        ? { pid: Number(match[1]), ppid: Number(match[2]), birth: match[3], command: match[4] }
        : null;
    })
    .filter(Boolean);
}
function track() {
  const rows = processRows();
  let added;
  do {
    added = false;
    for (const row of rows)
      if (
        !children.has(row.pid) &&
        row.command !== "ps -axo pid=,ppid=,lstart=,command=" &&
        (row.ppid === process.pid || children.has(row.ppid))
      ) {
        children.set(row.pid, row);
        added = true;
      }
  } while (added);
}
function alive(row) {
  return processRows().some((current) => current.pid === row.pid && current.birth === row.birth);
}
let chrome, browser, cdpPort, origin;
let daemon;
function lsof(args) {
  try {
    return execFileSync("lsof", ["-nP", ...args], { encoding: "utf8" });
  } catch (error) {
    if (error.status === 1 && !error.stdout) return "";
    throw error;
  }
}
const tracker = setInterval(track, 100);
try {
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const profile = join(scratch, "chrome");
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "--no-proxy-server",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      cdpPort = Number(
        (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
      );
      break;
    } catch {
      await delay(25);
    }
  }
  assert.ok(cdpPort, "Own Chrome must have its own CDP endpoint");
  await writeFile(
    join(evidence, "runtime.json"),
    JSON.stringify(
      {
        pid: process.pid,
        origin,
        chromePid: chrome.pid,
        cdpPort,
        profile,
        scratch,
        daemonHome,
        rootEnvFilesExcluded: true,
        nativeTouched: false,
        actualWecomAndModels: 0,
      },
      null,
      2,
    ),
  );
  const driver = await readFile(
    join(client, "packages/ui/test/enterprise-login-error/driver.py"),
    "utf8",
  );
  browser = spawn("browser-harness", [], {
    cwd: scratch,
    env: {
      ...process.env,
      BH_HOME: daemonHome,
      BH_RUNTIME_DIR: join(daemonHome, "runtime"),
      BH_TMP_DIR: join(daemonHome, "tmp"),
      BH_AGENT_WORKSPACE: join(daemonHome, "agent-workspace"),
      BH_CONFIG_DIR: daemonHome,
      BU_NAME: "default",
      BU_CDP_URL: `http://127.0.0.1:${cdpPort}`,
      BH_RECORD: "0",
    },
    stdio: ["pipe", "inherit", "inherit"],
  });
  const browserExit = new Promise((done) => {
    // 先结算为值，避免 daemon 归属等待期间的 spawn error 变成未处理 rejection。
    browser.once("error", (error) => done({ error }));
    browser.once("exit", (exit) => done({ exit }));
  });
  browser.stdin.end(
    `EVIDENCE=${JSON.stringify(evidence)}\nORIGIN=${JSON.stringify(origin)}\nCASES=${JSON.stringify(cases)}\n` +
      driver,
  );
  // BH daemon may reparent before the driver exits. Its owned PID file and socket,
  // not a generic command name or ancestry alone, establish cleanup ownership.
  for (let attempt = 0; attempt < 200 && !daemon; attempt++) {
    try {
      const runtime = join(daemonHome, "runtime");
      const files = (await readdir(runtime)).filter((name) => /^bu(?:-[\w-]+)?\.pid$/.test(name));
      assert.equal(files.length, 1, "Exactly one daemon PID file in this run's owned runtime");
      const pid = Number((await readFile(join(runtime, files[0]), "utf8")).trim());
      const row = processRows().find((current) => current.pid === pid);
      assert.ok(
        row && /(?:^|\s)-m browser_harness\.daemon(?:\s|$)/.test(row.command),
        "Owned daemon PID must still name BH daemon",
      );
      const sockets = lsof(["-a", "-p", String(pid), "-U", "-Fn"]);
      if (!sockets.includes(join(runtime, "bu.sock"))) {
        await delay(25);
        continue;
      }
      daemon = { ...row, pidFile: join(runtime, files[0]), sockets };
      children.set(pid, row);
      await writeFile(join(evidence, "daemon-owner.json"), JSON.stringify(daemon, null, 2));
    } catch (error) {
      if (error.code !== "ENOENT" && !(error.code === "ERR_ASSERTION" && !daemon)) throw error;
      await delay(25);
    }
  }
  const result = await browserExit;
  if (result.error) throw result.error;
  assert.ok(daemon, "Unverified BH daemon; preserve owned roots on cleanup");
  if (result.exit !== 0) process.exitCode = Number(result.exit ?? 1);
} finally {
  clearInterval(tracker);
  track();
  await server.close();
  if (browser?.exitCode === null && browser?.signalCode === null) browser.kill("SIGTERM");
  if (chrome?.exitCode === null && chrome?.signalCode === null) chrome.kill("SIGTERM");
  for (const row of [...children.values()].reverse())
    if (alive(row)) {
      try {
        process.kill(row.pid, "SIGTERM");
      } catch {}
    }
  await delay(300);
  for (const row of [...children.values()].reverse())
    if (alive(row)) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch {}
    }
  await delay(100);
  const remaining = [...children.values()].filter(alive);
  const ports = [origin && Number(new URL(origin).port), cdpPort].filter(Boolean);
  const tcp = ports.map((port) => ({ port, descriptors: lsof([`-iTCP:${port}`, "-Fpcn"]) }));
  const unixSockets = lsof(["-U", "-Fpcn"])
    .split("\n")
    .filter((line) => line.includes(daemonHome));
  const allClosed =
    !!daemon &&
    remaining.length === 0 &&
    tcp.every((item) => !item.descriptors) &&
    unixSockets.length === 0;
  if (allClosed) {
    await rm(daemonHome, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
  await writeFile(
    join(evidence, "cleanup.json"),
    JSON.stringify(
      {
        ownViteClosed: !server.httpServer.listening,
        knownProcesses: [...children.values()],
        remaining,
        ports,
        daemon,
        tcp,
        unixSockets,
        allClosed,
        ownScratchRemoved: allClosed,
        nativeTouched: false,
      },
      null,
      2,
    ),
  );
  assert.ok(allClosed, "Own process or listener remains; scratch preserved");
}
