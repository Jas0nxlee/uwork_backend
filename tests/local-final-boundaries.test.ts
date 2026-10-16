import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-local-final-"));
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    calls++;
    const body = JSON.parse(raw) as { messages: { content: string }[] };
    const input = body.messages.at(-1)!.content;
    if (input === "FAIL") {
      res.writeHead(429).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: input === "EMPTY" ? "" : "你好🌏",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const app = await createApp({
    database: join(directory, "state.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Local final",
    email: "final@example.test",
    password,
  });
  const other = await bootstrap(app.services.db, {
    name: "Other",
    email: "other-final@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  let token = "";
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    status = 200,
  ): Promise<T> {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await r.text();
    assert.equal(r.status, status, `${method} ${path}: ${raw}`);
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
  const login = async (email: string) => {
    token = (
      await api<{ token: string }>("POST", "/api/auth/login", {
        email,
        password,
      })
    ).token;
  };
  await login("final@example.test");
  return {
    app,
    api,
    login,
    password,
    p: `/api/tenants/${owner.tenantId}`,
    owner,
    other,
    calls: () => calls,
    port: (upstream.address() as { port: number }).port,
  };
}

test("client events retain the first payload per user and tenant and reject invalid fields atomically", async (t) => {
  const f = await fixture(t);
  const body = {
    eventKey: "same",
    type: "client.error",
    data: { code: "first" },
  };
  await f.api("POST", "/api/client/events", body, 202);
  await f.api(
    "POST",
    "/api/client/events",
    {
      ...body,
      type: "asset.installed",
      data: { resourceId: "changed", version: 3 },
    },
    202,
  );
  const rows = f.app.services.db.all<{ type: string; data: string }>(
    "SELECT type,data FROM client_events WHERE tenant_id=?",
    f.owner.tenantId,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.type, "client.error");
  assert.deepEqual(JSON.parse(rows[0]!.data), { code: "first" });
  await f.api(
    "POST",
    `${f.p}/members`,
    {
      name: "Member",
      email: "member-final@example.test",
      password: f.password,
      seat: true,
    },
    201,
  );
  await f.login("member-final@example.test");
  await f.api("POST", "/api/client/events", body, 202);
  await f.login("other-final@example.test");
  await f.api("POST", "/api/client/events", body, 202);
  assert.equal(
    (
      await f.api<{ total: number }>(
        "GET",
        `/api/tenants/${f.other.tenantId}/client-events`,
      )
    ).total,
    1,
  );
  await f.login("final@example.test");
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/client-events`)).total,
    2,
  );
  for (const invalid of [
    { ...body, eventKey: "" },
    { ...body, eventKey: "x".repeat(129) },
    { ...body, type: "unknown" },
    { ...body, data: { code: "x".repeat(81) } },
    { ...body, data: { version: -1 } },
    { ...body, data: { version: 1.5 } },
    { ...body, data: { secret: "not-allowed" } },
    { ...body, extra: true },
  ])
    await f.api("POST", "/api/client/events", invalid, 400);
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/client-events`)).total,
    2,
  );
  await f.api(
    "POST",
    "/api/client/events",
    {
      eventKey: "x".repeat(128),
      type: "configuration.applied",
      data: { resourceId: "x".repeat(80), code: "x".repeat(80), version: 0 },
    },
    202,
  );
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/client-events`)).total,
    3,
  );
  assert.equal(f.calls(), 0);
});

test("dataset limits and Unicode/empty exact or contains scores include failed runs as failed cases", async (t) => {
  const f = await fixture(t);
  const credential = await f.api<{ id: string }>(
    "POST",
    `${f.p}/credentials`,
    { name: "Controlled", value: "synthetic-only" },
    201,
  );
  const model = await f.api<{ id: string }>(
    "POST",
    `${f.p}/models`,
    {
      name: "Controlled",
      upstreamModel: "local",
      credentialId: credential.id,
      baseUrl: `http://127.0.0.1:${f.port}/v1`,
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  const agent = await f.api<{ id: string }>(
    "POST",
    `${f.p}/agents`,
    {
      name: "Scoring",
      modelId: model.id,
      instructions: "Answer",
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  await f.api("POST", `${f.p}/agents/${agent.id}/publish`, { version: 1 });
  const boundary = {
    name: "Boundary",
    cases: Array.from({ length: 50 }, () => ({
      input: "OK",
      expected: "你好🌏",
    })),
  };
  const accepted = await f.api<{ id: string }>(
    "POST",
    `${f.p}/datasets`,
    boundary,
    201,
  );
  assert.equal(
    (await f.api<{ cases: unknown[] }>("GET", `${f.p}/datasets/${accepted.id}`))
      .cases.length,
    50,
  );
  await f.api(
    "POST",
    `${f.p}/datasets`,
    { ...boundary, cases: [...boundary.cases, boundary.cases[0]] },
    400,
  );
  await f.api("POST", `${f.p}/datasets`, { name: "Empty", cases: [] }, 400);
  assert.equal((await f.api<unknown[]>("GET", `${f.p}/datasets`)).length, 1);
  const lengths = await f.api<{ id: string }>(
    "POST",
    `${f.p}/datasets`,
    {
      name: "Length boundary",
      cases: [{ input: "x".repeat(10000), expected: "界".repeat(10000) }],
    },
    201,
  );
  assert.equal(
    (
      await f.api<{ cases: { input: string; expected: string }[] }>(
        "GET",
        `${f.p}/datasets/${lengths.id}`,
      )
    ).cases[0]!.expected.length,
    10000,
  );
  for (const invalid of [
    { input: "", expected: "" },
    { input: "x".repeat(10001), expected: "" },
    { input: "x", expected: "界".repeat(10001) },
  ])
    await f.api(
      "POST",
      `${f.p}/datasets`,
      { name: "Invalid length", cases: [invalid] },
      400,
    );
  assert.equal((await f.api<unknown[]>("GET", `${f.p}/datasets`)).length, 2);
  const cases = [
    { input: "OK", expected: "你好🌏", match: "exact" },
    { input: "OK", expected: "好🌏", match: "contains" },
    { input: "OK", expected: "你好", match: "exact" },
    { input: "EMPTY", expected: "", match: "exact" },
    { input: "OK", expected: "", match: "contains" },
    { input: "FAIL", expected: "", match: "contains" },
  ];
  const dataset = await f.api<{ id: string }>(
    "POST",
    `${f.p}/datasets`,
    { name: "Scoring cases", cases },
    201,
  );
  const evaluation = await f.api<{ id: string }>(
    "POST",
    `${f.p}/evaluations`,
    { agentId: agent.id, datasetId: dataset.id },
    202,
  );
  await f.app.services.evaluation.drain();
  const result = await f.api<{
    status: string;
    report: {
      cases: { passed: boolean; status: string }[];
      passed: number;
      total: number;
      passRate: number;
    };
  }>("GET", `${f.p}/evaluations/${evaluation.id}`);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    result.report.cases.map((c) => c.passed),
    [true, true, false, true, true, false],
  );
  assert.equal(result.report.cases.at(-1)!.status, "failed");
  assert.equal(result.report.passed, 4);
  assert.equal(result.report.total, 6);
  assert.equal(result.report.passRate, 4 / 6);
  assert.equal(f.calls(), 6);
});
