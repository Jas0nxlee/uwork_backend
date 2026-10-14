import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { ApiError } from "../src/core.js";
import type { SandboxDriver, SandboxOwner } from "../src/sandbox/contract.js";

class ControlledDriver implements SandboxDriver {
  containers = new Map<string, { owner: string; running: boolean }>();
  async health() {
    return { available: true, image: "controlled-driver" };
  }
  async create(o: SandboxOwner) {
    this.containers.set(o.id, { owner: o.ownerToken, running: true });
    return { running: true, exitCode: null, containerId: o.id };
  }
  async inspect(o: SandboxOwner) {
    const c = this.containers.get(o.id);
    if (!c) return null;
    if (c.owner !== o.ownerToken)
      throw new ApiError(403, "SANDBOX_OWNER_MISMATCH", "wrong owner");
    return {
      running: c.running,
      exitCode: c.running ? null : 0,
      containerId: o.id,
    };
  }
  async stop(o: SandboxOwner) {
    await this.inspect(o);
    const c = this.containers.get(o.id);
    if (c) c.running = false;
  }
  async remove(o: SandboxOwner) {
    await this.stop(o);
    this.containers.delete(o.id);
  }
  async execute(o: SandboxOwner, code: string, signal: AbortSignal) {
    if (code === "hang") {
      await new Promise<void>((_r, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            void this.stop(o).then(() => reject(new Error("aborted")));
          },
          { once: true },
        ),
      );
    }
    return { stdout: "controlled-result", stderr: "", exitCode: 0 };
  }
}
test("sandbox lifecycle is persistent, permissioned, serialized, encrypted and cancellable", async (t) => {
  const driver = new ControlledDriver();
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 15),
    publicUrl: "http://localhost:3000",
    sandboxDriver: driver,
  });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Sandbox",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const token = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.test", password: "test-password-long" },
    })
  ).json().token;
  const headers = { authorization: `Bearer ${token}` };
  const p = `/api/tenants/${tenantId}`;
  const capability = (
    await app.inject({ url: `${p}/runtime`, headers })
  ).json();
  assert.equal(capability.isolatedCodeExecution, true);
  assert.equal(capability.arbitraryCodeExecution, true);
  assert.equal(capability.hostCodeExecution, false);
  assert.equal(capability.agentToolExecution, false);
  const created = await app.inject({
    method: "POST",
    url: `${p}/runtimes`,
    headers,
    payload: { name: "Runtime", scope: { all: true }, ttlMinutes: 10 },
  });
  assert.equal(created.statusCode, 201, created.body);
  const runtime = created.json().id;
  assert.ok(!created.body.includes("owner_token"));
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/runtimes/${runtime}/executions`,
        headers,
        payload: { code: "sensitive-code" },
      })
    ).statusCode,
    403,
  );
  const draft = (
    await app.inject({
      method: "PUT",
      url: `${p}/configurations/security`,
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
    url: `${p}/configurations/security/publish`,
    headers,
    payload: { revision: draft.revision },
  });
  const accepted = await app.inject({
    method: "POST",
    url: `${p}/runtimes/${runtime}/executions`,
    headers,
    payload: { code: "sensitive-code", timeoutMs: 1000 },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/runtimes/${runtime}/executions`,
        headers,
        payload: { code: "duplicate" },
      })
    ).statusCode,
    409,
  );
  await app.services.sandbox.drain();
  const result = (
    await app.inject({
      url: `${p}/sandbox-executions/${accepted.json().id}`,
      headers,
    })
  ).json();
  assert.equal(result.status, "succeeded");
  assert.equal(result.stdout, "controlled-result");
  assert.ok(
    !JSON.stringify(
      app.services.db.all("SELECT * FROM sandbox_executions"),
    ).includes("sensitive-code"),
  );
  const hanging = (
    await app.inject({
      method: "POST",
      url: `${p}/runtimes/${runtime}/executions`,
      headers,
      payload: { code: "hang", timeoutMs: 1000 },
    })
  ).json();
  const work = app.services.sandbox.drain();
  await new Promise((r) => setTimeout(r, 10));
  await app.inject({
    method: "POST",
    url: `${p}/sandbox-executions/${hanging.id}/cancel`,
    headers,
  });
  await work;
  assert.equal(
    (
      await app.inject({
        url: `${p}/sandbox-executions/${hanging.id}`,
        headers,
      })
    ).json().status,
    "cancelled",
  );
  assert.equal(driver.containers.get(runtime)?.running, false);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `${p}/runtimes/${runtime}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.equal(driver.containers.size, 0);
});
