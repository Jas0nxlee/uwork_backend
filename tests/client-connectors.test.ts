import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";

/** 受控远端 MCP：记录代理实际发送的版本与会话，便于验证代理行为。 */
async function remote(t: TestContext) {
  const seen: {
    method: string;
    version?: string;
    session?: string;
  }[] = [];
  let negotiated = "2025-03-26";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    seen.push({
      method: body.method,
      ...(typeof req.headers["mcp-protocol-version"] === "string"
        ? { version: req.headers["mcp-protocol-version"] }
        : {}),
      ...(typeof req.headers["mcp-session-id"] === "string"
        ? { session: req.headers["mcp-session-id"] }
        : {}),
    });
    res.setHeader("content-type", "application/json");
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "initialize") {
      // 受控远端按请求版本协商，便于验证代理只在被要求时使用客户端版本。
      negotiated = body.params?.protocolVersion ?? negotiated;
      res.setHeader("mcp-session-id", "remote-session");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: negotiated,
            capabilities: { tools: {} },
            serverInfo: { name: "controlled", version: "1" },
          },
        }),
      );
      return;
    }
    if (body.method === "tools/list")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "multiply",
                description: "Multiply integers",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
        }),
      );
    else if (body.method === "tools/call")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "42" }] },
        }),
      );
    else
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "unknown" },
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  return { seen, url: `http://127.0.0.1:${port}/mcp` };
}

async function publishConnector(t: TestContext, url: string) {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const credential = f.app.services.db.get<{ id: string }>(
    "SELECT id FROM credentials WHERE tenant_id=?",
    f.tenantId,
  )!.id;
  const created = await f.app.inject({
    method: "POST",
    url: `${f.p}/assets`,
    headers: f.headers,
    payload: {
      name: "Controlled Connector",
      kind: "connector",
      scope: { all: true },
      content: {
        url: "https://controlled.example.test/mcp",
        transport: "streamable-http",
        credentialId: credential,
        description: "受控连接器",
        allowedTools: ["multiply"],
      },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  // 只有受控夹具把生产 HTTPS 形态换成 loopback。
  const version = f.app.services.db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=?",
    id,
  )!;
  const data = JSON.parse(version.data);
  data.content.url = url;
  f.app.services.db.run(
    "UPDATE resource_versions SET data=? WHERE resource_id=?",
    JSON.stringify(data),
    id,
  );
  for (const [action, payload] of [
    ["review", { version: 1, approved: true }],
    ["publish", { version: 1 }],
  ] as const) {
    const result = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets/${id}/${action}`,
      headers: f.headers,
      payload,
    });
    assert.equal(result.statusCode, 200, result.body);
  }
  return { ...f, id };
}

async function rpc(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  headers: Record<string, string>,
  id: string,
  body: Record<string, unknown>,
  session?: string,
) {
  return await app.inject({
    method: "POST",
    url: `/api/client/connectors/${id}/rpc`,
    headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
    payload: body,
  });
}

test("connector gateway masks the remote, negotiates the MCP version and releases its session", async (t) => {
  const endpoint = await remote(t);
  const f = await publishConnector(t, endpoint.url);
  const download = await f.app.inject({
    url: `/api/client/assets/${f.id}/download?version=1`,
    headers: f.headers,
  });
  assert.equal(download.statusCode, 200, download.body);
  const masked = download.json();
  assert.deepEqual(masked.content, {
    transport: "streamable-http",
    description: "受控连接器",
  });
  assert.equal(masked.gatewayUrl, `/api/client/connectors/${f.id}/rpc`);
  assert.equal(download.body.includes(endpoint.url), false);
  assert.equal(download.body.includes("credentialId"), false);

  const initialized = await rpc(f.app, f.headers, f.id, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "controlled", version: "1" },
    },
  });
  assert.equal(initialized.statusCode, 200, initialized.body);
  assert.equal(initialized.json().result.protocolVersion, "2025-06-18");
  // 代理返回自己的会话标识，远端会话只留在服务端（握手时也不外发）。
  const session = initialized.headers["mcp-session-id"] as string;
  assert.match(session, /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(endpoint.seen[0]?.session, undefined);
  // initialize 期间远端看到的是客户端请求的版本，不是代理的固定默认。
  assert.equal(endpoint.seen[0]?.version, "2025-06-18");

  const listed = await rpc(
    f.app,
    f.headers,
    f.id,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    session,
  );
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().result.tools[0].name, "multiply");
  // 后续请求回放该连接已协商的版本。
  assert.equal(endpoint.seen[1]?.version, "2025-06-18");
  assert.equal(endpoint.seen[1]?.session, "remote-session");

  const called = await rpc(
    f.app,
    f.headers,
    f.id,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "multiply", arguments: { left: 6, right: 7 } },
    },
    session,
  );
  assert.equal(called.statusCode, 200, called.body);
  const deniedTool = await rpc(
    f.app,
    f.headers,
    f.id,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "deleteEverything" },
    },
    session,
  );
  assert.equal(deniedTool.statusCode, 403, deniedTool.body);
  assert.equal(deniedTool.json().error.code, "TOOL_DENIED");

  const released = await f.app.inject({
    method: "DELETE",
    url: `/api/client/connectors/${f.id}/rpc`,
    headers: { ...f.headers, "mcp-session-id": session },
  });
  assert.equal(released.statusCode, 204, released.body);
  const afterRelease = await rpc(
    f.app,
    f.headers,
    f.id,
    { jsonrpc: "2.0", id: 5, method: "tools/list" },
    session,
  );
  assert.equal(afterRelease.statusCode, 409, afterRelease.body);
  assert.equal(afterRelease.json().error.code, "MCP_SESSION_EXPIRED");
  const missing = await f.app.inject({
    method: "DELETE",
    url: `/api/client/connectors/${f.id}/rpc`,
    headers: f.headers,
  });
  assert.equal(missing.statusCode, 400, missing.body);
});

test("a newer client version cannot silently change an established connector session", async (t) => {
  const endpoint = await remote(t);
  const f = await publishConnector(t, endpoint.url);
  const initialized = await rpc(f.app, f.headers, f.id, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "controlled", version: "1" },
    },
  });
  assert.equal(initialized.statusCode, 200, initialized.body);
  const session = initialized.headers["mcp-session-id"] as string;
  const listed = await rpc(
    f.app,
    f.headers,
    f.id,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: { protocolVersion: "2099-01-01" },
    },
    session,
  );
  assert.equal(listed.statusCode, 200, listed.body);
  // 请求体里的版本不能改写已协商连接的头部：只有该会话记录的版本生效。
  assert.equal(endpoint.seen[1]?.version, "2025-03-26");
  assert.equal(initialized.json().result.protocolVersion, "2025-03-26");
});

test("connector RPC refuses non-connector assets and expired credentials", async (t) => {
  const endpoint = await remote(t);
  const f = await publishConnector(t, endpoint.url);
  const skill = (
    await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled skill",
        kind: "skill",
        scope: { all: true },
        content: { files: [{ path: "SKILL.md", content: "# Controlled" }] },
      },
    })
  ).json().id as string;
  for (const [action, payload] of [
    ["review", { version: 1, approved: true }],
    ["publish", { version: 1 }],
  ] as const)
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.p}/assets/${skill}/${action}`,
          headers: f.headers,
          payload,
        })
      ).statusCode,
      200,
    );
  const invalid = await rpc(f.app, f.headers, skill, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {} },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json().error.code, "INVALID_CONNECTOR");
  const anonymous = await f.app.inject({
    method: "POST",
    url: `/api/client/connectors/${f.id}/rpc`,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  const device = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers: f.headers,
      payload: { ttlHours: 1 },
    })
  ).json().token as string;
  const released = await f.app.inject({
    method: "DELETE",
    url: `/api/client/connectors/${f.id}/rpc`,
    headers: {
      authorization: `Bearer ${device}`,
      "mcp-session-id": "unknown-session",
    },
  });
  // 终端凭据可以回收自己的连接器会话；未知会话不产生副作用。
  assert.equal(released.statusCode, 204, released.body);
});
