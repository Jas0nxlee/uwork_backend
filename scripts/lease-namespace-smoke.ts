import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
const exec = promisify(execFile);
await mkdir(resolve("evidence"), { recursive: true, mode: 0o700 });
const dir = await mkdtemp(resolve("evidence/lease-namespace-"));
const database = join(dir, "state.sqlite"),
  key = randomBytes(32);
const app = await createApp({
  database,
  masterKey: key,
  publicUrl: "http://localhost:3000",
});
try {
  const b = await bootstrap(app.services.db, {
    name: "Namespace verification",
    email: "owner@example.test",
    password: "controlled-password-long",
  });
  app.services.db.run(
    "INSERT INTO runs(id,tenant_id,user_id,session_id,agent_id,agent_version,status,input,timeout_ms,created_at) VALUES(?,?,?,?,?,1,'running',?,1000,?)",
    "namespace-marker",
    b.tenantId,
    b.userId,
    "session",
    "agent",
    "controlled",
    Date.now(),
  );
  const code = `import {createApp} from './dist/app.js';try{const app=await createApp({database:'/verification/state.sqlite',masterKey:Buffer.from(process.env.MASTER_KEY,'hex'),publicUrl:'http://localhost:3000'});console.log('ACQUIRED');await app.close();}catch(error){if(error.message.includes('namespace'))console.log('BLOCKED_NAMESPACE');else{console.log('OTHER_FAILURE');process.exitCode=1;}}`;
  const output = await exec(
    "docker",
    [
      "--context",
      process.env.UWORK_DOCKER_CONTEXT ?? "colima-uwork-backend",
      "run",
      "--rm",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      "--env",
      "MASTER_KEY",
      "--mount",
      `type=bind,source=${dir},target=/verification`,
      process.env.UWORK_DOCKER_IMAGE ?? "uwork-backend:local",
      "node",
      "--input-type=module",
      "-e",
      code,
    ],
    {
      env: { ...process.env, MASTER_KEY: key.toString("hex") },
      maxBuffer: 1024 * 1024,
    },
  );
  const protectedRun =
    app.services.db.get<{ status: string }>(
      "SELECT status FROM runs WHERE id='namespace-marker'",
    )!.status === "running";
  assert.ok(
    output.stdout.includes("BLOCKED_NAMESPACE") && protectedRun,
    JSON.stringify({
      crossNamespaceRejected: output.stdout.includes("BLOCKED_NAMESPACE"),
      originalRunUnchanged: protectedRun,
    }),
  );
  console.log(
    JSON.stringify({
      crossNamespaceRejected: true,
      originalRunUnchanged: true,
    }),
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
