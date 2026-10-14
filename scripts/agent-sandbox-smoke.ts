import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { agentEnvironment } from "./fixtures/agent-environment.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import type { SandboxRuntimeRow } from "../src/sandbox/contract.js";
import type { Run } from "../src/agent-contract.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";

const socket =
  process.env.UWORK_SANDBOX_SOCKET ??
  "/Users/ljp/.colima/uwork-backend/docker.sock";
const driver = new DockerSandboxDriver(
    socket,
    process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
  ),
  docker = new Docker({ socketPath: socket });
assert.equal((await driver.health()).available, true);
let modelCalls = 0;
const upstream = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, "Bearer synthetic-only");
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  modelCalls++;
  assert.equal(body.tools[0].function.name, "execute_javascript");
  const user = body.messages.findLast(
    (item: { role: string }) => item.role === "user",
  ).content;
  const results = body.messages.filter(
    (item: { role: string }) => item.role === "tool",
  );
  const finished = user === "calculate" && results.length === 2;
  if (results.length === 1 && user === "calculate")
    assert.equal(JSON.parse(results[0].content).stdout.trim(), "1000");
  if (finished)
    assert.equal(JSON.parse(results[1].content).stdout.trim(), "42");
  const code =
    user !== "calculate"
      ? "while(true){}"
      : results.length === 0
        ? "import {writeFile} from 'node:fs/promises';await writeFile('/workspace/answer',String(6*7));console.log(process.getuid())"
        : "console.log(await (await import('node:fs/promises')).readFile('/workspace/answer','utf8'))";
  res.setHeader("content-type", "application/json");
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
                    id: `call_${results.length}`,
                    type: "function",
                    function: {
                      name: "execute_javascript",
                      arguments: JSON.stringify({ code }),
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
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const f = await agentEnvironment(
  {
    database: ":memory:",
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    sandboxDriver: driver,
  },
  `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
);
const row = (runId: string) =>
  f.app.services.db.get<Run>("SELECT * FROM runs WHERE id=?", runId)!;
async function runningExec(runId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const runtime = f.app.services.db.get<SandboxRuntimeRow>(
      "SELECT b.* FROM run_sandboxes s JOIN sandbox_runtimes b ON b.id=s.runtime_id WHERE s.run_id=?",
      runId,
    );
    if (runtime?.container_id) {
      const info = await docker.getContainer(runtime.container_id).inspect();
      for (const id of info.ExecIDs ?? [])
        if ((await docker.getExec(id).inspect()).Running)
          return runtime.container_id;
    }
    if (!["queued", "running"].includes(row(runId).status))
      throw new Error("Agent ended before a real exec was observed");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Agent did not start a real Docker exec");
}
async function removed(containerId: string) {
  await assert.rejects(
    () => docker.getContainer(containerId).inspect(),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404,
  );
}
try {
  const calculate = await f.enqueue("calculate");
  await f.app.services.runtime.drain();
  assert.equal(
    row(calculate).status,
    "succeeded",
    row(calculate).error_code ?? "",
  );
  assert.equal(f.app.services.runtime.decode(row(calculate)).output, "42");
  assert.equal(modelCalls, 3);
  const history = f.app.services.runtime.toolHistory(row(calculate));
  assert.equal(history.length, 2);
  assert.ok(
    history.every((tool) => tool.status === "succeeded" && tool.execution_id),
  );
  const bound = f.app.services.db.get<SandboxRuntimeRow>(
    "SELECT b.* FROM run_sandboxes s JOIN sandbox_runtimes b ON b.id=s.runtime_id WHERE s.run_id=?",
    calculate,
  )!;
  assert.equal(bound.status, "deleted");
  await removed(bound.container_id!);
  const hang = await f.enqueue("hang"),
    work = f.app.services.runtime.drain(),
    container = await runningExec(hang);
  const cancel = await f.app.inject({
    method: "POST",
    url: `${f.path}/runs/${hang}/cancel`,
    headers: f.headers,
  });
  assert.equal(cancel.statusCode, 200, cancel.body);
  await work;
  assert.equal(row(hang).status, "cancelled");
  await removed(container);
  const revoked = await f.enqueue("revoked"),
    revokedWork = f.app.services.runtime.drain(),
    revokedContainer = await runningExec(revoked);
  await f.security(false);
  f.app.services.runtime.pump();
  await revokedWork;
  assert.equal(row(revoked).error_code, "ACCESS_REVOKED");
  await removed(revokedContainer);
  await f.security(true);
  const timeout = await f.enqueue("timeout", 1500),
    timeoutWork = f.app.services.runtime.drain(),
    timeoutContainer = await runningExec(timeout);
  await timeoutWork;
  assert.equal(
    row(timeout).status,
    "timed_out",
    JSON.stringify({
      status: row(timeout).status,
      errorCode: row(timeout).error_code,
    }),
  );
  await removed(timeoutContainer);
  assert.equal(
    f.app.services.db.all(
      "SELECT id FROM sandbox_runtimes WHERE status<>'deleted'",
    ).length,
    0,
  );
  console.log(
    JSON.stringify({
      actualSdkLoop: true,
      realDockerCode: true,
      uid1000: true,
      sameWorkspaceAcrossCalls: true,
      modelTurnsBilled: true,
      cancellationStopsProcess: true,
      revocationStopsProcess: true,
      runTimeoutStopsProcess: true,
      runContainersRemoved: true,
    }),
  );
} finally {
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
}
