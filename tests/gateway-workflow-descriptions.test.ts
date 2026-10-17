import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fixture } from "./fixtures.js";

test("gateway accepts bounded formal workflow descriptions and rejects oversize before dispatch or billing", async (t) => {
  const received: number[] = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push(body.tools[0].function.description.length);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "controlled" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  const f = await fixture(
    t,
    `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
  );
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const model = (
    await f.app.inject({ url: `${f.p}/models`, headers: f.headers })
  ).json()[0];
  const updated = await f.app.inject({
    method: "PUT",
    url: `${f.p}/models/${f.model}`,
    headers: f.headers,
    payload: {
      ...model.data,
      name: model.name,
      scope: model.scope,
      revision: model.revision,
      contextWindow: 1000000,
      supportsTools: true,
    },
  });
  assert.equal(updated.statusCode, 200);
  for (const [length, status] of [
    [30137, 200],
    [23062, 200],
    [65536, 200],
    [65537, 400],
  ]) {
    const response = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        ...f.headers,
        "content-type": "application/json",
        "idempotency-key": `description-contract-${length}`,
      },
      body: JSON.stringify({
        model: f.model,
        messages: [{ role: "user", content: "controlled" }],
        max_tokens: 8,
        tools: [
          {
            type: "function",
            function: {
              name: "CreateWorkflow",
              description: "x".repeat(length!),
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
    });
    const body = await response.json();
    assert.equal(response.status, status, `description length ${length}`);
    if (status === 400) assert.equal(body.error.code, "VALIDATION");
  }
  assert.deepEqual(received, [30137, 23062, 65536]);
  const usage = await f.app.inject({ url: `${f.p}/usage`, headers: f.headers });
  assert.equal(usage.json().items.length, 3);
  assert.ok(
    usage
      .json()
      .items.every((row: { status: string }) => row.status === "settled"),
  );
});
