import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { isOwnedMetadataCall } from "./client-remote-docker-metadata-contract.mjs";

const { app, utilityProcess, MessageChannelMain } = createRequire(
  import.meta.url,
)("electron");
const configPath = process.argv
  .find((arg) => arg.startsWith("--fixture-config="))
  ?.slice(17);
if (!configPath) throw new Error("Owned metadata fixture config required");
const config = JSON.parse(await readFile(configPath, "utf8"));
const { ChannelClient, MessagePortProtocol } = await import(
  pathToFileURL(config.rpcModule).href
);
app.setPath("userData", config.electronUserData);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
const emit = (value) =>
  process.stdout.write("UWORK_REMOTE_METADATA " + JSON.stringify(value) + "\n");
const bounded = (promise, label, milliseconds = 20000) => {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(label + " timeout")),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
};
const pendingConnections = new Map();
const pendingCloses = new Map();
const attachments = new Map();
let child, exited, descriptor, stopping;
function attach(key, scope, initial) {
  const pair = initial ?? new MessageChannelMain();
  const protocol = new MessagePortProtocol({
    addEventListener: (_type, listener) => pair.port1.on("message", listener),
    removeEventListener: (_type, listener) =>
      pair.port1.off("message", listener),
    postMessage: (data) => pair.port1.postMessage(data),
    start: () => pair.port1.start(),
    close: () => pair.port1.close(),
  });
  attachments.set(key, { client: new ChannelClient(protocol), protocol });
  if (!initial)
    child.postMessage(
      {
        type: "attach-service-port",
        requestId: "metadata-attach",
        attachmentId: "metadata-remote",
        clientMode: "desktop-continuous",
        scope,
      },
      [pair.port2],
    );
  return pair;
}
function detach(key) {
  const attachment = attachments.get(key);
  attachment?.client.dispose();
  attachment?.protocol.disconnect();
  attachments.delete(key);
}
function stopHost() {
  if (stopping) return stopping;
  stopping = (async () => {
    for (const key of attachments.keys()) detach(key);
    if (!child) return;
    child.postMessage({ type: "dispose" });
    try {
      await bounded(exited, "production Host cleanup", 15000);
    } catch (error) {
      child.kill();
      await bounded(exited, "forced owned Host exit", 5000);
      throw error;
    } finally {
      child = undefined;
    }
  })();
  return stopping;
}
await app.whenReady();
child = utilityProcess.fork(config.hostModule, [], {
  cwd: config.localWorkspacePath,
  serviceName: "uwork-metadata-only-remote-host",
  execArgv: ["--no-warnings"],
  stdio: "pipe",
  env: { ...process.env },
});
const owned = child;
let ready, failed;
const startup = new Promise((resolve, reject) => {
  ready = resolve;
  failed = reject;
});
owned.once("spawn", () => emit({ event: "host-spawned", pid: owned.pid }));
for (const stream of [owned.stdout, owned.stderr])
  stream?.on("data", (bytes) => process.stderr.write(bytes));
exited = new Promise((resolve) =>
  owned.once("exit", (code) => {
    emit({ event: "host-exited", code });
    failed(new Error("Owned Host exited before startup"));
    for (const waiter of [
      ...pendingConnections.values(),
      ...pendingCloses.values(),
    ])
      waiter.reject(new Error("Owned Host exited"));
    pendingConnections.clear();
    pendingCloses.clear();
    resolve(code);
  }),
);
owned.on("message", (message) => {
  if (message.type === "browser-execute-request") {
    owned.postMessage({
      type: "browser-execute-result",
      requestId: message.requestId,
      result: {
        ok: false,
        error: {
          code: "backend_unavailable",
          message: "metadata fixture has no browser executor",
        },
        elapsedMs: 0,
      },
    });
  } else if (message.type === "database-startup-state") {
    emit({
      event: "database-startup",
      phase: message.state.phase,
      errorCode: message.state.errorCode,
    });
    if (message.state.phase === "ready") ready();
    if (message.state.phase === "failed")
      failed(new Error("Owned Host database startup failed"));
  } else if (
    message.type === "remote-workspace-connected" ||
    message.type === "remote-workspace-connect-failed"
  ) {
    const waiter = pendingConnections.get(message.requestId);
    pendingConnections.delete(message.requestId);
    if (message.type === "remote-workspace-connected")
      waiter?.resolve(message.descriptor);
    else waiter?.reject(new Error(message.error));
    emit({ event: "host-message", message });
  } else if (message.type === "remote-workspace-closed") {
    pendingCloses.get(message.remoteSessionId)?.resolve(message);
    pendingCloses.delete(message.remoteSessionId);
    emit({ event: "host-message", message });
  } else if (message.type.startsWith("agent-process-"))
    emit({ event: "host-message", message });
});
const initial = attach("local", { kind: "local" }, new MessageChannelMain());
owned.postMessage(
  {
    type: "init-local",
    hostId: "owned-metadata-only",
    databaseStartupId: "owned-metadata-only",
    workspacePath: config.localWorkspacePath,
    workspaceIdentity: config.localWorkspaceIdentity,
    agentSpawnFallbackCwd: config.localWorkspacePath,
    zcodeBuiltinProviderConfigFilePath: config.builtinProvider,
    runtimeProcessEnvPatch: { PATH: process.env.PATH ?? "" },
  },
  [initial.port2],
);
await bounded(startup, "production Host startup", 40000);
emit({ event: "ready", pid: process.pid });
createInterface({ input: process.stdin }).on("line", async (line) => {
  let command;
  try {
    if (Buffer.byteLength(line) > 65536)
      throw new Error("Metadata control frame too large");
    command = JSON.parse(line);
    let result;
    if (command.operation === "connect") {
      if (descriptor) throw new Error("Metadata connection already exists");
      const requestId = "metadata-connect-" + command.id;
      const connected = new Promise((resolve, reject) =>
        pendingConnections.set(requestId, { resolve, reject }),
      );
      owned.postMessage({
        type: "connect-remote-workspace",
        requestId,
        target: config.target,
        remoteAssets: config.remoteAssets,
        workspacePath: config.remoteWorkspacePath,
        workspaceIdentity: config.remoteWorkspaceIdentity,
      });
      descriptor = await bounded(
        connected,
        "production metadata Docker connection",
        150000,
      );
      if (
        descriptor.workspacePath !== config.remoteWorkspacePath ||
        descriptor.workspaceIdentity !== config.remoteWorkspaceIdentity
      )
        throw new Error(
          "Production remote descriptor does not match the owned workspace",
        );
      attach("remote", {
        kind: "remote",
        remoteSessionId: descriptor.remoteSessionId,
        workspacePath: descriptor.workspacePath,
        workspaceIdentity: descriptor.workspaceIdentity,
      });
      result = descriptor;
    } else if (command.operation === "disconnect") {
      if (!descriptor) throw new Error("Metadata connection absent");
      const id = descriptor.remoteSessionId;
      const closed = new Promise((resolve, reject) =>
        pendingCloses.set(id, { resolve, reject }),
      );
      detach("remote");
      owned.postMessage({
        type: "dispose-remote-workspace-session",
        requestId: "metadata-close-" + command.id,
        remoteSessionId: id,
      });
      result = await bounded(closed, "production remote closed event", 15000);
      descriptor = undefined;
    } else if (command.operation === "call") {
      if (!isOwnedMetadataCall(command, config.remoteSeedPath))
        throw new Error("Only owned File/System metadata calls are allowed");
      const remote = attachments.get("remote");
      if (!remote) throw new Error("Metadata remote attachment absent");
      result = await bounded(
        remote.client
          .getChannel(command.channel)
          .call(command.method, command.args ?? []),
        "production metadata RPC",
      );
    } else if (command.operation === "shutdown") {
      await stopHost();
      result = { stopped: true };
    } else throw new Error("Invalid metadata operation");
    emit({ id: command.id, ok: true, result });
    if (command.operation === "shutdown") setImmediate(() => app.quit());
  } catch (error) {
    emit({
      id: command?.id,
      ok: false,
      error:
        error instanceof Error ? error.message : "Metadata operation failed",
    });
  }
});
process.stdin.once("end", () => {
  void stopHost().finally(() => app.quit());
});
process.once("SIGTERM", () => {
  void stopHost().finally(() => app.exit(0));
});
