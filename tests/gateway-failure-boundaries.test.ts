import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Mode =
  | "429"
  | "500"
  | "disconnect"
  | "non-json"
  | "oversized"
  | "input-usage"
  | "output-usage"
  | "sse-multibyte"
  | "sse-no-done"
  | "sse-no-usage"
  | "sse-output-usage"
  | "sse-error"
  | "sse-error-after-content"
  | "sse-error-null"
  | "sse-done-open"
  | "sse-done-extra"
  | "sse-named-error"
  | "hang";
type Ledger = {
  status: string;
  amount: number;
  reserved: number;
  input_tokens: number;
  output_tokens: number;
  request_key: string;
};
type Completion = {
  choices: { message: { content: string } }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};
async function record(name: string, report: unknown) {
  const directory = process.env.UWORK_GATEWAY_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
async function bounded<T>(promise: Promise<T>, timeout = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned gateway fixture timed out")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, "Gateway state timed out");
    await delay(25);
  }
}
async function fixture(t: TestContext, mode: Mode, separateProcess = false) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-gateway-boundaries-"));
  const database = join(directory, "backend.sqlite"),
    masterKey = randomBytes(32),
    upstreamToken = randomBytes(24).toString("hex");
  let responseClosed = false;
  let requests = 0,
    authenticated = 0,
    splitWrites = 0;
  const upstream = createServer(async (request, response) => {
    response.once("close", () => {
      responseClosed = true;
    });
    for await (const chunk of request) void chunk;
    requests++;
    if (request.headers.authorization !== `Bearer ${upstreamToken}`) {
      response.writeHead(401).end();
      return;
    }
    authenticated++;
    if (mode === "hang") return;
    if (mode === "disconnect") {
      request.socket.destroy();
      return;
    }
    if (mode === "429" || mode === "500") {
      response.writeHead(Number(mode), { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: upstreamToken } }));
      return;
    }
    if (mode === "non-json") {
      response.end(`invalid JSON with synthetic credential ${upstreamToken}`);
      return;
    }
    if (mode.startsWith("sse-")) {
      response.setHeader("content-type", "text/event-stream");
      if (mode === "sse-named-error") {
        response.end(
          `event: error\ndata: ${JSON.stringify({ code: "provider_error", message: upstreamToken })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      if (mode === "sse-error" || mode === "sse-error-after-content") {
        if (mode === "sse-error-after-content") {
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "partial answer" }, finish_reason: null }] })}\n\n`,
          );
          await delay(5);
        }
        response.end(
          `data: ${JSON.stringify({ error: { code: "provider_error", message: upstreamToken } })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      const content = mode === "sse-multibyte" ? "你好🌍" : "你好";
      const delta = {
        choices: [{ delta: { content }, finish_reason: null }],
        ...(mode === "sse-error-null" ? { error: null } : {}),
      };
      const final = {
        choices: [{ delta: {}, finish_reason: "stop" }],
        ...(mode === "sse-error-null" ? { error: null } : {}),
        ...(mode === "sse-no-usage"
          ? {}
          : {
              usage: {
                prompt_tokens: 12,
                completion_tokens: mode === "sse-output-usage" ? 65 : 4,
              },
            }),
      };
      const text = `${mode === "sse-error-null" ? "event: message\r\n" : ""}data: ${JSON.stringify(delta)}\r\n\r\ndata: ${JSON.stringify(final)}\r\n\r\n${mode === "sse-no-done" ? "" : "data: [DONE]\r\n\r\n"}`;
      if (mode === "sse-done-open") {
        response.write(text);
        return;
      }
      if (mode === "sse-done-extra") {
        response.end(
          text +
            `data: ${JSON.stringify({ choices: [{ delta: { content: "MUST_NOT_APPEAR" }, finish_reason: null }] })}\n\nevent: error\ndata: ${JSON.stringify({ code: "provider_error", message: upstreamToken })}\n\ndata: malformed-after-done\n\n`,
        );
        return;
      }
      if (mode !== "sse-multibyte") {
        response.end(text);
        return;
      }
      const bytes = Buffer.from(text),
        unicode = bytes.indexOf(Buffer.from("你")),
        crlf = bytes.indexOf(Buffer.from("\r\n"));
      const cuts = [
        ...new Set([
          unicode + 1,
          unicode + 2,
          crlf + 1,
          bytes.length - 1,
          bytes.length,
        ]),
      ].sort((a, b) => a - b);
      let start = 0;
      for (const end of cuts) {
        response.write(bytes.subarray(start, end));
        splitWrites++;
        start = end;
        await delay(5);
      }
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                mode === "oversized"
                  ? "x".repeat(2 * 1024 * 1024 + 1)
                  : "answer",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: mode === "input-usage" ? 100000 : 12,
          completion_tokens: mode === "output-usage" ? 65 : 4,
        },
      }),
    );
  });
  const state: {
    app?: Awaited<ReturnType<typeof createApp>>;
    child?: ChildProcess;
    exit?: { code: number | null; signal: NodeJS.Signals | null };
    childExit?: Promise<void>;
  } = {};
  let origin = "",
    logs = "",
    token = "";
  async function stopChild(signal: NodeJS.Signals = "SIGTERM") {
    if (!state.child || state.exit) return;
    state.child.kill(signal);
    try {
      await bounded(state.childExit!, 5000);
    } catch {
      state.child.kill("SIGKILL");
      await bounded(state.childExit!, 5000);
    }
  }
  t.after(async () => {
    try {
      upstream.closeAllConnections();
      await state.app?.close();
      await stopChild();
    } finally {
      try {
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const options = {
    database,
    masterKey,
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: false,
  };
  state.app = await createApp(options);
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(state.app.services.db, {
    name: "Gateway boundary",
    email: "gateway-boundary@example.test",
    password,
  });
  async function startChild() {
    const reservation = createPortServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    origin = `http://127.0.0.1:${port}`;
    state.exit = undefined;
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/server.ts", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          DATABASE_PATH: database,
          MASTER_KEY: masterKey.toString("hex"),
          HOST: "127.0.0.1",
          PORT: String(port),
          PUBLIC_URL: origin,
          ALLOW_PRIVATE_UPSTREAMS: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    state.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-4096);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-4096);
    });
    state.childExit = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        state.exit = { code, signal };
        resolve();
      });
    });
    await poll(async () => {
      assert.ok(!state.exit, `Owned backend exited at startup: ${logs}`);
      try {
        const r = await fetch(origin + "/health", {
          headers: { connection: "close" },
          signal: AbortSignal.timeout(500),
        });
        const ok = r.status === 200;
        await r.arrayBuffer();
        return ok;
      } catch {
        return false;
      }
    }, Boolean);
  }
  if (separateProcess) {
    await state.app.close();
    state.app = undefined;
    await startChild();
  } else origin = await state.app.listen({ host: "127.0.0.1", port: 0 });
  async function raw(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
    signal?: AbortSignal,
  ) {
    return fetch(origin + path, {
      method,
      headers: {
        connection: "close",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(15000),
    });
  }
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    status = 200,
  ): Promise<T> {
    const response = await raw(method, path, body);
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  token = (
    await api<{ token: string }>("POST", "/api/auth/login", {
      email: "gateway-boundary@example.test",
      password,
    })
  ).token;
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    { name: "Controlled provider", value: upstreamToken },
    201,
  );
  const model = await api<{ id: string }>(
    "POST",
    `${p}/models`,
    {
      name: "Boundary model",
      upstreamModel: "controlled",
      baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
      credentialId: credential.id,
      scope: { all: true },
      contextWindow: 8192,
      maxOutputTokens: 128,
    },
    201,
  );
  const payload = {
    model: model.id,
    messages: [{ role: "user", content: `boundary ${mode}` }],
    max_tokens: 64,
    temperature: 0,
    stream: mode.startsWith("sse-"),
  };
  function cache(key: string) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT count(*) n,sum(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END) cached FROM gateway_calls WHERE tenant_id=? AND request_key=?",
        )
        .get(owner.tenantId, key) as { n: number; cached: number | null };
      return { ...row };
    } finally {
      db.close();
    }
  }
  async function ledger(key: string) {
    return poll(
      async () =>
        (
          await api<{ items: Ledger[] }>("GET", `${p}/usage?pageSize=100`)
        ).items.filter((row) => row.request_key === key),
      (rows) => rows.length === 1 && rows[0]!.status !== "reserved",
    );
  }
  async function replayDenied(key: string) {
    const response = await raw("POST", "/v1/chat/completions", payload, key);
    assert.equal(response.status, 409);
    const error = (await response.json()) as { error: { code: string } };
    assert.equal(error.error.code, "REQUEST_EXISTS");
    assert.equal(requests, 1);
    return error.error.code;
  }
  return {
    api,
    raw,
    p,
    payload,
    cache,
    ledger,
    replayDenied,
    secret: upstreamToken,
    requests: () => requests,
    responseClosed: () => responseClosed,
    authenticated: () => authenticated,
    splitWrites: () => splitWrites,
    async restart() {
      if (separateProcess) {
        await startChild();
      } else {
        await state.app!.close();
        state.app = await createApp(options);
        origin = await state.app.listen({ host: "127.0.0.1", port: 0 });
      }
    },
    async crash() {
      await stopChild("SIGKILL");
      assert.equal(state.exit?.signal, "SIGKILL");
    },
    exit: () => state.exit,
    stopChild,
  };
}
function frames(text: string) {
  return text
    .split("\n\n")
    .map((frame) =>
      frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
}
const failures = [
  { mode: "429", code: "UPSTREAM_REJECTED", status: "released" },
  { mode: "500", code: "UPSTREAM_REJECTED", status: "uncertain" },
  { mode: "disconnect", code: "UPSTREAM_FAILURE", status: "uncertain" },
  { mode: "non-json", code: "UPSTREAM_FORMAT", status: "uncertain" },
  { mode: "oversized", code: "UPSTREAM_TOO_LARGE", status: "uncertain" },
  { mode: "input-usage", code: "METERING_INVALID", status: "uncertain" },
  { mode: "output-usage", code: "METERING_INVALID", status: "uncertain" },
  { mode: "sse-no-done", code: "UPSTREAM_INCOMPLETE", status: "uncertain" },
  { mode: "sse-output-usage", code: "METERING_INVALID", status: "uncertain" },
  { mode: "sse-error", code: "UPSTREAM_REJECTED", status: "uncertain" },
  { mode: "sse-named-error", code: "UPSTREAM_REJECTED", status: "uncertain" },
  {
    mode: "sse-error-after-content",
    code: "UPSTREAM_REJECTED",
    status: "uncertain",
  },
] as const;
for (const scenario of failures)
  test(`gateway ${scenario.mode} persists ${scenario.status} without a success cache or repeated upstream dispatch`, async (t) => {
    const f = await fixture(t, scenario.mode),
      key = `boundary-${scenario.mode}`;
    const response = await f.raw(
        "POST",
        "/v1/chat/completions",
        f.payload,
        key,
      ),
      text = await response.text();
    assert.ok(
      !text.includes(f.secret),
      "provider error must not expose its credential",
    );
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const values = frames(text)
        .filter((value) => value !== "[DONE]")
        .map(
          (value) =>
            JSON.parse(value) as { error?: { code: string }; usage?: unknown },
        );
      if (
        (scenario.mode.startsWith("sse-error") ||
          scenario.mode === "sse-named-error") &&
        !values.some((value) => value.error)
      )
        await record(`${scenario.mode}-wrong-success`, {
          upstreamSentErrorEnvelope: true,
          httpStatus: response.status,
          observedFrames: values,
          ledger: await f.ledger(key),
          cache: f.cache(key),
          upstreamRequests: f.requests(),
          providerCredentialNotLeaked: !text.includes(f.secret),
        });
      assert.equal(
        values.find((value) => value.error)?.error?.code,
        scenario.code,
      );
      assert.ok(!values.some((value) => value.usage));
      assert.equal(frames(text).at(-1), "[DONE]");
    } else {
      assert.equal(response.status, 502);
      assert.equal(
        (JSON.parse(text) as { error: { code: string } }).error.code,
        scenario.code,
      );
    }
    const [entry] = await f.ledger(key);
    assert.ok(entry);
    assert.equal(entry.status, scenario.status);
    assert.ok(entry.reserved > 0);
    assert.equal(
      entry.amount,
      scenario.status === "released" ? 0 : entry.reserved,
    );
    assert.deepEqual(f.cache(key), { n: 1, cached: 0 });
    assert.equal(f.requests(), 1);
    assert.equal(f.authenticated(), 1);
    const trace = await f.api<{
      items: { status: string; error_code: string }[];
    }>("GET", `${f.p}/traces`);
    assert.equal(trace.items.length, 1);
    assert.equal(trace.items[0]!.status, "failed");
    assert.equal(trace.items[0]!.error_code, scenario.code);
    await f.replayDenied(key);
    await f.restart();
    await f.replayDenied(key);
    const [restored] = await f.ledger(key);
    assert.deepEqual(restored, entry);
    const usage = await f.api<{
      usage: { consumed: number; reserved: number };
    }>("GET", `${f.p}/subscription`);
    assert.equal(usage.usage.reserved, 0);
    assert.equal(usage.usage.consumed, entry.amount);
    await record(scenario.mode, {
      passed: true,
      transport: "real TCP/disk",
      code: scenario.code,
      ledger: entry,
      cache: f.cache(key),
      upstreamRequests: f.requests(),
      replayBeforeAndAfterRestart: "409 REQUEST_EXISTS",
      usage: usage.usage,
    });
  });
for (const mode of ["sse-multibyte", "sse-no-usage", "sse-error-null"] as const)
  test(`gateway ${mode} reassembles/estimates and durably replays one settled generation`, async (t) => {
    const f = await fixture(t, mode),
      key = `boundary-${mode}`;
    const response = await f.raw(
      "POST",
      "/v1/chat/completions",
      f.payload,
      key,
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    const values = frames(text)
      .filter((value) => value !== "[DONE]")
      .map(
        (value) =>
          JSON.parse(value) as {
            error?: unknown;
            choices: { delta: { content?: string }; finish_reason?: string }[];
            usage?: Completion["usage"];
          },
      );
    assert.ok(values.every((value) => !value.error));
    const content = values
      .map((value) => value.choices[0]?.delta.content ?? "")
      .join("");
    assert.equal(content, mode === "sse-multibyte" ? "你好🌍" : "你好");
    assert.equal(frames(text).at(-1), "[DONE]");
    const usage = values.find((value) => value.usage)!.usage!;
    if (mode === "sse-no-usage") {
      assert.equal(
        usage.prompt_tokens,
        320 + Buffer.byteLength(f.payload.messages[0]!.content),
      );
      assert.equal(usage.completion_tokens, Buffer.byteLength(content));
    } else {
      assert.deepEqual(usage, {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
      });
      if (mode === "sse-multibyte") assert.ok(f.splitWrites() >= 5);
    }
    const [entry] = await f.ledger(key);
    assert.ok(entry);
    assert.equal(entry.status, "settled");
    assert.equal(entry.input_tokens, usage.prompt_tokens);
    assert.equal(entry.output_tokens, usage.completion_tokens);
    assert.equal(entry.amount, usage.total_tokens);
    assert.deepEqual(f.cache(key), { n: 1, cached: 1 });
    await f.restart();
    const replay = await f.raw("POST", "/v1/chat/completions", f.payload, key);
    assert.equal(replay.status, 200);
    const replayText = await replay.text();
    assert.ok(replayText.includes(content));
    assert.equal(f.requests(), 1);
    assert.deepEqual((await f.ledger(key))[0], entry);
    await record(mode, {
      passed: true,
      transport: "real TCP/disk",
      splitWrites: f.splitWrites(),
      usage,
      ledger: entry,
      cache: f.cache(key),
      upstreamRequests: f.requests(),
      cachedReplayAfterRestart: true,
    });
  });

test("a real backend process killed after dispatch recovers reserved billing as uncertain and never replays the call", async (t) => {
  const f = await fixture(t, "hang", true),
    key = "boundary-process-crash";
  const pending = f.raw("POST", "/v1/chat/completions", f.payload, key).then(
    () => "unexpected-response",
    () => "connection-closed",
  );
  await poll(
    async () => f.requests(),
    (count) => count === 1,
  );
  const before = await f.api<{ items: Ledger[] }>("GET", `${f.p}/usage`);
  assert.equal(before.items.length, 1);
  assert.equal(before.items[0]!.status, "reserved");
  assert.deepEqual(f.cache(key), { n: 1, cached: 0 });
  await f.crash();
  assert.equal(await bounded(pending), "connection-closed");
  const crashedExit = f.exit();
  await f.restart();
  const [entry] = await f.ledger(key);
  assert.ok(entry);
  assert.equal(entry.status, "uncertain");
  assert.equal(entry.amount, entry.reserved);
  assert.ok(entry.amount > 0);
  await f.replayDenied(key);
  assert.deepEqual(f.cache(key), { n: 1, cached: 0 });
  await f.stopChild();
  assert.deepEqual(f.exit(), { code: 0, signal: null });
  await record("process-crash", {
    passed: true,
    transport: "real child source CLI/TCP/file SQLite",
    crashedExit,
    cleanExit: f.exit(),
    upstreamRequests: f.requests(),
    recoveredLedger: entry,
    cache: f.cache(key),
    replay: "409 REQUEST_EXISTS",
    initialization:
      "bootstrap in own temporary database before child start; all other setup and requests via HTTP",
  });
});

for (const mode of ["sse-done-open", "sse-done-extra"] as const)
  test(`gateway ${mode} finishes at the first DONE and never consumes trailing data`, async (t) => {
    const f = await fixture(t, mode),
      key = `boundary-${mode}`;
    const started = Date.now();
    let text = "",
      transportError: string | undefined;
    try {
      const response = await f.raw(
        "POST",
        "/v1/chat/completions",
        f.payload,
        key,
        AbortSignal.timeout(2000),
      );
      assert.equal(response.status, 200);
      text = await response.text();
    } catch (error) {
      transportError = error instanceof Error ? error.name : "unknown";
    }
    const elapsedMs = Date.now() - started;
    const values = frames(text)
      .filter((value) => value !== "[DONE]")
      .map(
        (value) =>
          JSON.parse(value) as {
            error?: { code: string };
            choices?: { delta?: { content?: string } }[];
            usage?: Completion["usage"];
          },
      );
    const content = values
      .map((value) => value.choices?.[0]?.delta?.content ?? "")
      .join("");
    const [entry] = await f.ledger(key);
    await poll(async () => f.responseClosed(), Boolean);
    const passed =
      transportError === undefined &&
      entry?.status === "settled" &&
      content === "你好" &&
      !values.some((value) => value.error);
    await record(`${mode}-${passed ? "green" : "red"}`, {
      passed,
      elapsedMs,
      clientDeadlineMs: 2000,
      transportError,
      content,
      errorFrames: values.filter((value) => value.error),
      ledger: entry,
      cache: f.cache(key),
      upstreamRequests: f.requests(),
      upstreamResponseClosed: f.responseClosed(),
      boundary:
        "real TCP; upstream intentionally keeps HTTP response open after complete SSE DONE or appends extra data/malformed payload",
    });
    assert.equal(
      transportError,
      undefined,
      "DONE must complete before the real two-second client deadline",
    );
    assert.equal(
      content,
      "你好",
      "Frames after DONE must never become completion content",
    );
    assert.ok(values.every((value) => !value.error));
    assert.equal(frames(text).at(-1), "[DONE]");
    assert.deepEqual(values.find((value) => value.usage)?.usage, {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    });
    assert.equal(entry?.status, "settled");
    assert.equal(entry.amount, 16);
    assert.deepEqual(f.cache(key), { n: 1, cached: 1 });
    assert.equal(f.requests(), 1);
    assert.equal(f.responseClosed(), true);
  });
