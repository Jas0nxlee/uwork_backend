import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { nextOccurrence } from "../src/automation.js";
import { bootstrap } from "../src/identity.js";

type Delivery = {
  id: string;
  run_id: string;
  status: string;
  attempts: number;
  next_at: number;
  error_code: string | null;
};
const output = "controlled-feishu-output\n第二行";
async function record(name: string, report: unknown) {
  const directory = process.env.UWORK_AUTOMATION_ADDITIONAL_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
async function fixture(t: TestContext, modelStatus = 200) {
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-automation-additional-"),
  );
  const modelToken = randomBytes(24).toString("hex"),
    deliveryToken = randomBytes(24).toString("hex");
  const notifications: unknown[] = [];
  let modelCalls = 0,
    deliveryStatus = 200;
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.url === "/feishu") {
      assert.equal(request.headers.authorization, `Bearer ${deliveryToken}`);
      notifications.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(deliveryStatus, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          code: deliveryStatus === 200 ? 0 : 1,
          msg: "controlled",
        }),
      );
      return;
    }
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${modelToken}`);
    modelCalls++;
    response.writeHead(modelStatus, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        modelStatus === 200
          ? {
              choices: [
                { message: { content: output }, finish_reason: "stop" },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 4 },
            }
          : { error: { message: "controlled model denial" } },
      ),
    );
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
  const provider = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
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
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        connection: "close",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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
    name: "Additional automation",
    email: "additional-automation@example.test",
    password,
  });
  token = (
    await api<{ token: string }>("POST", "/api/auth/login", {
      email: "additional-automation@example.test",
      password,
    })
  ).token;
  const p = `/api/tenants/${owner.tenantId}`;
  const credential = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    { name: "Controlled model", value: modelToken },
    201,
  );
  const model = await api<{ id: string }>(
    "POST",
    `${p}/models`,
    {
      name: "Controlled model",
      upstreamModel: "controlled",
      baseUrl: provider + "/v1",
      credentialId: credential.id,
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  const agent = await api<{ id: string }>(
    "POST",
    `${p}/agents`,
    {
      name: "Additional agent",
      modelId: model.id,
      instructions: "Answer briefly",
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  await api("POST", `${p}/agents/${agent.id}/publish`, { version: 1 });
  const notification = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    {
      name: "Controlled Feishu payload",
      value: JSON.stringify({
        url: provider + "/feishu",
        token: deliveryToken,
        type: "feishu",
      }),
    },
    201,
  );
  async function createTask() {
    const due = Date.now() + 60000;
    const task = await api<{ id: string; nextAt: number }>(
      "POST",
      `${p}/automations`,
      {
        name: "Additional notification",
        agentId: agent.id,
        input: "controlled input",
        schedule: { type: "once", at: due },
        timezone: "UTC",
        webhookCredentialId: notification.id,
      },
      201,
    );
    // Existing worker entry points receive an explicit deterministic clock.
    // These are real scheduler/model/delivery implementations, not SQL states.
    state.app!.services.automation.tick(task.nextAt);
    await state.app!.services.runtime.drain();
    return task;
  }
  return {
    api,
    p,
    agentId: agent.id,
    createTask,
    deliveries: () => api<Delivery[]>("GET", `${p}/deliveries`),
    notifications,
    modelCalls: () => modelCalls,
    rejectNotification: () => {
      deliveryStatus = 503;
    },
    acceptNotification: () => {
      deliveryStatus = 200;
    },
    deliver: (at: number) => state.app!.services.automation.deliver(at),
    async reopen() {
      await state.app!.close();
      state.app = await createApp(options);
      origin = await state.app.listen({ host: "127.0.0.1", port: 0 });
    },
  };
}

test("pending Feishu notification retains its retry deadline across disk restart and maps completed output", async (t) => {
  const f = await fixture(t);
  const task = await f.createTask();
  f.rejectNotification();
  await f.deliver(task.nextAt);
  const [pending] = await f.deliveries();
  assert.ok(pending);
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 1);
  assert.equal(pending.next_at, task.nextAt + 60000);
  const expected = { msg_type: "text", content: { text: output } };
  assert.deepEqual(f.notifications, [expected]);
  assert.equal(f.modelCalls(), 1);
  await f.reopen();
  assert.deepEqual(await f.deliveries(), [pending]);
  f.acceptNotification();
  await f.deliver(pending.next_at - 1);
  assert.equal(f.notifications.length, 1);
  assert.deepEqual(await f.deliveries(), [pending]);
  await f.deliver(pending.next_at);
  const [sent] = await f.deliveries();
  assert.ok(sent);
  assert.equal(sent.status, "sent");
  assert.equal(sent.attempts, 2);
  assert.equal(sent.error_code, null);
  assert.deepEqual(f.notifications, [expected, expected]);
  assert.equal(f.modelCalls(), 1);
  await record("pending-restart-feishu", {
    passed: true,
    transport: "real TCP + temporary file SQLite",
    pending,
    sent,
    beforeDeadlineRequests: 1,
    atDeadlineRequests: 2,
    modelDispatchesAcrossRestart: 1,
    payload: expected,
    clockBoundary:
      "existing production tick/deliver(time) entry points use explicit test times; no real 60-second wait, fake timers or business-state SQL writes",
    externalFeishuAcceptance: false,
  });
});

test("Feishu notification maps a real failed model run to status/error text without a fabricated successful output", async (t) => {
  const f = await fixture(t, 400);
  const task = await f.createTask();
  const [pending] = await f.deliveries();
  assert.ok(pending);
  const run = await f.api<{
    status: string;
    error_code: string;
    output: string | null;
  }>("GET", `${f.p}/runs/${pending.run_id}`);
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "UPSTREAM_REJECTED");
  assert.equal(run.output, null);
  await f.deliver(task.nextAt);
  const expected = {
    msg_type: "text",
    content: { text: "任务 failed: UPSTREAM_REJECTED" },
  };
  assert.deepEqual(f.notifications, [expected]);
  const [sent] = await f.deliveries();
  assert.equal(sent?.status, "sent");
  assert.equal(sent.attempts, 1);
  assert.equal(f.modelCalls(), 1);
  await record("feishu-failed-result", {
    passed: true,
    controlledModelHttpStatus: 400,
    modelRunStatus: run.status,
    modelRunError: run.error_code,
    payload: expected,
    notificationRequests: f.notifications.length,
    externalFeishuAcceptance: false,
  });
});

test("locked Cron timezone semantics project DST gaps and folds to explicit UTC instants", async (t) => {
  const zone = "America/New_York";
  const gap = { type: "cron", expression: "30 2 * * *" } as const;
  const fold = { type: "cron", expression: "30 1 * * *" } as const;
  const cases = [
    {
      schedule: gap,
      after: "2026-03-08T06:59:00Z",
      expected: "2026-03-08T07:30:00.000Z",
      meaning: "nonexistent 02:30 lands at 03:30 EDT",
    },
    {
      schedule: gap,
      after: "2026-03-08T07:30:00Z",
      expected: "2026-03-09T06:30:00.000Z",
      meaning: "following day returns to 02:30 EDT",
    },
    {
      schedule: fold,
      after: "2026-11-01T04:00:00Z",
      expected: "2026-11-01T05:30:00.000Z",
      meaning: "before fold selects first 01:30 EDT",
    },
    {
      schedule: fold,
      after: "2026-11-01T05:30:00Z",
      expected: "2026-11-02T06:30:00.000Z",
      meaning: "next from first occurrence skips repeated hour",
    },
    {
      schedule: fold,
      after: "2026-11-01T06:00:00Z",
      expected: "2026-11-01T06:30:00.000Z",
      meaning:
        "fresh parser anchored inside second hour may select second 01:30 EST",
    },
  ];
  for (const c of cases)
    assert.equal(
      new Date(
        nextOccurrence(c.schedule, zone, Date.parse(c.after))!,
      ).toISOString(),
      c.expected,
      c.meaning,
    );
  const f = await fixture(t);
  const before = Date.now();
  const created = await f.api<{ id: string; nextAt: number }>(
    "POST",
    `${f.p}/automations`,
    {
      name: "DST Cron projection",
      agentId: f.agentId,
      input: "must remain unexecuted",
      schedule: fold,
      timezone: zone,
      enabled: false,
    },
    201,
  );
  assert.equal(created.nextAt, nextOccurrence(fold, zone, before));
  await f.reopen();
  const task = (
    await f.api<
      {
        id: string;
        next_at: number;
        timezone: string;
        schedule: unknown;
        enabled: number;
      }[]
    >("GET", `${f.p}/automations`)
  ).find((row) => row.id === created.id)!;
  assert.equal(task.next_at, created.nextAt);
  assert.equal(task.timezone, zone);
  assert.deepEqual(task.schedule, fold);
  assert.equal(task.enabled, 0);
  assert.equal(f.modelCalls(), 0);
  assert.equal(f.notifications.length, 0);
  await record("cron-dst-projections", {
    passed: true,
    timezone: zone,
    lockedCronParserVersion: "5.10.2",
    cases,
    httpCronProjectionPersistedAcrossRestart: true,
    disabledCronDispatched: false,
    boundary:
      "fixed locked-library path-dependent semantics; not a new once-versus-twice DST business policy or a real wall-clock transition observation",
  });
});
