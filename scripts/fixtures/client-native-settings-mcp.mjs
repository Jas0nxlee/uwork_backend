import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const evidence = resolve(
  "evidence/client-native-settings-live-20261017/mcp-peer.json",
);
const methods = [];
let calls = 0;
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(405).end();
    return;
  }
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString();
      if (raw.length > 1024 * 1024) throw Error("Owned frame too large");
    }
    const frame = JSON.parse(raw);
    methods.push(frame.method);
    if (frame.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result = {};
    if (frame.method === "initialize")
      result = {
        protocolVersion: frame.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "owned-native-settings", version: "1" },
      };
    if (frame.method === "tools/list")
      result = {
        tools: [
          {
            name: "mark",
            description: "Return a harmless owned marker",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    if (frame.method === "tools/call") {
      calls++;
      result = { content: [{ type: "text", text: "OWNED_NATIVE_MCP_MARKER" }] };
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
  } catch {
    res.writeHead(400).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
let closing = false;
const save = () =>
  writeFile(
    evidence,
    JSON.stringify({ methods, calls, port, pid: process.pid }, null, 2),
    {
      mode: 0o600,
    },
  );
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await save();
  console.log(
    JSON.stringify({ event: "closed", port, listening: server.listening }),
  );
  process.exit(0);
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (line === "status") {
    void save().then(() =>
      console.log(JSON.stringify({ methods, calls, port })),
    );
  } else if (line === "close") void close();
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void close());
console.log(JSON.stringify({ event: "ready", port, pid: process.pid }));
