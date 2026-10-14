import assert from "node:assert/strict";
import type { agentEnvironment } from "./agent-environment.js";

export async function publishAgentConnector(
  f: Awaited<ReturnType<typeof agentEnvironment>>,
  url: string,
  toolTimeoutMs = 1000,
) {
  const credential = f.app.services.db.get<{ id: string }>(
    "SELECT id FROM credentials WHERE tenant_id=?",
    f.tenantId,
  )!.id;
  const asset = await f.app.inject({
    method: "POST",
    url: `${f.path}/assets`,
    headers: f.headers,
    payload: {
      name: "Controlled MCP",
      kind: "connector",
      scope: { all: true },
      content: {
        url: "https://controlled.example.test/mcp",
        transport: "streamable-http",
        credentialId: credential,
        allowedTools: ["multiply"],
      },
    },
  });
  assert.equal(asset.statusCode, 201, asset.body);
  const assetId = asset.json().id as string;
  // Only this controlled fixture substitutes loopback for the production HTTPS form.
  const version = f.app.services.db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=?",
    assetId,
  )!;
  const data = JSON.parse(version.data);
  data.content.url = url;
  f.app.services.db.run(
    "UPDATE resource_versions SET data=? WHERE resource_id=?",
    JSON.stringify(data),
    assetId,
  );
  for (const [action, payload] of [
    ["review", { version: 1, approved: true }],
    ["publish", { version: 1 }],
  ] as const) {
    const result = await f.app.inject({
      method: "POST",
      url: `${f.path}/assets/${assetId}/${action}`,
      headers: f.headers,
      payload,
    });
    assert.equal(result.statusCode, 200, result.body);
  }
  const agent = await f.app.inject({
    method: "POST",
    url: `${f.path}/agents`,
    headers: f.headers,
    payload: {
      name: "MCP only",
      modelId: f.modelId,
      instructions: "Use the approved multiplication tool",
      assetIds: [assetId],
      scope: { all: true },
      sandbox: false,
      maxOutputTokens: 256,
      toolTimeoutMs,
    },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  const agentId = agent.json().id as string;
  const publish = await f.app.inject({
    method: "POST",
    url: `${f.path}/agents/${agentId}/publish`,
    headers: f.headers,
    payload: { version: 1 },
  });
  assert.equal(publish.statusCode, 200, publish.body);
  await f.security(false);
  return { assetId, agentId };
}
