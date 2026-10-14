import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db.js";
import { Vault } from "../src/vault.js";
import { bootstrap } from "../src/identity.js";
import { currentActor } from "../src/access.js";
import { SandboxService } from "../src/sandbox/service.js";
import type { SandboxDriver, SandboxOwner } from "../src/sandbox/contract.js";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
class GatedDriver implements SandboxDriver {
  containers = new Map<string, boolean>();
  createGate: ReturnType<typeof gate> | undefined;
  stopGate: ReturnType<typeof gate> | undefined;
  inspectGate: ReturnType<typeof gate> | undefined;
  entered = gate();
  private calls = 0;
  async health() {
    return { available: true, image: "controlled" };
  }
  async create(o: SandboxOwner) {
    if (this.createGate) {
      this.entered.release();
      await this.createGate.promise;
    }
    this.containers.set(o.id, true);
    return { running: true, exitCode: null, containerId: o.id };
  }
  async inspect(o: SandboxOwner) {
    if (this.inspectGate) {
      this.entered.release();
      await this.inspectGate.promise;
    }
    const running = this.containers.get(o.id);
    return running === undefined
      ? null
      : { running, exitCode: running ? null : 0, containerId: o.id };
  }
  async stop(o: SandboxOwner) {
    if (this.stopGate && this.calls++ === 0) {
      this.entered.release();
      await this.stopGate.promise;
    }
    if (this.containers.has(o.id)) this.containers.set(o.id, false);
  }
  async remove(o: SandboxOwner) {
    await this.stop(o);
    this.containers.delete(o.id);
  }
  async execute() {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
}
async function fixture(t: TestContext) {
  const db = new Db(":memory:");
  const b = await bootstrap(db, {
    name: "Test",
    email: "owner@example.test",
    password: "controlled-password-long",
  });
  const actor = currentActor(db, b.tenantId, b.userId),
    driver = new GatedDriver();
  const sandbox = new SandboxService(
    db,
    new Vault(db, Buffer.alloc(32, 16)),
    driver,
    () => {},
  );
  t.after(async () => {
    driver.createGate?.release();
    driver.stopGate?.release();
    driver.inspectGate?.release();
    await sandbox.stop();
    db.close();
  });
  return { db, actor, driver, sandbox };
}
test("late stop completion cannot revive a deleted runtime", async (t) => {
  const f = await fixture(t);
  const r = await f.sandbox.create(
    f.actor,
    "Runtime",
    { all: true, members: [], departments: [] },
    1,
  );
  f.driver.stopGate = gate();
  const stop = f.sandbox.stopRuntime(f.actor, r.id);
  await f.driver.entered.promise;
  const remove = f.sandbox.stopRuntime(f.actor, r.id, true);
  await new Promise((r) => setTimeout(r, 20));
  f.driver.stopGate.release();
  await Promise.allSettled([stop, remove]);
  assert.equal(
    f.db.get<{ status: string }>(
      "SELECT status FROM sandbox_runtimes WHERE id=?",
      r.id,
    )!.status,
    "deleted",
  );
});
test("late inspection cannot resurrect a deleted runtime", async (t) => {
  const f = await fixture(t);
  const runtime = await f.sandbox.create(
    f.actor,
    "Runtime",
    { all: true, members: [], departments: [] },
    1,
  );
  f.driver.inspectGate = gate();
  const view = f.sandbox.view(f.actor, runtime.id);
  await f.driver.entered.promise;
  await f.sandbox.stopRuntime(f.actor, runtime.id, true);
  f.driver.inspectGate.release();
  await assert.rejects(view, /Runtime 不存在/);
  assert.equal(
    f.db.get<{ status: string }>(
      "SELECT status FROM sandbox_runtimes WHERE id=?",
      runtime.id,
    )!.status,
    "deleted",
  );
});
test("stop during provisioning wins over a late create response", async (t) => {
  const f = await fixture(t);
  f.driver.createGate = gate();
  const creation = f.sandbox.create(
    f.actor,
    "Runtime",
    { all: true, members: [], departments: [] },
    1,
  );
  await f.driver.entered.promise;
  const id = f.db.get<{ id: string }>("SELECT id FROM sandbox_runtimes")!.id;
  const stop = f.sandbox.stopRuntime(f.actor, id);
  await new Promise((r) => setTimeout(r, 20));
  f.driver.createGate.release();
  await Promise.allSettled([creation, stop]);
  assert.equal(
    f.db.get<{ status: string }>(
      "SELECT status FROM sandbox_runtimes WHERE id=?",
      id,
    )!.status,
    "stopped",
  );
  assert.equal(f.driver.containers.get(id), undefined);
});
test("expiration reaper and delete preserve the deleted terminal state", async (t) => {
  const f = await fixture(t);
  const runtime = await f.sandbox.create(
    f.actor,
    "Runtime",
    { all: true, members: [], departments: [] },
    1,
  );
  f.db.run(
    "UPDATE sandbox_runtimes SET expires_at=? WHERE id=?",
    Date.now() - 1,
    runtime.id,
  );
  f.driver.stopGate = gate();
  const reap = f.sandbox.drain();
  await f.driver.entered.promise;
  const remove = f.sandbox.stopRuntime(f.actor, runtime.id, true);
  await new Promise((r) => setTimeout(r, 20));
  f.driver.stopGate.release();
  await Promise.allSettled([reap, remove]);
  assert.equal(
    f.db.get<{ status: string }>(
      "SELECT status FROM sandbox_runtimes WHERE id=?",
      runtime.id,
    )!.status,
    "deleted",
  );
});
