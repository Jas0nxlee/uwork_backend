import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap, issueSession } from "../src/identity.js";
import { DEFAULT_RETENTION_DAYS, retentionSweep } from "../src/telemetry.js";
import type { RetentionPorts } from "../src/events.js";

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 12),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Retention",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  return { app, headers, p: `/api/tenants/${tenantId}`, tenantId };
}

const day = 86400000;
const insert = (
  app: Awaited<ReturnType<typeof fixture>>["app"],
  tenantId: string,
  table: "audit" | "traces" | "client_events",
  id: string,
  createdAt: number,
) =>
  app.services.db.run(
    table === "audit"
      ? "INSERT INTO audit(id,tenant_id,user_id,action,target,metadata,created_at) VALUES(?,?,?,?,?,?,?)"
      : table === "traces"
        ? "INSERT INTO traces(id,tenant_id,user_id,application,model_id,status,input_tokens,output_tokens,duration_ms,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        : "INSERT INTO client_events(id,tenant_id,user_id,event_key,type,data,created_at) VALUES(?,?,?,?,?,?,?)",
    ...(table === "audit"
      ? [id, tenantId, "owner", "controlled.action", null, "{}", createdAt]
      : table === "traces"
        ? [
            id,
            tenantId,
            "owner",
            "uwork",
            "controlled",
            "ok",
            1,
            1,
            5,
            null,
            createdAt,
          ]
        : [id, tenantId, "owner", id, "session.start", "{}", createdAt]),
  );

test("retention falls back to the default until the tenant configures its own window", async (t) => {
  const f = await fixture(t);
  const initial = await f.app.inject({
    url: `${f.p}/retention`,
    headers: f.headers,
  });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), {
    days: DEFAULT_RETENTION_DAYS,
    configured: false,
  });
  const invalid = await f.app.inject({
    method: "PUT",
    url: `${f.p}/retention`,
    headers: f.headers,
    payload: { days: 3 },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const configured = await f.app.inject({
    method: "PUT",
    url: `${f.p}/retention`,
    headers: f.headers,
    payload: { days: 30 },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.deepEqual(configured.json(), { days: 30, configured: true });
  // 企业联系人不被留存写入覆盖。
  const tenant = (await f.app.inject({ url: f.p, headers: f.headers })).json();
  assert.equal(tenant.name, "Retention");
});

test("a purge without an explicit window uses the configured retention days", async (t) => {
  const f = await fixture(t);
  const fresh = Date.now() - 5 * day,
    stale = Date.now() - 40 * day;
  insert(f.app, f.tenantId, "audit", "audit-fresh", fresh);
  insert(f.app, f.tenantId, "audit", "audit-stale", stale);
  insert(f.app, f.tenantId, "traces", "trace-stale", stale);
  insert(f.app, f.tenantId, "client_events", "event-stale", stale);
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `${f.p}/retention`,
        headers: f.headers,
        payload: { days: 30 },
      })
    ).statusCode,
    200,
  );
  const purged = await f.app.inject({
    method: "POST",
    url: `${f.p}/retention/purge`,
    headers: f.headers,
    payload: {},
  });
  assert.equal(purged.statusCode, 200, purged.body);
  assert.equal(purged.json().audit, 1);
  assert.equal(purged.json().traces, 1);
  assert.equal(purged.json().client_events, 1);
  // 只比较本测试写入的行：bootstrap 自身也会写审计事实。
  const remaining = () =>
    f.app.services.db.all<{ id: string }>(
      "SELECT id FROM audit WHERE tenant_id=? AND id LIKE 'audit-%' ORDER BY id",
      f.tenantId,
    );
  assert.deepEqual(
    remaining().map((row) => row.id),
    ["audit-fresh"],
    "窗口内的记录必须保留",
  );
  // 显式天数仍然优先于企业配置。
  insert(f.app, f.tenantId, "audit", "audit-stale-2", stale);
  const explicit = await f.app.inject({
    method: "POST",
    url: `${f.p}/retention/purge`,
    headers: f.headers,
    payload: { days: 3650 },
  });
  assert.equal(explicit.statusCode, 200, explicit.body);
  assert.deepEqual(
    remaining().map((row) => row.id),
    ["audit-fresh", "audit-stale-2"],
    "更长窗口不得删除仍在留存期内的记录",
  );
});

test("the background sweep only touches tenants that configured retention", async (t) => {
  const f = await fixture(t);
  const stale = Date.now() - 120 * day;
  insert(f.app, f.tenantId, "audit", "audit-stale", stale);
  const ports: RetentionPorts = {
    purgeCalls: () => 0,
    purgeRuns: () => 0,
    purgeSandbox: () => 0,
    purgeIdentity: () => undefined,
  };
  assert.deepEqual(retentionSweep(f.app.services.db, ports, Date.now()), {
    tenants: 0,
    purged: 0,
  });
  const controlled = () =>
    f.app.services.db.all<{ id: string }>(
      "SELECT id FROM audit WHERE tenant_id=? AND id LIKE 'audit-%' ORDER BY id",
      f.tenantId,
    );
  assert.deepEqual(
    controlled().map((row) => row.id),
    ["audit-stale"],
    "未配置留存的企业不能被默认值静默清理",
  );
  await f.app.inject({
    method: "PUT",
    url: `${f.p}/retention`,
    headers: f.headers,
    payload: { days: 90 },
  });
  assert.deepEqual(retentionSweep(f.app.services.db, ports, Date.now()), {
    tenants: 1,
    purged: 1,
  });
  assert.deepEqual(controlled(), []);
});

test("retention is an administrative setting: members and device tokens cannot read or change it", async (t) => {
  const f = await fixture(t);
  const member = await f.app.inject({
    method: "POST",
    url: `${f.p}/members`,
    headers: f.headers,
    payload: {
      name: "Member",
      email: "member@example.test",
      password: "member-password-long",
      role: "member",
      seat: true,
    },
  });
  const memberToken = issueSession(
    f.app.services.db,
    member.json().id,
    f.tenantId,
    "session",
    ["execute"],
  ).token;
  const read = await f.app.inject({
    url: `${f.p}/retention`,
    headers: { authorization: `Bearer ${memberToken}` },
  });
  assert.equal(read.statusCode, 403, read.body);
  const write = await f.app.inject({
    method: "PUT",
    url: `${f.p}/retention`,
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { days: 30 },
  });
  assert.equal(write.statusCode, 403, write.body);
  // 终端凭据同样不能改留存。
  const device = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers: f.headers,
      payload: { ttlHours: 1 },
    })
  ).json().token;
  const viaDevice = await f.app.inject({
    method: "PUT",
    url: `${f.p}/retention`,
    headers: { authorization: `Bearer ${device}` },
    payload: { days: 30 },
  });
  assert.equal(viaDevice.statusCode, 403, viaDevice.body);
});
