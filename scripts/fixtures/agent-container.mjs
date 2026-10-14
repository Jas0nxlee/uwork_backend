import assert from "node:assert/strict";
import { createServer } from "node:http";
import Docker from "dockerode";
import { createApp } from "/app/dist/app.js";
import { bootstrap } from "/app/dist/identity.js";

assert.equal(process.getuid(), 1000);
const socket = "/run/uwork-sandbox.sock";
const docker = new Docker({ socketPath: socket });
assert.equal((await docker.info()).ID, process.env.UWORK_EXPECTED_ENGINE_ID);
let modelCalls = 0;
const upstream = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, "Bearer synthetic-only");
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text),
    done = body.messages.at(-1).role === "tool";
  modelCalls++;
  if (done) {
    const output = JSON.parse(JSON.parse(body.messages.at(-1).content).stdout);
    assert.deepEqual(output, {
      answer: 42,
      uid: 1000,
      backendKey: false,
      backendSocket: false,
    });
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: done
            ? { content: "42" }
            : {
                content: null,
                tool_calls: [
                  {
                    id: "call_container",
                    type: "function",
                    function: {
                      name: "execute_javascript",
                      arguments: JSON.stringify({
                        code: "import fs from 'node:fs';console.log(JSON.stringify({answer:6*7,uid:process.getuid(),backendKey:!!process.env.MASTER_KEY,backendSocket:fs.existsSync('/run/uwork-sandbox.sock')}))",
                      }),
                    },
                  },
                ],
              },
          finish_reason: done ? "stop" : "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
  );
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const app = await createApp({
  database: ":memory:",
  masterKey: Buffer.from(process.env.MASTER_KEY, "hex"),
  publicUrl: "http://localhost:3000",
  allowPrivateUpstreams: true,
  sandboxSocket: socket,
  sandboxImage: process.env.UWORK_SANDBOX_IMAGE,
});
try {
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Packaged Agent",
    email: "owner@example.test",
    password: "controlled-password-long",
  });
  console.log(JSON.stringify({ type: "tenant", tenantId }));
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "owner@example.test",
      password: "controlled-password-long",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = { authorization: `Bearer ${login.json().token}` },
    path = `/api/tenants/${tenantId}`;
  const credential = await app.inject({
    method: "POST",
    url: `${path}/credentials`,
    headers,
    payload: { name: "Synthetic", value: "synthetic-only" },
  });
  assert.equal(credential.statusCode, 201);
  const model = await app.inject({
    method: "POST",
    url: `${path}/models`,
    headers,
    payload: {
      name: "Controlled",
      upstreamModel: "controlled",
      baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      credentialId: credential.json().id,
      scope: { all: true },
      supportsTools: true,
      maxOutputTokens: 128,
    },
  });
  assert.equal(model.statusCode, 201, model.body);
  const agent = await app.inject({
    method: "POST",
    url: `${path}/agents`,
    headers,
    payload: {
      name: "Packaged Agent",
      modelId: model.json().id,
      instructions: "Compute using isolated code",
      scope: { all: true },
      sandbox: true,
      maxTurns: 3,
      maxToolCalls: 1,
      toolTimeoutMs: 3000,
      maxOutputTokens: 128,
    },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${path}/agents/${agent.json().id}/publish`,
        headers,
        payload: { version: 1 },
      })
    ).statusCode,
    200,
  );
  const draft = await app.inject({
    method: "PUT",
    url: `${path}/configurations/security`,
    headers,
    payload: { revision: 0, data: { allowSandbox: true } },
  });
  assert.equal(draft.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${path}/configurations/security/publish`,
        headers,
        payload: { revision: draft.json().revision },
      })
    ).statusCode,
    200,
  );
  const accepted = await app.inject({
    method: "POST",
    url: `${path}/runs`,
    headers,
    payload: { agentId: agent.json().id, input: "Calculate", timeoutMs: 10000 },
  });
  assert.equal(accepted.statusCode, 202);
  await app.services.runtime.drain();
  const run = (
    await app.inject({ url: `${path}/runs/${accepted.json().id}`, headers })
  ).json();
  assert.equal(run.status, "succeeded", run.error_code ?? "");
  assert.equal(run.output, "42");
  assert.equal(modelCalls, 2);
  const history = app.services.runtime.toolHistory(run);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "succeeded");
  assert.equal(
    app.services.db.all("SELECT id FROM ledger WHERE status='settled'").length,
    2,
  );
  const runtime = app.services.db.get(
    "SELECT b.* FROM run_sandboxes s JOIN sandbox_runtimes b ON b.id=s.runtime_id WHERE s.run_id=?",
    run.id,
  );
  assert.equal(runtime.status, "deleted");
  await assert.rejects(
    () => docker.getContainer(runtime.container_id).inspect(),
    (error) => error.statusCode === 404,
  );
  console.log(
    JSON.stringify({
      type: "result",
      packagedSdkLoop: true,
      backendUid1000: true,
      sandboxUid1000: true,
      noBackendSecretsOrSocket: true,
      modelCalls: 2,
      codeExecutions: 1,
      cleaned: true,
    }),
  );
} finally {
  await app.services.runtime.stop();
  const cleanup = await Promise.allSettled(
    app.services.db
      .all("SELECT run_id FROM run_sandboxes")
      .map((row) => app.services.sandbox.releaseRun(row.run_id)),
  );
  await app.close();
  upstream.closeAllConnections();
  upstream.close();
  assert.ok(
    cleanup.every((result) => result.status === "fulfilled"),
    "Packaged Agent cleanup was not confirmed",
  );
}
