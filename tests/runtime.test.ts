import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { nextOccurrence } from "../src/automation.js";

test("published agent performs HTTP model run, cancellation is terminal and evaluation reports scores", async (t) => {
  const upstream = createServer((req, res) => {
    let content = "";
    req.on("data", (c) => (content += c));
    req.on("end", () => {
      const body = JSON.parse(content);
      if (body.messages.some((m: { content: string }) => m.content === "hang"))
        return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "answer" } }],
          usage: { prompt_tokens: 12, completion_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 6),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Test",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const p = `/api/tenants/${tenantId}`;
  const c = await app.inject({
    method: "POST",
    url: `${p}/credentials`,
    headers,
    payload: { name: "test", value: "test" },
  });
  const model = await app.inject({
    method: "POST",
    url: `${p}/models`,
    headers,
    payload: {
      name: "Test",
      upstreamModel: "test",
      baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
      credentialId: c.json().id,
      scope: { all: true },
    },
  });
  const agent = await app.inject({
    method: "POST",
    url: `${p}/agents`,
    headers,
    payload: {
      name: "Test Agent",
      modelId: model.json().id,
      instructions: "Be precise",
      assetIds: [],
      scope: { all: true },
      maxOutputTokens: 128,
    },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  const aid = agent.json().id;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/agents/${aid}/publish`,
        headers,
        payload: { version: 1 },
      })
    ).statusCode,
    200,
  );
  const run = await app.inject({
    method: "POST",
    url: `${p}/runs`,
    headers,
    payload: { agentId: aid, input: "hello", timeoutMs: 1000 },
  });
  assert.equal(run.statusCode, 202, run.body);
  await app.services.runtime.drain();
  const completed = (
    await app.inject({ url: `${p}/runs/${run.json().id}`, headers })
  ).json();
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.equal(completed.output, "answer");
  const hanging = await app.inject({
    method: "POST",
    url: `${p}/runs`,
    headers,
    payload: { agentId: aid, input: "hang", timeoutMs: 1000 },
  });
  const work = app.services.runtime.drain();
  await new Promise((r) => setTimeout(r, 30));
  await app.inject({
    method: "POST",
    url: `${p}/runs/${hanging.json().id}/cancel`,
    headers,
  });
  await work;
  assert.equal(
    (
      await app.inject({ url: `${p}/runs/${hanging.json().id}`, headers })
    ).json().status,
    "cancelled",
  );
  const timed = await app.inject({
    method: "POST",
    url: `${p}/runs`,
    headers,
    payload: { agentId: aid, input: "hang", timeoutMs: 100 },
  });
  await app.services.runtime.drain();
  assert.equal(
    (await app.inject({ url: `${p}/runs/${timed.json().id}`, headers })).json()
      .status,
    "timed_out",
  );
  const dataset = await app.inject({
    method: "POST",
    url: `${p}/datasets`,
    headers,
    payload: {
      name: "Dataset",
      cases: [{ input: "hello", expected: "answer", match: "exact" }],
    },
  });
  assert.equal(dataset.statusCode, 201, dataset.body);
  const evaluation = await app.inject({
    method: "POST",
    url: `${p}/evaluations`,
    headers,
    payload: { agentId: aid, datasetId: dataset.json().id },
  });
  assert.equal(evaluation.statusCode, 202, evaluation.body);
  await app.services.evaluation.drain();
  const report = (
    await app.inject({
      url: `${p}/evaluations/${evaluation.json().id}`,
      headers,
    })
  ).json();
  assert.equal(report.status, "succeeded", JSON.stringify(report));
  assert.equal(report.report.passRate, 1);
});

test("cron timezone and interval schedules have explicit future occurrences", () => {
  assert.equal(
    nextOccurrence(
      { type: "cron", expression: "0 0 9 * * *" },
      "Asia/Shanghai",
      Date.UTC(2026, 9, 14, 0),
    ),
    Date.UTC(2026, 9, 14, 1),
  );
  assert.equal(
    nextOccurrence({ type: "interval", seconds: 60 }, "UTC", 1000),
    61000,
  );
  assert.equal(nextOccurrence({ type: "once", at: 1000 }, "UTC", 1001), null);
});
