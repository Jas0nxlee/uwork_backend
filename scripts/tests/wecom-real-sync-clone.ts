import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { DatabaseSync, backup } from "node:sqlite";
import { parseEnv } from "node:util";
import { createApp } from "../../src/app.js";

const profile = process.argv[2] ?? "client-real-wecom-sync-clone-20261020";
assert.match(profile, /^client-real-wecom-sync-clone(?:-v\d+)?-20261020$/);
const expectSuccess = process.argv.includes("--success");
const output = "evidence/" + profile;
const root = "/Users/ljp/Library/Caches/uwork-backend/" + profile;
await mkdir(output, { mode: 0o700 });
await mkdir(root, { mode: 0o700 });
const env = parseEnv(await readFile(".env", "utf8"));
const main = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
const clonePath = root + "/clone.sqlite";
const facts: Record<string, unknown> = {
  status: "failed",
  mainDatabaseReadOnly: true,
  workerEnabled: false,
};
function identities(db: DatabaseSync) {
  const tables = ["users", "departments", "members"];
  return Object.fromEntries(
    tables.map((table) => {
      const rows = db
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort();
      return [
        table,
        {
          count: rows.length,
          digest: createHash("sha256").update(rows.join("\n")).digest("hex"),
        },
      ];
    }),
  );
}
const beforeMain = identities(main);
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let token = "";
let origin = "";
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(45000),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    value: response.status === 204 ? undefined : await response.json(),
  };
}
try {
  await backup(main, clonePath);
  await chmod(clonePath, 0o600);
  const clone = new DatabaseSync(clonePath);
  // 仅独立备份副本清除复制来的运行租约，主库租约保持原样。
  clone.exec("DELETE FROM instance_lease");
  const beforeClone = identities(clone);
  const existingMemberships = clone
    .prepare("SELECT tenant_id,user_id,role,seat FROM members")
    .all();
  clone.close();
  app = await createApp({
    database: clonePath,
    masterKey: Buffer.from(env.MASTER_KEY!, "hex"),
    publicUrl: "http://127.0.0.1",
    worker: false,
    logger: false,
  });
  origin = await app.listen({ port: 0, host: "127.0.0.1" });
  const bootstrap = await readFile("data/bootstrap-credentials.txt", "utf8");
  const field = (name: string) => {
    const match = bootstrap.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
    assert.ok(match);
    return match[1]!.trim();
  };
  const tenantId = field("Tenant ID");
  const login = await api("/api/auth/login", "POST", {
    email: field("Email"),
    password: field("Password"),
    tenantId,
    delivery: "token",
  });
  assert.equal(login.status, 200);
  token = login.value.token;
  const sync = await api(`/api/tenants/${tenantId}/wecom/sync`, "POST");
  facts.realSyncHttpStatus = sync.status;
  facts.actualDirectorySyncSucceeded = sync.status === 200;
  assert.equal(sync.status, expectSuccess ? 200 : 502);
  if (!expectSuccess) {
    assert.equal(sync.value.error.code, "WECOM_REJECTED");
    const message = String(sync.value.error.message);
    facts.upstreamCode = message.includes("60020") ? 60020 : null;
    facts.guidanceMatchesTrustedIp =
      message.includes("可信 IP") && message.includes("出口 IP");
    assert.equal(facts.upstreamCode, 60020);
    assert.equal(facts.guidanceMatchesTrustedIp, true);
  }
  const after = new DatabaseSync(clonePath, { readOnly: true });
  const afterClone = identities(after);
  after.close();
  if (expectSuccess) {
    assert.ok(sync.value.departments > 0 && sync.value.members > 0);
    facts.synced = {
      departments: sync.value.departments,
      members: sync.value.members,
    };
    const state = new DatabaseSync(clonePath, { readOnly: true });
    for (const member of existingMemberships) {
      const current = state
        .prepare(
          "SELECT role,seat FROM members WHERE tenant_id=? AND user_id=?",
        )
        .get(member.tenant_id!, member.user_id!);
      assert.ok(current);
      assert.equal(current.role, member.role);
      assert.equal(current.seat, member.seat);
    }
    assert.equal(state.prepare("PRAGMA foreign_key_check").all().length, 0);
    state.close();
    facts.existingRolesAndSeatsPreserved = true;
    facts.foreignKeysValid = true;
    const repeated = await api(`/api/tenants/${tenantId}/wecom/sync`, "POST");
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.value, sync.value);
    const repeatedDb = new DatabaseSync(clonePath, { readOnly: true });
    assert.deepEqual(identities(repeatedDb), afterClone);
    repeatedDb.close();
    facts.secondRealSyncIdempotent = true;
  } else {
    assert.deepEqual(afterClone, beforeClone);
    facts.cloneUsersDepartmentsMembershipsUnchanged = true;
  }
  facts.identityCounts = Object.fromEntries(
    Object.entries(afterClone).map(([key, row]) => [key, row.count]),
  );
  facts.status = expectSuccess
    ? "passed-real-sync"
    : "passed-rejection-integrity";
} catch (error) {
  facts.failure =
    error instanceof assert.AssertionError
      ? { kind: "assertion", operator: error.operator }
      : {
          kind: "runtime",
          name: error instanceof Error ? error.name : "unknown",
        };
} finally {
  if (token)
    facts.cloneLogoutStatus = (
      await api("/api/auth/logout", "POST", { revokeDevices: false })
    ).status;
  await app?.close();
  facts.mainIdentityUnchanged =
    JSON.stringify(identities(main)) === JSON.stringify(beforeMain);
  main.close();
  if (!facts.mainIdentityUnchanged) facts.status = "failed";
  for (const suffix of ["", "-wal", "-shm"])
    await rm(clonePath + suffix, { force: true });
  facts.cloneRemoved = true;
  await writeFile(
    output + "/result.json",
    JSON.stringify(facts, null, 2) + "\n",
    { mode: 0o600 },
  );
}
process.stdout.write(JSON.stringify(facts) + "\n");
process.exitCode = ["passed-rejection-integrity", "passed-real-sync"].includes(
  String(facts.status),
)
  ? 0
  : 1;
