import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectViaWebSocket } from "../../clients/uwork/packages/client/src/websocket.ts";
import { stablePathId } from "../../clients/uwork/packages/zcode-server-cli/src/runtime/paths.ts";

assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const name = process.argv[2];
assert.match(name ?? "", /^client-macos-server-service-update-[a-z0-9-]+$/);
const repo = process.cwd();
const evidence = join(repo, "evidence", name);
await mkdir(evidence, { mode: 0o700 });
const scratch = await realpath(await mkdtemp("/tmp/uwmupd-"));
const root = join(scratch, "server");
await mkdir(root, { mode: 0o700 });
const stage =
  "/Users/ljp/Library/Caches/uwork-backend/client-macos-server-service-update-20261020/new";
const bootstrap = [join(stage, "runtime/node"), join(stage, "runtime/server-cli.js")];
const label = "com.zhipu.zcode.server." + stablePathId(root);
const domain = `gui/${process.getuid()}/${label}`;
const descriptor = join(root, "service", label + ".plist");
const marker = "UWORK_MAC_SERVICE_UPDATE_OWNED_20261020";
const history = [
  { role: "user", content: marker + " USER imported fixture; no inference" },
  { role: "assistant", content: marker + " ASSISTANT imported fixture; no inference" },
];
const facts = {
  status: "failed",
  root,
  label,
  startedAt: Date.now(),
  checks: [],
  commands: [],
  phases: [],
  connections: [],
  cleanup: {},
  profileGuards: [],
};
const pids = new Set(),
  ports = new Set(),
  sockets = [],
  receipts = [];
let inferenceRequests = 0,
  catalog;
const archivePaths = {
  old: "/Users/ljp/Library/Caches/uwork-backend/client-macos-server-service-update-20261020/old.tar.gz",
  new: stage + ".tar.gz",
};
const metadata = {};
for (const [key, path] of Object.entries(archivePaths)) {
  const tree = key === "old" ? path.slice(0, -7) : stage;
  const manifest = JSON.parse(await readFile(join(tree, "manifest.json"), "utf8"));
  metadata[key] = {
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    size: (await stat(path)).size,
    appVersion: manifest.appVersion,
    target: manifest.target,
  };
  assert.equal(manifest.target, "darwin-arm64");
  assert.equal(manifest.appVersion, "3.16.0");
}
assert.notEqual(metadata.old.sha256, metadata.new.sha256);
facts.archives = metadata;
const server = createServer((req, res) => {
  receipts.push(req.url);
  if (req.url === "/catalog.json")
    res.setHeader("content-type", "application/json").end(JSON.stringify(catalog));
  else if (req.url === "/old.tar.gz" || req.url === "/new.tar.gz")
    createReadStream(archivePaths[req.url.slice(1, -7)]).pipe(res);
  else if (req.url === "/v1/models")
    res
      .setHeader("content-type", "application/json")
      .end(JSON.stringify({ data: [{ id: "owned-stateful-model", object: "model" }] }));
  else if (req.url.startsWith("/v1/")) {
    inferenceRequests++;
    res.writeHead(500).end("Inference forbidden in this owned persistence probe");
  } else res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
ports.add(server.address().port);
const env = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: join(scratch, "caller-home"),
  TMPDIR: scratch,
  NODE_ENV: "production",
  ZCODE_SERVER_RELEASE_MANIFEST_URL: origin + "/catalog.json",
};
await mkdir(env.HOME, { mode: 0o700 });
function os(command, args) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 5000 });
}
function job() {
  return os("launchctl", ["print", domain]);
}
function disabled() {
  const result = os("launchctl", ["print-disabled", `gui/${process.getuid()}`]);
  assert.equal(result.status, 0);
  return result.stdout.split("\n").filter((x) => x.includes("com.zhipu.zcode.server."));
}
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error("Observation timeout: " + label);
          e.code = "OWNED_OBSERVATION_TIMEOUT";
          reject(e);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function cli(args) {
  const child = spawn(bootstrap[0], [bootstrap[1], ...args, "--server-root", root, "--json"], {
    env,
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (x) => (stdout += x));
  child.stderr.on("data", (x) => (stderr += x));
  const code = await bounded(
    new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    }),
    65000,
    "original CLI " + args[0],
  ).catch((e) => {
    child.kill("SIGKILL");
    throw e;
  });
  const value = stdout
    .split("\n")
    .filter((x) => x.startsWith("{"))
    .map((x) => JSON.parse(x))
    .at(-1);
  facts.commands.push({ args, code, value, stderr: stderr.slice(-1500) });
  assert.equal(code, 0);
  assert.ok(value);
  if (value.pid) pids.add(value.pid);
  if (value.port) ports.add(value.port);
  return value;
}
async function ready(previous) {
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    const x = await cli(["status"]);
    if (x.state === "ready" && x.pid !== previous) return x;
    await delay(100);
  }
  throw new Error("Core ready deadline");
}
function release(key) {
  const x = metadata[key];
  catalog = {
    schemaVersion: 1,
    releases: [
      {
        version: x.appVersion,
        target: x.target,
        archiveUrl: origin + "/" + key + ".tar.gz",
        archiveSha256: x.sha256,
        archiveSizeBytes: x.size,
      },
    ],
  };
}
async function connect(status, phase) {
  let closedResolve;
  const closed = new Promise((resolve) => (closedResolve = resolve));
  const row = { phase, corePid: status.pid, port: status.port, openedAt: Date.now() };
  const services = await bounded(
    connectViaWebSocket(`ws://127.0.0.1:${status.port}/ws`, {
      onOpenSocket(socket) {
        sockets.push(socket);
      },
      onClose(event) {
        row.closedAt = Date.now();
        row.close = event;
        closedResolve(event);
      },
    }),
    8000,
    "original SDK connect",
  );
  facts.connections.push(row);
  return { services, closed, row };
}
async function guard(status, services, phase) {
  const observed = os("ps", ["eww", "-p", String(status.pid), "-o", "command="]);
  assert.equal(observed.status, 0);
  const keys = [
    "HOME",
    "USERPROFILE",
    "ZCODE_DESKTOP_HOME_DIR",
    "UWORK_DATA_BASE_DIR",
    "ZCODE_DATA_BASE_DIR",
    "ZCODE_STORAGE_DIR",
    "ZCODE_SERVER_ROOT",
  ];
  const profile = {};
  for (const key of keys) {
    const match = observed.stdout.match(new RegExp("(?:^|\\s)" + key + "=([^\\s]+)"));
    profile[key] = match?.[1];
    assert.equal(profile[key], key === "ZCODE_STORAGE_DIR" ? join(root, ".uwork") : root);
  }
  const info = await services.systemService.info();
  assert.equal(info.homedir, root);
  const response = await fetch(`http://127.0.0.1:${status.port}/api/server-info`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const http = await response.json();
  assert.equal(http.version, "3.16.0");
  facts.profileGuards.push({
    phase,
    corePid: status.pid,
    profile,
    SDKHomedir: info.homedir,
    httpVersion: http.version,
    guardedBeforeBusinessWrite: true,
  });
}
async function uninstall() {
  const child = spawn(bootstrap[0], [bootstrap[1], "uninstall", "--server-root", root, "--json"], {
    env,
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "",
    stderr = "",
    confirmations = 0;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const count = (output.match(/Type DELETE/g) || []).length;
    if (count > confirmations) {
      assert.equal(count, confirmations + 1);
      assert.ok(count <= 2);
      child.stdin.write("DELETE\n");
      confirmations = count;
    }
  });
  child.stderr.on("data", (x) => (stderr += x));
  const code = await bounded(
    new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    }),
    20000,
    "owned uninstall confirmations",
  ).catch((e) => {
    child.kill("SIGKILL");
    throw e;
  });
  facts.uninstall = { code, confirmations, stderr: stderr.slice(-1000) };
  assert.equal(code, 0);
  assert.equal(confirmations, 2);
  assert.ok(output.includes('"uninstalled":true'));
}
async function portClosed(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/server-info`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}
let workspacePath;
let taskId;
let providerId;
let initialSessionTitle;
let initialMessages;
async function observe(services, phase) {
  const settings = await bounded(services.settingService.get(), 15000, "setting get");
  const file = await bounded(
    services.fileService.readTextFile({
      path: workspacePath + "/.zcodeignore",
    }),
    15000,
    "file read",
  );
  const ignore = await services.fileService.readWorkspaceFileSearchIgnore({
    rootPath: workspacePath,
  });
  const tasks = await bounded(
    services.zcodeTaskService.listTasks({ workspacePath }),
    20000,
    "task list",
  );
  const task = tasks.find((entry) => entry.taskId === taskId);
  if (phase !== "old-original-rpc-seed") {
    // The original UI resumes a persisted task after Core/runtime replacement;
    // readSession only reads an already-active record and does not cold-restore it.
    const resumed = await bounded(
      services.zcodeTaskService.resumeTask({
        taskId,
        workspacePath,
        mcpServers: [],
      }),
      30000,
      "original same-ID task resume",
    );
    assert.equal(resumed.taskId, taskId);
    facts.resumeOperations ??= [];
    facts.resumeOperations.push({
      phase,
      taskId: resumed.taskId,
      workspacePath: resumed.workspacePath,
      suppliedModeOrModel: false,
    });
  }
  const session = await bounded(
    services.zcodeSessionService.readSession({
      workspacePath,
      sessionId: taskId,
    }),
    30000,
    "session read",
  );
  const providers = await services.providerSettingsService.getView();
  const runtime = await services.zcodeSessionService.getWorkspaceRuntimeIdentity({
    workspacePath,
  });
  if (runtime.processId) pids.add(runtime.processId);
  facts.observations ??= [];
  facts.observations.push({
    phase,
    taskTitle: task?.title,
    sessionTitle: session.session.title,
    taskId,
    actualSessionId: session.session.sessionId,
    mode: session.settings.mode.current,
    model: session.settings.model.current,
    thoughtLevel: session.settings.thoughtLevel.current,
    messageCount: session.messages.length,
    runtime,
  });
  assert.ok(providers.providers.some((entry) => entry.providerId === providerId));
  assert.equal(settings.locale, "en-US");
  assert.equal(settings.terminalInheritSystemProfile, false);
  assert.equal(file.content, "# " + marker + "\nowned-stateful-ignore/**\n");
  assert.equal(ignore.content, file.content);
  assert.equal(ignore.source, "file");
  assert.ok(task);
  assert.equal(task.title, marker, "Original Task index must preserve its required title");
  assert.equal(session.session.sessionId, taskId);
  // Task.renameTask explicitly treats the separate Agent title sync as best-effort.
  // Preserve a nonempty observed Session title; do not invent a synchronous title contract.
  if (initialSessionTitle === undefined) initialSessionTitle = session.session.title;
  assert.equal(
    session.session.title,
    initialSessionTitle,
    "Persisted original Session title changed",
  );
  assert.equal(session.settings.mode.current, "edit");
  assert.equal(session.settings.model.current.providerId, providerId);
  assert.equal(session.settings.model.current.modelId, "owned-stateful-model");
  assert.equal(session.settings.thoughtLevel.current, "none");
  assert.equal(session.messages.length, 2);
  assert.deepEqual(
    session.messages.map((message) => ({
      role: message.info.role,
      content: message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    })),
    history,
  );
  if (initialMessages === undefined) initialMessages = structuredClone(session.messages);
  assert.deepEqual(
    session.messages,
    initialMessages,
    "Original imported messages must retain all original fields and bytes",
  );
  const row = {
    phase,
    workspacePath,
    taskId,
    taskTitle: task.title,
    sessionTitle: session.session.title,
    sessionMode: session.settings.mode.current,
    messageCount: session.messages.length,
    settings: {
      locale: settings.locale,
      terminalInheritSystemProfile: settings.terminalInheritSystemProfile,
    },
    fileContent: file.content,
    runtime,
    providerId,
    messages: session.messages,
  };
  facts.phases.push(row);
  return row;
}

const beforeDisabled = disabled();
facts.disabledBefore = beforeDisabled;
try {
  const absent = job();
  assert.notEqual(absent.status, 0);
  assert.ok(absent.stderr.includes("Could not find service"));
  assert.ok(beforeDisabled.every((x) => !x.includes(label)));
  facts.checks.push("unique-launchd-label-absent-before");
  const boot = await cli(["serve", "--daemon"]);
  assert.equal(boot.state, "ready");
  assert.equal(boot.serviceRegistered, true);
  const plist = await readFile(descriptor, "utf8");
  assert.ok(plist.includes(label));
  assert.ok(plist.includes(root + "/bin/zcode"));
  assert.ok(plist.includes("--service-entry"));
  assert.ok(plist.includes(root));
  facts.descriptorSha256 = createHash("sha256").update(plist).digest("hex");
  const registered = job();
  assert.equal(registered.status, 0);
  assert.ok(registered.stdout.includes(root + "/bin/zcode"));
  const supervisor = Number(registered.stdout.match(/\n\s*pid = (\d+)/)[1]);
  pids.add(supervisor);
  facts.supervisorPid = supervisor;
  const initial = await connect(boot, "new-safe-bootstrap");
  await guard(boot, initial.services, "new-safe-bootstrap");
  sockets.at(-1).close();
  await initial.closed;
  facts.checks.push("original-registered-safe-supervisor-core-profile-before-write");
  release("old");
  assert.equal((await cli(["update"])).applied, true);
  const old = await ready(boot.pid);
  const original = await connect(old, "old-original-core");
  const services = original.services;
  await guard(old, services, "old-original-core-under-safe-supervisor");
  assert.equal(
    JSON.parse(await readFile(root + "/current.json", "utf8")).archiveSha256,
    metadata.old.sha256,
  );
  workspacePath = (await services.fileService.ensureConversationWorkspace()).path;
  assert.equal(workspacePath, join(root, ".uwork/workspace/default"));
  await services.fileService.writeWorkspaceFileSearchIgnore({
    rootPath: workspacePath,
    content: "# " + marker + "\nowned-stateful-ignore/**\n",
  });
  await services.settingService.update({
    locale: "en-US",
    terminalInheritSystemProfile: false,
  });
  facts.checks.push("original-file-and-setting-rpc-write");
  const created = await services.providerSettingsService.createPersonalProvider({
    providerName: "Owned stateful local provider",
    initialConfig: {
      api: { type: "openai-chat-completions", baseUrl: origin + "/v1" },
      access: {
        type: "api-key",
        apiKey: "owned-stateful-local-only-not-a-real-credential",
      },
    },
  });
  providerId = created.providerId;
  await services.providerSettingsService.addPersonalModel(
    providerId,
    "owned-stateful-model",
    {
      properties: { contextWindow: 128000 },
      optionSpecs: { reasoningLevel: { values: ["none"], map: "{}" } },
    },
    true,
  );
  await services.providerSettingsService.refresh("owned-stateful-session-prerequisite");
  const imported = await bounded(
    services.zcodeSessionService.createSession({
      workspacePath,
      mode: "edit",
      mcpServers: [],
      persistence: "immediate",
      model: {
        providerId,
        modelId: "owned-stateful-model",
        options: { reasoningLevel: "none" },
      },
      thoughtLevel: "none",
      importedHistory: {
        source: "claudeCode",
        title: marker,
        messages: history,
      },
    }),
    30000,
    "original history import",
  );
  taskId = imported.session.sessionId;
  assert.ok(taskId);
  facts.seedKind =
    "Original public importedHistory; two explicitly synthetic fixture messages, not model inference";
  await services.zcodeSessionService.setModel({
    workspacePath,
    sessionId: taskId,
    model: {
      providerId,
      modelId: "owned-stateful-model",
      options: { reasoningLevel: "none" },
    },
  });
  await services.zcodeTaskService.renameTask({
    workspacePath,
    taskId,
    title: marker,
  });
  const beforeMode = await services.zcodeSessionService.readSession({
    workspacePath,
    sessionId: taskId,
  });
  facts.modeBeforeExplicitSetter = beforeMode.settings.mode.current;
  const modeResult = await services.zcodeSessionService.setMode({
    workspacePath,
    sessionId: taskId,
    mode: "edit",
  });
  facts.explicitModeSetterResult = modeResult.settings.mode.current;
  assert.equal(
    modeResult.settings.mode.current,
    "edit",
    "Original Session setter must accept requested mode",
  );
  await observe(services, "old-original-rpc-seed");
  facts.checks.push("original-file-setting-task-session-rpc-seed-and-readback");

  const idle = await cli(["status"]);
  assert.equal(idle.runningTaskCount, 0);
  release("new");
  facts.updateStartedAt = Date.now();
  assert.equal((await cli(["update"])).applied, true);
  await bounded(original.closed, 15000, "old SDK natural close");
  let staleError;
  try {
    await bounded(services.settingService.get(), 2000, "retired proxy");
  } catch (e) {
    staleError = e;
  }
  assert.ok(staleError);
  assert.notEqual(staleError.code, "OWNED_OBSERVATION_TIMEOUT");
  facts.retiredProxyError = String(staleError).slice(0, 300);
  const updated = await ready(old.pid);
  assert.equal(
    JSON.parse(await readFile(root + "/current.json", "utf8")).archiveSha256,
    metadata.new.sha256,
  );
  const next = await connect(updated, "new-original-core");
  await guard(updated, next.services, "new-original-core");
  await observe(next.services, "new-core-original-rpc-restored");
  facts.checks.push("same-version-original-build-replacement-sdk-state-and-natural-disconnect");
  assert.deepEqual(await cli(["restart"]), { restarting: true });
  await bounded(next.closed, 15000, "restart natural SDK close");
  const restarted = await ready(updated.pid);
  const final = await connect(restarted, "restarted-original-core");
  await guard(restarted, final.services, "restarted-original-core");
  await observe(final.services, "restart-original-rpc-restored");
  facts.checks.push("registered-restart-core-agent-cold-restore-state");
  await cli(["stop"]);
  await bounded(final.closed, 15000, "stop SDK natural close");
  await delay(12000);
  assert.equal((await cli(["status"])).state, "stopped");
  facts.checks.push("registered-stop-no-launchd-respawn-12seconds");
  await uninstall();
  assert.notEqual(job().status, 0);
  assert.equal(
    await access(descriptor).then(
      () => true,
      () => false,
    ),
    false,
  );
  facts.checks.push("original-uninstall-double-confirmation-job-descriptor-removed");
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
  facts.failureStack = error.stack?.slice(0, 2000);
} finally {
  for (const socket of sockets) if (socket.readyState < WebSocket.CLOSING) socket.close();
  const remaining = job();
  if (remaining.status === 0) {
    facts.cleanup.stop = await cli(["stop"]).catch((e) => String(e));
    const removed = os("launchctl", ["unload", "-w", descriptor]);
    facts.cleanup.emergencyOwnedUnload = removed.status;
  }
  await bounded(new Promise((resolve) => server.close(resolve)), 5000, "owned HTTP catalog close");
  for (let i = 0; i < 100; i++) {
    if (
      [...pids].every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      })
    )
      break;
    await delay(100);
  }
  facts.cleanup.jobAbsent = job().status !== 0;
  facts.cleanup.pids = [...pids].map((pid) => {
    try {
      process.kill(pid, 0);
      return { pid, alive: true };
    } catch {
      return { pid, alive: false };
    }
  });
  facts.cleanup.ports = [];
  for (const port of ports) facts.cleanup.ports.push({ port, closed: await portClosed(port) });
  facts.disabledAfter = disabled();
  facts.cleanup.unrelatedDisabledUnchanged =
    JSON.stringify(facts.disabledAfter.filter((x) => !x.includes(label))) ===
    JSON.stringify(beforeDisabled);
  facts.cleanup.ownDisabledMetadata = facts.disabledAfter.filter((x) => x.includes(label));
  facts.cleanup.retainedBusinessSettingAfterUninstall = await access(
    join(root, ".uwork/v2/setting.json"),
  ).then(
    () => true,
    () => false,
  );
  if (facts.status === "passed")
    assert.equal(facts.cleanup.retainedBusinessSettingAfterUninstall, true);
  if (facts.cleanup.jobAbsent && facts.cleanup.pids.every((entry) => !entry.alive))
    await rm(scratch, { recursive: true, force: true });
  facts.cleanup.ownedScratchRemoved = !(await access(scratch).then(
    () => true,
    () => false,
  ));
  facts.receipts = receipts;
  facts.inferenceRequests = inferenceRequests;
  facts.finishedAt = Date.now();
  if (
    !facts.cleanup.jobAbsent ||
    facts.cleanup.pids.some((x) => x.alive) ||
    facts.cleanup.ports.some((x) => !x.closed) ||
    !facts.cleanup.unrelatedDisabledUnchanged ||
    inferenceRequests !== 0
  )
    facts.status = "failed";
  await writeFile(join(evidence, "result.json"), JSON.stringify(facts, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: facts.status,
      checks: facts.checks,
      failure: facts.failure,
      root,
      label,
      ownDisabledMetadata: facts.cleanup.ownDisabledMetadata,
    }),
  );
}
process.exitCode = facts.status === "passed" ? 0 : 1;
