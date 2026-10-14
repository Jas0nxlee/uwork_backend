import Docker from "dockerode";
import { agentEnvironment } from "./agent-environment.js";
import { DockerSandboxDriver } from "../../src/sandbox/docker.js";
import type { SandboxRuntimeRow } from "../../src/sandbox/contract.js";
import { currentActor } from "../../src/access.js";

const socket = process.env.UWORK_SANDBOX_SOCKET!;
const f = await agentEnvironment(
  {
    database: process.env.UWORK_SANDBOX_DATABASE!,
    masterKey: Buffer.from(process.env.MASTER_KEY!, "hex"),
    publicUrl: "http://localhost:3000",
    sandboxDriver: new DockerSandboxDriver(
      socket,
      process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
    ),
  },
  process.env.UWORK_VERIFICATION_UPSTREAM!,
);
const runId = await f.enqueue("crash", 30000);
f.app.services.runtime.pump();
const docker = new Docker({ socketPath: socket });
for (let attempt = 0; attempt < 200; attempt++) {
  const runtime = f.app.services.db.get<SandboxRuntimeRow>(
    "SELECT b.* FROM run_sandboxes s JOIN sandbox_runtimes b ON b.id=s.runtime_id WHERE s.run_id=?",
    runId,
  );
  if (runtime?.container_id) {
    if (process.env.UWORK_AGENT_CRASH_MODE === "ready") {
      const tool = f.app.services.db.get<{ execution_id: string }>(
        "SELECT execution_id FROM run_tools WHERE run_id=? AND status='succeeded'",
        runId,
      );
      if (tool && runtime.status === "ready") {
        const result = f.app.services.sandbox.getExecution(
          currentActor(f.app.services.db, f.tenantId, f.userId),
          tool.execution_id,
        );
        if (result.stdout?.trim() !== "42")
          throw new Error("Completed code output was not observed");
        process.send?.({
          runId,
          containerId: runtime.container_id,
          runtimeId: runtime.id,
          observedReady: true,
        });
        await new Promise(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }
    const info = await docker.getContainer(runtime.container_id).inspect();
    for (const execution of info.ExecIDs ?? [])
      if ((await docker.getExec(execution).inspect()).Running) {
        process.send?.({
          tenantId: f.tenantId,
          userId: f.userId,
          runId,
          containerId: runtime.container_id,
          runtimeId: runtime.id,
          observedRunning: true,
        });
        await new Promise(() => {});
      }
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}
throw new Error("Agent did not reach a running Docker exec");
