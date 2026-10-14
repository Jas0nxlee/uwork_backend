import Docker from "dockerode";
import { createApp } from "../../src/app.js";
import { bootstrap } from "../../src/identity.js";
import { DockerSandboxDriver } from "../../src/sandbox/docker.js";
const socket = process.env.UWORK_SANDBOX_SOCKET!;
const app = await createApp({
  database: process.env.UWORK_SANDBOX_DATABASE!,
  masterKey: Buffer.from(process.env.MASTER_KEY!, "hex"),
  publicUrl: "http://localhost:3000",
  sandboxDriver: new DockerSandboxDriver(
    socket,
    process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
  ),
});
const { tenantId, userId } = await bootstrap(app.services.db, {
  name: "Crash verification",
  email: "owner@example.test",
  password: "controlled-password-long",
});
const login = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  payload: {
    email: "owner@example.test",
    password: "controlled-password-long",
  },
});
const headers = { authorization: `Bearer ${login.json().token}` };
const path = `/api/tenants/${tenantId}`;
const draft = (
  await app.inject({
    method: "PUT",
    url: `${path}/configurations/security`,
    headers,
    payload: { revision: 0, data: { allowSandbox: true } },
  })
).json();
await app.inject({
  method: "POST",
  url: `${path}/configurations/security/publish`,
  headers,
  payload: { revision: draft.revision },
});
const runtime = (
  await app.inject({
    method: "POST",
    url: `${path}/runtimes`,
    headers,
    payload: { name: "Crash test", ttlMinutes: 2 },
  })
).json();
const run = (
  await app.inject({
    method: "POST",
    url: `${path}/runtimes/${runtime.id}/executions`,
    headers,
    payload: { code: "while(true){}", timeoutMs: 30000 },
  })
).json();
app.services.sandbox.pump();
const docker = new Docker({ socketPath: socket });
let observed = false;
for (let i = 0; i < 100; i++) {
  const info = await docker.getContainer(runtime.containerId).inspect();
  for (const id of info.ExecIDs ?? []) {
    if ((await docker.getExec(id).inspect()).Running) observed = true;
  }
  if (observed) break;
  await new Promise((r) => setTimeout(r, 20));
}
if (!observed) throw new Error("No running Docker exec observed");
process.send?.({
  tenantId,
  userId,
  runtimeId: runtime.id,
  executionId: run.id,
  observedRunning: true,
});
