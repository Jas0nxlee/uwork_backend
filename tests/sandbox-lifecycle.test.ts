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
  executeGate: ReturnType<typeof gate> | undefined;
  entered = gate();
  private calls = 0;
  stopFailure = false;
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
    if (this.stopFailure) throw new Error("Controlled stop failure");
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
    if (this.executeGate) {
      this.entered.release();
      await this.executeGate.promise;
    }
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
    driver.executeGate?.release();
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
for (const outcome of [
  "member-disabled",
  "lifetime-expired",
  "stop-unconfirmed",
  "execution-expired",
] as const)
  test(`late successful sandbox output is withheld for ${outcome}`, async (t) => {
    const f = await fixture(t);
    f.db.run(
      "INSERT INTO configurations(tenant_id,kind,draft,published,revision,version,updated_at) VALUES(?,'security',?,?,1,1,?)",
      f.actor.tenantId,
      JSON.stringify({ allowSandbox: true }),
      JSON.stringify({ allowSandbox: true }),
      Date.now(),
    );
    const runtime = await f.sandbox.create(
      f.actor,
      "Controlled runtime",
      { all: true, members: [], departments: [] },
      1,
    );
    const execution = await f.sandbox.enqueue(f.actor, runtime.id, "42", 1000);
    f.driver.executeGate = gate();
    const work = f.sandbox.drain();
    await f.driver.entered.promise;
    if (outcome === "lifetime-expired")
      t.mock.method(Date, "now", () => runtime.expiresAt + 1);
    else if (outcome === "execution-expired") {
      const started = f.db.get<{ started_at: number }>(
        "SELECT started_at FROM sandbox_executions WHERE id=?",
        execution,
      )!.started_at;
      t.mock.method(Date, "now", () => started + 1001);
    } else
      f.db.run(
        "UPDATE members SET status='disabled' WHERE tenant_id=? AND user_id=?",
        f.actor.tenantId,
        f.actor.userId,
      );
    f.driver.stopFailure = outcome === "stop-unconfirmed";
    f.driver.executeGate.release();
    await work;
    const result = f.db.get<{
      status: string;
      error_code: string;
      stdout: string | null;
    }>(
      "SELECT status,error_code,stdout FROM sandbox_executions WHERE id=?",
      execution,
    )!;
    assert.equal(
      result.status,
      outcome === "stop-unconfirmed"
        ? "failed"
        : outcome === "lifetime-expired" || outcome === "execution-expired"
          ? "timed_out"
          : "cancelled",
    );
    assert.equal(
      result.error_code,
      outcome === "stop-unconfirmed"
        ? "STOP_UNCONFIRMED"
        : outcome === "lifetime-expired" || outcome === "execution-expired"
          ? "TIMEOUT"
          : "ACCESS_REVOKED",
    );
    assert.equal(result.stdout, null);
    assert.equal(
      f.driver.containers.get(runtime.id),
      outcome === "stop-unconfirmed"
        ? true
        : outcome === "lifetime-expired"
          ? undefined
          : false,
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

test("waiting for a write transaction does not consume a queued execution's runtime budget", async (t) => {
  const f = await fixture(t);
  f.db.run(
    "INSERT INTO configurations(tenant_id,kind,draft,published,revision,version,updated_at) VALUES(?,'security',?,?,1,1,?)",
    f.actor.tenantId,
    JSON.stringify({ allowSandbox: true }),
    JSON.stringify({ allowSandbox: true }),
    Date.now(),
  );
  const runtime = await f.sandbox.create(
    f.actor,
    "Queued runtime",
    { all: true, members: [], departments: [] },
    1,
  );
  const execution = await f.sandbox.enqueue(f.actor, runtime.id, "42", 1000);
  let time = Date.now();
  t.mock.method(Date, "now", () => time);
  const transaction = f.db.transaction.bind(f.db);
  t.mock.method(f.db, "transaction", <T>(operation: () => T): T => {
    // 模拟 BEGIN 等待已有写锁后才进入事务回调，而不是执行期间消耗预算。
    time += 5000;
    return transaction(operation);
  });
  await f.sandbox.drain();
  assert.equal(
    f.db.get<{ status: string }>(
      "SELECT status FROM sandbox_executions WHERE id=?",
      execution,
    )!.status,
    "succeeded",
  );
});
