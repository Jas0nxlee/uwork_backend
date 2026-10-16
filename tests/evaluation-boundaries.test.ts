import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

interface Evaluation {
  id: string;
  status: string;
  finished_at: number | null;
  report: {
    cases: {
      runId: string;
      expected: string;
      status?: string;
      passed?: boolean;
    }[];
    passed?: number;
    total?: number;
    passRate?: number;
  };
}
interface Run {
  id: string;
  session_id: string;
  status: string;
  output: string | null;
  finished_at: number | null;
}
async function evidence(name: string, data: unknown) {
  const directory = process.env.UWORK_EVALUATION_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(data, null, 2),
    {
      mode: 0o600,
    },
  );
}
async function fixture(t: TestContext, worker = false, oneFast = false) {
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-evaluation-boundaries-"),
  );
  const upstreamToken = randomBytes(24).toString("hex");
  let requests = 0;
  const upstream = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests++;
    if (request.headers.authorization !== `Bearer ${upstreamToken}`) {
      response.writeHead(401).end();
      return;
    }
    if (oneFast && requests > 1) return;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "answer" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
  });
  const state: {
    app?: Awaited<ReturnType<typeof createApp>>;
    token?: string;
  } = {};
  t.after(async () => {
    try {
      await state.app?.close();
    } finally {
      try {
        upstream.closeAllConnections();
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
  state.app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker,
  });
  const instance = state.app;
  const origin = await instance.listen({ host: "127.0.0.1", port: 0 });
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    status = 200,
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const password = randomBytes(24).toString("hex");
  const { tenantId } = await bootstrap(instance.services.db, {
    name: "Evaluation boundaries",
    email: "evaluation-boundaries@example.test",
    password,
  });
  state.token = (
    await api<{ token: string }>("POST", "/api/auth/login", {
      email: "evaluation-boundaries@example.test",
      password,
    })
  ).token;
  const p = `/api/tenants/${tenantId}`;
  const credential = await api<{ id: string }>(
    "POST",
    `${p}/credentials`,
    { name: "Controlled local credential", value: upstreamToken },
    201,
  );
  const model = await api<{ id: string }>(
    "POST",
    `${p}/models`,
    {
      name: "Controlled local model",
      upstreamModel: "controlled",
      credentialId: credential.id,
      baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
      scope: { all: true },
      maxOutputTokens: 128,
    },
    201,
  );
  const agent = await api<{ id: string }>(
    "POST",
    `${p}/agents`,
    {
      name: "Evaluation boundary agent",
      modelId: model.id,
      instructions: "Answer briefly",
      assetIds: [],
      maxOutputTokens: 128,
      scope: { all: true },
    },
    201,
  );
  await api("POST", `${p}/agents/${agent.id}/publish`, { version: 1 });
  async function dataset(count: number, mismatch = false) {
    return (
      await api<{ id: string }>(
        "POST",
        `${p}/datasets`,
        {
          name: `Boundary dataset ${count}`,
          cases: Array.from({ length: count }, (_, i) => ({
            input: `controlled input ${i}`,
            expected: mismatch && i === 1 ? "wrong" : "answer",
            match: "exact",
          })),
        },
        201,
      )
    ).id;
  }
  const evaluate = async (datasetId: string) =>
    (
      await api<{ id: string }>(
        "POST",
        `${p}/evaluations`,
        { agentId: agent.id, datasetId },
        202,
      )
    ).id;
  const evaluation = (id: string) =>
    api<Evaluation>("GET", `${p}/evaluations/${id}`);
  const run = (id: string) => api<Run>("GET", `${p}/runs/${id}`);
  async function snapshot() {
    const [runs, sessions, evaluations] = await Promise.all([
      api<{ total: number }>("GET", `${p}/runs?pageSize=100`),
      api<{ total: number }>("GET", `${p}/sessions?pageSize=100`),
      api<Evaluation[]>("GET", `${p}/evaluations`),
    ]);
    return {
      runs: runs.total,
      sessions: sessions.total,
      evaluations: evaluations.length,
    };
  }
  async function references(row: Evaluation) {
    const runs = await Promise.all(row.report.cases.map((c) => run(c.runId)));
    for (const r of runs) {
      const sessions = await api<{
        items: { id: string; run_count: number }[];
      }>("GET", `${p}/sessions?q=${r.session_id}`);
      assert.equal(sessions.items.length, 1);
      assert.equal(sessions.items[0]!.run_count, 1);
    }
    return runs;
  }
  // Fault injection changes only timestamps in this test's own database.
  // All setup, enqueue, cancellation and retention business writes use TCP HTTP.
  const ageFinished = () =>
    instance.services.db.run(
      "UPDATE runs SET finished_at=? WHERE tenant_id=? AND status NOT IN ('queued','running')",
      Date.now() - 30 * 86400000,
      tenantId,
    );
  const counts = () => ({
    orphanSessions: instance.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM runtime_sessions s WHERE tenant_id=? AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.session_id=s.id)",
      tenantId,
    )!.n,
    orphanEvaluationRuns: instance.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM runs r WHERE tenant_id=? AND trigger_key LIKE 'evaluation:%' AND NOT EXISTS(SELECT 1 FROM evaluations e WHERE r.trigger_key LIKE 'evaluation:'||e.id||':%')",
      tenantId,
    )!.n,
  });
  return {
    app: instance,
    api,
    p,
    tenantId,
    agentId: agent.id,
    dataset,
    evaluate,
    evaluation,
    run,
    references,
    snapshot,
    ageFinished,
    counts,
    requests: () => requests,
  };
}
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 12000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, "Boundary state timed out");
    await delay(30);
  }
}

test("multi-case evaluation enqueue rolls back at capacity and fits exactly at 100 over real disk/TCP", async (t) => {
  const f = await fixture(t);
  const datasetId = await f.dataset(2);
  const standalone: string[] = [];
  for (let i = 0; i < 99; i++)
    standalone.push(
      (
        await f.api<{ id: string }>(
          "POST",
          `${f.p}/runs`,
          { agentId: f.agentId, input: `capacity ${i}` },
          202,
        )
      ).id,
    );
  const before = await f.snapshot();
  assert.deepEqual(before, { runs: 99, sessions: 99, evaluations: 0 });
  const rejected = await f.api<{ error: { code: string } }>(
    "POST",
    `${f.p}/evaluations`,
    { agentId: f.agentId, datasetId },
    429,
  );
  assert.equal(rejected.error.code, "QUEUE_FULL");
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(f.counts(), { orphanSessions: 0, orphanEvaluationRuns: 0 });
  await f.api("POST", `${f.p}/runs/${standalone[0]}/cancel`, {});
  const accepted = await f.evaluation(await f.evaluate(datasetId));
  assert.equal(accepted.report.cases.length, 2);
  assert.equal(
    (await f.api<{ total: number }>("GET", `${f.p}/runs?status=queued`)).total,
    100,
  );
  const full = await f.snapshot();
  const again = await f.api<{ error: { code: string } }>(
    "POST",
    `${f.p}/evaluations`,
    { agentId: f.agentId, datasetId },
    429,
  );
  assert.equal(again.error.code, "QUEUE_FULL");
  assert.deepEqual(await f.snapshot(), full);
  assert.deepEqual(f.counts(), { orphanSessions: 0, orphanEvaluationRuns: 0 });
  assert.equal(f.requests(), 0);
  await evidence("capacity", {
    independentDiskTcp: true,
    before,
    rejectedAt99: rejected.error.code,
    acceptedCaseCount: accepted.report.cases.length,
    activeAtExactFit: 100,
    unchangedAt100: full,
    orphanCounts: f.counts(),
    upstreamRequests: f.requests(),
  });
});

test("queued evaluation cancellation and retention preserve report references while purging an unrelated terminal run", async (t) => {
  const f = await fixture(t);
  const datasetId = await f.dataset(3);
  const id = await f.evaluate(datasetId);
  const initial = await f.evaluation(id);
  assert.ok((await f.references(initial)).every((r) => r.status === "queued"));
  await f.api("POST", `${f.p}/evaluations/${id}/cancel`, {});
  await f.api("POST", `${f.p}/evaluations/${id}/cancel`, {});
  const cancelled = await f.evaluation(id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.finished_at);
  assert.deepEqual(
    cancelled.report.cases.map((c) => c.runId),
    initial.report.cases.map((c) => c.runId),
  );
  assert.ok(
    (await f.references(cancelled)).every((r) => r.status === "cancelled"),
  );
  const activeId = await f.evaluate(datasetId);
  const active = await f.evaluation(activeId);
  const unrelated = await f.api<{ id: string }>(
    "POST",
    `${f.p}/runs`,
    { agentId: f.agentId, input: "unrelated terminal" },
    202,
  );
  await f.api("POST", `${f.p}/runs/${unrelated.id}/cancel`, {});
  f.ageFinished();
  await f.api("PUT", `${f.p}/retention`, { days: 7 });
  const purged = await f.api<{ runs: number }>(
    "POST",
    `${f.p}/retention/purge`,
    {},
  );
  assert.equal(purged.runs, 1);
  await f.api("GET", `${f.p}/runs/${unrelated.id}`, undefined, 404);
  assert.deepEqual((await f.evaluation(id)).report, cancelled.report);
  assert.ok(
    (await f.references(await f.evaluation(id))).every(
      (r) => r.status === "cancelled",
    ),
  );
  assert.deepEqual(await f.evaluation(activeId), active);
  assert.ok((await f.references(active)).every((r) => r.status === "queued"));
  await f.api("DELETE", `${f.p}/datasets/${datasetId}`, undefined, 409);
  assert.equal(f.requests(), 0);
  await evidence("queued-cancel-retention", {
    independentDiskTcp: true,
    cancelledCaseCount: 3,
    repeatCancelStable: true,
    preservedQueuedCaseCount: 3,
    purgedUnrelatedRuns: purged.runs,
    datasetStillInUse: true,
    upstreamRequests: 0,
    timestampFaultInjection:
      "only terminal runs.finished_at aged by 30 days in owned temporary database",
  });
});

test("mixed succeeded/running/queued evaluation cancels remaining cases and survives retention without resurrection", async (t) => {
  const f = await fixture(t, true, true);
  const id = await f.evaluate(await f.dataset(6));
  const row = await f.evaluation(id);
  const mixed = await poll(
    () => f.references(row),
    (runs) =>
      runs.some((r) => r.status === "succeeded") &&
      runs.some((r) => r.status === "running") &&
      runs.some((r) => r.status === "queued"),
  );
  f.ageFinished();
  const purged = await f.api<{ runs: number }>(
    "POST",
    `${f.p}/retention/purge`,
    { days: 7 },
  );
  assert.equal(purged.runs, 0);
  assert.equal((await f.references(row)).length, 6);
  await f.api("POST", `${f.p}/evaluations/${id}/cancel`, {});
  const terminal = await f.evaluation(id);
  assert.equal(terminal.status, "cancelled");
  const runs = await f.references(terminal);
  assert.equal(runs.filter((r) => r.status === "succeeded").length, 1);
  assert.equal(runs.filter((r) => r.status === "cancelled").length, 5);
  assert.ok(runs.every((r) => r.finished_at));
  const requests = f.requests();
  await delay(1200);
  assert.equal(f.requests(), requests);
  assert.deepEqual(await f.evaluation(id), terminal);
  f.ageFinished();
  assert.equal(
    (
      await f.api<{ runs: number }>("POST", `${f.p}/retention/purge`, {
        days: 7,
      })
    ).runs,
    0,
  );
  assert.deepEqual((await f.evaluation(id)).report, terminal.report);
  assert.equal((await f.references(terminal)).length, 6);
  const usage = await f.api<{ items: { status: string }[] }>(
    "GET",
    `${f.p}/usage?pageSize=100`,
  );
  assert.ok(usage.items.every((entry) => entry.status !== "reserved"));
  assert.ok(usage.items.some((entry) => entry.status === "uncertain"));
  await evidence("running-cancel-retention", {
    independentDiskTcp: true,
    beforeCancel: mixed.map((r) => r.status),
    afterCancel: runs.map((r) => r.status),
    reportCaseCount: terminal.report.cases.length,
    noResurrectionAfterWorkerTick: true,
    upstreamRequests: requests,
    retainedEvaluationRuns: 6,
    ledgerStatuses: usage.items.map((entry) => entry.status),
    boundary:
      "controlled model cancellation after dispatch correctly remains uncertain; no paid vendor called",
  });
});

test("retention removes aged trace/cache but preserves scored evaluation, dataset and referenced outputs", async (t) => {
  const f = await fixture(t, true);
  const datasetId = await f.dataset(2, true);
  const id = await f.evaluate(datasetId);
  const completed = await poll(
    () => f.evaluation(id),
    (row) => row.status === "succeeded",
  );
  assert.equal(completed.report.total, 2);
  assert.equal(completed.report.passed, 1);
  assert.equal(completed.report.passRate, 0.5);
  const before = await f.references(completed);
  assert.ok(
    before.every(
      (run) => run.status === "succeeded" && run.output === "answer",
    ),
  );
  f.ageFinished();
  const old = Date.now() - 30 * 86400000;
  for (const table of ["traces", "gateway_calls"] as const)
    f.app.services.db.run(
      `UPDATE ${table} SET created_at=? WHERE tenant_id=?`,
      old,
      f.tenantId,
    );
  f.app.services.db.run(
    "UPDATE evaluations SET finished_at=? WHERE id=?",
    old,
    id,
  );
  const snapshot = await f.evaluation(id);
  const purge = await f.api<{
    runs: number;
    traces: number;
    gateway_calls: number;
  }>("POST", `${f.p}/retention/purge`, { days: 7 });
  assert.equal(purge.runs, 0);
  assert.equal(purge.traces, 2);
  assert.equal(purge.gateway_calls, 2);
  assert.deepEqual(await f.evaluation(id), snapshot);
  assert.deepEqual(
    (await f.references(snapshot)).map((r) => r.output),
    ["answer", "answer"],
  );
  assert.equal(
    (await f.api<{ cases: unknown[] }>("GET", `${f.p}/datasets/${datasetId}`))
      .cases.length,
    2,
  );
  await f.api("DELETE", `${f.p}/datasets/${datasetId}`, undefined, 409);
  assert.equal(
    (await f.api<{ items: unknown[] }>("GET", `${f.p}/usage`)).items.length,
    2,
  );
  await evidence("scored-retention", {
    independentDiskTcp: true,
    report: completed.report,
    purge,
    retainedLedgerEntries: 2,
    datasetStillInUse: true,
    upstreamRequests: f.requests(),
    timestampFaultInjection:
      "finished runs/evaluation and traces/cache aged by 30 days only in owned temporary database",
  });
});
