import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { liveFixture, eventually } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
const phase =
  process.env.UWORK_CONTROL_LANES_EVIDENCE === "red" ? "red" : "green";
const evidence = resolve(`evidence/client-control-lanes-20261017/${phase}`);
const facts: Row = {
  status: "running",
  boundary:
    "production Desktop Host utilityProcess/MessagePort + actual McpSync + dedicated MCP-status lane + staged CLI + real private backend HTTP and owned TCP MCP peer; no Native UI or external MCP claim",
};
const rpc: Row[] = [],
  lifecycle: Row[] = [],
  methods: string[] = [];
let audit: (output: string) => void = () => {};
const safe = (value: unknown) => {
  const output = JSON.stringify(value, null, 2);
  audit(output);
  return output;
};
const bounded = <T>(
  promise: Promise<T>,
  label: string,
  timeout = 25000,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timeout")), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};

test(
  "production Host MCP status lane obeys current personal connector policy and reaches the owned peer only while allowed",
  { timeout: 120000 },
  async (t) => {
    await mkdir(evidence, { recursive: true });
    const peer = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/mcp") {
        res.writeHead(405).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk.toString();
      const frame = JSON.parse(raw) as Row;
      methods.push(String(frame.method));
      if (frame.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      let result: Row = {};
      if (frame.method === "initialize")
        result = {
          protocolVersion: (frame.params as Row).protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "owned-control-lanes", version: "1" },
        };
      if (frame.method === "tools/list")
        result = {
          tools: [
            {
              name: "mark",
              description: "Harmless owned marker",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
    });
    await new Promise<void>((done) => peer.listen(0, "127.0.0.1", done));
    const peerPort = (peer.address() as { port: number }).port;
    t.after(async () => {
      peer.closeAllConnections();
      await new Promise<void>((done) => peer.close(() => done()));
      facts.peerCleanup = { port: peerPort, closed: !peer.listening };
    });
    const f = await liveFixture(t, "control-lanes", true, {
      evidenceDirectory: evidence,
    });
    const b = f.ownedDesktopHostBootstrap();
    audit = b.assertPrivateOutputSafe;
    const clientRoot = resolve("clients/uwork");
    const appRoot = join(b.directory, "control-lanes-app");
    const workspace = {
      workspacePath: join(b.directory, "owned-workspace"),
      workspaceIdentity: "controlled-control-lanes",
    };
    const configDir = join(b.dataBaseDirectory, ".uwork/v2");
    await Promise.all(
      [appRoot, workspace.workspacePath, configDir].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    const identityConfig = join(configDir, "enterprise-identity.json");
    await writeFile(
      identityConfig,
      JSON.stringify({
        backend: "uwork",
        apiBaseUrl: b.apiBaseUrl,
        callbackUrl: b.apiBaseUrl + "/api/auth/wecom/callback",
        organizations: [
          {
            orgId: f.p.split("/").at(-1),
            corpId: "synthetic-never-called",
            agentId: "1",
          },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(configDir, "setting.json"),
      JSON.stringify({ httpProxyCaCertPath: b.certificatePath }),
      { mode: 0o600 },
    );
    const hostModule = join(clientRoot, "packages/desktop/out/host/index.js");
    const bundle = join(
      clientRoot,
      "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
    );
    const [hostBytes, cliBytes, sourceBytes] = await Promise.all([
      readFile(hostModule),
      readFile(bundle),
      readFile(join(clientRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs")),
    ]);
    assert.ok(cliBytes.equals(sourceBytes));
    facts.artifacts = {
      hostSha256: createHash("sha256").update(hostBytes).digest("hex"),
      cliSha256: createHash("sha256").update(cliBytes).digest("hex"),
    };
    const config = join(appRoot, "fixture.json");
    await writeFile(
      config,
      JSON.stringify({
        hostModule,
        rpcModule: join(clientRoot, "packages/rpc/dist/index.js"),
        electronUserData: join(b.directory, "electron-userdata"),
        builtinProvider: join(clientRoot, "config/provider/zcode-builtin.json"),
        identityConfig,
        ...workspace,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({
        name: "uwork-controlled-control-lanes",
        main: "entry.cjs",
      }),
    );
    await writeFile(
      join(appRoot, "entry.cjs"),
      `import(${JSON.stringify(pathToFileURL(resolve("scripts/fixtures/client-control-lanes-host-launcher.mjs")).href)});`,
    );
    const child = spawn(
      resolve(
        "data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron",
      ),
      [appRoot, `--fixture-config=${config}`],
      {
        cwd: appRoot,
        detached: true,
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: b.dataBaseDirectory,
          USERPROFILE: b.dataBaseDirectory,
          UWORK_DATA_BASE_DIR: b.dataBaseDirectory,
          ZCODE_DATA_BASE_DIR: b.dataBaseDirectory,
          ZCODE_STORAGE_DIR: join(b.dataBaseDirectory, ".uwork"),
          ZCODE_CREDENTIAL_SECRET: b.credentialSecret,
          NODE_EXTRA_CA_CERTS: b.certificatePath,
          ZCODE_ENV: "production",
          ZCODE_MODEL_TELEMETRY_ENABLED: "false",
          ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
          ZCODE_ARMS_RUM_ENDPOINT: "",
        },
      },
    );
    const output: string[] = [];
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk: Buffer) => {
        if (output.join("").length < 6 * 1024 * 1024)
          output.push(chunk.toString());
      });
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    let ready!: () => void;
    const readiness = new Promise<void>((done) => {
      ready = done;
    });
    const pending = new Map<
      string,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.startsWith("UWORK_AUTOMATION_RPC ")) return;
      const frame = JSON.parse(line.slice(21)) as Row;
      if (frame.event) {
        lifecycle.push(frame);
        if (frame.event === "ready") ready();
        return;
      }
      const request = pending.get(String(frame.id));
      if (!request) return;
      pending.delete(String(frame.id));
      if (frame.ok) request.resolve(frame.result);
      else request.reject(new Error(String(frame.error)));
    });
    const control = (operation: string, extra: Row = {}) => {
      const id = randomUUID();
      return bounded(
        new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          child.stdin.write(JSON.stringify({ id, operation, ...extra }) + "\n");
        }),
        operation,
        45000,
      ).finally(() => pending.delete(id));
    };
    const call = async <T = Row>(
      channel: string,
      method: string,
      params?: unknown,
    ): Promise<T> => {
      const result = await control("call", {
        channel,
        method,
        args: params === undefined ? [] : [params],
      });
      rpc.push({ channel, method, params, result });
      return result as T;
    };
    let disposing: Promise<void> | undefined;
    const disposeHost = () =>
      (disposing ??= (async () => {
        let failure: unknown;
        try {
          if (child.exitCode === null && child.signalCode === null)
            await control("shutdown");
          await bounded(exited, "owned Electron exit", 12000);
        } catch (error) {
          failure = error;
          if (child.pid) process.kill(-child.pid, "SIGKILL");
          await bounded(exited, "forced owned Electron exit", 5000);
        }
        const pids = [
          child.pid,
          ...lifecycle.flatMap((event) =>
            event.event === "host-spawned"
              ? [event.pid]
              : event.event === "host-agent" &&
                  (event.message as Row).type === "agent-process-spawned"
                ? [(event.message as Row).pid]
                : [],
          ),
        ].filter((pid): pid is number => typeof pid === "number");
        assert.ok(!pids.includes(37266) && !pids.includes(process.pid));
        facts.processCleanup = await eventually(
          async () =>
            pids.map((pid) => {
              try {
                process.kill(pid, 0);
                return { pid, exited: false };
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                  throw error;
                return { pid, exited: true };
              }
            }),
          (checks) => checks.every((check) => check.exited),
          5000,
        );
        audit(output.join(""));
        await writeFile(join(evidence, "host.log"), output.join(""), {
          mode: 0o600,
        });
        facts.electronExit = {
          pid: child.pid,
          code: child.exitCode,
          signal: child.signalCode,
        };
        facts.lifecycle = lifecycle;
        if (failure) throw failure;
        assert.equal(child.exitCode, 0);
      })());
    t.after(async () => {
      try {
        await disposeHost();
      } catch {
        facts.afterCleanupFailed = true;
      }
    });
    const configure = async (kind: string, data: Row) => {
      const old = await f.api<Row>(
        `${f.p}/configurations/${kind}`,
        "GET",
        undefined,
        f.login.token,
      );
      const saved = await f.api<Row>(
        `${f.p}/configurations/${kind}`,
        "PUT",
        {
          revision: old.revision,
          data: { ...(old.published as Row), ...data },
        },
        f.login.token,
      );
      await f.api(
        `${f.p}/configurations/${kind}/publish`,
        "POST",
        { revision: saved.revision },
        f.login.token,
      );
    };
    try {
      await bounded(readiness, "production Host ready", 45000);
      assert.equal(
        (await call("enterprise-identity", "restoreSession")).status,
        "authenticated",
      );
      await configure("security", {
        allowFilesystem: true,
        allowShell: true,
        allowNetwork: true,
        allowedDomains: [],
      });
      await configure("personal", { connectors: false });
      const name = "owned-control-lanes";
      const server = {
        name,
        type: "http",
        headers: [],
        url: `http://127.0.0.1:${peerPort}/mcp`,
        protocolVersion: "legacy",
      };
      await call("mcp-sync", "saveMcpToUserDirectory", {
        action: "upsert",
        source: "zcodeagentmcp",
        name,
        config: { type: "http", url: server.url, protocolVersion: "legacy" },
      });
      const loaded = await call<{ servers: Row[] }>(
        "mcp-sync",
        "loadMcpFromUserDirectory",
      );
      const record = loaded.servers.find((item) => item.name === name);
      assert.ok(record, "the public MCP owner must return the saved server");
      const configFile = String((record.file as Row).filePath);
      assert.ok(
        configFile.startsWith(b.dataBaseDirectory + "/"),
        "MCP writes must remain inside the owned HOME",
      );
      const originalConfig = await readFile(configFile);
      const list = () =>
        call<{ statuses: Record<string, Row> }>(
          "mcp-sync",
          "listWorkspaceMcpServerStatuses",
          { ...workspace, mcpServers: [server], mode: "connect" },
        );
      facts.deniedBefore = await list();
      assert.equal(methods.length, 0);
      await configure("personal", { connectors: true });
      const allowed = await list();
      facts.allowed = allowed;
      assert.equal(
        allowed.statuses[name]?.status,
        "connected",
        "an owned current MCP-status lane cannot be enterprise_runtime_obsolete",
      );
      assert.ok(
        methods.includes("initialize") && methods.includes("tools/list"),
      );
      const beforeRevocation = methods.length;
      await configure("personal", { connectors: false });
      facts.deniedAfter = await list();
      assert.equal(methods.length, beforeRevocation);
      assert.ok(
        originalConfig.equals(await readFile(configFile)),
        "runtime denial must preserve the saved personal MCP configuration",
      );
      assert.equal(f.calls(), 0);
      facts.peerMethods = methods;
      facts.revocationPeerDelta = 0;
      facts.modelCalls = 0;
      facts.status = "passed";
      f.check("production-Host-McpSync-current-control-lane-allow-and-revoke");
    } catch (error) {
      facts.status = "failed";
      facts.error = error instanceof Error ? error.message : "unknown";
      facts.peerMethods = methods;
      throw error;
    } finally {
      await disposeHost();
      await writeFile(join(evidence, "rpc-proof.json"), safe({ facts, rpc }), {
        mode: 0o600,
      });
    }
  },
);

after(async () => {
  try {
    const saved = JSON.parse(
      await readFile(join(evidence, "control-lanes-green.json"), "utf8"),
    );
    facts.backendCleanup = saved.cleanup;
    facts.backendRequests = saved.requests;
  } catch {
    facts.backendEvidenceMissing = true;
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "summary.json"), safe(facts), { mode: 0o600 });
});
