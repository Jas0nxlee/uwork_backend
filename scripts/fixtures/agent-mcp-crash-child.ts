import { agentEnvironment } from "./agent-environment.js";
import { publishAgentConnector } from "./agent-connector.js";

const base = process.env.UWORK_CONTROLLED_BASE!;
const f = await agentEnvironment(
  {
    database: process.env.UWORK_CONTROLLED_DB!,
    masterKey: Buffer.alloc(32, 7),
    publicUrl: "http://localhost:3000",
    worker: true,
  },
  `${base}/v1`,
);
const { agentId } = await publishAgentConnector(f, `${base}/mcp`, 60000);
const response = await f.app.inject({
  method: "POST",
  url: `${f.path}/runs`,
  headers: f.headers,
  payload: { agentId, input: "multiply", timeoutMs: 60000 },
});
if (response.statusCode !== 202)
  throw new Error("Controlled MCP run was rejected");
process.send?.({ runId: response.json().id });
f.app.services.runtime.pump();
