import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const { app, utilityProcess, MessageChannelMain } = createRequire(
  import.meta.url,
)("electron");
const configPath = process.argv
  .find((arg) => arg.startsWith("--fixture-config="))
  ?.slice(17);
if (!configPath) throw new Error("Owned Host fixture config required");
const config = JSON.parse(await readFile(configPath, "utf8"));
const { ChannelClient, MessagePortProtocol } = await import(
  pathToFileURL(config.rpcModule).href
);
app.setPath("userData", config.electronUserData);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
const prefix = "UWORK_AUTOMATION_RPC ";
const emit = (value) =>
  process.stdout.write(prefix + JSON.stringify(value) + "\n");
let child, client, protocol, exitPromise;
const bounded = (promise, label, timeout = 20000) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timeout")), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};
async function startHost() {
  if (child) throw new Error("Owned Host already started");
  const owned = utilityProcess.fork(config.hostModule, [], {
    cwd: config.workspacePath,
    serviceName: "uwork-controlled-bound-automation-host",
    execArgv: ["--no-warnings"],
    stdio: "pipe",
    env: { ...process.env },
  });
  child = owned;
  let ownedPid;
  owned.once("spawn", () => {
    ownedPid = owned.pid;
    emit({ event: "host-spawned", pid: ownedPid });
  });
  for (const stream of [owned.stdout, owned.stderr])
    stream?.on("data", (chunk) => process.stderr.write(chunk));
  let ready, failed;
  const startup = new Promise((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  exitPromise = new Promise((resolve) =>
    owned.once("exit", (code) => {
      emit({ event: "host-exited", pid: ownedPid, code });
      failed(new Error("Owned Host exited during startup"));
      resolve(code);
    }),
  );
  owned.on("message", (message) => {
    if (message.type === "browser-execute-request") {
      // 无窗口 launcher 没有 browser executor，按正式 Main 的缺席分支回执，
      // 不能让只读 ambient-context 桥等待一个本例不存在的浏览器。
      owned.postMessage({
        type: "browser-execute-result",
        requestId: message.requestId,
        result: {
          ok: false,
          error: {
            code: "backend_unavailable",
            message: "browser executor not ready",
          },
          elapsedMs: 0,
        },
      });
      emit({
        event: "browser-executor-unavailable",
        method: message.command?.method,
      });
    } else if (message.type === "database-startup-state") {
      emit({
        event: "database-startup",
        phase: message.state.phase,
        errorCode: message.state.errorCode,
      });
      if (message.state.phase === "ready") ready();
      if (message.state.phase === "failed")
        failed(
          new Error(
            "Owned Host database startup failed: " + message.state.errorCode,
          ),
        );
    } else if (message.type.startsWith("agent-process-"))
      emit({ event: "host-agent", message });
  });
  const { port1, port2 } = new MessageChannelMain();
  protocol = new MessagePortProtocol({
    addEventListener: (_type, listener) => port1.on("message", listener),
    removeEventListener: (_type, listener) => port1.off("message", listener),
    postMessage: (data) => port1.postMessage(data),
    start: () => port1.start(),
    close: () => port1.close(),
  });
  client = new ChannelClient(protocol);
  owned.postMessage(
    {
      type: "init-local",
      hostId: "controlled-bound-automation",
      databaseStartupId: "controlled-bound-automation",
      workspacePath: config.workspacePath,
      workspaceIdentity: config.workspaceIdentity,
      agentSpawnFallbackCwd: config.workspacePath,
      zcodeBuiltinProviderConfigFilePath: config.builtinProvider,
      enterpriseIdentityBuiltinConfigFilePath: config.identityConfig,
      runtimeProcessEnvPatch: { PATH: process.env.PATH ?? "" },
    },
    [port2],
  );
  await bounded(startup, "production Host startup", 30000);
  return { pid: owned.pid };
}
async function stopHost() {
  if (!child) return;
  const owned = child;
  const exited = exitPromise;
  owned.postMessage({ type: "dispose" });
  try {
    await bounded(exited, "production Host dispose", 12000);
  } catch (error) {
    owned.kill();
    await bounded(exited, "forced production Host exit", 5000);
    throw error;
  } finally {
    client?.dispose();
    protocol?.disconnect();
    client = protocol = child = undefined;
  }
}
await app.whenReady();
await startHost();
emit({ event: "ready", pid: process.pid });
const allowed = new Map([
  ["enterprise-identity", new Set(["getView", "restoreSession"])],
  ["ucas-gateway", new Set(["getView", "sync"])],
  [
    "zcode-task",
    new Set(["createTask", "sendPrompt", "listTasks", "closeTask"]),
  ],
  [
    "zcode-agent",
    new Set([
      "initialize",
      "listAutomations",
      "runAutomationNow",
      "listAutomationRuns",
      "readSession",
      "readSessionMessages",
      "readSessionEvents",
    ]),
  ],
]);
createInterface({ input: process.stdin }).on("line", async (line) => {
  let command;
  try {
    if (Buffer.byteLength(line) > 262144)
      throw new Error("Owned RPC frame too large");
    command = JSON.parse(line);
    let result;
    if (command.operation === "call") {
      if (!allowed.get(command.channel)?.has(command.method))
        throw new Error("Owned RPC method not allowed");
      result = await bounded(
        client
          .getChannel(command.channel)
          .call(command.method, command.args ?? []),
        "production service RPC",
      );
    } else if (command.operation === "restart") {
      await stopHost();
      result = await startHost();
    } else if (command.operation === "shutdown") {
      await stopHost();
      result = { stopped: true };
    } else throw new Error("Invalid owned RPC operation");
    emit({ id: command.id, ok: true, result });
    if (command.operation === "shutdown") setImmediate(() => app.quit());
  } catch (error) {
    emit({
      id: command?.id,
      ok: false,
      error: error instanceof Error ? error.message : "Owned RPC failed",
    });
  }
});
process.stdin.once("end", () => {
  void stopHost().finally(() => app.quit());
});
process.once("SIGTERM", () => {
  void stopHost().finally(() => app.exit(0));
});
