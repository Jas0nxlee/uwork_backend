import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import type { Run, RunTool } from "../src/agent-contract.js";

const directory = await mkdtemp(join(tmpdir(), "uwork-mcp-crash-")),
  database = join(directory, "backend.sqlite");
let calls = 0,
  models = 0,
  entered!: () => void;
const dispatched = new Promise<void>((resolve) => (entered = resolve));
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  res.setHeader("content-type", "application/json");
  if (req.url === "/mcp") {
    assert.equal(req.headers.authorization, "Bearer synthetic-only");
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "tools/call") {
      calls++;
      entered();
      return;
    }
    if (body.method === "initialize")
      res.setHeader("mcp-session-id", "controlled-private-session");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "initialize"
            ? {
                protocolVersion: "2025-03-26",
                serverInfo: { name: "controlled", version: "1" },
                capabilities: { tools: {} },
              }
            : {
                tools: [
                  {
                    name: "multiply",
                    inputSchema: {
                      type: "object",
                      properties: {
                        left: { type: "number" },
                        right: { type: "number" },
                      },
                      required: ["left", "right"],
                    },
                  },
                ],
              },
      }),
    );
  } else {
    models++;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "controlled-mcp-crash",
                  type: "function",
                  function: {
                    name: body.tools[0].function.name,
                    arguments: '{"left":6,"right":7}',
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
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const child = fork(
  new URL("./fixtures/agent-mcp-crash-child.ts", import.meta.url),
  [],
  {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      ...process.env,
      UWORK_CONTROLLED_BASE: base,
      UWORK_CONTROLLED_DB: database,
    },
  },
);
const exited = once(child, "exit");
const deadline = new Promise<never>((_, reject) =>
  setTimeout(
    () => reject(new Error("MCP crash verification deadline exceeded")),
    10000,
  ).unref(),
);
try {
  const ready = new Promise<string>((resolve, reject) => {
    child.once("message", (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        "runId" in message &&
        typeof message.runId === "string" &&
        /^[a-f0-9]{32}$/.test(message.runId)
      )
        resolve(message.runId);
      else reject(new Error("Invalid controlled run identity"));
    });
    child.once("error", () =>
      reject(new Error("Controlled child failed to start")),
    );
    child.once("exit", () =>
      reject(new Error("Controlled child exited before verification")),
    );
  });
  const runId = await Promise.race([ready, deadline]);
  await Promise.race([dispatched, deadline]);
  child.kill("SIGKILL");
  const [, signal] = await Promise.race([exited, deadline]);
  assert.equal(signal, "SIGKILL");
  const app = await createApp({
    database,
    masterKey: Buffer.alloc(32, 7),
    publicUrl: "http://localhost:3000",
    worker: true,
    allowPrivateUpstreams: true,
  });
  try {
    const run = app.services.db.get<Run>(
      "SELECT * FROM runs WHERE id=?",
      runId,
    )!;
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "PROCESS_RESTARTED");
    const tool = app.services.db.get<RunTool>(
      "SELECT * FROM run_tools WHERE run_id=?",
      runId,
    )!;
    assert.equal(tool.kind, "mcp");
    assert.equal(tool.dispatched, 1);
    assert.equal(tool.status, "uncertain");
    assert.equal(tool.error_code, "PROCESS_RESTARTED");
    assert.equal(
      app.services.db.get<{ n: number }>(
        "SELECT count(*) n FROM connector_sessions WHERE run_id=?",
        runId,
      )!.n,
      0,
    );
    app.services.runtime.pump();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(calls, 1);
    assert.equal(models, 1);
    console.log(
      JSON.stringify({
        remoteDispatchObserved: true,
        backendSigkill: true,
        parentFailedAfterRestart: true,
        remoteSideEffectUncertain: true,
        localSessionsRemoved: true,
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
  server.closeAllConnections();
  server.close();
  await rm(directory, { recursive: true, force: true });
}
