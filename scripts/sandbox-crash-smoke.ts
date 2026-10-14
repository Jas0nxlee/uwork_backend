import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import type { SandboxRuntimeRow } from "../src/sandbox/contract.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";
import { currentActor } from "../src/access.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
const socket =
  process.env.UWORK_SANDBOX_SOCKET ??
  "/Users/ljp/.colima/uwork-backend/docker.sock";
const dir = await mkdtemp(join(tmpdir(), "uwork-sandbox-crash-"));
const database = join(dir, "state.sqlite");
const key = randomBytes(32);
const child = fork(
  fileURLToPath(new URL("./fixtures/sandbox-crash-child.ts", import.meta.url)),
  [],
  {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      UWORK_SANDBOX_SOCKET: socket,
      UWORK_SANDBOX_DATABASE: database,
      MASTER_KEY: key.toString("hex"),
    },
  },
);
const exited = new Promise<void>((r) => child.once("exit", () => r()));
let state:
  | {
      tenantId: string;
      userId: string;
      runtimeId: string;
      executionId: string;
      observedRunning: boolean;
    }
  | undefined;
try {
  state = await new Promise<typeof state>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Crash fixture did not become ready")),
      10000,
    );
    child.once("message", (value) => {
      clearTimeout(timer);
      resolve(value as typeof state);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!state) reject(new Error("Crash fixture exited early"));
    });
  });
  assert.ok(state?.observedRunning);
  child.kill("SIGKILL");
  await exited;
  const driver = new DockerSandboxDriver(
    socket,
    process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
  );
  const app = await createApp({
    database,
    masterKey: key,
    publicUrl: "http://localhost:3000",
    sandboxDriver: driver,
  });
  try {
    const actor = currentActor(app.services.db, state.tenantId, state.userId);
    const result = app.services.sandbox.getExecution(actor, state.executionId);
    assert.equal(result.status, "failed");
    assert.equal(result.error_code, "PROCESS_RESTARTED");
    assert.equal(
      (await app.services.sandbox.view(actor, state.runtimeId)).status,
      "stopped",
    );
    await app.services.sandbox.stopRuntime(actor, state.runtimeId, true);
    console.log(
      JSON.stringify({
        observedRealRunningExec: true,
        backendKilled: true,
        persistentRecovery: true,
        interruptedTaskFailed: true,
        containerStopped: true,
      }),
    );
  } finally {
    await app.close();
  }
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
  if (existsSync(database)) {
    const connection = new DatabaseSync(database, { readOnly: true });
    try {
      if (
        connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='sandbox_runtimes'",
          )
          .get()
      ) {
        const rows = connection
          .prepare("SELECT * FROM sandbox_runtimes")
          .all() as unknown as SandboxRuntimeRow[];
        const driver = new DockerSandboxDriver(
          socket,
          process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
        );
        await cleanupSandboxes(
          driver,
          rows.map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            ownerToken: row.owner_token,
            expiresAt: row.expires_at,
          })),
        );
      }
    } finally {
      connection.close();
    }
  }
  await rm(dir, { recursive: true, force: true });
}
