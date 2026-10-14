import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";
test("vision and reasoning are opt-in and only bounded embedded image data is accepted", async (t) => {
  let calls = 0;
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      calls++;
      const body = JSON.parse(text);
      assert.equal(body.reasoning_effort, "high");
      assert.equal(body.messages[0].content[0].type, "image_url");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "image-result" } }],
          usage: { prompt_tokens: 20, completion_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = await fixture(
    t,
    `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
  );
  const payload = {
    model: f.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGVsbG8=" },
          },
        ],
      },
    ],
    reasoning_effort: "high",
  };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: f.headers,
        payload,
      })
    ).statusCode,
    400,
  );
  const model = (
    await f.app.inject({ url: `${f.p}/models`, headers: f.headers })
  ).json()[0];
  await f.app.inject({
    method: "PUT",
    url: `${f.p}/models/${f.model}`,
    headers: f.headers,
    payload: {
      name: model.name,
      ...model.data,
      scope: model.scope,
      enabled: model.enabled,
      revision: model.revision,
      supportsVision: true,
      supportsReasoning: true,
    },
  });
  const success = await f.app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: f.headers,
    payload,
  });
  assert.equal(success.statusCode, 200, success.body);
  assert.equal(calls, 1);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: f.headers,
        payload: {
          ...payload,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "http://127.0.0.1/private" },
                },
              ],
            },
          ],
        },
      })
    ).statusCode,
    400,
  );
});
