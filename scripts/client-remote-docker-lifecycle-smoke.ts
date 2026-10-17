import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

type Row = Record<string, unknown>;
const exec = promisify(execFile);
const clientRoot = resolve("clients/uwork");
const evidence = resolve("evidence/client-remote-docker-lifecycle-20261017");
const launcher = resolve(
  "scripts/fixtures/client-remote-docker-metadata-launcher.mjs",
);
const dependencyImage = "uwork-remote-dependencies:node24.14.0-live-20261017";
const prefix = "UWORK_REMOTE_METADATA ";
const runId = randomUUID().slice(0, 12);
const container = `uwork-remote-metadata-${runId}`;
const remoteWorkspacePath = "/home/node/metadata-workspace";
const remoteSeedPath = join(remoteWorkspacePath, "known-bytes.txt");
const seedBytes = "UWORK_METADATA_PERSISTENT_BYTES_20261017\n";
const sha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const facts: Row = {
  runId,
  container,
  status: "prepared",
  boundary:
    "production Desktop Local Host connection registry -> DockerBackend -> production deploy and stdio server -> File/System read-only metadata; no identity bootstrap or execution RPC",
};
let ownedRoot = "";
let containerCreated = false;
let containerAttempted = false;
let host: ChildProcessWithoutNullStreams | undefined;
let hostExit: Promise<void> | undefined;
let spawnError: Error | undefined;
let credentialSecret = "";
let dockerEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOCKER_CONTEXT: "colima-uwork-backend",
};
const logs: string[] = [];
const frames: Row[] = [];
const knownPids = new Set<number>();
const waiters = new Map<
  string,
  { resolve(value: unknown): void; reject(error: Error): void }
>();

const bounded = <T>(
  promise: Promise<T>,
  label: string,
  timeout: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timeout")), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};
async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 15000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline)
      throw new Error("Owned metadata observation timeout");
    await new Promise((done) => setTimeout(done, 25));
  }
}
async function docker(args: string[]): Promise<string> {
  const result = await exec("docker", args, {
    env: dockerEnv,
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
}
function control<T = Row>(operation: string, extra: Row = {}): Promise<T> {
  assert.ok(
    host?.pid && host.exitCode === null,
    "owned metadata launcher must be alive",
  );
  const id = randomUUID();
  const result = new Promise<T>((yes, no) =>
    waiters.set(id, { resolve: (value) => yes(value as T), reject: no }),
  );
  host.stdin.write(JSON.stringify({ operation, id, ...extra }) + "\n");
  return bounded(
    result,
    "metadata " + operation,
    operation === "connect" ? 160000 : 25000,
  );
}
function call<T = Row>(
  channel: "file" | "system",
  method: "info" | "readTextFile" | "stat",
  ...args: unknown[]
): Promise<T> {
  return control<T>("call", { channel, method, args });
}
async function captureHostTree() {
  if (!host?.pid) return;
  knownPids.add(host.pid);
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const rows = stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            command: match[3]!,
          },
        ]
      : [];
  });
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of rows)
      if (knownPids.has(row.parent) && !knownPids.has(row.pid)) {
        knownPids.add(row.pid);
        changed = true;
      }
  }
  facts.hostProcessTree = rows.filter((row) => knownPids.has(row.pid));
}
async function serverPids(): Promise<number[]> {
  const raw = await docker(["exec", container, "ps", "-eo", "pid=,args="]);
  return raw.split("\n").flatMap((line) => {
    const match =
      /^\s*(\d+)\s+\/home\/node\/\.zcode\/server\/node \/home\/node\/\.zcode\/server\/zcode-server\.cjs\s*$/.exec(
        line,
      );
    return match ? [Number(match[1])] : [];
  });
}
async function remotePidStates(
  pids: number[],
): Promise<{ pid: number; gone: boolean }[]> {
  const result = await docker([
    "exec",
    container,
    "node",
    "-e",
    "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(pid=>{let gone=false;try{process.kill(pid,0)}catch{gone=true}return{pid,gone}})))",
    JSON.stringify(pids),
  ]);
  return JSON.parse(result) as { pid: number; gone: boolean }[];
}

async function prepareAssets(stage: string): Promise<string> {
  const version = JSON.parse(
    await readFile(join(clientRoot, "package.json"), "utf8"),
  ).version;
  const release = join(stage, "mock-cdn/releases", version);
  const serverFile = join(release, "server/zcode-server.cjs");
  const { build } = await import(
    pathToFileURL(join(clientRoot, "node_modules/esbuild/lib/main.js")).href
  );
  const { loadBuiltinProviderConfig } = await import(
    pathToFileURL(join(clientRoot, "scripts/builtin-provider-config.mjs")).href
  );
  const { content } = await loadBuiltinProviderConfig();
  await mkdir(join(release, "server"), { recursive: true });
  const buildResult = await build({
    absWorkingDir: join(clientRoot, "packages/server"),
    entryPoints: ["src/entry-stdio.ts"],
    bundle: true,
    outfile: serverFile,
    platform: "node",
    format: "cjs",
    target: "node22",
    metafile: true,
    plugins: [
      {
        name: "native-addon",
        setup(api: {
          onResolve(
            filter: { filter: RegExp },
            callback: (args: { path: string }) => Row,
          ): void;
        }) {
          api.onResolve({ filter: /\.node$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
    banner: {
      js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href; var __import_meta_dirname = __dirname;',
    },
    define: {
      "import.meta.url": "__import_meta_url",
      "import.meta.dirname": "__import_meta_dirname",
      __ZCODE_VERSION__: JSON.stringify(version),
      __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(content),
    },
  });
  const { validateRemoteServerBundle } = await import(
    pathToFileURL(join(clientRoot, "packages/server/buildRemoteValidation.ts"))
      .href
  );
  const server = await readFile(serverFile, "utf8");
  validateRemoteServerBundle({
    bundledInputs: Object.keys(buildResult.metafile.inputs),
    source: server,
  });
  const sourceCli = join(
    clientRoot,
    "apps/zcode-cli/packages/cli/dist/zcode.cjs",
  );
  const stagedCli = join(
    clientRoot,
    "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
  );
  const [cli, staged] = await Promise.all([
    readFile(sourceCli),
    readFile(stagedCli),
  ]);
  assert.ok(
    cli.equals(staged),
    "coordinated CLI and staged CLI must be identical",
  );
  for (const path of [
    "node/linux-arm64",
    "node-pty/linux-arm64",
    "glm/linux-arm64",
    "tools/linux-arm64/bfs",
    "tools/linux-arm64/ripgrep",
    "tools/linux-arm64/ugrep",
  ])
    await mkdir(join(release, path), { recursive: true });
  await cp(stagedCli, join(release, "glm/linux-arm64/zcode.cjs"));
  await cp(
    join(
      clientRoot,
      "node_modules/@lydell/node-pty-linux-arm64/prebuilds/linux-arm64/pty.node",
    ),
    join(release, "node-pty/linux-arm64/pty.node"),
  );
  const assets = await import(
    pathToFileURL(
      join(
        clientRoot,
        "packages/server/src/remote/zcodeAgentOfficialPluginAssets.ts",
      ),
    ).href
  );
  for (const name of assets.REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES as string[]) {
    const source = join(clientRoot, "apps/zcode-cli/packages", name);
    const target = join(release, "glm/linux-arm64/packages", name);
    await mkdir(target, { recursive: true });
    for (const entry of assets.REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS as string[]) {
      if (await exists(join(source, entry)))
        await cp(join(source, entry), join(target, entry), {
          recursive: true,
          filter: (path) => !path.split("/").includes("node_modules"),
        });
    }
  }
  for (const [from, to] of [
    ["/usr/local/bin/node", "node/linux-arm64/node"],
    ["/usr/bin/bfs", "tools/linux-arm64/bfs/bfs"],
    ["/usr/bin/rg", "tools/linux-arm64/ripgrep/rg"],
    ["/usr/bin/ugrep", "tools/linux-arm64/ugrep/ugrep"],
  ])
    await docker(["cp", `${container}:${from}`, join(release, to!)]);
  const components = await Promise.all(
    [
      {
        id: "server-bundle",
        version,
        mount: "server",
        file: "zcode-server.cjs",
      },
      {
        id: "node-runtime",
        version: "24.14.0",
        mount: "node/linux-arm64",
        file: "node",
      },
      {
        id: "node-pty",
        version: "1.2.0-beta.10",
        mount: "node-pty/linux-arm64",
        file: "pty.node",
      },
      { id: "glm", version, mount: "glm/linux-arm64", file: "zcode.cjs" },
    ].map(async ({ file, ...component }) => ({
      ...component,
      artifactPath: `${component.id}-owned-stage.tar.gz`,
      sha256: sha(await readFile(join(release, component.mount, file))),
    })),
  );
  await writeFile(
    join(release, "manifest-linux-arm64.json"),
    JSON.stringify({
      schemaVersion: 1,
      appVersion: version,
      platformArch: "linux-arm64",
      components,
    }),
  );
  facts.artifacts = {
    version,
    cliSha256: sha(cli),
    serverSha256: sha(server),
    productionRemoteValidation: true,
    hostSha256: sha(
      await readFile(join(clientRoot, "packages/desktop/out/host/index.js")),
    ),
    cliRebuiltByFixture: false,
    desktopOutRebuiltByFixture: false,
    serverBuiltOnlyInsideOwnedStage: true,
  };
  return join(stage, "mock-cdn");
}

async function checkSchemas() {
  const { isOwnedMetadataCall } = await import(
    pathToFileURL(
      resolve("scripts/fixtures/client-remote-docker-metadata-contract.mjs"),
    ).href
  );
  for (const [channel, method, args] of [
    ["system", "info", []],
    ["file", "readTextFile", [{ path: remoteSeedPath }]],
    ["file", "stat", [{ path: remoteSeedPath }]],
  ])
    assert.equal(
      isOwnedMetadataCall({ channel, method, args }, remoteSeedPath),
      true,
    );
  for (const input of [
    {
      channel: "file",
      method: "readTextFile",
      args: [{ path: "/unowned/path" }],
    },
    {
      channel: "file",
      method: "writeWorkspaceFileSearchIgnore",
      args: [{ path: remoteSeedPath }],
    },
    {
      channel: "file",
      method: "stat",
      args: [{ path: remoteSeedPath, extra: true }],
    },
    { channel: "system", method: "info", args: ["unexpected"] },
    { channel: "system", method: "info", args: "" },
    { channel: "provider-settings", method: "getView", args: [] },
    { channel: "model-selection", method: "getView", args: [] },
    { channel: "terminal", method: "create", args: [] },
    { channel: "zcode-task", method: "sendPrompt", args: [] },
    { channel: "enterprise-identity", method: "restoreSession", args: [] },
  ])
    assert.equal(isOwnedMetadataCall(input, remoteSeedPath), false);
  const shared = await import(
    pathToFileURL(join(clientRoot, "packages/shared/src/index.ts")).href
  );
  const target = { kind: "docker", container };
  const workspaceIdentity = shared.buildRemoteWorkspaceIdentity(
    remoteWorkspacePath,
    target,
  );
  shared.hostInitLocalMessageSchema.parse({
    type: "init-local",
    hostId: "metadata-only",
    databaseStartupId: "metadata-only",
    workspacePath: "/owned/local",
    workspaceIdentity: "metadata-only-local",
    agentSpawnFallbackCwd: "/owned/local",
    zcodeBuiltinProviderConfigFilePath: "/owned/public-provider.json",
    runtimeProcessEnvPatch: { PATH: "/owned/bin" },
  });
  shared.hostConnectRemoteWorkspaceMessageSchema.parse({
    type: "connect-remote-workspace",
    requestId: "metadata-connect",
    target,
    remoteAssets: { mockCdnDir: "/owned/mock-cdn" },
    workspacePath: remoteWorkspacePath,
    workspaceIdentity,
  });
  shared.hostAttachServicePortMessageSchema.parse({
    type: "attach-service-port",
    requestId: "metadata-attach",
    attachmentId: "metadata-remote",
    clientMode: "desktop-continuous",
    scope: {
      kind: "remote",
      remoteSessionId: "metadata-session",
      workspacePath: remoteWorkspacePath,
      workspaceIdentity,
    },
  });
  shared.hostDisposeRemoteWorkspaceSessionMessageSchema.parse({
    type: "dispose-remote-workspace-session",
    requestId: "metadata-close",
    remoteSessionId: "metadata-session",
  });
  return { shared, workspaceIdentity };
}

if (process.argv.includes("--schema-only")) {
  await checkSchemas();
  console.log(
    "Metadata-only production message schemas passed; no runtime started",
  );
} else {
  test(
    "production Desktop Docker metadata connection closes stdio and reconnects",
    { timeout: 300000 },
    async (t) => {
      assert.equal(process.version, "v24.14.0");
      await mkdir(evidence, { recursive: true });
      facts.status = "running";
      t.after(async () => {
        const cleanupErrors: string[] = [];
        if (host?.pid && host.exitCode === null) {
          await captureHostTree().catch((error) =>
            cleanupErrors.push(String(error)),
          );
          try {
            if (frames.some((frame) => frame.event === "ready"))
              await control("shutdown");
            else host.kill("SIGTERM");
            await bounded(hostExit!, "metadata launcher exit", 20000);
          } catch (error) {
            cleanupErrors.push(String(error));
            host.kill("SIGTERM");
            await bounded(
              hostExit!,
              "forced metadata launcher exit",
              10000,
            ).catch((failure) => cleanupErrors.push(String(failure)));
          }
        }
        if (containerCreated || containerAttempted) {
          const label = await docker([
            "inspect",
            "--format",
            '{{index .Config.Labels "uwork.lifecycle-run"}}',
            container,
          ]).catch(() => undefined);
          if (label === runId)
            await docker(["rm", "-f", container]).catch((error) =>
              cleanupErrors.push(String(error)),
            );
          else if (containerCreated)
            cleanupErrors.push("owned container label changed before cleanup");
        }
        const output = logs.join("");
        if (credentialSecret && output.includes(credentialSecret))
          cleanupErrors.push("owned credential secret appeared in logs");
        else
          await writeFile(join(evidence, "production-host.log"), output, {
            mode: 0o600,
          });
        if (ownedRoot)
          await rm(ownedRoot, { recursive: true, force: true }).catch((error) =>
            cleanupErrors.push(String(error)),
          );
        const pids = [...knownPids].map((pid) => {
          let alive = true;
          try {
            process.kill(pid, 0);
          } catch {
            alive = false;
          }
          return { pid, gone: !alive };
        });
        // Docker_CONFIG is under the deleted owned HOME; inspect through the original read-only named context.
        dockerEnv = {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_CONTEXT: "colima-uwork-backend",
        };
        facts.cleanup = {
          errors: cleanupErrors,
          hostPids: pids,
          ownedRootAbsent: !ownedRoot || !(await exists(ownedRoot)),
          containerAbsent: !(
            await docker(["ps", "-a", "--format", "{{.Names}}"])
          )
            .split("\n")
            .includes(container),
        };
        if (
          cleanupErrors.length ||
          pids.some((row) => !row.gone) ||
          !(facts.cleanup as Row).ownedRootAbsent ||
          !(facts.cleanup as Row).containerAbsent
        )
          facts.status = "red-or-harness-failure";
        await writeFile(
          join(evidence, "result.json"),
          JSON.stringify(facts, null, 2),
          { mode: 0o600 },
        );
        assert.deepEqual(cleanupErrors, []);
        assert.ok(pids.every((row) => row.gone));
        assert.equal((facts.cleanup as Row).ownedRootAbsent, true);
        assert.equal((facts.cleanup as Row).containerAbsent, true);
      });
      const { shared, workspaceIdentity } = await checkSchemas();
      ownedRoot = await realpath(
        await mkdtemp(join(tmpdir(), "uwork-remote-metadata-")),
      );
      const stage = join(ownedRoot, "stage"),
        home = join(ownedRoot, "home"),
        localWorkspace = join(ownedRoot, "local-workspace");
      await Promise.all(
        [stage, home, localWorkspace].map((path) =>
          mkdir(path, { recursive: true }),
        ),
      );
      const endpoint = await docker([
        "context",
        "inspect",
        "colima-uwork-backend",
        "--format",
        "{{.Endpoints.docker.Host}}",
      ]);
      assert.ok(endpoint.startsWith("unix:///"));
      const dockerConfig = join(stage, "docker-config");
      dockerEnv = { PATH: process.env.PATH, DOCKER_CONFIG: dockerConfig };
      await docker([
        "context",
        "create",
        "colima-uwork-backend",
        "--docker",
        `host=${endpoint}`,
      ]);
      dockerEnv.DOCKER_CONTEXT = "colima-uwork-backend";
      facts.dependencyImage = await docker([
        "image",
        "inspect",
        dependencyImage,
        "--format",
        "{{.Id}} {{.Config.User}}",
      ]);
      assert.ok(String(facts.dependencyImage).endsWith(" node"));
      containerAttempted = true;
      await docker([
        "run",
        "-d",
        "--name",
        container,
        "--label",
        `uwork.lifecycle-run=${runId}`,
        "--cpus",
        "1",
        "--memory",
        "1g",
        "--pids-limit",
        "256",
        "--network",
        "none",
        "--entrypoint",
        "sleep",
        dependencyImage,
        "infinity",
      ]);
      containerCreated = true;
      assert.equal(
        await docker(["exec", container, "node", "--version"]),
        "v24.14.0",
      );
      facts.remoteRuntime = JSON.parse(
        await docker([
          "exec",
          container,
          "node",
          "-p",
          "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,uid:process.getuid()})",
        ]),
      );
      assert.deepEqual(facts.remoteRuntime, {
        version: "v24.14.0",
        platform: "linux",
        arch: "arm64",
        uid: 1000,
      });
      await docker([
        "exec",
        container,
        "node",
        "-e",
        "const f=require('node:fs');f.mkdirSync(process.argv[1],{recursive:true});f.writeFileSync(process.argv[2],process.argv[3]);",
        remoteWorkspacePath,
        remoteSeedPath,
        seedBytes,
      ]);
      const mockCdnDir = await prepareAssets(stage);
      const appRoot = join(stage, "app"),
        userData = join(stage, "electron-userdata"),
        configPath = join(stage, "fixture.json");
      await mkdir(appRoot, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({
          hostModule: join(clientRoot, "packages/desktop/out/host/index.js"),
          rpcModule: join(clientRoot, "packages/rpc/dist/index.js"),
          electronUserData: userData,
          localWorkspacePath: localWorkspace,
          localWorkspaceIdentity: "metadata-local-" + runId,
          builtinProvider: join(
            clientRoot,
            "config/provider/zcode-builtin.json",
          ),
          target: { kind: "docker", container },
          remoteAssets: { mockCdnDir },
          remoteWorkspacePath,
          remoteWorkspaceIdentity: workspaceIdentity,
          remoteSeedPath,
        }),
      );
      await writeFile(
        join(appRoot, "package.json"),
        JSON.stringify({
          name: "uwork-owned-metadata-only",
          version: "0.0.0",
          type: "module",
          main: "entry.cjs",
        }),
      );
      await writeFile(
        join(appRoot, "entry.cjs"),
        `import(${JSON.stringify(pathToFileURL(launcher).href)}).catch(error=>{console.error(error);require('electron').app.exit(1)});`,
      );
      await symlink(
        join(clientRoot, "node_modules"),
        join(appRoot, "node_modules"),
      );
      credentialSecret = randomBytes(32).toString("hex");
      host = spawn(
        resolve(
          "data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron",
        ),
        [
          appRoot,
          `--fixture-config=${configPath}`,
          `--user-data-dir=${userData}`,
        ],
        {
          cwd: localWorkspace,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            UWORK_DATA_BASE_DIR: home,
            ZCODE_DATA_BASE_DIR: home,
            ZCODE_STORAGE_DIR: join(home, ".uwork"),
            ZCODE_DESKTOP_HOME_DIR: home,
            ZCODE_CREDENTIAL_SECRET: credentialSecret,
            ZCODE_ENV: "production",
            ZCODE_ENDPOINT_ORIGIN: "http://127.0.0.1:9",
            ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
            ZCODE_MODEL_TELEMETRY_ENABLED: "false",
            ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
            ZCODE_ARMS_RUM_ENDPOINT: "",
            DOCKER_CONFIG: dockerConfig,
            DOCKER_CONTEXT: "colima-uwork-backend",
          },
        },
      );
      hostExit = new Promise<void>((done) => {
        host!.once("error", (error) => {
          spawnError = error;
          done();
        });
        host!.once("exit", (code, signal) => {
          facts.launcherExit = { code, signal };
          for (const waiter of waiters.values())
            waiter.reject(new Error("Owned metadata launcher exited"));
          waiters.clear();
          done();
        });
      });
      host.stderr.on("data", (bytes) => {
        if (logs.join("").length < 6 * 1024 * 1024) logs.push(bytes.toString());
      });
      createInterface({ input: host.stdout }).on("line", (line) => {
        if (!line.startsWith(prefix)) {
          logs.push(line + "\n");
          return;
        }
        const frame = JSON.parse(line.slice(prefix.length)) as Row;
        frames.push(frame);
        if (frame.event === "host-spawned") knownPids.add(frame.pid as number);
        if (frame.id) {
          const waiter = waiters.get(frame.id as string);
          waiters.delete(frame.id as string);
          if (frame.ok) waiter?.resolve(frame.result);
          else waiter?.reject(new Error(String(frame.error)));
        }
      });
      await eventually(
        async () => {
          if (spawnError) throw spawnError;
          if (host?.exitCode !== null)
            throw new Error("Metadata launcher exited during startup");
          return frames;
        },
        (values) => values.some((frame) => frame.event === "ready"),
        45000,
      );
      const passes: Row[] = [];
      facts.passes = passes;
      for (let pass = 1; pass <= 2; pass++) {
        const connection = await control("connect");
        shared.windowHostRemoteWorkspaceDescriptorSchema.parse(connection);
        const system = await call("system", "info");
        assert.equal(system.platform, "linux");
        assert.equal(system.homedir, "/home/node");
        const file = await call("file", "readTextFile", {
          path: remoteSeedPath,
        });
        assert.equal(file.content, seedBytes);
        assert.equal(file.bytesRead, Buffer.byteLength(seedBytes));
        assert.equal(sha(file.content as string), sha(seedBytes));
        const stat = await call("file", "stat", { path: remoteSeedPath });
        const pids = await serverPids();
        assert.equal(pids.length, 1);
        await captureHostTree();
        const observation: Row = {
          pass,
          connection,
          system,
          file,
          stat,
          serverPids: pids,
          fileSha256: sha(file.content as string),
        };
        passes.push(observation);
        const closed = await control("disconnect");
        assert.equal(closed.remoteSessionId, connection.remoteSessionId);
        observation.closed = closed;
        await eventually(serverPids, (values) => values.length === 0);
        observation.closedServerPids = await eventually(
          () => remotePidStates(pids),
          (values) => values.every((row) => row.gone),
        );
        observation.stdioProcessesGone = true;
      }
      assert.notEqual(
        (passes[0]!.connection as Row).remoteSessionId,
        (passes[1]!.connection as Row).remoteSessionId,
      );
      assert.deepEqual(passes[0]!.file, passes[1]!.file);
      facts.passes = passes;
      facts.fileSha256 = sha(seedBytes);
      facts.reconnectFilePersistence = true;
      facts.status = "green";
    },
  );
  after(async () => {
    await mkdir(evidence, { recursive: true });
    facts.frames = frames;
    if (facts.status !== "green") facts.status = "red-or-harness-failure";
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(facts, null, 2),
      { mode: 0o600 },
    );
    console.log(`Owned metadata lifecycle evidence: ${facts.status}`);
  });
}
