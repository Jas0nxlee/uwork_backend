import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { eventually, liveFixture } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type OwnedProcess = {
  label: string;
  child: ChildProcessWithoutNullStreams;
  output: string[];
  exited: Promise<void>;
  pids: Set<number>;
  cliPids: Set<number>;
  dispose(): Promise<void>;
};
const exec = promisify(execFile);
const evidence = resolve(
  process.env.UWORK_MAIN_SCHEDULER_EVIDENCE_DIRECTORY ??
    "evidence/client-automation-main-scheduler-20261017",
);
assert.ok(
  evidence.startsWith(resolve("evidence") + "/"),
  "owned evidence directory must stay under this repository's evidence root",
);
const clientRoot = resolve("clients/uwork");
const fixtureName = "automation-main-scheduler";
const sourceBundle = join(
  clientRoot,
  "apps/zcode-cli/packages/cli/dist/zcode.cjs",
);
const stagedBundle = join(
  clientRoot,
  "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
);
const facts: Row = {
  status: "running",
  boundary:
    "complete byte-identical production Main startup + owned scheduler real clock due tick + production Local Host + staged CLI; local controlled supplier, no run-now or injected renderer state",
};
const supplierBodies: Row[] = [];
const rpcCalls: Row[] = [];
const processes: OwnedProcess[] = [];
let auditPrivateOutput: (output: string) => void = () => {};
let rootDirectory = "";
const safeJson = (value: unknown) => {
  const output = JSON.stringify(value, null, 2);
  try {
    auditPrivateOutput(output);
    return output;
  } catch {
    return JSON.stringify({ status: "failed", privateOutputWithheld: true });
  }
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
      timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function captureOwnedProcesses(owned: OwnedProcess): Promise<void> {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const rows = stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }]
      : [];
  });
  const current = new Set<number>(owned.child.pid ? [owned.child.pid] : []);
  for (;;) {
    const size = current.size;
    for (const row of rows) if (current.has(row.ppid)) current.add(row.pid);
    if (size === current.size) break;
  }
  for (const row of rows) {
    if (!current.has(row.pid)) continue;
    assert.notEqual(row.pid, 37266, "protected backend must never be owned");
    assert.notEqual(row.pid, process.pid, "test runner cannot be child-owned");
    owned.pids.add(row.pid);
    // 完整 Main 从自身 app 根解析 bundled-agents；该只读 symlink 已核对 realpath
    // 与 staged 内容，不能只按原工作区字符串匹配而把真实 CLI 误判为未启动。
    if (
      row.command.includes(stagedBundle) ||
      row.command.includes(
        join(
          rootDirectory,
          "main-app/bundled-agents/darwin-arm64/glm/zcode.cjs",
        ),
      )
    )
      owned.cliPids.add(row.pid);
  }
}

function startOwned(
  label: string,
  appRoot: string,
  config: string,
  env: NodeJS.ProcessEnv,
  graceful: () => Promise<void>,
): OwnedProcess {
  assert.ok(appRoot.startsWith(rootDirectory + "/"));
  const child = spawn(
    resolve(
      "data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron",
    ),
    [appRoot, `--fixture-config=${config}`],
    { cwd: appRoot, detached: true, stdio: "pipe", env },
  );
  const output: string[] = [];
  let bytes = 0;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 6 * 1024 * 1024) output.push(chunk.toString());
    });
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  let cleanup: Promise<void> | undefined;
  const owned: OwnedProcess = {
    label,
    child,
    output,
    exited,
    pids: new Set(child.pid ? [child.pid] : []),
    cliPids: new Set(),
    dispose: () =>
      (cleanup ??= (async () => {
        await captureOwnedProcesses(owned);
        let cleanupError: unknown;
        if (child.exitCode === null && child.signalCode === null) {
          try {
            await graceful();
          } catch (error) {
            cleanupError = error;
          }
          try {
            await bounded(exited, `${label} graceful exit`, 15000);
          } catch (error) {
            cleanupError ??= error;
            if (child.pid) process.kill(-child.pid, "SIGKILL");
            await bounded(exited, `${label} forced exit`, 5000);
          }
        }
        const checks = () =>
          [...owned.pids].map((pid) => {
            try {
              process.kill(pid, 0);
              return { pid, exited: false };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw error;
              return { pid, exited: true };
            }
          });
        let processCleanup;
        try {
          processCleanup = await eventually(
            async () => checks(),
            (items) => items.every((item) => item.exited),
            5000,
          );
        } catch (error) {
          cleanupError ??= error;
          for (const check of checks())
            if (!check.exited) process.kill(check.pid, "SIGKILL");
          processCleanup = await eventually(
            async () => checks(),
            (items) => items.every((item) => item.exited),
            5000,
          );
        }
        await mkdir(evidence, { recursive: true });
        let text = output.join("");
        try {
          auditPrivateOutput(text);
        } catch (error) {
          cleanupError ??= error;
          text = "[private output withheld]\n";
        }
        await writeFile(join(evidence, `${label}.log`), text, { mode: 0o600 });
        facts.processes ??= [];
        (facts.processes as Row[]).push({
          label,
          pid: child.pid,
          code: child.exitCode,
          signal: child.signalCode,
          cliPids: [...owned.cliPids],
          processCleanup,
          ...(cleanupError
            ? {
                cleanupError:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : "cleanup failed",
              }
            : {}),
        });
        if (cleanupError) throw cleanupError;
        assert.equal(child.exitCode, 0);
      })()),
  };
  processes.push(owned);
  return owned;
}

test(
  "complete production Main naturally dispatches bound CronCreate, survives restart, and enforces current local revocation",
  { timeout: 330000 },
  async (t) => {
    t.after(async () => {
      const errors: unknown[] = [];
      for (const owned of [...processes].reverse()) {
        try {
          await owned.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      // 主体 finally 已将清理错误判为失败；after 不重抛同一错误，确保后续共享夹具
      // 的后台/端口/目录清理仍执行，不能让前置 hook 的拒绝截断后续资源释放。
      if (errors.length)
        facts.afterCleanupErrors = errors.map((error) =>
          error instanceof Error ? error.message : "cleanup failed",
        );
    });
    const f = await liveFixture(t, fixtureName, true, {
      evidenceDirectory: evidence,
      reply(body) {
        supplierBodies.push(structuredClone(body));
        if (!body.stream) return { text: "Controlled Main schedule" };
        const messages = body.messages as Row[];
        const latest = messages.findLastIndex(
          (message) => message.role === "user",
        );
        const user = messages[latest]?.content;
        const returned = messages
          .slice(latest + 1)
          .some((message) => message.role === "tool");
        if (
          typeof user === "string" &&
          user.includes("G05_MAIN_CREATE_CRON") &&
          !returned
        )
          return {
            toolCall: {
              id: `main-cron-${supplierBodies.length}`,
              name: "CronCreate",
              arguments: JSON.stringify({
                title: "Controlled Main schedule",
                cron: "* * * * *",
                prompt:
                  "G05_MAIN_SCHEDULED_MARKER: reply G05_MAIN_SCHEDULED_COMPLETE without tools",
                recurring: true,
              }),
            },
          };
        return { text: "G05_MAIN_SCHEDULED_COMPLETE" };
      },
    });
    const bootstrap = f.ownedDesktopHostBootstrap();
    rootDirectory = bootstrap.directory;
    auditPrivateOutput = bootstrap.assertPrivateOutputSafe;
    const configDir = join(bootstrap.dataBaseDirectory, ".uwork", "v2");
    const workspacePath = join(rootDirectory, "main-scheduler-workspace");
    const workspace = {
      workspacePath,
      workspaceIdentity: "controlled-main-scheduler",
    };
    const stageRoot = join(rootDirectory, "stage-app");
    const mainRoot = join(rootDirectory, "main-app");
    await Promise.all(
      [configDir, workspacePath, stageRoot, mainRoot].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    const tenantId = f.p.split("/").at(-1)!;
    const identityConfig = join(configDir, "enterprise-identity.json");
    await writeFile(
      identityConfig,
      JSON.stringify({
        backend: "uwork",
        apiBaseUrl: bootstrap.apiBaseUrl,
        callbackUrl: bootstrap.apiBaseUrl + "/api/auth/wecom/callback",
        organizations: [
          { orgId: tenantId, corpId: "synthetic-never-called", agentId: "1" },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(configDir, "setting.json"),
      JSON.stringify({ httpProxyCaCertPath: bootstrap.certificatePath }),
      { mode: 0o600 },
    );
    const configure = async (kind: string, data: Row) => {
      const previous = await f.api<Row>(
        `${f.p}/configurations/${kind}`,
        "GET",
        undefined,
        f.login.token,
      );
      const saved = await f.api<Row>(
        `${f.p}/configurations/${kind}`,
        "PUT",
        {
          revision: previous.revision,
          data: { ...(previous.published as Row), ...data },
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
    await configure("security", { allowFilesystem: true });
    const mainSource = join(clientRoot, "packages/desktop/out/main/index.js");
    const hostSource = join(clientRoot, "packages/desktop/out/host/index.js");
    const schedulerSource = join(
      clientRoot,
      "packages/desktop/out/scheduler/index.js",
    );
    await cp(join(clientRoot, "packages/desktop/out"), join(mainRoot, "out"), {
      recursive: true,
    });
    await Promise.all([
      symlink(join(clientRoot, "node_modules"), join(mainRoot, "node_modules")),
      symlink(
        join(clientRoot, "packages/desktop/bundled-agents"),
        join(mainRoot, "bundled-agents"),
      ),
    ]);
    assert.equal(
      await realpath(
        join(mainRoot, "bundled-agents/darwin-arm64/glm/zcode.cjs"),
      ),
      await realpath(stagedBundle),
    );
    const copiedMain = join(mainRoot, "out/main/index.js");
    const [
      sourceCli,
      stagedCli,
      mainBytes,
      copiedMainBytes,
      hostBytes,
      copiedHostBytes,
      schedulerBytes,
      copiedSchedulerBytes,
    ] = await Promise.all([
      readFile(sourceBundle),
      readFile(stagedBundle),
      readFile(mainSource),
      readFile(copiedMain),
      readFile(hostSource),
      readFile(join(mainRoot, "out/host/index.js")),
      readFile(schedulerSource),
      readFile(join(mainRoot, "out/scheduler/index.js")),
    ]);
    assert.ok(sourceCli.equals(stagedCli));
    assert.ok(mainBytes.equals(copiedMainBytes));
    assert.ok(hostBytes.equals(copiedHostBytes));
    assert.ok(schedulerBytes.equals(copiedSchedulerBytes));
    facts.artifacts = {
      cliSha256: sha(stagedCli),
      mainSha256: sha(mainBytes),
      hostSha256: sha(hostBytes),
      schedulerSha256: sha(schedulerBytes),
      completeOutCopiedWithoutRebuild: true,
    };
    const stageConfig = join(stageRoot, "fixture.json");
    const mainConfig = join(mainRoot, "fixture.json");
    await writeFile(
      stageConfig,
      JSON.stringify({
        hostModule: hostSource,
        rpcModule: join(clientRoot, "packages/rpc/dist/index.js"),
        electronUserData: join(rootDirectory, "stage-userdata"),
        builtinProvider: join(clientRoot, "config/provider/zcode-builtin.json"),
        identityConfig,
        ...workspace,
      }),
      { mode: 0o600 },
    );
    await writeFile(mainConfig, JSON.stringify({ mainModule: copiedMain }), {
      mode: 0o600,
    });
    for (const [appRoot, name, launcher] of [
      [
        stageRoot,
        "uwork-main-schedule-preparation",
        "client-automation-host-launcher.mjs",
      ],
      [
        mainRoot,
        "uwork-main-schedule-acceptance",
        "client-automation-main-launcher.mjs",
      ],
    ]) {
      await writeFile(
        join(appRoot!, "package.json"),
        JSON.stringify({
          name,
          version: "0.0.0",
          type: "module",
          main: "entry.cjs",
        }),
      );
      await writeFile(
        join(appRoot!, "entry.cjs"),
        `import(${JSON.stringify(pathToFileURL(resolve("scripts/fixtures", launcher!)).href)});`,
      );
    }
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: bootstrap.dataBaseDirectory,
      USERPROFILE: bootstrap.dataBaseDirectory,
      UWORK_DATA_BASE_DIR: bootstrap.dataBaseDirectory,
      ZCODE_DATA_BASE_DIR: bootstrap.dataBaseDirectory,
      ZCODE_STORAGE_DIR: join(bootstrap.dataBaseDirectory, ".uwork"),
      ZCODE_DESKTOP_HOME_DIR: bootstrap.dataBaseDirectory,
      ZCODE_DESKTOP_USER_DATA_DIR: join(rootDirectory, "main-userdata"),
      ZCODE_DESKTOP_SESSION_DATA_DIR: join(rootDirectory, "main-sessiondata"),
      ZCODE_DESKTOP_APPLICATION_NAME: "UWork Main schedule controlled",
      ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      ZCODE_CREDENTIAL_SECRET: bootstrap.credentialSecret,
      NODE_EXTRA_CA_CERTS: bootstrap.certificatePath,
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(
        clientRoot,
        "config/provider/zcode-builtin.json",
      ),
      ZCODE_ENV: "production",
      ZCODE_MODEL_TELEMETRY_ENABLED: "false",
      ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
      ZCODE_ARMS_RUM_ENDPOINT: "",
    };
    const stage = startOwned(
      "preparation-host",
      stageRoot,
      stageConfig,
      env,
      async () => {
        await stageControl("shutdown");
      },
    );
    const pending = new Map<
      string,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    let ready!: () => void;
    const readiness = new Promise<void>((done) => {
      ready = done;
    });
    createInterface({ input: stage.child.stdout }).on("line", (line) => {
      if (!line.startsWith("UWORK_AUTOMATION_RPC ")) return;
      const frame = JSON.parse(line.slice(21)) as Row;
      if (frame.event === "ready") ready();
      if (frame.event === "host-spawned") stage.pids.add(Number(frame.pid));
      const message = frame.message as Row | undefined;
      if (message?.type === "agent-process-spawned") {
        stage.pids.add(Number(message.pid));
        stage.cliPids.add(Number(message.pid));
      }
      const request = pending.get(String(frame.id));
      if (!request) return;
      pending.delete(String(frame.id));
      if (frame.ok) request.resolve(frame.result);
      else request.reject(new Error(String(frame.error)));
    });
    function stageControl(
      operation: string,
      extra: Row = {},
    ): Promise<unknown> {
      const id = randomUUID();
      return bounded(
        new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          stage.child.stdin.write(
            JSON.stringify({ id, operation, ...extra }) + "\n",
          );
        }),
        `preparation ${operation}`,
        45000,
      ).finally(() => pending.delete(id));
    }
    const call = async <T = Row>(
      channel: string,
      method: string,
      params?: unknown,
    ): Promise<T> => {
      assert.notEqual(method, "runAutomationNow");
      const result = await stageControl("call", {
        channel,
        method,
        args: params === undefined ? [] : [params],
      });
      rpcCalls.push({ channel, method, params, result });
      return result as T;
    };
    const dbPath = join(configDir, "tasks-index.sqlite");
    const snapshot = () => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        return {
          automation: db.prepare("SELECT * FROM automations").all() as Row[],
          runs: db
            .prepare("SELECT * FROM automation_runs ORDER BY created_at")
            .all() as Row[],
          tasks: db
            .prepare(
              "SELECT task_id, workspace_key, task_status FROM tasks WHERE deleted=0",
            )
            .all() as Row[],
        };
      } finally {
        db.close();
      }
    };
    const settledLedger = () =>
      eventually(
        () =>
          f.api<{ items: Row[] }>(
            `${f.p}/usage`,
            "GET",
            undefined,
            f.login.token,
          ),
        (usage) =>
          usage.items.length === f.calls() &&
          usage.items.every((item) => item.status === "settled"),
        10000,
      );
    const waitFor = async <T>(
      label: string,
      operation: () => Promise<T>,
      accept: (value: T) => boolean,
      timeout: number,
      owned: OwnedProcess,
    ): Promise<T> => {
      const deadline = Date.now() + timeout;
      let lastProgress = 0;
      for (;;) {
        assert.equal(owned.child.exitCode, null, `${label}: Main exited early`);
        assert.equal(
          owned.child.signalCode,
          null,
          `${label}: Main terminated early`,
        );
        await captureOwnedProcesses(owned);
        const value = await operation();
        if (accept(value)) return value;
        const now = Date.now();
        if (now >= deadline) throw new Error(`${label} timeout`);
        if (now - lastProgress >= 15000) {
          process.stdout.write(
            JSON.stringify({
              progress: label,
              at: new Date(now).toISOString(),
              remainingSeconds: Math.ceil((deadline - now) / 1000),
              supplierCalls: f.calls(),
            }) + "\n",
          );
          lastProgress = now;
        }
        await new Promise((done) => setTimeout(done, 500));
      }
    };
    let activeMain: OwnedProcess | undefined;
    try {
      await bounded(readiness, "preparation Host ready", 45000);
      assert.equal(
        (await call("enterprise-identity", "restoreSession")).status,
        "authenticated",
      );
      assert.ok((await call("ucas-gateway", "sync", "login")).committed);
      const task = await call<{ taskId: string }>("zcode-task", "createTask", {
        ...workspace,
        modelSelection: {
          providerId: "ucas",
          modelId: f.model.id,
          options: { reasoningLevel: "high" },
        },
        mode: "yolo",
      });
      facts.taskId = task.taskId;
      await call("zcode-task", "sendPrompt", {
        taskId: task.taskId,
        traceId: randomUUID(),
        content:
          "G05_MAIN_CREATE_CRON: create the controlled bound minute automation",
        clientMode: "desktop-continuous",
      });
      const automations = await eventually(
        () => call<Row[]>("zcode-agent", "listAutomations", workspace),
        (items) => items.length === 1,
        25000,
      );
      assert.equal(automations[0]!.targetTaskId, task.taskId);
      await eventually(
        () =>
          call<Row[]>("zcode-agent", "readSessionMessages", {
            ...workspace,
            sessionId: task.taskId,
          }),
        (messages) =>
          messages.some(
            (message) =>
              (message.info as Row).role === "assistant" &&
              JSON.stringify(message.parts).includes(
                "G05_MAIN_SCHEDULED_COMPLETE",
              ),
          ),
        25000,
      );
      await settledLedger();
      await stage.dispose();
      const initial = snapshot();
      assert.equal(initial.automation.length, 1);
      assert.equal(initial.runs.length, 0);
      assert.equal(initial.automation[0]!.cron_expr, "* * * * *");
      assert.equal(initial.automation[0]!.target_task_id, task.taskId);
      facts.initial = initial;
      const automationId = String(initial.automation[0]!.automation_id);
      const startMain = async (label: string) => {
        const owned: OwnedProcess = startOwned(
          label,
          mainRoot,
          mainConfig,
          env,
          async () => {
            owned.child.stdin.write("shutdown\n");
          },
        );
        activeMain = owned;
        await waitFor(
          `${label} production scheduler startup`,
          async () => owned.output.join(""),
          (text) =>
            text.includes("cron scheduler started") &&
            text.includes("UWORK_MAIN_LIFECYCLE"),
          45000,
          owned,
        );
        return owned;
      };
      const waitScheduled = async (
        owned: OwnedProcess,
        label: string,
        knownRuns: number,
        expectedDue: number,
        success: boolean,
      ) => {
        assert.ok(Number.isFinite(expectedDue));
        const state = await waitFor(
          label,
          async () => snapshot(),
          (state) =>
            state.runs.length === knownRuns + 1 &&
            state.runs.some(
              (run) =>
                Number(run.scheduled_at) === expectedDue &&
                (success
                  ? run.outcome === "succeeded"
                  : run.outcome === "failed" ||
                    run.dispatch_status === "failed_to_dispatch"),
            ),
          Math.max(0, expectedDue - Date.now()) + 50000,
          owned,
        );
        const run = state.runs.find(
          (item) => Number(item.scheduled_at) === expectedDue,
        )!;
        assert.equal(run.trigger, "schedule");
        assert.equal(run.run_id, `${automationId}:${expectedDue}`);
        assert.ok(
          Number(run.created_at) >= expectedDue,
          "real due cannot dispatch before nextRunAt",
        );
        if (success) assert.equal(run.session_id, task.taskId);
        assert.deepEqual(
          state.tasks.map((item) => item.task_id),
          [task.taskId],
        );
        assert.ok(state.runs.every((item) => item.trigger === "schedule"));
        return state;
      };
      const firstMain = await startMain("main-first");
      const firstDue = Number(initial.automation[0]!.next_run_at);
      const firstBeforeCalls = f.calls();
      const first = await waitScheduled(
        firstMain,
        "first natural schedule",
        0,
        firstDue,
        true,
      );
      assert.ok(f.calls() > firstBeforeCalls);
      await settledLedger();
      facts.first = {
        ...first,
        observedAt: Date.now(),
        supplierCalls: f.calls(),
      };
      assert.ok(
        firstMain.cliPids.size > 0,
        "production Main Host must spawn the actual verified staged CLI",
      );
      await firstMain.dispose();
      activeMain = undefined;
      const beforeRestartCalls = supplierBodies.length;
      const secondMain = await startMain("main-restarted");
      const secondDue = Number(first.automation[0]!.next_run_at);
      const second = await waitScheduled(
        secondMain,
        "natural schedule after complete Main restart",
        1,
        secondDue,
        true,
      );
      assert.ok(
        supplierBodies
          .slice(beforeRestartCalls)
          .some(
            (body) =>
              JSON.stringify(body.messages).includes("G05_MAIN_CREATE_CRON") &&
              JSON.stringify(body.messages).includes(
                "G05_MAIN_SCHEDULED_MARKER",
              ),
          ),
        "cold scheduled resume must consume persisted conversation",
      );
      const beforeDenyLedger = await settledLedger();
      const beforeDenyCalls = f.calls();
      facts.restarted = {
        ...second,
        observedAt: Date.now(),
        supplierCalls: beforeDenyCalls,
      };
      await configure("assistants", { local: false });
      const revokedAt = Date.now();
      const thirdDue = Number(second.automation[0]!.next_run_at);
      assert.ok(
        revokedAt < thirdDue,
        "local revocation must be committed before next natural due",
      );
      const denied = await waitScheduled(
        secondMain,
        "natural schedule under current local=false",
        2,
        thirdDue,
        false,
      );
      const deniedLedger = await f.api<{ items: Row[] }>(
        `${f.p}/usage`,
        "GET",
        undefined,
        f.login.token,
      );
      assert.equal(f.calls(), beforeDenyCalls);
      assert.equal(deniedLedger.items.length, beforeDenyLedger.items.length);
      facts.denied = {
        ...denied,
        revokedAt,
        observedAt: Date.now(),
        supplierDelta: 0,
        ledgerDelta: 0,
      };
      facts.supplierCalls = f.calls();
      facts.settledLedgerRows = deniedLedger.items.length;
      facts.schedulerIntervalMs = 20000;
      facts.manualRunCount = 0;
      facts.status = "passed";
      f.check(
        "complete-production-Main-natural-due-bound-conversation-restart-current-local-denial",
      );
    } catch (error) {
      facts.status = "failed";
      facts.error = error instanceof Error ? error.message : "unknown";
      try {
        facts.failureSnapshot = snapshot();
      } catch {
        /* Startup may fail before the owned DB exists. */
      }
      throw error;
    } finally {
      const cleanupErrors: unknown[] = [];
      for (const owned of [...processes].reverse()) {
        try {
          await owned.dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      facts.activeMainDisposed =
        !activeMain ||
        activeMain.child.exitCode !== null ||
        activeMain.child.signalCode !== null;
      if (cleanupErrors.length) {
        facts.status = "failed";
        facts.cleanupErrors = cleanupErrors.map((error) =>
          error instanceof Error ? error.message : "unknown",
        );
      }
      await mkdir(evidence, { recursive: true });
      await writeFile(
        join(evidence, "model-and-schedule-proof.json"),
        safeJson({ facts, supplierBodies, rpcCalls }),
        { mode: 0o600 },
      );
      if (cleanupErrors.length)
        throw new AggregateError(cleanupErrors, "owned process cleanup failed");
    }
  },
);

after(async () => {
  await mkdir(evidence, { recursive: true });
  try {
    const saved = JSON.parse(
      await readFile(join(evidence, `${fixtureName}-green.json`), "utf8"),
    );
    facts.backendHttpCount = saved.requests.length;
    facts.ledger = saved.ledger;
    facts.backendCleanup = saved.cleanup;
  } catch {
    facts.backendEvidenceMissing = true;
  }
  await writeFile(join(evidence, "summary.json"), safeJson(facts), {
    mode: 0o600,
  });
});
