import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { DatabaseSync } from "node:sqlite";
test("persistent tenant data survives backup/restore and a second worker cannot recover a live database", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    database: join(dir, "live.sqlite"),
    masterKey: Buffer.alloc(32, 12),
    publicUrl: "http://localhost:3000",
  };
  const app = await createApp(options);
  t.after(() => app.close());
  const b = await bootstrap(app.services.db, {
    name: "Persistent",
    email: "owner@example.test",
    password: "test-password-long",
  });
  app.services.db.run(
    "INSERT INTO runs(id,tenant_id,user_id,session_id,agent_id,agent_version,status,input,timeout_ms,created_at) VALUES(?,?,?,?,?,1,'running',?,1000,?)",
    "interrupted",
    b.tenantId,
    b.userId,
    "session",
    "agent",
    app.services.vault.seal("test", `${b.tenantId}:interrupted:input`),
    Date.now(),
  );
  app.services.db.run(
    "INSERT INTO ledger(id,tenant_id,request_key,user_id,application,model_id,period,amount,reserved,status,created_at) VALUES(?,?,?,?,?,?,?,0,100,'reserved',?)",
    "interrupted",
    b.tenantId,
    "interrupted",
    b.userId,
    "test",
    "model",
    "period",
    Date.now(),
  );
  await assert.rejects(() => createApp(options), /running backend/);
  assert.equal(
    app.services.db.get<{ status: string }>(
      "SELECT status FROM runs WHERE id='interrupted'",
    )!.status,
    "running",
  );
  await app.services.db.backupTo(join(dir, "backup.sqlite"));
  const copy = new DatabaseSync(join(dir, "backup.sqlite"), { readOnly: true });
  assert.equal(
    (
      copy.prepare("SELECT name FROM tenants WHERE id=?").get(b.tenantId) as {
        name: string;
      }
    ).name,
    "Persistent",
  );
  copy.close();
  await app.close();
  const restored = await createApp({
    ...options,
    database: join(dir, "backup.sqlite"),
  });
  const login = await restored.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(
    restored.services.db.get<{ status: string }>(
      "SELECT status FROM runs WHERE id='interrupted'",
    )!.status,
    "failed",
  );
  assert.equal(
    restored.services.db.get<{ status: string; amount: number }>(
      "SELECT status,amount FROM ledger WHERE id='interrupted'",
    )!.status,
    "uncertain",
  );
  await restored.close();
});
