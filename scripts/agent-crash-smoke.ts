import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";
import { createApp } from "../src/app.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import type { SandboxRuntimeRow } from "../src/sandbox/contract.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";

const socket =
  process.env.UWORK_SANDBOX_SOCKET ??
  "/Users/ljp/.colima/uwork-backend/docker.sock";
const dir = await mkdtemp(join(tmpdir(), "uwork-agent-crash-")),
  database = join(dir, "state.sqlite"),
  key = randomBytes(32);
let modelCalls = 0;
const mode = process.env.UWORK_AGENT_CRASH_MODE ?? "active";
assert.ok(["active", "ready"].includes(mode));
let resolveWaiting!: () => void;
const waiting = new Promise<void>((resolve) => (resolveWaiting = resolve));
const upstream = createServer(async (req, res) => {
  for await (const chunk of req) {
    void chunk;
  }
  modelCalls++;
  if (mode === "ready" && modelCalls === 2) {
    resolveWaiting();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_crash",
                type: "function",
                function: {
                  name: "execute_javascript",
                  arguments: JSON.stringify({
                    code:
                      mode === "ready" ? "console.log(42)" : "while(true){}",
                  }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
  );
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const driver = new DockerSandboxDriver(
  socket,
  process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
);
const child = fork(
  fileURLToPath(new URL("./fixtures/agent-crash-child.ts", import.meta.url)),
  [],
  {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      UWORK_SANDBOX_SOCKET: socket,
      UWORK_SANDBOX_DATABASE: database,
      UWORK_AGENT_CRASH_MODE: mode,
      UWORK_VERIFICATION_UPSTREAM: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
      MASTER_KEY: key.toString("hex"),
    },
  },
);
const exited = new Promise<void>((resolve) =>
  child.once("exit", () => resolve()),
);
interface State {
  runId: string;
  containerId: string;
  runtimeId: string;
  observedRunning?: boolean;
  observedReady?: boolean;
}
let state: State | undefined;
try {
  state = await new Promise<State>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Agent crash fixture did not become ready")),
      15000,
    );
    child.once("message", (value) => {
      clearTimeout(timer);
      resolve(value as State);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!state) reject(new Error("Agent crash fixture exited early"));
    });
  });
  if (mode === "ready") {
    assert.equal(state.observedReady, true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        waiting,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Second model request not observed")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  } else assert.equal(state.observedRunning, true);
  child.kill("SIGKILL");
  await exited;
  const app = await createApp({
    database,
    masterKey: key,
    publicUrl: "http://localhost:3000",
    sandboxDriver: driver,
  });
  try {
    const run = app.services.db.get<{ status: string; error_code: string }>(
      "SELECT status,error_code FROM runs WHERE id=?",
      state.runId,
    )!;
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "PROCESS_RESTARTED");
    const tool = app.services.db.get<{
      status: string;
      error_code: string;
      execution_id: string;
    }>(
      "SELECT status,error_code,execution_id FROM run_tools WHERE run_id=?",
      state.runId,
    )!;
    assert.equal(tool.status, mode === "ready" ? "succeeded" : "uncertain");
    assert.equal(
      tool.error_code,
      mode === "ready" ? null : "PROCESS_RESTARTED",
    );
    assert.ok(tool.execution_id);
    assert.equal(
      app.services.db.get<{ status: string }>(
        "SELECT status FROM sandbox_runtimes WHERE id=?",
        state.runtimeId,
      )!.status,
      "deleted",
    );
    await assert.rejects(
      () =>
        new Docker({ socketPath: socket })
          .getContainer(state!.containerId)
          .inspect(),
      (error) =>
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404,
    );
    await app.services.runtime.drain();
    assert.equal(modelCalls, mode === "ready" ? 2 : 1);
    console.log(
      JSON.stringify({
        mode,
        realAgentExecObserved: mode === "active",
        completedToolObserved: mode === "ready",
        backendSigkill: true,
        parentFailedAfterRestart: true,
        toolUncertaintyPreserved: mode === "active",
        completedResultPreserved: mode === "ready",
        ownedContainerRemoved: true,
        noModelOrToolReplay: true,
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
  upstream.closeAllConnections();
  upstream.close();
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
