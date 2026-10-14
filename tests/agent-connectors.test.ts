import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { agentEnvironment } from "../scripts/fixtures/agent-environment.js";
import { publishAgentConnector } from "../scripts/fixtures/agent-connector.js";
import type { Run } from "../src/agent-contract.js";

async function environment(t: TestContext, mode = "normal") {
  let calls = 0,
    models = 0,
    toolName = "",
    cancelNotices = 0;
  let entered!: () => void;
  const dispatched = new Promise<void>((resolve) => (entered = resolve));
  let beforeModelReply: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    if (req.url === "/mcp") {
      assert.equal(req.headers.authorization, "Bearer synthetic-only");
      if (body.method !== "initialize")
        assert.equal(req.headers["mcp-session-id"], "remote-private-session");
      if (body.id === undefined) {
        if (body.method === "notifications/cancelled") cancelNotices++;
        res.writeHead(202).end();
        return;
      }
      if (body.method === "initialize") {
        res.setHeader("mcp-session-id", "remote-private-session");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "controlled", version: "1" },
            },
            ...(mode === "top-level-secrets"
              ? {
                  debugToken: "synthetic-only",
                  debugSession: "remote-private-session",
                  "synthetic-only": "remote-private-session",
                }
              : {}),
          }),
        );
      } else if (body.method === "tools/list") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "multiply",
                  description: "Multiply integers",
                  inputSchema: {
                    type: "object",
                    properties: {
                      left:
                        mode === "unsafe-schema"
                          ? { type: "string", pattern: "(a+)+$" }
                          : { type: "integer" },
                      right: { type: "integer" },
                    },
                    required: ["left", "right"],
                    additionalProperties: false,
                  },
                },
                { name: "delete_everything", inputSchema: { type: "object" } },
              ],
            },
          }),
        );
      } else if (body.method === "tools/call") {
        assert.equal(body.params.name, "multiply");
        calls++;
        entered();
        if (mode === "hang") return;
        if (mode === "disconnect") {
          req.socket.destroy();
          return;
        }
        const result = {
          content: [
            {
              type: "text",
              text:
                String(
                  body.params.arguments.left * body.params.arguments.right,
                ) +
                (mode === "echo-secrets"
                  ? " synthetic-only remote-private-session"
                  : ""),
            },
          ],
        };
        res.setHeader("content-type", "text/event-stream");
        res.end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`,
        );
      } else res.writeHead(400).end();
      return;
    }
    models++;
    assert.equal(
      body.tools.length,
      1,
      "unapproved tools and disabled sandbox must not be exposed",
    );
    toolName = body.tools[0].function.name;
    assert.match(toolName, /^mcp_[a-f0-9]+$/);
    assert.ok(!raw.includes("remote-private-session"));
    assert.ok(!raw.includes("synthetic-only"));
    beforeModelReply?.();
    const last = body.messages.at(-1);
    const finished = last.role === "tool" && (mode !== "repeat" || models >= 3);
    if (last.role === "tool") assert.ok(last.content.includes("42"));
    res.end(
      JSON.stringify({
        choices: [
          {
            message: finished
              ? { content: "42" }
              : {
                  content: null,
                  tool_calls: [
                    {
                      id: "mcp_call",
                      type: "function",
                      function: {
                        name: toolName,
                        arguments:
                          mode === "invalid"
                            ? '{"left":"six","right":7}'
                            : '{"left":6,"right":7}',
                      },
                    },
                  ],
                },
            finish_reason: finished ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const f = await agentEnvironment(
    {
      database: ":memory:",
      masterKey: Buffer.alloc(32, 7),
      publicUrl: "http://localhost:3000",
      worker: false,
    },
    `${base}/v1`,
  );
  t.after(() => f.app.close());
  const { assetId, agentId } = await publishAgentConnector(f, `${base}/mcp`);
  const enqueue = async () => {
    const result = await f.app.inject({
      method: "POST",
      url: `${f.path}/runs`,
      headers: f.headers,
      payload: {
        agentId,
        input: "multiply",
        timeoutMs: 10000,
      },
    });
    assert.equal(result.statusCode, 202, result.body);
    f.app.services.runtime.pump();
    return result.json().id as string;
  };
  const done = async (runId: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const run = f.app.services.db.get<Run>(
        "SELECT * FROM runs WHERE id=?",
        runId,
      )!;
      if (!["queued", "running"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Controlled MCP run did not terminate");
  };
  return {
    ...f,
    enqueue,
    done,
    dispatched,
    assetId,
    counts: () => ({ calls, models, cancelNotices }),
    beforeReply: (fn: () => void) => (beforeModelReply = fn),
  };
}

test("an MCP-only Agent filters tools, preserves masked sessions, bills every model turn and never repeats a successful call", async (t) => {
  const f = await environment(t, "repeat"),
    runId = await f.enqueue(),
    run = await f.done(runId);
  assert.equal(run.status, "succeeded", JSON.stringify(run));
  assert.equal(f.app.services.runtime.decode(run).output, "42");
  assert.equal(f.counts().calls, 1);
  assert.equal(f.counts().models, 3);
  assert.equal(
    f.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM ledger WHERE status='settled'",
    )!.n,
    3,
  );
  const tools = f.app.services.runtime.toolHistory(run);
  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.status, "succeeded");
  assert.equal(tools[0]!.kind, "mcp");
  assert.equal(tools[0]!.dispatched, 1);
  assert.equal(
    f.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM sandbox_runtimes",
    )!.n,
    0,
  );
  assert.equal(
    f.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM connector_sessions",
    )!.n,
    0,
  );
});

test("MCP input schemas reject invalid model arguments before remote dispatch", async (t) => {
  const f = await environment(t, "invalid"),
    runId = await f.enqueue(),
    run = await f.done(runId);
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "MCP_ARGUMENTS_INVALID");
  assert.equal(f.counts().calls, 0);
});

test("remote schemas cannot introduce unbounded regex validation into the backend event loop", async (t) => {
  const f = await environment(t, "unsafe-schema"),
    run = await f.done(await f.enqueue());
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "MCP_TOOL_SCHEMA");
  assert.equal(f.counts().calls, 0);
  assert.equal(f.counts().models, 0);
});

test("a connector disabled during model generation prevents remote tool dispatch", async (t) => {
  const f = await environment(t);
  f.beforeReply(() =>
    f.app.services.db.run(
      "UPDATE resources SET enabled=0 WHERE id=?",
      f.assetId,
    ),
  );
  const run = await f.done(await f.enqueue());
  assert.equal(run.status, "failed");
  assert.equal(f.counts().calls, 0);
});

test("cancellation after MCP dispatch preserves uncertain side effects instead of claiming confirmed cancellation", async (t) => {
  const f = await environment(t, "hang"),
    runId = await f.enqueue();
  await Promise.race([
    f.dispatched,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("MCP dispatch not observed")),
        3000,
      ).unref(),
    ),
  ]);
  const cancelled = await f.app.inject({
    method: "POST",
    url: `${f.path}/runs/${runId}/cancel`,
    headers: f.headers,
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const run = await f.done(runId);
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "REMOTE_EFFECT_UNCONFIRMED");
  const tools = f.app.services.runtime.toolHistory(run);
  assert.equal(tools[0]!.status, "uncertain");
  assert.equal(tools[0]!.error_code, "REMOTE_EFFECT_UNCONFIRMED");
  assert.equal(f.counts().calls, 1);
});

test("MCP Agents obey the agent channel while a disabled local channel still blocks the UWork proxy", async (t) => {
  const f = await environment(t);
  const old = (
    await f.app.inject({
      url: `${f.path}/configurations/assistants`,
      headers: f.headers,
    })
  ).json();
  const draft = await f.app.inject({
    method: "PUT",
    url: `${f.path}/configurations/assistants`,
    headers: f.headers,
    payload: {
      revision: old.revision,
      data: { ...old.published, local: false, agents: true },
    },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `${f.path}/configurations/assistants/publish`,
        headers: f.headers,
        payload: { revision: draft.json().revision },
      })
    ).statusCode,
    200,
  );
  const proxy = await f.app.inject({
    method: "POST",
    url: `/api/client/connectors/${f.assetId}/rpc`,
    headers: f.headers,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  assert.equal(proxy.statusCode, 403, proxy.body);
  assert.equal((await f.done(await f.enqueue())).status, "succeeded");
});

test("connector reauthorization cannot promote a device credential without execute scope", async (t) => {
  const f = await environment(t);
  f.app.services.db.run(
    "UPDATE sessions SET kind='device',scopes='[]' WHERE tenant_id=? AND user_id=?",
    f.tenantId,
    f.userId,
  );
  const result = await f.app.inject({
    method: "POST",
    url: `/api/client/connectors/${f.assetId}/rpc`,
    headers: f.headers,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  assert.equal(result.statusCode, 403, result.body);
});

test("connector publication changes cannot redirect a frozen Agent tool binding", async (t) => {
  const f = await environment(t);
  f.beforeReply(() => {
    f.app.services.db.run(
      "INSERT INTO resource_versions SELECT resource_id,2,data,approved,created_at FROM resource_versions WHERE resource_id=? AND version=1",
      f.assetId,
    );
    f.app.services.db.run(
      "UPDATE resources SET published_version=2 WHERE id=?",
      f.assetId,
    );
  });
  const run = await f.done(await f.enqueue());
  assert.equal(run.error_code, "CONNECTOR_VERSION_CHANGED");
  assert.equal(f.counts().calls, 0);
});

test("subscription expiry during model generation prevents remote MCP dispatch", async (t) => {
  const f = await environment(t);
  f.beforeReply(() =>
    f.app.services.db.run(
      "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
      Date.now() - 1,
      f.tenantId,
    ),
  );
  const run = await f.done(await f.enqueue());
  assert.equal(run.error_code, "SUBSCRIPTION_INACTIVE");
  assert.equal(f.counts().calls, 0);
});

test("even an MCP server echoing its credential and session cannot forward them into model context or tool history", async (t) => {
  const f = await environment(t, "echo-secrets"),
    run = await f.done(await f.enqueue());
  assert.equal(run.status, "succeeded");
  const result = f.app.services.runtime.toolHistory(run)[0]!.result!;
  assert.ok(result.includes("[REDACTED]"));
  assert.ok(!result.includes("synthetic-only"));
  assert.ok(!result.includes("remote-private-session"));
});

test("non-protocol MCP response extensions cannot leak credentials or remote session identities through the proxy", async (t) => {
  const f = await environment(t, "top-level-secrets");
  const result = await f.app.inject({
    method: "POST",
    url: `/api/client/connectors/${f.assetId}/rpc`,
    headers: f.headers,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.ok(!result.body.includes("synthetic-only"));
  assert.ok(!result.body.includes("remote-private-session"));
  assert.deepEqual(Object.keys(result.json()).sort(), [
    "id",
    "jsonrpc",
    "result",
  ]);
});

for (const mode of ["hang", "disconnect"]) {
  test(`an MCP ${mode === "hang" ? "tool deadline" : "connection loss"} retains uncertainty without replay`, async (t) => {
    const f = await environment(t, mode),
      run = await f.done(await f.enqueue());
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "REMOTE_EFFECT_UNCONFIRMED");
    assert.equal(
      f.app.services.runtime.toolHistory(run)[0]!.status,
      "uncertain",
    );
    assert.equal(f.counts().calls, 1);
    assert.equal(f.counts().models, 1);
  });
}
