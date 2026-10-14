import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import { currentActor } from "../src/access.js";
import type { SandboxRuntimeRow } from "../src/sandbox/contract.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";

const driver = new DockerSandboxDriver(
  process.env.UWORK_SANDBOX_SOCKET ??
    "/Users/ljp/.colima/uwork-backend/docker.sock",
  process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
);
assert.equal((await driver.health()).available, true);
const app = await createApp({
  database: ":memory:",
  masterKey: randomBytes(32),
  publicUrl: "http://localhost:3000",
  sandboxDriver: driver,
});
const { tenantId, userId } = await bootstrap(app.services.db, {
  name: "Sandbox verification",
  email: "owner@example.test",
  password: "controlled-password-long",
});
const foreign = await bootstrap(app.services.db, {
  name: "Other",
  email: "other@example.test",
  password: "controlled-password-long",
});
const login = async (email: string) => {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "controlled-password-long" },
  });
  assert.equal(r.statusCode, 200);
  return { authorization: `Bearer ${r.json().token}` };
};
const headers = await login("owner@example.test"),
  otherHeaders = await login("other@example.test");
const path = `/api/tenants/${tenantId}`,
  resources: string[] = [];
const create = async () => {
  const r = await app.inject({
    method: "POST",
    url: `${path}/runtimes`,
    headers,
    payload: {
      name: "Controlled runtime",
      scope: { all: true },
      ttlMinutes: 2,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.ok(!r.body.includes("owner_token"));
  resources.push(r.json().id);
  return r.json().id as string;
};
const execute = async (runtimeId: string, code: string, timeoutMs = 2000) => {
  const r = await app.inject({
    method: "POST",
    url: `${path}/runtimes/${runtimeId}/executions`,
    headers,
    payload: { code, timeoutMs },
  });
  assert.equal(r.statusCode, 202, r.body);
  await app.services.sandbox.drain();
  return (
    await app.inject({
      url: `${path}/sandbox-executions/${r.json().id}`,
      headers,
    })
  ).json();
};
try {
  assert.equal(
    (await app.inject({ url: `${path}/integrations`, headers })).json()
      .capabilities.cloudSandbox,
    "isolated-docker",
  );
  const runtime = await create();
  assert.equal(
    (
      await app.inject({
        url: `${path}/runtimes/${runtime}`,
        headers: otherHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/tenants/${foreign.tenantId}/runtimes/${runtime}`,
        headers: otherHeaders,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${path}/runtimes/${runtime}/executions`,
        headers,
        payload: { code: "console.log(42)" },
      })
    ).statusCode,
    403,
  );
  const config = (
    await app.inject({
      method: "PUT",
      url: `${path}/configurations/security`,
      headers,
      payload: {
        revision: 0,
        data: {
          allowShell: false,
          allowFilesystem: false,
          allowNetwork: false,
          dangerousSkills: false,
          allowedDomains: [],
          allowSandbox: true,
        },
      },
    })
  ).json();
  await app.inject({
    method: "POST",
    url: `${path}/configurations/security/publish`,
    headers,
    payload: { revision: config.revision },
  });
  const output = await execute(
    runtime,
    "console.log(JSON.stringify({uid:process.getuid(),noKey:!process.env.MASTER_KEY}))",
  );
  assert.equal(output.status, "succeeded");
  assert.deepEqual(JSON.parse(output.stdout), { uid: 1000, noKey: true });
  assert.ok(
    !app.services.db
      .get<{
        code: string;
      }>("SELECT code FROM sandbox_executions WHERE id=?", output.id)!
      .code.includes("console.log"),
  );
  const silent = await execute(
    runtime,
    "await new Promise(r=>setTimeout(r,16000));console.log('silent-long-run')",
    20000,
  );
  assert.equal(
    silent.status,
    "succeeded",
    JSON.stringify({ status: silent.status, error: silent.error_code }),
  );
  assert.equal(silent.stdout.trim(), "silent-long-run");
  const pending = (
    await app.inject({
      method: "POST",
      url: `${path}/runtimes/${runtime}/executions`,
      headers,
      payload: { code: "while(true){}", timeoutMs: 10000 },
    })
  ).json().id;
  const work = app.services.sandbox.drain();
  await new Promise((r) => setTimeout(r, 100));
  const update = await app.inject({
    method: "PATCH",
    url: `${path}/runtimes/${runtime}`,
    headers,
    payload: { name: "Revoked runtime", scope: { all: false }, revision: 1 },
  });
  assert.equal(update.statusCode, 200, update.body);
  await work;
  const revoked = (
    await app.inject({ url: `${path}/sandbox-executions/${pending}`, headers })
  ).json();
  assert.equal(revoked.status, "cancelled");
  assert.equal(revoked.error_code, "ACCESS_REVOKED");
  const timed = await create();
  const timedResult = await execute(timed, "while(true){}", 100);
  assert.equal(timedResult.status, "timed_out");
  assert.equal(
    (await app.inject({ url: `${path}/runtimes/${timed}`, headers })).json()
      .status,
    "stopped",
  );
  const cancelRuntime = await create();
  const accepted = (
    await app.inject({
      method: "POST",
      url: `${path}/runtimes/${cancelRuntime}/executions`,
      headers,
      payload: { code: "while(true){}", timeoutMs: 10000 },
    })
  ).json().id;
  const cancelWork = app.services.sandbox.drain();
  await new Promise((r) => setTimeout(r, 50));
  const cancelled = await app.inject({
    method: "POST",
    url: `${path}/sandbox-executions/${accepted}/cancel`,
    headers,
  });
  assert.equal(cancelled.json().status, "cancelled");
  await cancelWork;
  const excessive = await create();
  const large = await execute(excessive, "console.log('x'.repeat(200000))");
  assert.equal(large.status, "failed");
  assert.equal(large.error_code, "SANDBOX_OUTPUT_LIMIT");
  const actor = currentActor(app.services.db, tenantId, userId);
  for (const resource of resources)
    await app.services.sandbox.stopRuntime(actor, resource, true);
  resources.length = 0;
  for (let i = 0; i < 4; i++) await create();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${path}/runtimes`,
        headers,
        payload: { name: "Over capacity" },
      })
    ).statusCode,
    429,
  );
  console.log(
    JSON.stringify({
      realDockerApi: true,
      crossTenantDenied: true,
      explicitOptIn: true,
      encryptedInput: true,
      silentExecutionBeyondTransportTimeout: true,
      revocationStopsProcess: true,
      timeout: true,
      cancellation: true,
      outputLimit: true,
      capacityEnforced: true,
    }),
  );
} finally {
  const owned = app.services.db.all<SandboxRuntimeRow>(
    "SELECT * FROM sandbox_runtimes",
  );
  await app.close();
  await cleanupSandboxes(
    driver,
    owned.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ownerToken: row.owner_token,
      expiresAt: row.expires_at,
    })),
  );
}
