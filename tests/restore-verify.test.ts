import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import {
  verifyRestore,
  type RestoreVerification,
} from "../scripts/verify-restore.js";

interface Snapshot {
  root: string;
  backup: string;
  snapshot: string;
  masterKey: Buffer;
  email: string;
  password: string;
  credential: string;
  tenantId: string;
  userId: string;
}

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "uwork-restore-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

/**
 * 合成一份带账号、Vault 密文、已发布配置和进行中账本/任务的快照。
 * 快照在源实例仍持锁时取得，随后关闭源实例，模拟真实停服备份。
 */
async function snapshot(t: TestContext): Promise<Snapshot> {
  const root = await directory(t);
  const source = join(root, "source"),
    backup = join(root, "backup");
  await mkdir(source, { mode: 0o700 });
  await mkdir(backup, { mode: 0o700 });
  const database = join(source, "uwork.sqlite"),
    masterKey = randomBytes(32),
    email = `owner-${randomBytes(4).toString("hex")}@example.test`,
    password = randomBytes(24).toString("base64url"),
    credential = `synthetic-${randomBytes(12).toString("base64url")}`;
  const app = await createApp({
    database,
    masterKey,
    publicUrl: "http://localhost:3000",
  });
  try {
    const account = await bootstrap(app.services.db, {
      name: "Restore Fixture",
      email,
      password,
    });
    const tenantId = account.tenantId,
      userId = account.userId;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: `Bearer ${login.json().token}` };
    const prefix = `/api/tenants/${tenantId}`;
    const created = await app.inject({
      method: "POST",
      url: `${prefix}/credentials`,
      headers,
      payload: { name: "Synthetic", value: credential },
    });
    assert.equal(created.statusCode, 201, created.body);
    const saved = await app.inject({
      method: "PUT",
      url: `${prefix}/configurations/new-chat`,
      headers,
      payload: {
        revision: 0,
        data: { welcome: "恢复校验", riskNotice: "重要信息请核实。" },
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const published = await app.inject({
      method: "POST",
      url: `${prefix}/configurations/new-chat/publish`,
      headers,
      payload: { revision: saved.json().revision },
    });
    assert.equal(published.statusCode, 200, published.body);
    app.services.db.run(
      "INSERT INTO runs(id,tenant_id,user_id,session_id,agent_id,agent_version,status,input,timeout_ms,created_at) VALUES(?,?,?,?,?,1,'running',?,1000,?)",
      "interrupted-run",
      tenantId,
      userId,
      "session",
      "agent",
      app.services.vault.seal("test", `${tenantId}:interrupted-run:input`),
      Date.now(),
    );
    app.services.db.run(
      "INSERT INTO ledger(id,tenant_id,request_key,user_id,application,model_id,period,amount,reserved,status,created_at) VALUES(?,?,?,?,?,?,?,0,100,'reserved',?)",
      "interrupted-ledger",
      tenantId,
      "interrupted-request",
      userId,
      "test",
      "model",
      "period",
      Date.now(),
    );
    const snapshotPath = join(backup, "snapshot.sqlite");
    await app.services.db.backupTo(snapshotPath);
    return {
      root,
      backup,
      snapshot: snapshotPath,
      masterKey,
      email,
      password,
      credential,
      tenantId,
      userId,
    };
  } finally {
    await app.close();
  }
}

function check(report: RestoreVerification, code: string) {
  const found = report.checks.find((entry) => entry.code === code);
  assert.ok(
    found,
    `缺少检查项 ${code}，实际输出：${JSON.stringify(report.checks)}`,
  );
  return found;
}

function rows<T>(path: string, sql: string): T[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (database.prepare(sql).all() as T[]).map((row) => ({ ...row }));
  } finally {
    database.close();
  }
}

async function targetFor(root: string, name = "restored.sqlite") {
  const directoryPath = join(root, "restore");
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  return {
    directoryPath,
    target: join(directoryPath, name),
  };
}

test("完整快照通过完整性、schema 6、登录、Vault、发布配置、账本和租约校验", async (t) => {
  const fixture = await snapshot(t);
  const { target, directoryPath } = await targetFor(fixture.root);
  const report = await verifyRestore({
    snapshot: fixture.snapshot,
    target,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  for (const code of [
    "SNAPSHOT_STATE",
    "SNAPSHOT_PERMISSIONS",
    "SNAPSHOT_DIRECTORY",
    "TARGET_IS_SNAPSHOT",
    "TARGET_EXISTS",
    "TARGET_DIRECTORY",
    "TARGET_DIRECTORY_PERMISSIONS",
    "TARGET_COPY",
    "TARGET_PERMISSIONS",
    "INTEGRITY",
    "FOREIGN_KEYS",
    "SCHEMA_VERSION",
    "REQUIRED_TABLES",
    "APPLICATION_START",
    "LOGIN",
    "VAULT_DECRYPTION",
    "PUBLISHED_CONFIGURATION",
    "RUN_STATE",
    "LEDGER_STATE",
    "LEASE_RELEASED",
    "SNAPSHOT_UNCHANGED",
  ])
    assert.equal(check(report, code).status, "pass", code);
  assert.equal(report.restored?.publishedVersions["new-chat"], 1);
  assert.equal(report.restored?.runsFailed, 1);
  assert.equal(report.restored?.ledgerUncertain, 1);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.equal((await stat(directoryPath)).mode & 0o777, 0o700);
  assert.deepEqual(
    rows<{ n: number }>(target, "SELECT count(*) n FROM instance_lease"),
    [{ n: 0 }],
  );
  assert.deepEqual(
    rows<{ status: string; error_code: string }>(
      target,
      "SELECT status,error_code FROM runs WHERE id='interrupted-run'",
    ),
    [{ status: "failed", error_code: "PROCESS_RESTARTED" }],
  );
  assert.deepEqual(
    rows<{ status: string; amount: number }>(
      target,
      "SELECT status,amount FROM ledger WHERE id='interrupted-ledger'",
    ),
    [{ status: "uncertain", amount: 100 }],
  );
  const restored = await createApp({
    database: target,
    masterKey: fixture.masterKey,
    publicUrl: "http://localhost:3000",
  });
  try {
    const login = await restored.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: fixture.email, password: fixture.password },
    });
    assert.equal(login.statusCode, 200, login.body);
    const credentials = restored.services.db.all<{
      id: string;
      tenant_id: string;
    }>("SELECT id,tenant_id FROM credentials WHERE revoked=0");
    assert.equal(credentials.length, 1);
    assert.equal(
      restored.services.vault.read(
        credentials[0]!.tenant_id,
        credentials[0]!.id,
      ),
      fixture.credential,
    );
  } finally {
    await restored.close();
  }
});

test("错误主密钥或登录凭据失败并清理临时目标，源快照保持不变", async (t) => {
  const fixture = await snapshot(t);
  const { target } = await targetFor(fixture.root);
  const before = await readFile(fixture.snapshot);
  const wrongKey = await verifyRestore({
    snapshot: fixture.snapshot,
    target,
    masterKey: randomBytes(32),
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(wrongKey.ok, false);
  assert.equal(check(wrongKey, "VAULT_DECRYPTION").status, "fail");
  assert.equal(check(wrongKey, "SNAPSHOT_UNCHANGED").status, "pass");
  await assert.rejects(stat(target), { code: "ENOENT" });
  assert.deepEqual(await readFile(fixture.snapshot), before);

  const wrongLogin = await verifyRestore({
    snapshot: fixture.snapshot,
    target,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: `${fixture.password}-wrong`,
  });
  assert.equal(wrongLogin.ok, false);
  assert.equal(check(wrongLogin, "LOGIN").status, "fail");
  await assert.rejects(stat(target), { code: "ENOENT" });

  const serialized = JSON.stringify([wrongKey, wrongLogin]);
  assert.ok(!serialized.includes(fixture.password));
  assert.ok(!serialized.includes(fixture.masterKey.toString("hex")));
  assert.ok(!serialized.includes(fixture.credential));
});

test("损坏或非 SQLite 快照在完整性阶段失败，不覆盖源快照", async (t) => {
  const root = await directory(t);
  const backup = join(root, "backup");
  await mkdir(backup, { mode: 0o700 });
  const snapshotPath = join(backup, "snapshot.sqlite");
  const garbage = randomBytes(4096);
  await writeFile(snapshotPath, garbage, { mode: 0o600 });
  await chmod(snapshotPath, 0o600);
  const { target } = await targetFor(root);
  const report = await verifyRestore({
    snapshot: snapshotPath,
    target,
    masterKey: randomBytes(32),
    email: "owner@example.test",
    password: "synthetic-password-long",
  });
  assert.equal(report.ok, false);
  assert.equal(check(report, "INTEGRITY").status, "fail");
  assert.equal(check(report, "APPLICATION_START").status, "skip");
  await assert.rejects(stat(target), { code: "ENOENT" });
  assert.deepEqual(await readFile(snapshotPath), garbage);
});

test("拒绝覆盖已有目标、目标等于快照以及过宽权限的输入", async (t) => {
  const fixture = await snapshot(t);
  const { target } = await targetFor(fixture.root);
  const sentinel = "existing data must not be overwritten\n";
  await writeFile(target, sentinel, { mode: 0o600 });
  const existing = await verifyRestore({
    snapshot: fixture.snapshot,
    target,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(existing.ok, false);
  assert.equal(check(existing, "TARGET_EXISTS").status, "fail");
  assert.equal(await readFile(target, "utf8"), sentinel);

  const same = await verifyRestore({
    snapshot: fixture.snapshot,
    target: fixture.snapshot,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(same.ok, false);
  assert.equal(check(same, "TARGET_IS_SNAPSHOT").status, "fail");

  const wideSnapshot = join(fixture.backup, "wide.sqlite");
  await writeFile(wideSnapshot, await readFile(fixture.snapshot), {
    mode: 0o600,
  });
  await chmod(wideSnapshot, 0o644);
  const wideDir = await targetFor(fixture.root, "wide-restored.sqlite");
  const wide = await verifyRestore({
    snapshot: wideSnapshot,
    target: wideDir.target,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(wide.ok, false);
  assert.equal(check(wide, "SNAPSHOT_PERMISSIONS").status, "fail");

  const looseDirectory = join(fixture.root, "loose");
  await mkdir(looseDirectory, { mode: 0o700 });
  await chmod(looseDirectory, 0o757);
  const looseTarget = join(looseDirectory, "restored.sqlite");
  const loose = await verifyRestore({
    snapshot: fixture.snapshot,
    target: looseTarget,
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(loose.ok, false);
  assert.equal(check(loose, "TARGET_DIRECTORY_PERMISSIONS").status, "fail");

  const missing = await verifyRestore({
    snapshot: join(fixture.root, "missing.sqlite"),
    target: join(fixture.root, "unused.sqlite"),
    masterKey: fixture.masterKey,
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(missing.ok, false);
  assert.equal(check(missing, "SNAPSHOT_STATE").status, "fail");
});
