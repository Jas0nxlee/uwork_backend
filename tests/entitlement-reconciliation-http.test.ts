import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

interface LedgerRow {
  id: string;
  status: string;
  amount: number;
  reserved: number;
  settled_at: number | null;
}

async function reconciliationFixture(t: TestContext, name: string) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-reconciliation-http-"));
  const app = await createApp({
    database: join(directory, "fixture.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  const password = "Reconciliation-synthetic-password!";
  const owner = await bootstrap(app.services.db, {
    name: "Reconciliation A",
    email: "reconciliation-a@example.test",
    password,
  });
  const foreign = await bootstrap(app.services.db, {
    name: "Reconciliation B",
    email: "reconciliation-b@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const sessions: string[] = [];
  const requests: { method: string; path: string; status: number }[] = [];
  const checks: string[] = [];
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    token = sessions[0],
  ) => {
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    requests.push({ path, method, status: response.status });
    return response;
  };
  const login = async (email: string) => {
    const response = await request("/api/auth/login", "POST", {
      email,
      password,
    });
    assert.equal(response.status, 200);
    const { token } = (await response.json()) as { token: string };
    sessions.push(token);
    return token;
  };
  t.after(async () => {
    const logoutFailures: unknown[] = [];
    try {
      for (const token of sessions) {
        try {
          const response = await request(
            "/api/auth/logout",
            "POST",
            undefined,
            token,
          );
          assert.equal(response.status, 204);
        } catch (error) {
          logoutFailures.push(error);
        }
      }
    } finally {
      try {
        await app.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    const portClosed = await new Promise<boolean>((resolve) => {
      const socket = createConnection(
        Number(new URL(origin).port),
        "127.0.0.1",
      );
      socket.once("error", () => resolve(true));
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
    });
    let directoryRemoved = false;
    try {
      await access(directory);
    } catch {
      directoryRemoved = true;
    }
    assert.ok(portClosed && directoryRemoved);
    const evidence = process.env.UWORK_RECONCILIATION_EVIDENCE;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(
        join(evidence, `${name}.json`),
        JSON.stringify(
          {
            boundary:
              "independent temporary disk and real TCP app; bootstrap and declared ledger fixture setup only; all reconciliation/auth/member business writes HTTP; no provider/main instance/env/Docker",
            node: process.version,
            origin,
            checks,
            requests,
            cleanup: {
              portClosed,
              directoryRemoved,
              loggedOut: sessions.length,
              logoutFailures: logoutFailures.length,
            },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    assert.equal(logoutFailures.length, 0, "all owned sessions must log out");
  });
  await login("reconciliation-a@example.test");
  const p = `/api/tenants/${owner.tenantId}`;
  const subscription = async () => {
    const response = await request(`${p}/subscription`);
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      period: string;
      usage: { consumed: number; reserved: number };
    }>;
  };
  const period = (await subscription()).period;
  // Deliberate isolated ledger state fixtures: no real generation or vendor bill.
  const seed = (
    id: string,
    status = "uncertain",
    amount = 100,
    tenantId = owner.tenantId,
    userId = owner.userId,
  ) => {
    app.services.db.run(
      "INSERT INTO ledger(id,tenant_id,request_key,user_id,application,model_id,period,amount,reserved,status,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      tenantId,
      id,
      userId,
      "reconciliation-fixture",
      "no-provider-model",
      period,
      amount,
      100,
      status,
      Date.now(),
      status === "reserved" ? null : Date.now(),
    );
  };
  const row = async (id: string) => {
    const response = await request(
      `${p}/usage?q=no-provider-model&pageSize=100`,
    );
    assert.equal(response.status, 200);
    const data = (await response.json()) as { items: LedgerRow[] };
    return data.items.find((r) => r.id === id)!;
  };
  const audits = async () => {
    const response = await request(
      `${p}/audit?q=entitlements.reconcile&pageSize=100`,
    );
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      total: number;
      items: { target: string; metadata: string }[];
    }>;
  };
  const reconcile = (id: string, amount: number, token?: string) =>
    request(
      `${p}/usage/${id}/reconcile`,
      "PUT",
      { amount, evidenceReference: `synthetic-proof:${id}:${amount}` },
      token,
    );
  const denied = async (
    id: string,
    amount: number,
    status: number,
    code: string,
    token?: string,
  ) => {
    const before = await row(id);
    const auditCount = (await audits()).total;
    const response = await reconcile(id, amount, token);
    assert.equal(response.status, status);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      code,
    );
    assert.deepEqual(await row(id), before);
    assert.equal((await audits()).total, auditCount);
  };
  const check = (value: string) => checks.push(value);
  return {
    owner,
    foreign,
    p,
    login,
    request,
    subscription,
    seed,
    row,
    audits,
    reconcile,
    denied,
    check,
    password,
  };
}

test("reconciliation accepts zero and exact reservation but atomically rejects excess and non-uncertain states over TCP", async (t) => {
  const f = await reconciliationFixture(t, "amount-and-state");
  for (const amount of [0, 100]) {
    const id = `boundary-${amount}`;
    f.seed(id);
    assert.equal((await f.reconcile(id, amount)).status, 200);
    const row = await f.row(id);
    assert.equal(row.status, "settled");
    assert.equal(row.amount, amount);
    assert.equal(row.reserved, 100);
    assert.ok(row.settled_at);
    f.check(`amount-${amount}-accepted`);
  }
  f.seed("excess");
  await f.denied("excess", 101, 409, "RECONCILIATION_CONFLICT");
  f.check("amount-above-reservation-rejected-unchanged");
  for (const status of ["reserved", "released", "settled"]) {
    f.seed(status, status, status === "settled" ? 20 : 0);
    await f.denied(status, 0, 409, "RECONCILIATION_CONFLICT");
    f.check(`${status}-rejected-unchanged`);
  }
  assert.equal((await f.audits()).total, 2);
  assert.deepEqual((await f.subscription()).usage, {
    consumed: 220,
    reserved: 100,
  });
  f.check("subscription-ledger-and-success-audits-agree");
});

test("two concurrent HTTP reconciliations have one durable winner and one audit fact", async (t) => {
  const f = await reconciliationFixture(t, "concurrent");
  f.seed("race");
  const amounts = [11, 17];
  const responses = await Promise.all(
    amounts.map((amount) => f.reconcile("race", amount)),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winner = amounts[responses.findIndex((r) => r.status === 200)]!;
  const loser = responses.find((r) => r.status === 409)!;
  assert.equal(
    ((await loser.json()) as { error: { code: string } }).error.code,
    "RECONCILIATION_CONFLICT",
  );
  assert.equal((await f.row("race")).amount, winner);
  assert.equal((await f.row("race")).status, "settled");
  const audits = await f.audits();
  assert.equal(audits.total, 1);
  assert.equal(audits.items[0]!.target, "race");
  assert.deepEqual((await f.subscription()).usage, {
    consumed: winner,
    reserved: 0,
  });
  f.check("concurrent-one-200-one-409-one-audit-and-correct-balance");
  await f.denied("race", winner, 409, "RECONCILIATION_CONFLICT");
  f.check("winner-cannot-be-reconciled-again");
});

test("reconciliation rejects role device and foreign tenant authority while admin retains authorized access", async (t) => {
  const f = await reconciliationFixture(t, "authorization");
  f.seed("authority");
  for (const role of ["operator", "auditor", "member", "admin"]) {
    const email = `reconcile-${role}@example.test`;
    assert.equal(
      (
        await f.request(`${f.p}/members`, "POST", {
          name: role,
          email,
          password: f.password,
          role,
          seat: true,
        })
      ).status,
      201,
    );
    const token = await f.login(email);
    if (role === "admin") {
      assert.equal((await f.reconcile("authority", 19, token)).status, 200);
      f.check("admin-identity-permission-can-reconcile");
    } else {
      await f.denied("authority", 19, 403, "FORBIDDEN", token);
      f.check(`${role}-cannot-reconcile`);
    }
  }
  const foreignToken = await f.login("reconciliation-b@example.test");
  await f.denied("authority", 19, 403, "TENANT_MISMATCH", foreignToken);
  f.check("foreign-tenant-url-denied");
  f.seed(
    "foreign-entry",
    "uncertain",
    100,
    f.foreign.tenantId,
    f.foreign.userId,
  );
  const response = await f.reconcile("foreign-entry", 19);
  assert.equal(response.status, 404);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "NOT_FOUND",
  );
  f.check("foreign-entry-id-hidden-as-not-found");
  const deviceResponse = await f.request("/api/auth/device-tokens", "POST", {});
  assert.equal(deviceResponse.status, 201);
  const device = (await deviceResponse.json()) as { token: string; id: string };
  await f.denied("authority", 19, 403, "DEVICE_SCOPE", device.token);
  assert.equal(
    (await f.request(`/api/auth/device-tokens/${device.id}`, "DELETE")).status,
    204,
  );
  f.check("device-cannot-reconcile-and-is-revoked");
  await f.denied("authority", 19, 401, "UNAUTHENTICATED", "");
  f.check("unauthenticated-request-denied");
  assert.equal((await f.audits()).total, 1);
  assert.equal((await f.row("authority")).amount, 19);
  f.check("all-authority-rejections-keep-one-admin-write");
});

test("invalid reconciliation bodies leave uncertain state and audit untouched over HTTP", async (t) => {
  const f = await reconciliationFixture(t, "validation");
  f.seed("validation");
  const before = await f.row("validation");
  for (const body of [
    { amount: -1, evidenceReference: "synthetic" },
    { amount: 0.5, evidenceReference: "synthetic" },
    { amount: 1000000000001, evidenceReference: "synthetic" },
    { amount: 10, evidenceReference: "" },
    { amount: 10 },
    { amount: 10, evidenceReference: "synthetic", extra: true },
  ]) {
    const response = await f.request(
      `${f.p}/usage/validation/reconcile`,
      "PUT",
      body,
    );
    assert.equal(response.status, 400);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "VALIDATION",
    );
    assert.deepEqual(await f.row("validation"), before);
    assert.equal((await f.audits()).total, 0);
    f.check(`invalid-body-${JSON.stringify(body)}-unchanged`);
  }
});
