import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fork, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  createServer as httpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as httpsServer } from "node:https";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  copyFile,
  chmod,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  FixtureCommand,
  WholeBackendAccount,
} from "./backend-e2e-fixture.js";

type Row = Record<string, unknown>;
const evidence = resolve("evidence/live-sixth-20261017/http");
const metadataPath = join(evidence, "sixth-backend-runtime.json");
const stopPath = join(evidence, "sixth-backend-runtime.stop");
const reportPath = join(evidence, "sixth-backend-runtime-report.json");
const trafficPath = join(evidence, "sixth-backend-runtime-requests.json");
const startedAt = new Date().toISOString();
const holdForUi = process.argv.includes("--hold-for-ui");
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const uiSocket = argument("--ui-sandbox-socket");
const uiImage = argument("--ui-sandbox-image") ?? "uwork-sandbox:local";
let sandboxConfig: { sandboxSocket: string; sandboxImage: string } | undefined;
let gitHead = "unrecorded";
const checks: {
  name: string;
  status: string;
  durationMs: number;
  error?: string;
}[] = [];
const requestCounts: Record<string, number> = {};
const accounts: WholeBackendAccount[] = [
  {
    name: "whole-api-enterprise-a",
    email: "whole-owner-a@example.test",
    password: "Whole-controlled-password-2026!",
  },
  {
    name: "whole-api-enterprise-b",
    email: "whole-owner-b@example.test",
    password: "Whole-controlled-password-2026!",
  },
  {
    name: "security-probe-enterprise",
    email: "security-probe-owner@example.test",
    password: "Whole-security-password-2026!",
  },
];
let origin = "",
  database = "",
  directory = "",
  child: ChildProcess | undefined,
  requestId = 0;
let currentDatabase = "",
  active = false;
let upstream: ReturnType<typeof httpServer> | undefined;
let mcp: ReturnType<typeof httpsServer> | undefined;
const masterKey = randomBytes(32).toString("hex");
const pending = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
let metadata: Row = {};
const concurrentFinishes: (() => void)[] = [];
const synth = {
  modelKey: "whole-model-key-v1",
  modelCalls: 0,
  mcpCalls: 0,
  webhookCalls: 0,
  lastSystem: "",
  webhookPayloads: [] as Row[],
};

async function secureJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
}
async function check(name: string, operation: () => Promise<void>) {
  const started = Date.now();
  try {
    await operation();
    checks.push({ name, status: "passed", durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    checks.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      error: message.slice(0, 500),
    });
    throw error;
  }
}
async function raw(
  method: string,
  path: string,
  token?: string,
  payload?: unknown,
  expected = 200,
  extra: Record<string, string> = {},
) {
  assert.ok(
    !/\/(?:wecom|drive)(?:\/|$)/.test(path.split("?")[0]!),
    "excluded integration operation must not dispatch",
  );
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(30000),
    redirect: "manual",
  });
  if (response.status !== expected) {
    let code = "unexpected_response";
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      code = body.error?.code ?? code;
    } catch {
      /* no response content is printed */
    }
    throw new Error(
      `${method} ${path.split("?")[0]} expected ${expected}, received ${response.status} (${code})`,
    );
  }
  return response;
}
async function api<T = Row>(
  method: string,
  path: string,
  token?: string,
  payload?: unknown,
  expected = 200,
  extra?: Record<string, string>,
): Promise<T> {
  const response = await raw(method, path, token, payload, expected, extra);
  const body = await response.text();
  if (!body && ![202, 204].includes(response.status))
    throw new Error(
      `${method} ${path.split("?")[0]} returned an unexpected empty body`,
    );
  return (body ? JSON.parse(body) : undefined) as T;
}
async function login(account: WholeBackendAccount) {
  const result = await api("POST", "/api/auth/login", undefined, {
    email: account.email,
    password: account.password,
  });
  assert.equal(typeof result.token, "string");
  return String(result.token);
}
async function poll<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 30000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for real HTTP worker state");
    await delay(150);
  }
}
function ipc(command: Omit<FixtureCommand, "requestId">): Promise<unknown> {
  if (!child?.connected)
    return Promise.reject(new Error("Controlled fixture IPC is disconnected"));
  const processToSend = child;
  const id = ++requestId;
  return new Promise((resolveValue, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Controlled fixture IPC timeout: ${command.kind}`));
    }, 20000);
    timer.unref();
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolveValue(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    processToSend.send({ ...command, requestId: id }, (error: Error | null) => {
      if (!error) return;
      const task = pending.get(id);
      pending.delete(id);
      task?.reject(error);
    });
  });
}
async function dumpTraffic() {
  if (!child?.connected) return;
  const counts = (await ipc({ kind: "dump-requests" })) as Record<
    string,
    number
  >;
  const combined = { ...requestCounts };
  for (const [key, value] of Object.entries(counts))
    combined[key] = (combined[key] ?? 0) + value;
  await secureJson(trafficPath, {
    recordedAt: new Date().toISOString(),
    records: combined,
  });
  return counts;
}
async function shutdownChild() {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    child = undefined;
    return;
  }
  if (!child.connected) {
    const stopped = child;
    if (!(await waitForChildExit(stopped, 10000)))
      throw new Error("Disconnected fixture child exit unconfirmed");
    child = undefined;
    return;
  }
  const counts = await dumpTraffic();
  for (const [key, value] of Object.entries(counts ?? {}))
    requestCounts[key] = (requestCounts[key] ?? 0) + value;
  const processToClose = child;
  const exited = waitForChildExit(processToClose, 10000);
  await ipc({ kind: "shutdown" });
  if (!(await exited))
    throw new Error("Controlled fixture did not exit after shutdown");
  child = undefined;
}
async function startChild(
  port: number,
  certificate: string,
  initialize = false,
) {
  child = fork(resolve("scripts/backend-e2e-fixture.ts"), [], {
    execArgv: ["--import", "tsx"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      NODE_EXTRA_CA_CERTS: certificate,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr?.on("data", () => {});
  child.on(
    "message",
    (message: {
      requestId: number;
      ok: boolean;
      value?: unknown;
      error?: string;
    }) => {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.ok) request.resolve(message.value);
      else
        request.reject(
          new Error(`Controlled fixture: ${message.error ?? "failed"}`),
        );
    },
  );
  child.once("exit", () => {
    for (const task of pending.values())
      task.reject(new Error("Controlled backend process exited"));
    pending.clear();
  });
  const result = (await ipc({
    kind: "start",
    database: currentDatabase,
    masterKey,
    port,
    initialize,
    accounts,
    ...sandboxConfig,
  } as Omit<FixtureCommand, "requestId">)) as {
    url: string;
    accounts: WholeBackendAccount[];
    pid: number;
  };
  origin = result.url;
  if (initialize) accounts.splice(0, accounts.length, ...result.accounts);
  await api("GET", "/health");
  return result.pid;
}
async function port() {
  const server = httpServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}
async function readBody(request: IncomingMessage): Promise<Row> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  return chunks.length
    ? (JSON.parse(Buffer.concat(chunks).toString()) as Row)
    : {};
}
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
async function setupProviders() {
  upstream = httpServer(async (request, response) => {
    const url = new URL(request.url!, "http://controlled.local");
    if (url.pathname === "/webhook") {
      synth.webhookCalls++;
      synth.webhookPayloads.push(await readBody(request));
      return json(response, { accepted: true });
    }
    if (url.pathname.startsWith("/drive/")) {
      if (request.headers.authorization !== "Bearer whole-drive-key")
        return json(response, { error: "controlled_unauthorized" }, 401);
      const endpoint = url.pathname.split("/").at(-1);
      if (request.method === "PUT")
        return json(response, { applied: true, ...(await readBody(request)) });
      return json(
        response,
        endpoint === "health"
          ? { available: true }
          : endpoint === "capacity"
            ? { totalBytes: 1000000, usedBytes: 128 }
            : {
                items: [
                  {
                    id: "whole-drive-synthetic",
                    tenantId: url.searchParams.get("tenantId"),
                  },
                ],
                total: 1,
              },
      );
    }
    if (url.pathname.endsWith("/models"))
      return json(response, {
        data: [{ id: "whole-controlled-model", object: "model" }],
      });
    const body = await readBody(request);
    if (request.headers.authorization !== `Bearer ${synth.modelKey}`)
      return json(response, { error: "controlled_unauthorized" }, 401);
    synth.modelCalls++;
    if (JSON.stringify(body.messages).includes("SIXTH-MALFORMED")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{bad-controlled");
      return;
    }
    const messages = body.messages as { role: string; content?: string }[];
    synth.lastSystem = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content ?? "")
      .join("\n");
    const slow = messages.some((message) =>
      String(message.content).includes("whole-ui-slow"),
    );
    if (
      messages.some((message) => String(message.content).includes("WHOLE-HANG"))
    )
      return;
    const finish = () => {
      if (response.destroyed) return;
      const usage = { prompt_tokens: 12, completion_tokens: 3 };
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "whole-" }, finish_reason: null }] })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`,
        );
        response.end(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`,
        );
      } else
        json(response, {
          id: "controlled-upstream",
          choices: [
            {
              message: { role: "assistant", content: "whole-answer" },
              finish_reason: "stop",
            },
          ],
          usage,
        });
    };
    if (
      messages.some((message) =>
        String(message.content).includes("WHOLE-CONCURRENCY"),
      )
    ) {
      concurrentFinishes.push(finish);
      return;
    }
    if (slow) {
      const timer = setTimeout(finish, 20000);
      response.once("close", () => clearTimeout(timer));
    } else finish();
  });
  await new Promise<void>((done) => upstream!.listen(0, "127.0.0.1", done));
  const tlsConfig = join(directory, "openssl.cnf"),
    certificate = join(directory, "controlled-ca.pem"),
    tlsKey = join(directory, "controlled-tls.key");
  await writeFile(
    tlsConfig,
    "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=whole-controlled-local\n[v3]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n",
    { mode: 0o600 },
  );
  await promisify(execFile)("openssl", [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-x509",
    "-days",
    "1",
    "-config",
    tlsConfig,
    "-keyout",
    tlsKey,
    "-out",
    certificate,
  ]);
  await chmod(tlsKey, 0o600);
  mcp = httpsServer(
    { key: await readFile(tlsKey), cert: await readFile(certificate) },
    async (request, response) => {
      if (request.headers.authorization !== "Bearer whole-mcp-key")
        return json(response, { error: "controlled_unauthorized" }, 401);
      const body = await readBody(request);
      if (body.id === undefined) {
        response.writeHead(202);
        return response.end();
      }
      response.setHeader("mcp-session-id", "whole-upstream-mcp-session");
      let result: unknown;
      if (body.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "whole-controlled-mcp", version: "1" },
        };
      else if (body.method === "tools/list")
        result = {
          tools: [
            {
              name: "echo",
              description: "Controlled echo",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string", maxLength: 200 } },
                required: ["message"],
                additionalProperties: false,
              },
            },
          ],
        };
      else {
        synth.mcpCalls++;
        result = {
          content: [
            {
              type: "text",
              text: `whole-echo:${String((body.params as Row)?.name)} whole-mcp-key whole-upstream-mcp-session`,
            },
          ],
        };
      }
      json(response, { jsonrpc: "2.0", id: body.id, result });
    },
  );
  await new Promise<void>((done) => mcp!.listen(0, "127.0.0.1", done));
  return {
    certificate,
    modelsBaseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
    webhookUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/webhook`,
    driveBaseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/drive`,
    mcpUrl: `https://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`,
  };
}
function waitForChildExit(
  processToClose: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (processToClose.exitCode !== null || processToClose.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((done) => {
    const exited = () => {
      clearTimeout(timer);
      done(true);
    };
    const timer = setTimeout(() => {
      processToClose.off("exit", exited);
      done(false);
    }, timeoutMs);
    processToClose.once("exit", exited);
  });
}
let cleanupWork: Promise<void> | undefined;
function cleanup(): Promise<void> {
  cleanupWork ??= (async () => {
    let cleanupError = false;
    try {
      await shutdownChild();
    } catch {
      cleanupError = true;
      const remaining = child;
      if (remaining) {
        remaining.kill("SIGTERM");
        if (!(await waitForChildExit(remaining, 5000))) {
          remaining.kill("SIGKILL");
          if (!(await waitForChildExit(remaining, 5000))) {
            await secureJson(metadataPath, {
              ...metadata,
              status: "cleanup-unconfirmed",
            });
            throw new Error(
              "Controlled fixture child exit unconfirmed; temporary files preserved",
            );
          }
        }
        child = undefined;
      }
    }
    upstream?.closeAllConnections();
    mcp?.closeAllConnections();
    const closed = await Promise.allSettled([
      new Promise<void>((done, reject) =>
        upstream
          ? upstream.close((error) => (error ? reject(error) : done()))
          : done(),
      ),
      new Promise<void>((done, reject) =>
        mcp ? mcp.close((error) => (error ? reject(error) : done())) : done(),
      ),
    ]);
    if (closed.some((item) => item.status === "rejected")) cleanupError = true;
    if (directory) await rm(directory, { recursive: true, force: true });
    await rm(stopPath, { force: true });
    await secureJson(metadataPath, {
      ...metadata,
      status: cleanupError ? "stopped-with-cleanup-error" : "stopped",
      cleanup:
        "owned child exit confirmed; providers/temp SQLite and TLS key removed",
    });
    active = false;
    if (cleanupError) {
      process.exitCode = 1;
      throw new Error(
        "Controlled fixture cleanup required forced termination or encountered a close error",
      );
    }
  })();
  return cleanupWork;
}
const stopOnSignal = () => {
  void cleanup()
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => process.exit(Number(process.exitCode) || 0));
};
process.on("SIGINT", stopOnSignal);
process.on("SIGTERM", stopOnSignal);

async function main() {
  await mkdir(evidence, { recursive: true });
  gitHead = (
    await promisify(execFile)("git", ["rev-parse", "HEAD"])
  ).stdout.trim();
  await rm(stopPath, { force: true });
  directory = await mkdtemp(join(tmpdir(), "uwork-sixth-backend-"));
  database = join(directory, "backend.sqlite");
  currentDatabase = database;
  const providers = await setupProviders();
  const backendPort = await port();
  if (uiSocket)
    sandboxConfig = { sandboxSocket: uiSocket, sandboxImage: uiImage };
  const firstPid = await startChild(backendPort, providers.certificate, true);
  active = true;
  const [initialOwnerA, ownerB] = await Promise.all([
    login(accounts[0]!),
    login(accounts[1]!),
  ]);
  let ownerA = initialOwnerA;
  const tenantA = accounts[0]!.tenantId!,
    tenantB = accounts[1]!.tenantId!,
    p = `/api/tenants/${tenantA}`,
    pB = `/api/tenants/${tenantB}`;
  await api("GET", "/api/openapi.json");
  const memberAccount: WholeBackendAccount = {
    name: "whole-api-member",
    email: "whole-member@example.test",
    password: "Whole-member-password-2026!",
    tenantId: tenantA,
  };
  const createdMember = await api(
    "POST",
    `${p}/members`,
    ownerA,
    {
      email: memberAccount.email,
      name: memberAccount.name,
      password: memberAccount.password,
      role: "member",
      seat: true,
    },
    201,
  );
  memberAccount.userId = String(createdMember.id);
  const member = await login(memberAccount);
  metadata = {
    status: "api-testing",
    origin,
    browserUrl: `http://uwork-whole-ui.localhost:${backendPort}/`,
    metadataPath,
    accounts: [...accounts, memberAccount],
    modelsBaseUrl: providers.modelsBaseUrl,
    webhookUrl: providers.webhookUrl,
    driveBaseUrl: providers.driveBaseUrl,
    mcpUrl: providers.mcpUrl,
    controlledReply: "whole-answer",
    slowPrompt: "whole-ui-slow",
    slowDelayMs: 20000,
    note: "synthetic only; no master key/tokens; security uses its own organization; UI waits for ready-for-ui",
  };
  await secureJson(metadataPath, metadata);
  console.log(`FIXTURE READY ${metadataPath}`);
  let department = "",
    model = "",
    credential = "",
    agent = "",
    device = "",
    deviceId = "";
  const assets: Record<string, string> = {};
  await check(
    "real TCP initialization, two organizations, RBAC and seats",
    async () => {
      const health = await api("GET", "/health");
      assert.ok(health);
      await api("GET", "/api/auth/me", ownerA);
      await api("GET", `${p}/members`, ownerB, undefined, 403);
      await api("GET", `${pB}/members`, ownerA, undefined, 403);
      await api("POST", `${p}/departments`, member, { name: "forbidden" }, 403);
      const dept = await api(
        "POST",
        `${p}/departments`,
        ownerA,
        { name: "whole-api-department" },
        201,
      );
      department = String(dept.id);
      await api("PATCH", `${p}/departments/${department}`, ownerA, {
        name: "whole-api-department-updated",
        parentId: null,
      });
      await api("PATCH", `${p}/members/${memberAccount.userId}`, ownerA, {
        departmentId: department,
      });
      await api("GET", `${p}/roles`, ownerA);
      const issued = await api(
        "POST",
        "/api/auth/device-tokens",
        member,
        { ttlHours: 1 },
        201,
      );
      device = String(issued.token);
      deviceId = String(issued.id);
      await api("GET", `${p}/members`, device, undefined, 403);
      await api("PATCH", `${p}/members/${memberAccount.userId}`, ownerA, {
        seat: false,
      });
      await api("GET", "/v1/models", device, undefined, 403);
      await api("PATCH", `${p}/members/${memberAccount.userId}`, ownerA, {
        seat: true,
      });
      await api("GET", "/api/auth/device-tokens", member);
    },
  );
  await check(
    "vault create/rotation/revocation and actual JSON/SSE model gateway",
    async () => {
      credential = String(
        (
          await api(
            "POST",
            `${p}/credentials`,
            ownerA,
            { name: "whole-api-model-key", value: synth.modelKey },
            201,
          )
        ).id,
      );
      const created = await api(
        "POST",
        `${p}/models`,
        ownerA,
        {
          name: "whole-api-controlled-model",
          upstreamModel: "whole-controlled-model",
          baseUrl: providers.modelsBaseUrl,
          credentialId: credential,
          maxOutputTokens: 128,
          supportsTools: true,
          scope: { all: true },
        },
        201,
      );
      model = String(created.id);
      await api("GET", "/v1/models", device);
      const request = {
        model,
        messages: [{ role: "user", content: "whole-json" }],
        max_tokens: 32,
      };
      const first = await api<{
        id: string;
        choices: { message: { content: string } }[];
      }>("POST", "/v1/chat/completions", ownerA, request, 200, {
        "idempotency-key": "whole-idempotent-json",
      });
      assert.equal(first.choices[0]!.message.content, "whole-answer");
      const count = synth.modelCalls;
      const replay = await api(
        "POST",
        "/v1/chat/completions",
        ownerA,
        request,
        200,
        { "idempotency-key": "whole-idempotent-json" },
      );
      assert.equal(replay.id, first.id);
      assert.equal(synth.modelCalls, count);
      await api(
        "POST",
        "/v1/chat/completions",
        ownerA,
        { ...request, messages: [{ role: "user", content: "conflict" }] },
        409,
        { "idempotency-key": "whole-idempotent-json" },
      );
      synth.modelKey = "whole-model-key-v2";
      await api("PUT", `${p}/credentials/${credential}`, ownerA, {
        value: synth.modelKey,
      });
      const stream = await raw(
        "POST",
        "/v1/chat/completions",
        device,
        { ...request, stream: true },
        200,
        { "idempotency-key": "whole-sse" },
      );
      const text = await stream.text();
      assert.ok(text.includes("whole-"));
      assert.ok(text.endsWith("data: [DONE]\n\n"));
      assert.ok(text.includes('"completion_tokens":3'));
      await api("POST", `${p}/models/${model}/probe`, ownerA);
      await api("PUT", `${p}/limits`, ownerA, {
        subjectType: "member",
        subjectId: memberAccount.userId,
        amount: 0,
      });
      await api("POST", "/v1/chat/completions", member, request, 402);
      await api(
        "DELETE",
        `${p}/limits/member/${memberAccount.userId}`,
        ownerA,
        undefined,
        204,
      );
      const revoked = String(
        (
          await api(
            "POST",
            `${p}/credentials`,
            ownerA,
            { name: "whole-api-revoked", value: "whole-revoked-only" },
            201,
          )
        ).id,
      );
      await api(
        "DELETE",
        `${p}/credentials/${revoked}`,
        ownerA,
        undefined,
        204,
      );
      const listed = await api<Row[]>("GET", `${p}/credentials`, ownerA);
      assert.ok(!JSON.stringify(listed).includes(synth.modelKey));
    },
  );
  await check(
    "20 controlled concurrent HTTP calls enforce 16 admission slots and one ledger charge per idempotent call",
    async () => {
      const body = {
        model,
        messages: [{ role: "user", content: "WHOLE-CONCURRENCY" }],
        max_tokens: 8,
      };
      const before = synth.modelCalls;
      const requests = Array.from({ length: 20 }, (_, index) =>
        fetch(new URL("/v1/chat/completions", origin), {
          method: "POST",
          headers: {
            authorization: `Bearer ${ownerA}`,
            "content-type": "application/json",
            "idempotency-key": `whole-concurrent-${index}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        }).then(async (response) => ({
          index,
          status: response.status,
          body: (await response.json()) as Row,
        })),
      );
      await poll(
        async () => concurrentFinishes.length,
        (count) => count === 16,
      );
      const subscription = await api<{ usage: { reserved: number } }>(
        "GET",
        `${p}/subscription`,
        ownerA,
      );
      assert.ok(
        subscription.usage.reserved > 0,
        "live in-flight calls reserve credits",
      );
      assert.equal(
        synth.modelCalls - before,
        16,
        "rejected calls must not reach the controlled vendor",
      );
      for (const finish of concurrentFinishes.splice(0)) finish();
      const results = await Promise.all(requests);
      assert.equal(
        results.filter((result) => result.status === 200).length,
        16,
      );
      assert.equal(results.filter((result) => result.status === 429).length, 4);
      const accepted = results.find((result) => result.status === 200)!;
      const count = synth.modelCalls;
      await api("POST", "/v1/chat/completions", ownerA, body, 200, {
        "idempotency-key": `whole-concurrent-${accepted.index}`,
      });
      assert.equal(synth.modelCalls, count);
      assert.equal(
        (
          await api<{ usage: { reserved: number } }>(
            "GET",
            `${p}/subscription`,
            ownerA,
          )
        ).usage.reserved,
        0,
      );
    },
  );
  await check(
    "five asset types require review, immutable publish, scoped client download",
    async () => {
      const category = String(
        (
          await api(
            "POST",
            `${p}/categories`,
            ownerA,
            { name: "whole-api-category", kind: "skill" },
            201,
          )
        ).id,
      );
      const mcpKey = String(
        (
          await api(
            "POST",
            `${p}/credentials`,
            ownerA,
            { name: "whole-api-MCP-key", value: "whole-mcp-key" },
            201,
          )
        ).id,
      );
      const contents: Record<string, unknown> = {
        skill: {
          files: [
            {
              path: "SKILL.md",
              content: "# Whole controlled skill\nwhole-skill-marker",
            },
          ],
        },
        expert: { instructions: "whole-expert-marker" },
        connector: {
          url: providers.mcpUrl,
          transport: "streamable-http",
          credentialId: mcpKey,
          allowedTools: ["echo"],
        },
        playbook: { markdown: "whole-playbook-marker" },
        instruction: { instructions: "whole-instruction-marker" },
      };
      for (const [kind, content] of Object.entries(contents)) {
        const result = await api(
          "POST",
          `${p}/assets`,
          ownerA,
          {
            name: `whole-api-${kind}`,
            kind,
            content,
            scope: { all: true },
            ...(kind === "skill" ? { categoryId: category } : {}),
          },
          201,
        );
        assets[kind] = String(result.id);
        await api(
          "POST",
          `${p}/assets/${assets[kind]}/publish`,
          ownerA,
          { version: 1 },
          409,
        );
        await api("POST", `${p}/assets/${assets[kind]}/review`, ownerA, {
          version: 1,
          approved: true,
        });
        await api("POST", `${p}/assets/${assets[kind]}/publish`, ownerA, {
          version: 1,
        });
        await api("GET", `${p}/assets/${assets[kind]}/versions`, ownerA);
        await api(
          "GET",
          `/api/client/assets/${assets[kind]}/download`,
          device,
          undefined,
          ["playbook", "instruction"].includes(kind) ? 403 : 200,
        );
      }
      const manifest = await api<{ items: Row[] }>(
        "GET",
        "/api/client/assets",
        device,
      );
      assert.equal(manifest.items.length, 3);
      await api("POST", "/api/client/authorize", device, {
        action: "asset",
        target: assets.skill,
        assetVersion: 1,
        assetChecksum: manifest.items.find((item) => item.id === assets.skill)!
          .checksum,
      });
    },
  );
  await check(
    "real TLS controlled MCP handshake/tool call/redaction/session release",
    async () => {
      const initial = await raw(
        "POST",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "whole-test", version: "1" },
          },
        },
      );
      const sid = initial.headers.get("mcp-session-id");
      assert.ok(sid);
      assert.notEqual(sid, "whole-upstream-mcp-session");
      await initial.json();
      const headers = { "mcp-session-id": sid };
      await api(
        "POST",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        202,
        headers,
      );
      await api(
        "POST",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        200,
        headers,
      );
      const result = await api(
        "POST",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "echo", arguments: { message: "whole" } },
        },
        200,
        headers,
      );
      assert.equal(synth.mcpCalls, 1);
      assert.ok(!JSON.stringify(result).includes("whole-mcp-key"));
      assert.ok(!JSON.stringify(result).includes("whole-upstream-mcp-session"));
      await api(
        "POST",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "denied", arguments: {} },
        },
        403,
        headers,
      );
      await api(
        "DELETE",
        `/api/client/connectors/${assets.connector}/rpc`,
        device,
        undefined,
        204,
        headers,
      );
    },
  );
  await check(
    "configuration drafts are inert; published menus, security and personal decisions apply",
    async () => {
      const publish = async (kind: string, data: Row) => {
        const before = await api("GET", `${p}/configurations/${kind}`, ownerA);
        const saved = await api("PUT", `${p}/configurations/${kind}`, ownerA, {
          revision: before.revision,
          data,
        });
        await api("POST", `${p}/configurations/${kind}/publish`, ownerA, {
          revision: saved.revision,
        });
      };
      const old = await api("GET", `${p}/configurations/new-chat`, ownerA);
      const saved = await api("PUT", `${p}/configurations/new-chat`, ownerA, {
        revision: old.revision,
        data: { welcome: "whole-api-welcome", riskNotice: "whole-api-risk" },
      });
      const draftView = await api<{ configuration: Record<string, Row> }>(
        "GET",
        "/api/client/configuration",
        device,
      );
      assert.notEqual(
        draftView.configuration["new-chat"]!.welcome,
        "whole-api-welcome",
      );
      await api("POST", `${p}/configurations/new-chat/publish`, ownerA, {
        revision: saved.revision,
      });
      const published = await api<{ configuration: Record<string, Row> }>(
        "GET",
        "/api/client/configuration",
        device,
      );
      assert.equal(
        published.configuration["new-chat"]!.welcome,
        "whole-api-welcome",
      );
      const menus = await api<{ published: { items: Row[] } }>(
        "GET",
        `${p}/configurations/menus`,
        ownerA,
      );
      const items = menus.published.items.map((item) => ({
        ...item,
        ...(item.id === "assets" ? { enabled: false } : {}),
      }));
      await publish("menus", { items });
      assert.equal(
        (await api("POST", "/api/client/menus/assets/authorize", device, {}))
          .allowed,
        false,
      );
      await publish("menus", { items: menus.published.items });
      await publish("personal", {
        models: true,
        skills: true,
        connectors: true,
        mcpHub: null,
      });
      assert.equal(
        (
          await api<{ personal: Row }>(
            "POST",
            "/api/client/authorize",
            device,
            { action: "execution" },
          )
        ).personal.models,
        true,
      );
      await publish("security", {
        allowShell: false,
        allowFilesystem: false,
        allowNetwork: true,
        allowSandbox: false,
        dangerousSkills: false,
        allowedDomains: [],
      });
      assert.equal(
        (
          await api("POST", "/api/client/authorize", device, {
            action: "shell",
          })
        ).allowed,
        false,
      );
      const deny = String(
        (
          await api(
            "POST",
            `${p}/policies`,
            ownerA,
            {
              family: "model",
              name: "whole-api-model-deny",
              scope: { members: [memberAccount.userId] },
              mode: "deny",
              resourceIds: [model],
            },
            201,
          )
        ).id,
      );
      await api(
        "POST",
        "/v1/chat/completions",
        member,
        {
          model,
          messages: [{ role: "user", content: "denied" }],
          max_tokens: 32,
        },
        403,
      );
      await api("PATCH", `${p}/policies/${deny}`, ownerA, { enabled: false });
      await api("DELETE", `${p}/policies/${deny}`, ownerA, undefined, 204);
    },
  );
  await check(
    "worker executes model-only Agents, session continuation, cancellation and timeout",
    async () => {
      agent = String(
        (
          await api(
            "POST",
            `${p}/agents`,
            ownerA,
            {
              name: "whole-api-agent",
              modelId: model,
              instructions: "whole-agent-instructions",
              assetIds: [
                assets.skill,
                assets.expert,
                assets.playbook,
                assets.instruction,
              ],
              scope: { all: true },
              maxOutputTokens: 128,
            },
            201,
          )
        ).id,
      );
      await api("POST", `${p}/agents/${agent}/publish`, ownerA, { version: 1 });
      const run = await api(
        "POST",
        `${p}/runs`,
        member,
        { agentId: agent, input: "whole-run", timeoutMs: 10000 },
        202,
      );
      const result = await poll(
        () => api("GET", `${p}/runs/${run.id}`, member),
        (row) => !["queued", "running"].includes(String(row.status)),
      );
      assert.equal(result.status, "succeeded");
      assert.equal(result.output, "whole-answer");
      assert.ok(synth.lastSystem.includes("whole-playbook-marker"));
      const continued = await api(
        "POST",
        `${p}/runs`,
        member,
        {
          agentId: agent,
          sessionId: result.session_id,
          input: "whole-continued",
          timeoutMs: 10000,
        },
        202,
      );
      await poll(
        () => api("GET", `${p}/runs/${continued.id}`, member),
        (row) => row.status === "succeeded",
      );
      const hanging = await api(
        "POST",
        "/api/client/runs",
        member,
        { agentId: agent, input: "WHOLE-HANG", timeoutMs: 15000 },
        202,
      );
      await poll(
        () => api("GET", `/api/client/runs/${hanging.id}`, member),
        (row) => row.status === "running",
      );
      await api("POST", `/api/client/runs/${hanging.id}/cancel`, member, {});
      assert.equal(
        (await api("GET", `/api/client/runs/${hanging.id}`, member)).status,
        "cancelled",
      );
      const timed = await api(
        "POST",
        `${p}/runs`,
        member,
        { agentId: agent, input: "WHOLE-HANG", timeoutMs: 100 },
        202,
      );
      assert.equal(
        (
          await poll(
            () => api("GET", `${p}/runs/${timed.id}`, member),
            (row) => !["queued", "running"].includes(String(row.status)),
          )
        ).status,
        "timed_out",
      );
      await api("GET", `${p}/sessions`, ownerA);
      await api("GET", `${p}/runs/${run.id}/tools`, member);
      await api("GET", "/api/client/agents", member);
      await api("GET", "/api/client/runs", member);
    },
  );
  await check(
    "once automation triggers through live worker and delivers actual Webhook",
    async () => {
      const hook = String(
        (
          await api(
            "POST",
            `${p}/credentials`,
            ownerA,
            {
              name: "whole-api-webhook",
              value: JSON.stringify({ url: providers.webhookUrl }),
            },
            201,
          )
        ).id,
      );
      const created = await api(
        "POST",
        `${p}/automations`,
        ownerA,
        {
          name: "whole-api-once",
          agentId: agent,
          input: "whole-automation",
          schedule: { type: "once", at: Date.now() + 1300 },
          webhookCredentialId: hook,
        },
        201,
      );
      await poll(
        () => api<Row[]>("GET", `${p}/deliveries`, ownerA),
        (rows) => rows.some((row) => row.status === "sent"),
      );
      assert.equal(synth.webhookCalls, 1);
      assert.equal(synth.webhookPayloads[0]!.status, "succeeded");
      assert.ok(
        (await api<Row[]>("GET", `${p}/automations`, ownerA)).some(
          (r) => r.id === created.id,
        ),
      );
      await api("PATCH", `${p}/automations/${created.id}`, ownerA, {
        enabled: false,
      });
      await api(
        "DELETE",
        `${p}/automations/${created.id}`,
        ownerA,
        undefined,
        204,
      );
    },
  );
  await check(
    "evaluation executes real model cases, aggregates scores and cancels running cases",
    async () => {
      const dataset = String(
        (
          await api(
            "POST",
            `${p}/datasets`,
            ownerA,
            {
              name: "whole-api-dataset",
              cases: [
                { input: "whole-eval", expected: "whole-answer" },
                {
                  input: "whole-eval-two",
                  expected: "answer",
                  match: "contains",
                },
              ],
            },
            201,
          )
        ).id,
      );
      await api("GET", `${p}/datasets/${dataset}`, ownerA);
      const evalId = String(
        (
          await api(
            "POST",
            `${p}/evaluations`,
            ownerA,
            { agentId: agent, datasetId: dataset },
            202,
          )
        ).id,
      );
      const scored = await poll(
        () =>
          api<{ status: string; report: { passRate: number } }>(
            "GET",
            `${p}/evaluations/${evalId}`,
            ownerA,
          ),
        (row) => row.status !== "running",
      );
      assert.equal(scored.status, "succeeded");
      assert.equal(scored.report.passRate, 1);
      const slowData = String(
        (
          await api(
            "POST",
            `${p}/datasets`,
            ownerA,
            {
              name: "whole-api-cancel-dataset",
              cases: [{ input: "WHOLE-HANG", expected: "never" }],
            },
            201,
          )
        ).id,
      );
      const slowEval = String(
        (
          await api(
            "POST",
            `${p}/evaluations`,
            ownerA,
            { agentId: agent, datasetId: slowData },
            202,
          )
        ).id,
      );
      await api("POST", `${p}/evaluations/${slowEval}/cancel`, ownerA, {});
      assert.equal(
        (await api("GET", `${p}/evaluations/${slowEval}`, ownerA)).status,
        "cancelled",
      );
      await api("GET", `${p}/evaluations`, ownerA);
      await api("GET", `${p}/datasets`, ownerA);
      const unused = String(
        (
          await api(
            "POST",
            `${p}/datasets`,
            ownerA,
            {
              name: "whole-api-unused-dataset",
              cases: [{ input: "whole", expected: "whole-answer" }],
            },
            201,
          )
        ).id,
      );
      await api("DELETE", `${p}/datasets/${unused}`, ownerA, undefined, 204);
    },
  );
  await check(
    "external capability metadata stays honest without invoking excluded integrations",
    async () => {
      const result = await api<{ capabilities: Row }>(
        "GET",
        `${p}/integrations`,
        ownerA,
      );
      assert.equal(result.capabilities.payments, "unavailable");
      assert.equal(
        result.capabilities.cloudSandbox,
        sandboxConfig ? "isolated-docker" : "unavailable",
      );
      assert.ok(result.capabilities);
    },
  );
  await check(
    "audits, traces, ledger aggregates, CSV and retention are real persisted flows",
    async () => {
      const auditRows = await api<{ items: Row[]; total: number }>(
        "GET",
        `${p}/audit?pageSize=100`,
        ownerA,
      );
      assert.ok(auditRows.total > 15);
      const traceFacts = await api<{ items: Row[]; total: number }>(
        "GET",
        `${p}/traces`,
        ownerA,
      );
      assert.ok(
        traceFacts.total > 0 &&
          traceFacts.items.some((row) => row.status === "succeeded"),
      );
      const usage = await api<{ items: Row[] }>(
        "GET",
        `${p}/usage?pageSize=100`,
        ownerA,
      );
      const settled = usage.items
        .filter((row) => row.status === "settled")
        .reduce((sum, row) => sum + Number(row.amount), 0);
      for (const groupBy of ["member", "department", "application"]) {
        const aggregates = await api<Row[]>(
          "GET",
          `${p}/usage/aggregates?groupBy=${groupBy}`,
          ownerA,
        );
        assert.equal(
          aggregates.reduce((sum, row) => sum + Number(row.credits), 0),
          settled,
        );
      }
      const csv = await raw("GET", `${p}/usage?format=csv`, ownerA);
      assert.ok(csv.headers.get("content-type")?.includes("text/csv"));
      assert.ok((await csv.text()).includes('"model_id"'));
      const metrics = await api<{ summary: { requests: number } }>(
        "GET",
        `${p}/metrics`,
        ownerA,
      );
      assert.ok(metrics.summary.requests > 0);
      const clientUsage = await api<{
        summary: { requestCount: number; cost: number };
      }>("GET", "/api/client/usage", device);
      assert.ok(
        clientUsage.summary.requestCount > 0 && clientUsage.summary.cost > 0,
      );
      const entitlement = await api("GET", "/api/client/entitlement", device);
      assert.equal(entitlement.status, "active");
      assert.ok(Number(entitlement.amountUsed) > 0);
      await api(
        "POST",
        "/api/client/events",
        device,
        {
          eventKey: "whole-retention-old",
          type: "configuration.applied",
          data: { version: 1 },
        },
        202,
      );
      await ipc({ kind: "inject-retention-clock", tenantId: tenantA } as Omit<
        FixtureCommand,
        "requestId"
      >);
      await api("PUT", `${p}/retention`, ownerA, { days: 7 });
      await api("GET", `${p}/retention`, ownerA);
      const purged = await api<Row>("POST", `${p}/retention/purge`, ownerA, {});
      assert.ok(purged);
      const events = await api<{ items: Row[] }>(
        "GET",
        `${p}/client-events`,
        ownerA,
      );
      assert.ok(
        !events.items.some((row) => row.event_key === "whole-retention-old"),
      );
    },
  );
  await check(
    "remaining management operations persist changes and preserve owners",
    async () => {
      const members = await api<{ items: Row[] }>(
        "GET",
        `${p}/members`,
        ownerA,
      );
      assert.ok(members.items.some((r) => r.id === memberAccount.userId));
      const departments = await api<Row[]>("GET", `${p}/departments`, ownerA);
      assert.ok(departments.some((r) => r.id === department));
      const emptyDepartment = await api(
        "POST",
        `${p}/departments`,
        ownerA,
        { name: "sixth-empty" },
        201,
      );
      await api(
        "DELETE",
        `${p}/departments/${emptyDepartment.id}`,
        ownerA,
        undefined,
        204,
      );
      assert.ok(
        !(await api<Row[]>("GET", `${p}/departments`, ownerA)).some(
          (r) => r.id === emptyDepartment.id,
        ),
      );
      const subscription = await api("GET", `${p}/subscription`, ownerA);
      await api("PUT", `${p}/subscription`, ownerA, {
        seats: subscription.seats,
        credits: subscription.credits,
        startsAt: subscription.starts_at,
        endsAt: subscription.ends_at,
        metering: subscription.metering,
      });
      assert.equal(
        (await api("GET", `${p}/subscription`, ownerA)).credits,
        subscription.credits,
      );
      assert.deepEqual(await api("GET", `${p}/limits`, ownerA), []);
      const models = await api<Row[]>("GET", `${p}/models`, ownerA);
      const current = models.find((r) => r.id === model)!;
      await api("PUT", `${p}/models/${model}`, ownerA, {
        ...(current.data as Row),
        name: "sixth-updated-model",
        scope: current.scope,
        enabled: current.enabled,
        revision: current.revision,
      });
      assert.equal(
        (await api<Row[]>("GET", `${p}/models`, ownerA)).find(
          (r) => r.id === model,
        )!.name,
        "sixth-updated-model",
      );
      const temporary = await api(
        "POST",
        `${p}/models`,
        ownerA,
        {
          name: "sixth-disable-model",
          upstreamModel: "whole-controlled-model",
          baseUrl: providers.modelsBaseUrl,
          credentialId: credential,
          scope: { all: true },
        },
        201,
      );
      await api(
        "DELETE",
        `${p}/models/${temporary.id}`,
        ownerA,
        undefined,
        204,
      );
      assert.ok(
        !(await api<{ data: Row[] }>("GET", "/v1/models", device)).data.some(
          (r) => r.id === temporary.id,
        ),
      );
      const resources = await api<{ items: Row[] }>(
        "GET",
        `${p}/assets`,
        ownerA,
      );
      const skill = resources.items.find((r) => r.id === assets.skill)!;
      assert.ok(skill);
      await api("PUT", `${p}/assets/${assets.skill}`, ownerA, {
        name: "sixth-skill-draft2",
        kind: "skill",
        content: {
          files: [{ path: "SKILL.md", content: "# Sixth draft only" }],
        },
        categoryId: (skill.data as Row).categoryId,
        scope: skill.scope,
        enabled: true,
        revision: skill.revision,
      });
      const versions = await api<Row[]>(
        "GET",
        `${p}/assets/${assets.skill}/versions`,
        ownerA,
      );
      assert.equal(versions.length, 2);
      const actual = await api<{ content: { files: { content: string }[] } }>(
        "GET",
        `/api/client/assets/${assets.skill}/download`,
        device,
      );
      assert.ok(
        actual.content.files[0]!.content.includes("whole-skill-marker"),
      );
      const categories = await api<Row[]>("GET", `${p}/categories`, ownerA);
      assert.ok(categories.length);
      const unusedCategory = await api(
        "POST",
        `${p}/categories`,
        ownerA,
        { name: "sixth-unused-category", kind: "skill" },
        201,
      );
      await api(
        "DELETE",
        `${p}/categories/${unusedCategory.id}`,
        ownerA,
        undefined,
        204,
      );
      assert.ok(
        !(await api<Row[]>("GET", `${p}/categories`, ownerA)).some(
          (r) => r.id === unusedCategory.id,
        ),
      );
      assert.deepEqual(await api("GET", `${p}/policies`, ownerA), []);
      const policy = await api(
        "POST",
        `${p}/policies/security`,
        ownerA,
        {
          name: "sixth-deny-shell",
          scope: { all: true },
          priority: 200,
          data: {
            allowShell: false,
            allowFilesystem: false,
            allowNetwork: true,
            allowSandbox: false,
            dangerousSkills: false,
            allowedDomains: [],
          },
        },
        201,
      );
      const permissions = await api<{ security: Row }>(
        "GET",
        `${p}/permissions/${memberAccount.userId}`,
        ownerA,
      );
      assert.equal(permissions.security.allowShell, false);
      await api("DELETE", `${p}/policies/${policy.id}`, ownerA, undefined, 204);
      const conf = await api("GET", `${p}/configurations/new-chat`, ownerA);
      await api("PUT", `${p}/configurations/new-chat`, ownerA, {
        revision: conf.revision,
        data: { welcome: "sixth-discarded-draft", riskNotice: "sixth" },
      });
      await api(
        "DELETE",
        `${p}/configurations/new-chat/draft`,
        ownerA,
        undefined,
        200,
      );
      const discarded = await api(
        "GET",
        `${p}/configurations/new-chat`,
        ownerA,
      );
      assert.deepEqual(discarded.draft, discarded.published);
      const agents = await api<Row[]>("GET", `${p}/agents`, ownerA);
      const selected = agents.find((r) => r.id === agent)!;
      await api("PUT", `${p}/agents/${agent}`, ownerA, {
        ...(selected.data as Row),
        name: selected.name,
        scope: selected.scope,
        enabled: selected.enabled,
        revision: selected.revision,
      });
      assert.equal(
        (await api<Row[]>("GET", `${p}/agents`, ownerA)).find(
          (r) => r.id === agent,
        )!.published_version,
        1,
      );
      const retired = await api(
        "POST",
        `${p}/agents`,
        ownerA,
        {
          name: "sixth-retired-agent",
          modelId: model,
          instructions: "retired",
          scope: { all: true },
        },
        201,
      );
      await api("DELETE", `${p}/agents/${retired.id}`, ownerA, undefined, 204);
      assert.ok(
        !(
          await api<{ items: Row[] }>("GET", "/api/client/agents", member)
        ).items.some((r) => r.id === retired.id),
      );
      const runs = await api<{ items: Row[] }>("GET", `${p}/runs`, ownerA);
      assert.ok(runs.items.some((r) => r.status === "succeeded"));
      const cancel = await api(
        "POST",
        `${p}/runs`,
        ownerA,
        { agentId: agent, input: "WHOLE-HANG", timeoutMs: 10000 },
        202,
      );
      await api("POST", `${p}/runs/${cancel.id}/cancel`, ownerA, {});
      const cancelled = await poll(
        () => api("GET", `${p}/runs/${cancel.id}`, ownerA),
        (r) => r.status === "cancelled",
      );
      assert.equal(cancelled.output, null);
      const automations = await api<Row[]>("GET", `${p}/automations`, ownerA);
      assert.deepEqual(automations, []);
      assert.ok(await api("GET", `${p}/runtime`, ownerA));
    },
  );
  await check(
    "real failed provider receipt is reconciled through the public HTTP owner",
    async () => {
      const before = synth.modelCalls;
      await api(
        "POST",
        "/v1/chat/completions",
        ownerA,
        {
          model,
          messages: [{ role: "user", content: "SIXTH-MALFORMED" }],
          max_tokens: 32,
        },
        502,
        { "idempotency-key": "sixth-malformed" },
      );
      assert.equal(synth.modelCalls, before + 1);
      const records = await api<{ items: Row[] }>(
        "GET",
        `${p}/usage?pageSize=100`,
        ownerA,
      );
      const uncertain = records.items.find(
        (r) => r.request_key === "sixth-malformed",
      )!;
      assert.equal(uncertain.status, "uncertain");
      await api("PUT", `${p}/usage/${uncertain.id}/reconcile`, ownerA, {
        amount: 15,
        evidenceReference: "sixth-controlled-provider-12input+3output",
      });
      const settled = (
        await api<{ items: Row[] }>("GET", `${p}/usage?pageSize=100`, ownerA)
      ).items.find((r) => r.id === uncertain.id)!;
      assert.equal(settled.status, "settled");
      assert.equal(settled.amount, 15);
      assert.equal(synth.modelCalls, before + 1);
    },
  );
  await check(
    "all isolated runtime HTTP operations execute and cancel real code",
    async () => {
      assert.ok(
        sandboxConfig,
        "pass --ui-sandbox-socket for actual isolated runtime coverage",
      );
      const capability = await api("GET", `${p}/runtimes/capability`, ownerA);
      assert.equal(capability.available, true);
      const before = await api<{ items: Row[] }>(
        "GET",
        `${p}/runtimes`,
        ownerA,
      );
      assert.equal(before.items.length, 0);
      const config = await api("GET", `${p}/configurations/security`, ownerA);
      const saved = await api("PUT", `${p}/configurations/security`, ownerA, {
        revision: config.revision,
        data: {
          allowShell: false,
          allowFilesystem: false,
          allowNetwork: true,
          allowSandbox: true,
          dangerousSkills: false,
          allowedDomains: [],
        },
      });
      await api("POST", `${p}/configurations/security/publish`, ownerA, {
        revision: saved.revision,
      });
      const runtime = await api(
        "POST",
        `${p}/runtimes`,
        ownerA,
        { name: "sixth-owned-runtime", scope: { all: true }, ttlMinutes: 2 },
        201,
      );
      try {
        const view = await api("GET", `${p}/runtimes/${runtime.id}`, ownerA);
        assert.equal(view.status, "ready");
        await api("PATCH", `${p}/runtimes/${runtime.id}`, ownerA, {
          name: "sixth-owned-updated",
          scope: { all: true },
          revision: view.revision,
        });
        assert.equal(
          (await api("GET", `${p}/runtimes/${runtime.id}`, ownerA)).name,
          "sixth-owned-updated",
        );
        const execution = await api(
          "POST",
          `${p}/runtimes/${runtime.id}/executions`,
          ownerA,
          {
            code: "console.log(JSON.stringify({answer:42,uid:process.getuid(),noKey:!process.env.MASTER_KEY}))",
            timeoutMs: 10000,
          },
          202,
        );
        const done = await poll(
          () => api("GET", `${p}/sandbox-executions/${execution.id}`, ownerA),
          (r) => r.status === "succeeded",
        );
        assert.deepEqual(JSON.parse(String(done.stdout)), {
          answer: 42,
          uid: 1000,
          noKey: true,
        });
        const list = await api<{ items: Row[] }>(
          "GET",
          `${p}/sandbox-executions`,
          ownerA,
        );
        assert.ok(list.items.some((r) => r.id === execution.id));
        const long = await api(
          "POST",
          `${p}/runtimes/${runtime.id}/executions`,
          ownerA,
          { code: "while(true){}", timeoutMs: 15000 },
          202,
        );
        await poll(
          () => api("GET", `${p}/sandbox-executions/${long.id}`, ownerA),
          (r) => r.status === "running",
        );
        await api(
          "POST",
          `${p}/sandbox-executions/${long.id}/cancel`,
          ownerA,
          {},
        );
        const stopped = await poll(
          () => api("GET", `${p}/sandbox-executions/${long.id}`, ownerA),
          (r) => r.status === "cancelled",
        );
        assert.ok(!stopped.stdout);
        await api("POST", `${p}/runtimes/${runtime.id}/stop`, ownerA, {});
        assert.equal(
          (await api("GET", `${p}/runtimes/${runtime.id}`, ownerA)).status,
          "stopped",
        );
      } finally {
        await api(
          "DELETE",
          `${p}/runtimes/${runtime.id}`,
          ownerA,
          undefined,
          204,
        );
      }
      assert.equal(
        (await api<{ items: Row[] }>("GET", `${p}/runtimes`, ownerA)).items
          .length,
        0,
      );
    },
  );
  await check(
    "asset revocation and device revocation fail closed over live HTTP",
    async () => {
      for (const id of Object.values(assets))
        await api("DELETE", `${p}/assets/${id}`, ownerA, undefined, 204);
      await api(
        "GET",
        `/api/client/assets/${assets.skill}/download`,
        device,
        undefined,
        403,
      );
      await api(
        "DELETE",
        `/api/auth/device-tokens/${deviceId}`,
        member,
        undefined,
        204,
      );
      await api("GET", "/api/client/configuration", device, undefined, 401);
      await api(
        "POST",
        `${p}/agents`,
        ownerA,
        {
          name: "whole-api-ui-ready-agent",
          modelId: model,
          instructions: "Controlled UI agent",
          scope: { all: true },
          maxOutputTokens: 128,
        },
        201,
      );
    },
  );
  await check(
    "actual SQLite process restart, online snapshot and restored business state",
    async () => {
      const snapshot = join(directory, "online-snapshot.sqlite");
      await ipc({ kind: "backup", destination: snapshot } as Omit<
        FixtureCommand,
        "requestId"
      >);
      assert.ok((await stat(snapshot)).size > 0);
      await api("PATCH", p, ownerA, { name: "whole-api-after-snapshot" });
      assert.equal(
        (await api("GET", `${p}/retention`, ownerA)).days,
        7,
        "enterprise PATCH must preserve configured retention",
      );
      await shutdownChild();
      const secondPid = await startChild(backendPort, providers.certificate);
      assert.notEqual(secondPid, firstPid);
      assert.equal(
        (await api("GET", p, ownerA)).name,
        "whole-api-after-snapshot",
      );
      await api("POST", "/v1/chat/completions", ownerA, {
        model,
        messages: [{ role: "user", content: "whole-after-restart" }],
        max_tokens: 32,
      });
      await shutdownChild();
      currentDatabase = join(directory, "restored.sqlite");
      await copyFile(snapshot, currentDatabase);
      await startChild(backendPort, providers.certificate);
      assert.equal((await api("GET", p, ownerA)).name, accounts[0]!.name);
      const models = await api<Row[]>("GET", `${p}/models`, ownerA);
      assert.ok(models.some((row) => row.id === model));
      await api("POST", "/v1/chat/completions", ownerA, {
        model,
        messages: [{ role: "user", content: "whole-restored-vault" }],
        max_tokens: 32,
      });
      const bytes = await readFile(currentDatabase);
      assert.ok(!bytes.includes(Buffer.from(synth.modelKey)));
    },
  );
  if (holdForUi && uiSocket) {
    await shutdownChild();
    sandboxConfig = { sandboxSocket: uiSocket, sandboxImage: uiImage };
    await startChild(backendPort, providers.certificate);
    const configured = await api<{ capabilities: Row }>(
      "GET",
      `${p}/integrations`,
      ownerA,
    );
    assert.equal(configured.capabilities.cloudSandbox, "isolated-docker");
  }
  await check(
    "same-tenant session switch invalidates old bearer and logout is durable",
    async () => {
      const old = ownerA;
      const switched = await api("POST", "/api/auth/switch", ownerA, {
        tenantId: tenantA,
      });
      ownerA = String(switched.token);
      assert.equal(typeof switched.token, "string");
      await api("GET", "/api/auth/me", old, undefined, 401);
      assert.equal(
        (await api<{ tenant: { id: string } }>("GET", "/api/auth/me", ownerA))
          .tenant.id,
        tenantA,
      );
      await api("POST", "/api/auth/logout", ownerB, undefined, 204);
      await api("GET", "/api/auth/me", ownerB, undefined, 401);
      await api("POST", "/api/auth/logout", member, undefined, 204);
    },
  );
  await writeOperationCoverage();
  metadata = {
    ...metadata,
    status: "ready-for-ui",
    apiChecks: checks.length,
    sandboxConfigured: !!sandboxConfig,
    gitHead,
    node: process.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    apiPassed: checks.every((item) => item.status === "passed"),
    note: "API main flows complete; UI may write whole-ui-* in A; security owns its isolated organization; stop marker triggers owned cleanup",
  };
  await secureJson(metadataPath, metadata);
  await secureJson(reportPath, {
    status: "passed",
    gitHead,
    node: process.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    checks,
    fixture:
      "compiled dist/app.js; real TCP; worker=true; disk SQLite; controlled loopback model/MCP/Webhook; no WeCom or drive operations",
    directDatabaseUse: [
      "initial bootstrap of three synthetic organizations",
      "explicit retention clock fault injection on synthetic event",
    ],
    boundaries: [
      "WeCom and drive operations excluded entirely; MCP only local controlled TLS provider",
      "no paid model billing or external service acceptance",
      "Docker tested separately by root agent",
    ],
  });
  await dumpTraffic();
  console.log(`HTTP E2E PASSED ${checks.length}; UI READY ${metadataPath}`);
}

async function writeOperationCoverage() {
  const schema = await api<{ paths: Record<string, Record<string, unknown>> }>(
    "GET",
    "/api/openapi.json",
  );
  const counts = await dumpTraffic();
  const combined = { ...requestCounts };
  for (const [key, value] of Object.entries(counts ?? {}))
    combined[key] = (combined[key] ?? 0) + value;
  const rows = Object.entries(schema.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => {
      const key = method.toUpperCase() + " " + path;
      const evidence = Object.entries(combined)
        .filter(([route]) => {
          const [m, p] = route.split(" ");
          return (
            m === method.toUpperCase() &&
            p!.replace(/:([a-zA-Z0-9_]+)/g, "{$1}") === path
          );
        })
        .map(([route, count]) => ({
          status: Number(route.split(" ")[2]),
          count,
        }));
      const excluded = /\/(?:wecom|drive)(?:\/|$)/.test(path);
      return {
        operation: key,
        status: excluded
          ? "excluded"
          : evidence.some((r) => r.status >= 200 && r.status < 300)
            ? "2xx-observed"
            : "missing-success",
        evidence,
        semanticAssertions:
          "named business check groups in report; status code alone is not completion",
      };
    }),
  );
  await secureJson(join(evidence, "operation-coverage.json"), {
    gitHead,
    total: rows.length,
    inScope: rows.filter((r) => r.status !== "excluded").length,
    successful: rows.filter((r) => r.status === "2xx-observed").length,
    excluded: rows.filter((r) => r.status === "excluded").length,
    operations: rows,
  });
  const missing = rows.filter((r) => r.status === "missing-success");
  assert.equal(
    missing.length,
    0,
    "missing scoped successful operations: " +
      missing.map((r) => r.operation).join("; "),
  );
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error ? error.message : "whole_backend_failed";
  process.exitCode = 1;
  console.error(`HTTP E2E FAILED ${message}`);
  metadata = {
    ...metadata,
    status: "api-failed",
    error: message.slice(0, 500),
  };
  await secureJson(metadataPath, metadata);
  await writeOperationCoverage().catch(() => {});
  await secureJson(reportPath, {
    status: "failed",
    checks,
    error: message.slice(0, 500),
  });
}
if (active && holdForUi) {
  console.log(`Fixture remains active until ${stopPath} exists.`);
  let lastDump = 0;
  for (;;) {
    if (Date.now() - lastDump > 10000) {
      await dumpTraffic();
      lastDump = Date.now();
    }
    try {
      await stat(stopPath);
      break;
    } catch {
      await delay(1000);
    }
  }
}
await cleanup();
console.log("OWNED FIXTURE CLEANED");
