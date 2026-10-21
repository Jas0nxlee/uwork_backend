import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { connectViaWebSocket } from "../../clients/uwork/packages/client/src/websocket.ts";

const metadata = JSON.parse(await readFile("/input/metadata.json", "utf8"));
const root = "/work/server";
const marker = "UWORK_STATEFUL_UPDATE_OWNED_20261020";
const history = [
  {
    role: "user",
    content: marker + " USER imported test fixture; no model request",
  },
  {
    role: "assistant",
    content:
      marker + " ASSISTANT imported test fixture; not generated inference",
  },
];
const facts = {
  status: "failed",
  startedAt: Date.now(),
  checks: [],
  commands: [],
  phases: [],
  connections: [],
  cleanup: {},
  archives: metadata,
};
const pids = new Set();
const ports = new Set();
const sockets = [];
let inferenceRequests = 0;
let catalog;
let launcher = "/bootstrap/bin/zcode";
const receipts = [];
const server = createServer((req, res) => {
  receipts.push(req.url);
  if (req.url === "/catalog.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(catalog));
  } else if (["/old.tar.gz", "/new.tar.gz"].includes(req.url)) {
    createReadStream("/input" + req.url).pipe(res);
  } else if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: [{ id: "owned-stateful-model", object: "model" }],
      }),
    );
  } else if (req.url.startsWith("/v1/")) {
    inferenceRequests++;
    res
      .writeHead(500)
      .end("No prompt is allowed in this state-persistence test");
  } else res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
ports.add(server.address().port);
const env = {
  PATH: "/bootstrap/runtime:/usr/bin:/bin",
  HOME: "/work/home",
  TMPDIR: "/tmp",
  NODE_ENV: "production",
  ZCODE_DATA_BASE_DIR: root,
  ZCODE_SERVER_ROOT: root,
  ZCODE_SERVER_SKIP_SERVICE_REGISTRATION: "1",
  ZCODE_SERVER_RELEASE_MANIFEST_URL: origin + "/catalog.json",
};
if (metadata.clockRollback)
  env.NODE_OPTIONS = "--import /input/clock-preload.mjs";

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Test observation timed out: " + label);
          error.code = "OWNED_OBSERVATION_TIMEOUT";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cli(args, expected = 0) {
  const child = spawn(launcher, [...args, "--server-root", root, "--json"], {
    env,
    cwd: "/work",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    timedOut = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 60000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  const value = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .at(-1);
  facts.commands.push({
    args,
    launcher,
    code,
    value,
    timedOut,
    stderr: stderr.slice(-1600),
  });
  if (value?.pid) pids.add(value.pid);
  if (value?.port) ports.add(value.port);
  assert.equal(timedOut, false);
  assert.equal(code, expected);
  assert.ok(value);
  return value;
}

async function ready(previousPid) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await cli(["status"]);
    if (state.state === "ready" && state.pid !== previousPid) return state;
    await delay(100);
  }
  throw new Error("Original Core did not become ready");
}

function release(which) {
  const item = metadata[which];
  catalog = {
    schemaVersion: 1,
    releases: [
      {
        version: item.appVersion,
        target: item.target,
        archiveUrl: origin + "/" + which + ".tar.gz",
        archiveSha256: item.sha256,
        archiveSizeBytes: item.size,
      },
    ],
  };
}

async function httpInfo(status) {
  const response = await fetch(
    `http://127.0.0.1:${status.port}/api/server-info`,
    { signal: AbortSignal.timeout(5000) },
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.capabilities.websocketRpc, true);
  facts.httpObservations ??= [];
  facts.httpObservations.push({
    corePid: status.pid,
    port: status.port,
    status: response.status,
    version: value.version,
    websocketRpc: value.capabilities.websocketRpc,
  });
  return value;
}

async function connect(status, phase) {
  const row = {
    phase,
    corePid: status.pid,
    port: status.port,
    openedAt: Date.now(),
  };
  let closedResolve;
  const closed = new Promise((resolve) => {
    closedResolve = resolve;
  });
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
    "original client connect",
  );
  facts.connections.push(row);
  return { services, closed, row };
}

let workspacePath;
let taskId;
let providerId;
let initialSessionTitle;
let initialMessages;
async function observe(services, phase) {
  const settings = await bounded(
    services.settingService.get(),
    15000,
    "setting get",
  );
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
  const runtime =
    await services.zcodeSessionService.getWorkspaceRuntimeIdentity({
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
  assert.ok(
    providers.providers.some((entry) => entry.providerId === providerId),
  );
  assert.equal(settings.locale, "en-US");
  assert.equal(settings.terminalInheritSystemProfile, false);
  assert.equal(file.content, "# " + marker + "\nowned-stateful-ignore/**\n");
  assert.equal(ignore.content, file.content);
  assert.equal(ignore.source, "file");
  assert.ok(task);
  assert.equal(
    task.title,
    marker,
    "Original Task index must preserve its required title",
  );
  assert.equal(session.session.sessionId, taskId);
  // Task.renameTask explicitly treats the separate Agent title sync as best-effort.
  // Preserve a nonempty observed Session title; do not invent a synchronous title contract.
  if (initialSessionTitle === undefined)
    initialSessionTitle = session.session.title;
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
  if (initialMessages === undefined)
    initialMessages = structuredClone(session.messages);
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

async function endpointClosed(options) {
  return await new Promise((resolve) => {
    const socket = createConnection(options);
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) =>
      resolve(["ENOENT", "ECONNREFUSED"].includes(error.code)),
    );
  });
}

const deadline = setTimeout(() => {
  throw new Error("Stateful update total deadline");
}, 230000);
try {
  assert.equal(process.version, "v22.16.0");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "arm64");
  assert.notEqual(metadata.old.sha256, metadata.new.sha256);
  await mkdir("/work/home", { recursive: true });
  const boot = await cli(["serve", "--daemon"]);
  assert.equal(boot.state, "ready");
  assert.equal(boot.serviceRegistered, false);
  const lock = JSON.parse(await readFile(root + "/run/server.lock", "utf8"));
  pids.add(lock.pid);
  release("old");
  assert.equal((await cli(["update"])).applied, true);
  const old = await ready(boot.pid);
  assert.equal((await httpInfo(old)).version, "0.0.0-dev");
  const original = await connect(old, "old-core");
  const services = original.services;
  workspacePath = (
    await services.fileService.createScratchWorkspace({
      name: "uwork-stateful-update-owned",
    })
  ).path;
  assert.ok(workspacePath.startsWith("/work/home/"));
  await services.fileService.writeWorkspaceFileSearchIgnore({
    rootPath: workspacePath,
    content: "# " + marker + "\nowned-stateful-ignore/**\n",
  });
  await services.settingService.update({
    locale: "en-US",
    terminalInheritSystemProfile: false,
  });
  facts.checks.push("original-file-and-setting-rpc-write");
  const created = await services.providerSettingsService.createPersonalProvider(
    {
      providerName: "Owned stateful local provider",
      initialConfig: {
        api: { type: "openai-chat-completions", baseUrl: origin + "/v1" },
        access: {
          type: "api-key",
          apiKey: "owned-stateful-local-only-not-a-real-credential",
        },
      },
    },
  );
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
  await services.providerSettingsService.refresh(
    "owned-stateful-session-prerequisite",
  );
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
  facts.idleBeforeUpdate = idle;
  assert.equal(
    idle.runningTaskCount,
    0,
    "No prompt was started; preserve unexpected busy behavior",
  );
  release("new");
  facts.updateStartedAt = Date.now();
  assert.equal((await cli(["update"])).applied, true);
  const close = await bounded(
    original.closed,
    15000,
    "old original WebSocket natural close",
  );
  facts.oldSocketNaturalClose = close;
  assert.ok(original.row.closedAt >= facts.updateStartedAt);
  facts.checks.push(
    "original-update-while-idle-websocket-connected-natural-close",
  );
  let staleError;
  try {
    await bounded(
      services.settingService.get(),
      2000,
      "retired original proxy rejection",
    );
  } catch (error) {
    staleError = error;
  }
  assert.ok(staleError);
  assert.notEqual(staleError.code, "OWNED_OBSERVATION_TIMEOUT");
  facts.retiredProxyError = String(staleError).slice(0, 500);
  const updated = await ready(old.pid);
  assert.equal((await httpInfo(updated)).version, "3.16.0");
  const pointer = JSON.parse(await readFile(root + "/current.json", "utf8"));
  assert.equal(pointer.archiveSha256, metadata.new.sha256);
  launcher = root + "/bin/zcode";
  const next = await connect(updated, "updated-core");
  await observe(next.services, "new-core-original-rpc-restored");
  facts.checks.push(
    "new-core-http-original-client-reconnect-and-persisted-state",
  );
  assert.deepEqual(await cli(["restart"]), { restarting: true });
  await bounded(next.closed, 15000, "updated Core restart socket close");
  const restarted = await ready(updated.pid);
  assert.equal((await httpInfo(restarted)).version, "3.16.0");
  const final = await connect(restarted, "restarted-core");
  await observe(final.services, "restart-original-rpc-restored");
  facts.checks.push("restart-http-original-client-and-state-preserved");
  await cli(["stop"]);
  await bounded(final.closed, 15000, "original stop WebSocket close");
  facts.checks.push("original-stop-naturally-closes-last-original-client");
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
} finally {
  for (const socket of sockets)
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  if (!(await endpointClosed({ path: root + "/run/control.sock" })))
    await cli(["stop"]).catch((error) => {
      facts.cleanup.stopFailure = String(error);
    });
  await bounded(
    new Promise((resolve) => server.close(resolve)),
    5000,
    "catalog close",
  ).catch((error) => {
    facts.cleanup.catalogFailure = String(error);
  });
  for (let i = 0; i < 100; i++) {
    const alive = [...pids].filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!alive.length) break;
    await delay(100);
  }
  facts.cleanup.pids = [...pids].map((pid) => {
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    return { pid, alive };
  });
  facts.cleanup.ports = [];
  for (const port of ports)
    facts.cleanup.ports.push({
      port,
      closed: await endpointClosed({ host: "127.0.0.1", port }),
    });
  facts.cleanup.controlSocketClosed = await endpointClosed({
    path: root + "/run/control.sock",
  });
  if (
    facts.cleanup.pids.some((row) => row.alive) ||
    facts.cleanup.ports.some((row) => !row.closed) ||
    !facts.cleanup.controlSocketClosed
  )
    facts.status = "failed";
  facts.receipts = receipts;
  facts.inferenceRequests = inferenceRequests;
  if (inferenceRequests !== 0) facts.status = "failed";
  if (metadata.clockRollback) {
    try {
      facts.clockJournal = (
        await readFile("/work/clock-agent-journal.jsonl", "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const ready = facts.clockJournal.filter(
        (row) => row.event === "original-startup-ready-clock-restored",
      );
      assert.equal(
        ready.length,
        2,
        "Both actual new Agent starts must exercise the process-local rollback fixture",
      );
      assert.ok(
        ready.every(
          (row) =>
            row.agentSha256 === metadata.new.agentSha256 &&
            row.states.at(-1)?.phase === "ready" &&
            row.states.every(
              (state) =>
                Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0,
            ),
        ),
      );
      facts.checks.push(
        "actual-new-agent-clock-rollback-original-ready-schema-preserved",
      );
    } catch (error) {
      facts.status = "failed";
      facts.clockFailure = String(error);
    }
  }
  facts.finishedAt = Date.now();
  clearTimeout(deadline);
  await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n");
  console.log(
    JSON.stringify({
      status: facts.status,
      checks: facts.checks,
      failure: facts.failure,
    }),
  );
}
process.exitCode = facts.status === "passed" ? 0 : 1;
