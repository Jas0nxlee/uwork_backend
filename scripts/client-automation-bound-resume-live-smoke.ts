import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { eventually, liveFixture } from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
const evidence = resolve("evidence/client-automation-bound-resume-20261017");
const clientRoot = resolve("clients/uwork");
const fixtureName = "automation-bound-resume";
const facts: Row = {
  status: "running",
  boundary:
    "production Desktop Host utilityProcess/RPC + CronCreate current-conversation target injection + actual runAutomationNow/dispatchCronRun/resumeTask; not Native button or Main timed scheduler acceptance",
};
const supplierBodies: Row[] = [];
const rpcCalls: Row[] = [];
const lifecycle: Row[] = [];
let disposeHost: (() => Promise<void>) | undefined;
let auditPrivateOutput: (output: string) => void = () => {};
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

test(
  "real CronCreate binds the existing task and production Host run-now cold resumes it under current local policy",
  { timeout: 120000 },
  async (t) => {
    t.after(async () => {
      await disposeHost?.();
    });
    const f = await liveFixture(t, fixtureName, true, {
      evidenceDirectory: evidence,
      reply(body) {
        supplierBodies.push(structuredClone(body));
        if (!body.stream) return { text: "Controlled bound automation" };
        const messages = body.messages as Row[];
        const latest = messages.findLastIndex(
          (message) => message.role === "user",
        );
        const user = messages[latest]?.content;
        const alreadyReturned = messages
          .slice(latest + 1)
          .some((message) => message.role === "tool");
        if (
          typeof user === "string" &&
          user.includes("G05_CREATE_BOUND_CRON") &&
          !alreadyReturned
        )
          return {
            toolCall: {
              id: `controlled-cron-${supplierBodies.length}`,
              name: "CronCreate",
              arguments: JSON.stringify({
                title: "Controlled bound automation",
                cron: "0 0 1 1 *",
                prompt:
                  "G05_BOUND_RUN_MARKER: reply G05_BOUND_RUN_COMPLETE without tools",
                recurring: true,
              }),
            },
          };
        return { text: "G05_BOUND_RUN_COMPLETE" };
      },
    });
    const bootstrap = f.ownedDesktopHostBootstrap();
    auditPrivateOutput = bootstrap.assertPrivateOutputSafe;
    const security = await f.api<Row>(
      `${f.p}/configurations/security`,
      "GET",
      undefined,
      f.login.token,
    );
    const securityDraft = await f.api<Row>(
      `${f.p}/configurations/security`,
      "PUT",
      {
        revision: security.revision,
        data: { ...(security.published as Row), allowFilesystem: true },
      },
      f.login.token,
    );
    await f.api(
      `${f.p}/configurations/security/publish`,
      "POST",
      { revision: securityDraft.revision },
      f.login.token,
    );
    const tenantId = f.p.split("/").at(-1)!;
    const configDir = join(bootstrap.dataBaseDirectory, ".uwork", "v2");
    const workspacePath = join(bootstrap.directory, "host-workspace");
    const workspace = {
      workspacePath,
      workspaceIdentity: "controlled-bound-automation",
    };
    const appRoot = join(bootstrap.directory, "electron-app");
    await Promise.all([
      mkdir(configDir, { recursive: true }),
      mkdir(workspacePath),
      mkdir(appRoot),
    ]);
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
    const hostConfig = join(appRoot, "fixture.json");
    const hostModule = join(clientRoot, "packages/desktop/out/host/index.js");
    await writeFile(
      hostConfig,
      JSON.stringify({
        hostModule,
        rpcModule: join(clientRoot, "packages/rpc/dist/index.js"),
        electronUserData: join(bootstrap.directory, "electron-userdata"),
        builtinProvider: join(clientRoot, "config/provider/zcode-builtin.json"),
        identityConfig,
        ...workspace,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({
        name: "uwork-controlled-automation-host",
        main: "entry.cjs",
      }),
    );
    await writeFile(
      join(appRoot, "entry.cjs"),
      `import(${JSON.stringify(pathToFileURL(resolve("scripts/fixtures/client-automation-host-launcher.mjs")).href)});`,
    );
    const sourceBundle = join(
      clientRoot,
      "apps/zcode-cli/packages/cli/dist/zcode.cjs",
    );
    const stagedBundle = join(
      clientRoot,
      "packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
    );
    const [sourceBytes, stagedBytes, hostBytes] = await Promise.all([
      readFile(sourceBundle),
      readFile(stagedBundle),
      readFile(hostModule),
    ]);
    assert.ok(sourceBytes.equals(stagedBytes));
    facts.artifacts = {
      cliSha256: createHash("sha256").update(stagedBytes).digest("hex"),
      desktopHostSha256: createHash("sha256").update(hostBytes).digest("hex"),
    };
    const electron = spawn(
      resolve(
        "data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron",
      ),
      [appRoot, `--fixture-config=${hostConfig}`],
      {
        cwd: appRoot,
        detached: process.platform !== "win32",
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          HOME: join(bootstrap.directory, "electron-home"),
          USERPROFILE: join(bootstrap.directory, "electron-home"),
          UWORK_DATA_BASE_DIR: bootstrap.dataBaseDirectory,
          ZCODE_DATA_BASE_DIR: bootstrap.dataBaseDirectory,
          ZCODE_STORAGE_DIR: join(bootstrap.dataBaseDirectory, ".uwork"),
          ZCODE_CREDENTIAL_SECRET: bootstrap.credentialSecret,
          NODE_EXTRA_CA_CERTS: bootstrap.certificatePath,
          ZCODE_ENV: "production",
          ZCODE_MODEL_TELEMETRY_ENABLED: "false",
          ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
          ZCODE_ARMS_RUM_ENDPOINT: "",
        },
      },
    );
    const stdout: string[] = [],
      stderr: string[] = [];
    electron.stdout.on("data", (chunk: Buffer) => {
      if (stdout.join("").length < 4 * 1024 * 1024)
        stdout.push(chunk.toString());
    });
    electron.stderr.on("data", (chunk: Buffer) => {
      if (stderr.join("").length < 4 * 1024 * 1024)
        stderr.push(chunk.toString());
    });
    let ready!: () => void;
    const readiness = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const pending = new Map<
      string,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    const exited = new Promise<void>((resolve) =>
      electron.once("exit", () => resolve()),
    );
    createInterface({ input: electron.stdout }).on("line", (line) => {
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
    const control = <T = Row>(
      operation: string,
      extra: Row = {},
    ): Promise<T> => {
      const id = randomUUID();
      return bounded(
        new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          electron.stdin.write(
            JSON.stringify({ id, operation, ...extra }) + "\n",
          );
        }),
        `Electron ${operation}`,
        45000,
      ).finally(() => pending.delete(id)) as Promise<T>;
    };
    const call = async <T = Row>(
      channel: string,
      method: string,
      params?: unknown,
    ): Promise<T> => {
      try {
        const result = await control<T>("call", {
          channel,
          method,
          args: params === undefined ? [] : [params],
        });
        rpcCalls.push({ channel, method, params, result });
        return result;
      } catch (error) {
        rpcCalls.push({
          channel,
          method,
          params,
          error: error instanceof Error ? error.message : "unknown",
        });
        throw error;
      }
    };
    let cleanup: Promise<void> | undefined;
    disposeHost = () =>
      (cleanup ??= (async () => {
        let error: unknown;
        try {
          if (electron.exitCode === null && electron.signalCode === null)
            await control("shutdown");
        } catch (caught) {
          error = caught;
        }
        try {
          await bounded(exited, "owned Electron exit", 8000);
        } catch (caught) {
          if (electron.pid) process.kill(electron.pid, "SIGKILL");
          await bounded(exited, "forced owned Electron exit", 5000);
          error ??= caught;
        }
        let output = stdout.join("") + stderr.join("");
        try {
          bootstrap.assertPrivateOutputSafe(output);
        } catch (caught) {
          error ??= caught;
          output = "[private output withheld after audit failure]\n";
          facts.privateOutputWithheld = true;
        }
        await mkdir(evidence, { recursive: true });
        await writeFile(join(evidence, "host-output.log"), output, {
          mode: 0o600,
        });
        facts.electronExit = {
          pid: electron.pid,
          code: electron.exitCode,
          signal: electron.signalCode,
        };
        facts.hostLifecycle = lifecycle;
        const hostSpawns = lifecycle.filter(
          (item) => item.event === "host-spawned",
        );
        const cliSpawns = lifecycle.filter(
          (item) =>
            item.event === "host-agent" &&
            (item.message as Row).type === "agent-process-spawned",
        );
        const hostExits = lifecycle.filter(
          (item) => item.event === "host-exited",
        );
        const cliExits = lifecycle.filter(
          (item) =>
            item.event === "host-agent" &&
            (item.message as Row).type === "agent-process-exited",
        );
        const pids = [
          electron.pid,
          ...hostSpawns.map((item) => item.pid),
          ...cliSpawns.map((item) => (item.message as Row).pid),
        ].filter((pid): pid is number => typeof pid === "number");
        const processChecks = async () =>
          pids.map((pid) => {
            try {
              process.kill(pid, 0);
              return { pid, exited: false };
            } catch (caught) {
              if ((caught as NodeJS.ErrnoException).code !== "ESRCH")
                throw caught;
              return { pid, exited: true };
            }
          });
        try {
          facts.ownedProcessCleanup = await eventually(
            processChecks,
            (checks) => checks.every((item) => item.exited),
            5000,
          );
        } catch (caught) {
          error ??= caught;
          const forced = [];
          for (const check of await processChecks()) {
            if (check.exited) continue;
            try {
              process.kill(check.pid, "SIGKILL");
              forced.push(check.pid);
            } catch (killError) {
              if ((killError as NodeJS.ErrnoException).code !== "ESRCH")
                throw killError;
            }
          }
          facts.forcedOwnedPids = forced;
          facts.ownedProcessCleanup = await eventually(
            processChecks,
            (checks) => checks.every((item) => item.exited),
            5000,
          );
        }
        assert.equal(hostExits.length, hostSpawns.length);
        assert.equal(cliExits.length, cliSpawns.length);
        assert.ok(hostExits.every((item) => item.code === 0));
        assert.ok(
          cliExits.every((item) => (item.message as Row).exitCode === 0),
        );
        assert.ok(
          cliSpawns.every((item) =>
            ((item.message as Row).args as string[]).includes(stagedBundle),
          ),
          "actual Host-spawned CLI argv must use the verified staged artifact",
        );
        if (error) throw error;
        assert.equal(electron.exitCode, 0);
      })());
    try {
      await bounded(readiness, "owned Electron/Host readiness", 45000);
      const identity = await call("enterprise-identity", "restoreSession");
      assert.equal(identity.status, "authenticated");
      assert.ok((await call("ucas-gateway", "sync", "login")).committed);
      const task = await call<{ taskId: string; mode: string }>(
        "zcode-task",
        "createTask",
        {
          ...workspace,
          modelSelection: {
            providerId: "ucas",
            modelId: f.model.id,
            options: { reasoningLevel: "high" },
          },
          mode: "yolo",
        },
      );
      assert.equal(typeof task.taskId, "string");
      facts.originalTaskId = task.taskId;
      facts.initialControlledTaskMode = "yolo";
      facts.initialCreateDeferPersistenceUntilFirstPrompt =
        "omitted (public default)";
      const initialSnapshot = await call<Row>("zcode-agent", "readSession", {
        ...workspace,
        sessionId: task.taskId,
      });
      const runtimeMode = ((initialSnapshot.settings as Row).mode as Row)
        .current;
      facts.initialMode = {
        requested: "yolo",
        returnedTask: task.mode,
        sessionProjection: (initialSnapshot.session as Row).mode,
        runtimeSettings: runtimeMode,
      };
      assert.equal(
        runtimeMode,
        "yolo",
        "public createTask mode must reach the actual runtime without a separate switch",
      );
      assert.equal(
        task.mode,
        runtimeMode,
        "public task metadata mode must equal the active runtime",
      );
      assert.equal(
        (initialSnapshot.session as Row).mode,
        runtimeMode,
        "active session metadata cannot report a different permission mode",
      );
      await call("zcode-task", "sendPrompt", {
        taskId: task.taskId,
        traceId: randomUUID(),
        content:
          "G05_CREATE_BOUND_CRON: create the controlled bound automation",
        clientMode: "desktop-continuous",
      });
      const automations = await eventually(
        () => call<Row[]>("zcode-agent", "listAutomations", workspace),
        (items) => items.length === 1,
        25000,
      );
      const automation = automations[0]!;
      assert.equal(
        automation.targetTaskId,
        task.taskId,
        "only actual CronCreate session context may provide the binding",
      );
      facts.automationId = automation.automationId;
      const initialMessages = await call<Row[]>(
        "zcode-agent",
        "readSessionMessages",
        { ...workspace, sessionId: task.taskId },
      );
      const originalUser = initialMessages.find(
        (item) =>
          (item.info as Row).role === "user" &&
          JSON.stringify(item.parts).includes("G05_CREATE_BOUND_CRON"),
      );
      assert.ok(
        originalUser,
        "successful default first input must be in actual persisted messages",
      );
      facts.initialUserMessageId = (originalUser.info as Row).messageId;
      assert.equal(typeof facts.initialUserMessageId, "string");
      const target = { ...workspace, automationId: automation.automationId };
      const terminalRuns = () =>
        call<Row[]>("zcode-agent", "listAutomationRuns", target);
      const run = async (expected: "succeeded" | "failed") => {
        const known = new Set((await terminalRuns()).map((item) => item.runId));
        try {
          assert.equal(
            (await call("zcode-agent", "runAutomationNow", target)).status,
            "queued",
          );
        } catch (error) {
          if (expected === "succeeded") throw error;
          facts.deniedRunNowError =
            error instanceof Error ? error.message : "unknown";
        }
        return eventually(
          terminalRuns,
          (items) =>
            items.length === known.size + 1 &&
            items.some(
              (item) =>
                !known.has(item.runId) &&
                (item.outcome === expected ||
                  (expected === "failed" &&
                    item.dispatchStatus === "failed_to_dispatch")) &&
                item.dispatchStatus !== "claimed",
            ),
          25000,
        );
      };
      await eventually(
        async () => f.calls(),
        (calls) => calls >= 2,
        10000,
      );
      const first = await run("succeeded");
      assert.ok(first.every((item) => item.sessionId === task.taskId));
      const beforeDeny = f.calls();
      const beforeDenyLedger = await eventually(
        () =>
          f.api<{ items: Row[] }>(
            `${f.p}/usage`,
            "GET",
            undefined,
            f.login.token,
          ),
        (usage) =>
          usage.items.length === beforeDeny &&
          usage.items.every((item) => item.status === "settled"),
      );
      const config = await f.api<Row>(
        `${f.p}/configurations/assistants`,
        "GET",
        undefined,
        f.login.token,
      );
      const changeLocal = async (local: boolean) => {
        const current = await f.api<Row>(
          `${f.p}/configurations/assistants`,
          "GET",
          undefined,
          f.login.token,
        );
        const saved = await f.api<Row>(
          `${f.p}/configurations/assistants`,
          "PUT",
          {
            revision: current.revision,
            data: { ...(config.published as Row), local },
          },
          f.login.token,
        );
        await f.api(
          `${f.p}/configurations/assistants/publish`,
          "POST",
          { revision: saved.revision },
          f.login.token,
        );
      };
      await changeLocal(false);
      const denied = await run("failed");
      assert.equal(
        f.calls(),
        beforeDeny,
        "local revocation cannot dispatch another model request",
      );
      const deniedLedger = await f.api<{ items: Row[] }>(
        `${f.p}/usage`,
        "GET",
        undefined,
        f.login.token,
      );
      assert.equal(
        deniedLedger.items.length,
        beforeDenyLedger.items.length,
        "local denial cannot add a model ledger row",
      );
      await changeLocal(true);
      await control("restart");
      assert.equal(
        (await call("enterprise-identity", "restoreSession")).status,
        "authenticated",
      );
      assert.ok((await call("ucas-gateway", "sync", "login")).committed);
      const restored = await call<Row[]>(
        "zcode-agent",
        "listAutomations",
        workspace,
      );
      assert.equal(restored.length, 1);
      assert.equal(restored[0]!.targetTaskId, task.taskId);
      const beforeResume = supplierBodies.length;
      const resumed = await run("succeeded");
      assert.ok(resumed.every((item) => item.sessionId === task.taskId));
      assert.ok(
        supplierBodies
          .slice(beforeResume)
          .some(
            (body) =>
              JSON.stringify(body.messages).includes("G05_CREATE_BOUND_CRON") &&
              JSON.stringify(body.messages).includes("G05_BOUND_RUN_MARKER"),
          ),
        "actual resumed model must consume the persisted original conversation",
      );
      const tasks = await call<Row[]>("zcode-task", "listTasks", workspace);
      assert.deepEqual(
        tasks.map((item) => item.taskId),
        [task.taskId],
      );
      const restoredMessages = await call<Row[]>(
        "zcode-agent",
        "readSessionMessages",
        { ...workspace, sessionId: task.taskId },
      );
      assert.ok(
        restoredMessages.some(
          (item) =>
            (item.info as Row).messageId === facts.initialUserMessageId &&
            (item.info as Row).role === "user",
        ),
        "same original user message must survive Host/CLI restart",
      );
      facts.defaultInitialInputPersistedAcrossRestart = true;
      facts.runs = { first, denied, resumed };
      facts.supplierCalls = f.calls();
      const finalLedger = await eventually(
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
      );
      facts.settledLedgerRows = finalLedger.items.length;
      facts.localDeniedLedgerDelta =
        deniedLedger.items.length - beforeDenyLedger.items.length;
      facts.sameTaskAfterRestart = true;
      facts.localDeniedSupplierDelta = 0;
      facts.status = "passed";
      f.check(
        "actual-CronCreate-bound-target-production-run-now-resume-same-task-local-revocation-restart-persistence",
      );
    } catch (error) {
      facts.status = "failed";
      facts.error = error instanceof Error ? error.message : "unknown";
      throw error;
    } finally {
      try {
        await disposeHost();
      } catch (error) {
        facts.status = "failed";
        facts.cleanupError = error instanceof Error ? error.message : "unknown";
        throw error;
      } finally {
        await writeFile(
          join(evidence, "model-and-rpc-proof.json"),
          safeJson({ facts, supplierBodies, rpcCalls }),
          { mode: 0o600 },
        );
      }
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
