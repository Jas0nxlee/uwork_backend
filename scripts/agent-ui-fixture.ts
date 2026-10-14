import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { agentEnvironment } from "./fixtures/agent-environment.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import type { SandboxRuntimeRow } from "../src/sandbox/contract.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";

const port = Number(process.env.UWORK_VERIFICATION_PORT ?? 3002),
  origin = `http://uwork-verification.localhost:${port}`;
const upstream = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text),
    done = body.messages.at(-1).role === "tool";
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: done
            ? { content: "42 (UID 1000)" }
            : {
                content: null,
                tool_calls: [
                  {
                    id: "call_ui",
                    type: "function",
                    function: {
                      name: "execute_javascript",
                      arguments: JSON.stringify({
                        code: "console.log(JSON.stringify({result:6*7,uid:process.getuid()}))",
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
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const driver = new DockerSandboxDriver(
  process.env.UWORK_SANDBOX_SOCKET ??
    "/Users/ljp/.colima/uwork-backend/docker.sock",
  process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
);
const f = await agentEnvironment(
  {
    database: ":memory:",
    masterKey: randomBytes(32),
    publicUrl: origin,
    sandboxDriver: driver,
    worker: true,
  },
  `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await f.app.services.runtime.stop();
  const owners = f.app.services.db
    .all<SandboxRuntimeRow>("SELECT * FROM sandbox_runtimes")
    .map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ownerToken: row.owner_token,
      expiresAt: row.expires_at,
    }));
  await f.app.close();
  upstream.closeAllConnections();
  upstream.close();
  await cleanupSandboxes(driver, owners);
};
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
try {
  await f.app.listen({ host: "127.0.0.1", port });
  console.log(
    JSON.stringify({
      url: origin,
      modelId: f.modelId,
      agentId: f.agentId,
      controlledVerification: true,
    }),
  );
} catch (error) {
  await close();
  throw error;
}
