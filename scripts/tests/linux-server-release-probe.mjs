import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import * as rpc from "../../clients/uwork/packages/rpc/src/index.ts";
import { RemoteServiceAccess } from "../../clients/uwork/packages/client/src/remoteServiceAccess.ts";

const require = createRequire("/release/runtime/package.json");
const WebSocket = require("ws");
const root = "/work/server";
const sentinel = "UWORK_LINUX_RELEASE_SENTINEL\n";
const env = {
  PATH: "/release/runtime:/usr/bin:/bin",
  HOME: "/work/home",
  TMPDIR: "/tmp",
  NODE_ENV: "production",
  ZCODE_DATA_BASE_DIR: root,
  ZCODE_SERVER_ROOT: root,
  ZCODE_SERVER_SKIP_SERVICE_REGISTRATION: "1",
};
const facts = {
  status: "failed",
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  checks: [],
  commands: [],
  cleanup: {},
};
const pids = new Set(),
  ports = new Set(),
  sockets = [];

async function execute(
  command,
  args,
  timeout = 30000,
  confirmUninstall = false,
) {
  const child = spawn(command, args, {
    cwd: "/work",
    env,
    stdio: [confirmUninstall ? "pipe" : "ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    timedOut = false;
  let confirmations = 0;
  child.stdout.on("data", (data) => {
    stdout += data;
    const prompts = stdout.split("Type DELETE").length - 1;
    if (confirmUninstall && prompts === confirmations + 1 && prompts <= 2) {
      confirmations += 1;
      child.stdin.write("DELETE\n");
    }
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeout);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(timedOut, false, "Owned command timed out");
  return { code, stdout, stderr, confirmations };
}

async function cli(...args) {
  const result = await execute("/release/bin/zcode", [
    ...args,
    "--server-root",
    root,
    "--json",
  ]);
  const lines = result.stdout.split("\n").filter((s) => s.startsWith("{"));
  const value = lines.length ? JSON.parse(lines.at(-1)) : null;
  facts.commands.push({
    args,
    exitCode: result.code,
    value,
    stderr: result.stderr.slice(-2000),
  });
  if (value?.pid) pids.add(value.pid);
  if (value?.port) ports.add(value.port);
  assert.equal(result.code, 0, `Original ${args[0]} failed`);
  assert.ok(value);
  return value;
}

async function waitReady(previousPid) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const status = await cli("status");
    if (status.state === "ready" && status.pid !== previousPid) return status;
    await delay(200);
  }
  throw new Error("Original status did not become ready");
}

async function sentinelRpc(status) {
  const socket = new WebSocket(`ws://127.0.0.1:${status.port}/ws`);
  sockets.push(socket);
  const data = new rpc.Emitter(),
    close = new rpc.Emitter(),
    end = new rpc.Emitter();
  socket.on("message", (body) =>
    data.fire(rpc.VSBuffer.wrap(new Uint8Array(body))),
  );
  socket.on("error", () => {});
  socket.once("close", () => {
    close.fire();
    end.fire();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const protocol = new rpc.SocketProtocol({
    onData: data.event,
    onClose: close.event,
    onEnd: end.event,
    write(buffer) {
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
  const client = new rpc.ChannelClient(protocol);
  try {
    const services = new RemoteServiceAccess(client);
    const file = await services.fileService.readTextFile({
      path: "/work/workspace/sentinel.txt",
    });
    const system = await services.systemService.info();
    assert.equal(file.content, sentinel);
    assert.deepEqual(system, { homedir: "/work/home", platform: "linux" });
  } finally {
    const closed = new Promise((resolve) => socket.once("close", resolve));
    client.dispose();
    protocol.dispose();
    socket.close();
    await closed;
    data.dispose();
    close.dispose();
    end.dispose();
  }
}

async function endpointClosed(options) {
  return await new Promise((resolve) => {
    const connection = createConnection(options);
    connection.setTimeout(1000);
    connection.once("connect", () => {
      connection.destroy();
      resolve(false);
    });
    connection.once("timeout", () => {
      connection.destroy();
      resolve(false);
    });
    connection.once("error", (error) =>
      resolve(["ENOENT", "ECONNREFUSED"].includes(error.code)),
    );
  });
}

const deadline = setTimeout(() => {
  throw new Error("Linux probe exceeded total deadline");
}, 120000);
try {
  assert.equal(process.version, "v22.16.0");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "arm64");
  await mkdir("/work/home", { recursive: true });
  await mkdir("/work/workspace", { recursive: true });
  await writeFile("/work/workspace/sentinel.txt", sentinel);
  facts.checks.push("packaged-node22-linux-arm64");
  for (const [directory, name] of [
    ["ripgrep", "rg"],
    ["bfs", "bfs"],
    ["ugrep", "ugrep"],
  ]) {
    const result = await execute(
      `/release/runtime/tools/${directory}/${name}`,
      ["--version"],
    );
    assert.equal(result.code, 0, `${name} target binary failed`);
  }
  facts.checks.push("packaged-native-search-executed");
  const agent = await execute("/release/runtime/node", [
    "/release/runtime/zcode.cjs",
    "--version",
  ]);
  facts.agent = {
    exitCode: agent.code,
    version: agent.stdout.trim().slice(0, 160),
    stderr: agent.stderr.slice(-1500),
  };
  assert.equal(agent.code, 0, "Packaged Agent did not load under Node22");
  assert.match(agent.stdout, /\d+\.\d+\.\d+/);
  facts.checks.push("packaged-agent-node22-load");
  const first = await cli("serve", "--daemon");
  assert.equal(first.state, "ready");
  assert.equal(first.serviceRegistered, false);
  const manifest = JSON.parse(await readFile("/release/manifest.json", "utf8"));
  facts.releaseVersion = manifest.appVersion;
  assert.equal(
    first.version,
    manifest.appVersion,
    "Runtime version differs from staged release",
  );
  const response = await fetch(
    `http://127.0.0.1:${first.port}/api/server-info`,
  );
  assert.equal(response.status, 200);
  const info = await response.json();
  assert.equal(info.version, manifest.appVersion);
  assert.equal(info.authRequired, false);
  assert.equal(info.capabilities.websocketRpc, true);
  facts.checks.push("packaged-server-http-ready");
  await sentinelRpc(first);
  facts.checks.push("original-websocket-file-and-system");
  assert.deepEqual(await cli("restart"), { restarting: true });
  const next = await waitReady(first.pid);
  assert.equal(next.generation, first.generation + 1);
  await sentinelRpc(next);
  facts.checks.push("restart-new-core-and-websocket");
  await cli("stop");
  await delay(1000);
  assert.equal((await cli("status")).state, "stopped");
  facts.checks.push("original-stop");
  const removed = await execute(
    "/release/bin/zcode",
    ["uninstall", "--server-root", root, "--json"],
    20000,
    true,
  );
  facts.uninstall = {
    exitCode: removed.code,
    confirmations: removed.confirmations,
    completed: removed.stdout.includes('"uninstalled":true'),
  };
  assert.deepEqual(facts.uninstall, {
    exitCode: 0,
    confirmations: 2,
    completed: true,
  });
  facts.checks.push("original-uninstall-natural-exit");
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
} finally {
  for (const socket of sockets) socket.terminate();
  if ((await endpointClosed({ path: root + "/run/control.sock" })) === false) {
    await cli("stop").catch((error) => {
      facts.cleanup.stopFailure = String(error);
    });
    await delay(1000);
  }
  facts.cleanup.pidsAbsent = Object.fromEntries(
    [...pids].map((pid) => {
      try {
        process.kill(pid, 0);
        return [pid, false];
      } catch (error) {
        return [pid, error.code === "ESRCH"];
      }
    }),
  );
  facts.cleanup.portsClosed = Object.fromEntries(
    await Promise.all(
      [...ports].map(async (port) => [
        port,
        await endpointClosed({ host: "127.0.0.1", port }),
      ]),
    ),
  );
  facts.cleanup.controlSocketClosed = await endpointClosed({
    path: root + "/run/control.sock",
  });
  if (
    !facts.cleanup.controlSocketClosed ||
    Object.values(facts.cleanup.pidsAbsent).includes(false) ||
    Object.values(facts.cleanup.portsClosed).includes(false)
  )
    facts.status = "failed";
  clearTimeout(deadline);
  await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n");
}
process.stdout.write(JSON.stringify(facts) + "\n");
process.exitCode = facts.status === "passed" ? 0 : 1;
