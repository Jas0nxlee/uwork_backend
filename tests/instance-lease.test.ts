import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db, backupDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import type { SandboxDriver } from "../src/sandbox/contract.js";

test("foreign namespaces and legacy leases cannot use local PID absence to recover live work", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-lease-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  assert.throws(() => new Db(path), /require an instance lease owner/);
  const raw = new DatabaseSync(path);
  raw.exec(
    "CREATE TABLE instance_lease(id INTEGER PRIMARY KEY,owner TEXT,pid INTEGER)",
  );
  raw.prepare("INSERT INTO instance_lease VALUES(1,'legacy',2147483647)").run();
  assert.throws(() => new Db(path, "legacy-successor"), /namespace/);
  assert.equal(
    raw.prepare("SELECT name FROM sqlite_master WHERE name='runs'").get(),
    undefined,
  );
  raw.exec("DELETE FROM instance_lease");
  raw.close();
  const live = new Db(path, "live");
  live.run("UPDATE instance_lease SET host_id='foreign',pid=2147483647");
  assert.throws(() => new Db(path, "foreign-successor"), /namespace/);
  live.releaseInstance("live");
  live.close();
});

test("a fenced server refuses HTTP requests and closing does not delete a successor lease", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-fenced-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  const app = await createApp({
    database: path,
    masterKey: Buffer.alloc(32, 17),
    publicUrl: "http://localhost:3000",
  });
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE instance_lease SET owner='successor'").run();
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 503);
  assert.equal(health.json().error.code, "INSTANCE_LEASE_LOST");
  await app.close();
  assert.equal(
    (raw.prepare("SELECT owner FROM instance_lease").get() as { owner: string })
      .owner,
    "successor",
  );
  raw.close();
});

test("expired foreign takeover fences the old writer and its release cannot erase its successor", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-fence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite");
  const old = new Db(path, "old");
  old.run(
    "UPDATE instance_lease SET host_id='foreign',heartbeat_at=?",
    Date.now() - 180000,
  );
  const next = new Db(path, "next");
  assert.throws(() => old.run("DELETE FROM tenants"), /lease lost/);
  assert.throws(() => old.transaction(() => 1), /lease lost/);
  assert.throws(() => old.renewInstance("old"), /lease lost/);
  old.releaseInstance("old");
  old.close();
  next.assertInstance();
  assert.equal(
    next.get<{ owner: string }>("SELECT owner FROM instance_lease")!.owner,
    "next",
  );
  next.renewInstance("next");
  next.releaseInstance("next");
  next.close();
});

test("standalone online backup does not migrate or modify the source database", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-readonly-backup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "legacy.sqlite"),
    destination = join(dir, "copy.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec(
    "CREATE TABLE original(value TEXT); INSERT INTO original VALUES('preserved')",
  );
  const before = raw.prepare("PRAGMA schema_version").get();
  await backupDatabase(path, destination);
  assert.deepEqual(raw.prepare("PRAGMA schema_version").get(), before);
  assert.equal(
    raw
      .prepare("SELECT name FROM sqlite_master WHERE name='schema_version'")
      .get(),
    undefined,
  );
  const copy = new DatabaseSync(destination, { readOnly: true });
  assert.equal(
    (copy.prepare("SELECT value FROM original").get() as { value: string })
      .value,
    "preserved",
  );
  await assert.rejects(
    () => backupDatabase(path, destination),
    /already exists/,
  );
  copy.close();
  raw.close();
});

test("a failed write-lock acquisition does not weaken subsequent transaction fencing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-lock-retry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite"),
    db = new Db(path, "owner"),
    raw = new DatabaseSync(path);
  t.after(() => {
    raw.close();
    db.close();
  });
  db.run("PRAGMA busy_timeout=1");
  raw.exec("BEGIN IMMEDIATE");
  assert.throws(() => db.transaction(() => 1), /locked/);
  raw.exec("ROLLBACK");
  db.transaction(() => {
    assert.throws(() => raw.exec("BEGIN IMMEDIATE"), /locked/);
    db.run("DELETE FROM tenants");
  });
});

test("the instance heartbeat runs while asynchronous sandbox recovery is still pending", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-recovery-heartbeat-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.sqlite"),
    db = new Db(path, "seed");
  const b = await bootstrap(db, {
    name: "Recovery",
    email: "owner@example.test",
    password: "controlled-password-long",
  });
  db.run(
    "INSERT INTO sandbox_runtimes(id,tenant_id,user_id,name,scope,owner_token,status,created_at,expires_at,updated_at) VALUES('recovery',?,?,'Recovery','{}','controlled','ready',?,?,?)",
    b.tenantId,
    b.userId,
    Date.now(),
    Date.now() + 1800000,
    Date.now(),
  );
  db.close();
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve)),
    ready = new Promise<void>((resolve) => (entered = resolve));
  const driver: SandboxDriver = {
    health: async () => ({ available: true, image: "controlled" }),
    create: async () => {
      throw new Error("Not expected");
    },
    execute: async () => {
      throw new Error("Not expected");
    },
    stop: async () => {},
    remove: async () => {},
    inspect: async () => {
      entered();
      await pending;
      return { containerId: "controlled", running: true, exitCode: null };
    },
  };
  t.mock.timers.enable({ apis: ["setInterval"] });
  const creating = createApp({
    database: path,
    masterKey: Buffer.alloc(32, 18),
    publicUrl: "http://localhost:3000",
    sandboxDriver: driver,
  });
  await ready;
  const raw = new DatabaseSync(path);
  t.after(async () => {
    release();
    await (await creating).close();
    raw.close();
  });
  raw.prepare("UPDATE instance_lease SET heartbeat_at=1").run();
  t.mock.timers.tick(15001);
  assert.ok(
    (
      raw.prepare("SELECT heartbeat_at FROM instance_lease").get() as {
        heartbeat_at: number;
      }
    ).heartbeat_at > 1,
  );
  release();
  await creating;
});
