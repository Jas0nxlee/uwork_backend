import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Run = {
  id: string;
  session_id: string;
  agent_version: number;
  status: string;
  error_code: string | null;
  output: string | null;
};
type Delivery = {
  status: string;
  attempts: number;
  next_at: number;
  error_code: string | null;
};
type Message = { role: string; content: string };
async function evidence(name: string, data: unknown) {
  const directory = process.env.UWORK_RUNTIME_SIXTH_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(data, null, 2),
    { mode: 0o600 },
  );
}
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const until = Date.now() + 10000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < until, "Controlled runtime state timed out");
    await delay(15);
  }
}
async function fixture(t: TestContext, holdFirst = false) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-runtime-sixth-"));
  const modelSecret = randomBytes(24).toString("hex"),
    notificationSecret = randomBytes(24).toString("hex");
  const messages: Message[][] = [],
    notifications: unknown[] = [],
    notificationResponseBytes: number[] = [];
  let held: ServerResponse | undefined,
    notificationResponse: unknown = { code: 0, msg: "success" };
  const respond = (response: ServerResponse, n: number) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: `reply${n}` },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
  };
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (request.url === "/feishu") {
      assert.equal(
        request.headers.authorization,
        `Bearer ${notificationSecret}`,
      );
      notifications.push(data);
      response.setHeader("content-type", "application/json");
      const body =
        typeof notificationResponse === "string"
          ? notificationResponse
          : JSON.stringify(notificationResponse);
      notificationResponseBytes.push(Buffer.byteLength(body));
      response.end(body);
      return;
    }
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${modelSecret}`);
    messages.push(data.messages as Message[]);
    if (holdFirst && messages.length === 1) {
      held = response;
      return;
    }
    respond(response, messages.length);
  });
  const state: { app?: Awaited<ReturnType<typeof createApp>> } = {};
  t.after(async () => {
    try {
      upstream.closeAllConnections();
      await state.app?.close();
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
  const base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const options = {
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: false,
  };
  state.app = await createApp(options);
  let origin = await state.app.listen({ host: "127.0.0.1", port: 0 }),
    token = "";
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    status = 200,
    credential = token,
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        connection: "close",
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(state.app.services.db, {
    name: "Runtime sixth",
    email: "runtime-sixth@example.test",
    password,
  });
  token = (
    await api<{ token: string }>("POST", "/api/auth/login", {
      email: "runtime-sixth@example.test",
      password,
    })
  ).token;
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    { name: "Controlled model", value: modelSecret },
    201,
  );
  const model = await api<{ id: string }>(
    "POST",
    `${p}/models`,
    {
      name: "Controlled model",
      upstreamModel: "controlled",
      baseUrl: base + "/v1",
      credentialId: credential.id,
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  const createAgent = async (name: string, instructions: string) => {
    const agent = await api<{ id: string }>(
      "POST",
      `${p}/agents`,
      {
        name,
        modelId: model.id,
        instructions,
        assetIds: [],
        scope: { all: true },
        maxOutputTokens: 128,
      },
      201,
    );
    await api("POST", `${p}/agents/${agent.id}/publish`, { version: 1 });
    return agent.id;
  };
  const agentId = await createAgent("Sixth Agent", "VERSION_ONE");
  const notification = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    {
      name: "Local Feishu contract",
      value: JSON.stringify({
        url: base + "/feishu",
        token: notificationSecret,
        type: "feishu",
      }),
    },
    201,
  );
  const enqueue = async (
    input: string,
    sessionId?: string,
    agent = agentId,
    auth = token,
  ) =>
    (
      await api<{ id: string }>(
        "POST",
        `${p}/runs`,
        { agentId: agent, input, ...(sessionId ? { sessionId } : {}) },
        202,
        auth,
      )
    ).id;
  const run = (id: string) => api<Run>("GET", `${p}/runs/${id}`);
  async function task() {
    const created = await api<{ id: string; nextAt: number }>(
      "POST",
      `${p}/automations`,
      {
        name: "Sixth Feishu response",
        agentId,
        input: "notify local only",
        schedule: { type: "once", at: Date.now() + 60000 },
        timezone: "UTC",
        webhookCredentialId: notification.id,
      },
      201,
    );
    state.app!.services.automation.tick(created.nextAt);
    await state.app!.services.runtime.drain();
    return created;
  }
  return {
    api,
    p,
    agentId,
    modelId: model.id,
    enqueue,
    run,
    createAgent,
    messages,
    notifications,
    notificationResponseBytes,
    notificationSecret,
    task,
    deliveries: () => api<Delivery[]>("GET", `${p}/deliveries`),
    setNotification: (value: unknown) => {
      notificationResponse = value;
    },
    pump: () => state.app!.services.runtime.pump(),
    drain: () => state.app!.services.runtime.drain(),
    deliver: (at: number) => state.app!.services.automation.deliver(at),
    release: () => {
      assert.ok(held);
      respond(held, 1);
    },
    async reopen() {
      await state.app!.close();
      state.app = await createApp(options);
      origin = await state.app.listen({ host: "127.0.0.1", port: 0 });
    },
  };
}

for (const mode of ["business-error", "malformed"] as const)
  test(`Feishu HTTP200 ${mode} stays pending, preserves retry after restart and recovers only on code zero`, async (t) => {
    const f = await fixture(t);
    const task = await f.task();
    f.setNotification(
      mode === "business-error"
        ? { code: 19024, StatusCode: 0, msg: f.notificationSecret }
        : `not-json-${f.notificationSecret}`,
    );
    await f.deliver(task.nextAt);
    const [first] = await f.deliveries();
    assert.ok(first);
    await evidence(
      `feishu-${mode}-${first.status === "pending" ? "initial-green" : "red"}`,
      {
        controlledHttpStatus: 200,
        observed: first,
        modelDispatches: f.messages.length,
        notificationRequests: f.notifications.length,
        remoteErrorNotPersisted: !JSON.stringify(first).includes(
          f.notificationSecret,
        ),
        contract:
          "modern numeric code=0 is required; deprecated StatusCode cannot override code error",
        source:
          "https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot",
      },
    );
    assert.equal(
      first.status,
      "pending",
      "HTTP200 alone cannot confirm a Feishu delivery",
    );
    assert.equal(first.attempts, 1);
    assert.equal(first.next_at, task.nextAt + 60000);
    assert.equal(first.error_code, "DELIVERY_FAILED");
    await f.reopen();
    assert.deepEqual(await f.deliveries(), [first]);
    f.setNotification({ code: 0, StatusCode: 0, msg: "success" });
    await f.deliver(first.next_at - 1);
    assert.equal(f.notifications.length, 1);
    await f.deliver(first.next_at);
    const [sent] = await f.deliveries();
    assert.equal(sent?.status, "sent");
    assert.equal(sent.attempts, 2);
    assert.equal(sent.error_code, null);
    assert.equal(f.notifications.length, 2);
    assert.equal(f.messages.length, 1);
    const ledger = await f.api<{ total: number; items: { status: string }[] }>(
      "GET",
      `${f.p}/usage`,
    );
    assert.equal(ledger.total, 1);
    assert.equal(ledger.items[0]?.status, "settled");
    await evidence(`feishu-${mode}-green`, {
      passed: true,
      first,
      sent,
      notificationRequests: 2,
      modelDispatches: 1,
      ledgerEntries: 1,
      remoteErrorNotPersisted: true,
    });
  });

test("queued Agent freezes its published prompt version while new runs use the new version and disabled queues never dispatch", async (t) => {
  const f = await fixture(t);
  const frozen = await f.enqueue("queued before publish");
  const old = (
    await f.api<{ id: string; revision: number }[]>("GET", `${f.p}/agents`)
  ).find((row) => row.id === f.agentId)!;
  const revised = await f.api<{ version: number }>(
    "PUT",
    `${f.p}/agents/${f.agentId}`,
    {
      name: "Sixth Agent",
      modelId: f.modelId,
      instructions: "VERSION_TWO",
      assetIds: [],
      scope: { all: true },
      maxOutputTokens: 128,
      revision: old.revision,
    },
  );
  await f.api("POST", `${f.p}/agents/${f.agentId}/publish`, {
    version: revised.version,
  });
  await f.drain();
  const first = await f.run(frozen);
  assert.equal(first.status, "succeeded");
  assert.equal(first.agent_version, 1);
  assert.equal(f.messages[0]?.[0]?.content, "VERSION_ONE");
  const current = await f.enqueue("queued after publish");
  await f.drain();
  const second = await f.run(current);
  assert.equal(second.agent_version, 2);
  assert.equal(second.status, "succeeded");
  assert.equal(f.messages[1]?.[0]?.content, "VERSION_TWO");
  const disabled = await f.enqueue("must not dispatch");
  await f.api("DELETE", `${f.p}/agents/${f.agentId}`, undefined, 204);
  await f.drain();
  const denied = await f.run(disabled);
  assert.equal(denied.status, "failed");
  assert.equal(denied.error_code, "AGENT_DENIED");
  assert.equal(f.messages.length, 2);
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/usage`)).total,
    2,
  );
  await evidence("agent-version-pin", {
    passed: true,
    frozenVersion: first.agent_version,
    subsequentVersion: second.agent_version,
    disabledQueuedCode: denied.error_code,
    modelDispatches: 2,
    ledgerEntries: 2,
  });
});

test("a session serializes real model calls, rejects foreign bindings and excludes cancelled turns from continuation", async (t) => {
  const f = await fixture(t, true);
  const firstId = await f.enqueue("first user input");
  f.pump();
  await poll(
    async () => f.messages.length,
    (n) => n === 1,
  );
  const firstRunning = await f.run(firstId);
  assert.equal(firstRunning.status, "running");
  const secondId = await f.enqueue(
    "second user input",
    firstRunning.session_id,
  );
  f.pump();
  assert.equal((await f.run(secondId)).status, "queued");
  assert.equal(f.messages.length, 1);
  const otherAgent = await f.createAgent("Other sixth Agent", "other");
  await f.api(
    "POST",
    `${f.p}/runs`,
    {
      agentId: otherAgent,
      input: "foreign Agent",
      sessionId: firstRunning.session_id,
    },
    404,
  );
  const password = randomBytes(24).toString("hex");
  await f.api(
    "POST",
    `${f.p}/members`,
    {
      email: "other-runtime-sixth@example.test",
      name: "Other user",
      password,
      role: "member",
      seat: true,
    },
    201,
  );
  const other = await f.api<{ token: string }>("POST", "/api/auth/login", {
    email: "other-runtime-sixth@example.test",
    password,
  });
  await f.api(
    "POST",
    `${f.p}/runs`,
    {
      agentId: f.agentId,
      input: "foreign user",
      sessionId: firstRunning.session_id,
    },
    404,
    other.token,
  );
  f.release();
  await f.drain();
  assert.equal((await f.run(firstId)).status, "succeeded");
  assert.equal((await f.run(secondId)).status, "succeeded");
  assert.deepEqual(f.messages[1]?.slice(1), [
    { role: "user", content: "first user input" },
    { role: "assistant", content: "reply1" },
    { role: "user", content: "second user input" },
  ]);
  const cancelled = await f.enqueue(
    "cancelled must not be history",
    firstRunning.session_id,
  );
  await f.api("POST", `${f.p}/runs/${cancelled}/cancel`, {});
  const last = await f.enqueue("last user input", firstRunning.session_id);
  await f.drain();
  assert.equal((await f.run(last)).status, "succeeded");
  assert.equal((await f.run(cancelled)).status, "cancelled");
  assert.equal(f.messages.length, 3);
  assert.ok(
    !JSON.stringify(f.messages[2]).includes("cancelled must not be history"),
  );
  assert.deepEqual(f.messages[2]?.slice(1), [
    { role: "user", content: "first user input" },
    { role: "assistant", content: "reply1" },
    { role: "user", content: "second user input" },
    { role: "assistant", content: "reply2" },
    { role: "user", content: "last user input" },
  ]);
  assert.equal((await f.api<{ total: number }>("GET", `${f.p}/runs`)).total, 4);
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/sessions`)).total,
    1,
  );
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/usage`)).total,
    3,
  );
  await evidence("session-continuation", {
    passed: true,
    sameSessionNoOverlap: true,
    foreignAgentAndUserBindings: 404,
    cancelledTurnExcluded: true,
    totalRuns: 4,
    totalSessions: 1,
    modelDispatches: 3,
    ledgerEntries: 3,
  });
});

test("Feishu business confirmation requires a present numeric zero without legacy fallback or string coercion", async (t) => {
  for (const mode of ["missing-code", "string-zero"] as const) {
    const f = await fixture(t);
    const task = await f.task();
    f.setNotification(
      mode === "missing-code"
        ? { StatusCode: 0, msg: f.notificationSecret }
        : { code: "0", msg: f.notificationSecret },
    );
    await f.deliver(task.nextAt);
    const [delivery] = await f.deliveries();
    assert.ok(delivery);
    assert.equal(delivery.status, "pending", mode);
    assert.equal(delivery.attempts, 1);
    assert.equal(delivery.next_at, task.nextAt + 60000);
    assert.equal(delivery.error_code, "DELIVERY_FAILED");
    assert.ok(!JSON.stringify(delivery).includes(f.notificationSecret));
    assert.equal(f.messages.length, 1);
    assert.equal(f.notifications.length, 1);
    const ledger = await f.api<{ total: number; items: { status: string }[] }>(
      "GET",
      `${f.p}/usage`,
    );
    assert.equal(ledger.total, 1);
    assert.equal(ledger.items[0]?.status, "settled");
    await evidence(`feishu-${mode}`, {
      passed: true,
      mode,
      controlledHttpStatus: 200,
      actualResponseBytes: f.notificationResponseBytes[0],
      delivery,
      notificationRequests: 1,
      modelDispatches: 1,
      settledLedgerEntries: 1,
      remoteMessageNotPersisted: true,
    });
  }
});

test("Feishu decoded response limit accepts valid JSON at 64KiB and rejects one extra byte without leaking remote text", async (t) => {
  for (const size of [65536, 65537]) {
    const f = await fixture(t);
    const task = await f.task();
    const overhead = Buffer.byteLength(JSON.stringify({ code: 0, msg: "" }));
    const body = JSON.stringify({
      code: 0,
      msg:
        f.notificationSecret +
        "x".repeat(size - overhead - Buffer.byteLength(f.notificationSecret)),
    });
    assert.equal(Buffer.byteLength(body), size);
    assert.equal((JSON.parse(body) as { code: number }).code, 0);
    f.setNotification(body);
    await f.deliver(task.nextAt);
    const [delivery] = await f.deliveries();
    assert.ok(delivery);
    assert.equal(f.notificationResponseBytes[0], size);
    assert.equal(delivery.status, size === 65536 ? "sent" : "pending");
    assert.equal(
      delivery.error_code,
      size === 65536 ? null : "DELIVERY_FAILED",
    );
    assert.equal(delivery.attempts, 1);
    if (size === 65537) assert.equal(delivery.next_at, task.nextAt + 60000);
    assert.ok(!JSON.stringify(delivery).includes(f.notificationSecret));
    assert.equal(f.messages.length, 1);
    assert.equal(f.notifications.length, 1);
    const ledger = await f.api<{ total: number; items: { status: string }[] }>(
      "GET",
      `${f.p}/usage`,
    );
    assert.equal(ledger.total, 1);
    assert.equal(ledger.items[0]?.status, "settled");
    await evidence(`feishu-response-${size}`, {
      passed: true,
      controlledHttpStatus: 200,
      validJsonCodeZero: true,
      actualResponseBytes: f.notificationResponseBytes[0],
      delivery,
      notificationRequests: 1,
      modelDispatches: 1,
      settledLedgerEntries: 1,
      remoteMessageNotPersisted: true,
    });
  }
});
