import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
const evidence = resolve("evidence/client-user-permission-journey-20261017");
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-user-journey-"));
  const key = randomBytes(32),
    vendorKey = randomBytes(32).toString("hex");
  let calls = 0,
    heldResolve!: () => void,
    release!: () => void;
  const held = new Promise<void>((done) => {
    heldResolve = done;
  });
  const released = new Promise<void>((done) => {
    release = done;
  });
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      messages: { content: string }[];
    };
    calls++;
    if (body.messages.at(-1)?.content === "hold") {
      heldResolve();
      await released;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "controlled-result" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const options = {
    database: join(directory, "backend.sqlite"),
    masterKey: key,
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: false,
  };
  let app = await createApp(options),
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const checks: { label: string; status: number }[] = [];
  t.after(async () => {
    release();
    try {
      provider.closeAllConnections();
      await new Promise<void>((done) => provider.close(() => done()));
    } finally {
      try {
        app.server.closeAllConnections();
        await app.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  async function call(
    label: string,
    method: string,
    path: string,
    token = "",
    body?: unknown,
    expected = 200,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        connection: "close",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, expected, label);
    assert.ok(
      !text.includes(vendorKey),
      "provider credential is never projected",
    );
    checks.push({ label, status: response.status });
    return {
      body: (text ? JSON.parse(text) : {}) as Row,
      headers: response.headers,
    };
  }
  const api = async (
    label: string,
    method: string,
    path: string,
    token = "",
    body?: unknown,
    expected = 200,
    extra?: Record<string, string>,
  ) => (await call(label, method, path, token, body, expected, extra)).body;
  const password = "Synthetic-user-journey-password!";
  const a = await bootstrap(app.services.db, {
    name: "Journey A",
    email: "journey-owner-a@example.test",
    password,
  });
  const b = await bootstrap(app.services.db, {
    name: "Journey B",
    email: "journey-owner-b@example.test",
    password,
  });
  const login = async (email: string, tenantId?: string) => {
    const response = await call(
      "interactive-login",
      "POST",
      "/api/auth/login",
      "",
      { email, password, ...(tenantId ? { tenantId } : {}) },
    );
    return {
      token: String(response.body.token),
      cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    };
  };
  const ownerA = await login("journey-owner-a@example.test"),
    ownerB = await login("journey-owner-b@example.test");
  const pa = `/api/tenants/${a.tenantId}`,
    pb = `/api/tenants/${b.tenantId}`;
  const parent = await api(
    "create-A-parent",
    "POST",
    `${pa}/departments`,
    ownerA.token,
    { name: "Parent" },
    201,
  );
  const child = await api(
    "create-A-child",
    "POST",
    `${pa}/departments`,
    ownerA.token,
    { name: "Child", parentId: parent.id },
    201,
  );
  const otherDepartment = await api(
    "create-A-other-department",
    "POST",
    `${pa}/departments`,
    ownerA.token,
    { name: "Other" },
    201,
  );
  const alice = await api(
    "create-Alice",
    "POST",
    `${pa}/members`,
    ownerA.token,
    {
      name: "Alice",
      email: "journey-alice@example.test",
      password,
      role: "member",
      seat: true,
      departmentId: child.id,
    },
    201,
  );
  const bob = await api(
    "create-Bob",
    "POST",
    `${pa}/members`,
    ownerA.token,
    {
      name: "Bob",
      email: "journey-bob@example.test",
      password,
      role: "member",
      seat: true,
      departmentId: child.id,
    },
    201,
  );
  // Explicit initial fixture seed only: local membership joining an existing
  // user is normally enterprise synchronization, which this test excludes.
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'operator',1)",
    b.tenantId,
    String(alice.id),
  );
  const aliceA = await login("journey-alice@example.test", a.tenantId),
    bobA = await login("journey-bob@example.test", a.tenantId);
  async function makeModel(prefix: string, owner: string, scope: unknown) {
    const credential = await api(
      "create-provider-reference",
      "POST",
      `${prefix}/credentials`,
      owner,
      { name: "Controlled", value: vendorKey },
      201,
    );
    return api(
      "create-provider-model",
      "POST",
      `${prefix}/models`,
      owner,
      {
        name: "Controlled",
        upstreamModel: "controlled",
        baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
        credentialId: credential.id,
        scope,
      },
      201,
    );
  }
  const modelA = await makeModel(pa, ownerA.token, {
      departments: [parent.id],
    }),
    modelB = await makeModel(pb, ownerB.token, { all: true });
  const completion = (model = modelA.id, content = "controlled") => ({
    model,
    messages: [{ role: "user", content }],
    max_tokens: 16,
  });
  const allowance = (token = aliceA.token) =>
    api("read-own-entitlement", "GET", "/api/client/entitlement", token);
  const limit = (subjectType: string, subjectId: unknown, amount: number) =>
    api("set-current-budget-rule", "PUT", `${pa}/limits`, ownerA.token, {
      subjectType,
      subjectId,
      amount,
    });
  const removeLimit = (subjectType: string, subjectId: unknown) =>
    api(
      "remove-current-budget-rule",
      "DELETE",
      `${pa}/limits/${subjectType}/${subjectId}`,
      ownerA.token,
      undefined,
      204,
    );
  const record = async (name: string, values: Row) => {
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, `${name}.json`),
      JSON.stringify(
        {
          status: "passed",
          checks,
          localSupplierCalls: calls,
          realSupplierCalls: 0,
          ...values,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  };
  return {
    get app() {
      return app;
    },
    get origin() {
      return origin;
    },
    a,
    b,
    pa,
    pb,
    ownerA,
    ownerB,
    alice,
    bob,
    aliceA,
    bobA,
    parent,
    child,
    otherDepartment,
    modelA,
    modelB,
    completion,
    api,
    call,
    login,
    allowance,
    limit,
    removeLimit,
    calls: () => calls,
    held,
    release,
    record,
    async reopen() {
      app.server.closeAllConnections();
      await app.close();
      app = await createApp(options);
      origin = await app.listen({ host: "127.0.0.1", port: 0 });
    },
  };
}

test("client quota projection includes sibling department usage and preserves personal legacy fields", async (t) => {
  const f = await fixture(t);
  await f.api(
    "Bob-consumes-five-credits",
    "POST",
    "/v1/chat/completions",
    f.bobA.token,
    f.completion(),
  );
  await f.limit("member", f.alice.id, 200);
  await f.limit("department", f.parent.id, 5);
  const projection = await f.allowance();
  assert.equal(projection.amountTotal, 200);
  assert.equal(projection.amountUsed, 0);
  const effective = projection.effectiveAllowance as Row;
  assert.ok(
    effective,
    "client must expose effective allowance rather than misstate shared availability",
  );
  assert.equal(effective.application, "uwork");
  assert.equal(effective.amountRemaining, 0);
  assert.equal(effective.blocked, true);
  assert.equal(effective.reason, "quota_exhausted");
  await f.api(
    "shared-ancestor-budget-rejects-before-dispatch",
    "POST",
    "/v1/chat/completions",
    f.aliceA.token,
    f.completion(),
    402,
  );
  assert.equal(f.calls(), 1);
  await f.record("department-allowance", {
    personalAmountTotal: projection.amountTotal,
    personalAmountUsed: projection.amountUsed,
    effectiveAllowance: effective,
  });
});

test("all effective quota families share admission state through reservations, reconciliation, restart and expiry", async (t) => {
  const f = await fixture(t);
  await f.api(
    "Alice-consumes-five",
    "POST",
    "/v1/chat/completions",
    f.aliceA.token,
    f.completion(),
  );
  await f.api(
    "Bob-consumes-five",
    "POST",
    "/v1/chat/completions",
    f.bobA.token,
    f.completion(),
  );
  const checkRemaining = async (expected: number, label: string) => {
    const value = await f.allowance();
    assert.equal(
      (value.effectiveAllowance as Row).amountRemaining,
      expected,
      label,
    );
    assert.equal(value.amountUsed, 5);
    const effective = value.effectiveAllowance as Row;
    assert.equal("used" in effective, false);
    assert.equal("subjectId" in effective, false);
    assert.ok(
      !JSON.stringify(effective).includes(String(f.bob.id)),
      "no sibling identity in budget projection",
    );
    return value;
  };
  await f.limit("member", f.alice.id, 40);
  await f.limit("department", f.parent.id, 60);
  await checkRemaining(35, "member capacity minus own consumption");
  await f.limit("department", f.child.id, 12);
  await checkRemaining(2, "nearest department capacity includes both members");
  await f.removeLimit("department", f.child.id);
  await f.limit("application", "uwork", 17);
  await checkRemaining(7, "application capacity includes sibling consumption");
  await f.limit("tenant", f.a.tenantId, 13);
  await checkRemaining(3, "explicit tenant rule wins over larger subscription");
  await f.limit("application", "unrelated-app", 0);
  await checkRemaining(
    3,
    "unrelated application never affects UWork allowance",
  );
  const time = Date.now();
  const subscription = (
    credits: number,
    startsAt = time - 100000,
    endsAt = time + 86400000,
  ) =>
    f.api(
      "update-subscription-boundary",
      "PUT",
      `${f.pa}/subscription`,
      f.ownerA.token,
      { seats: 10, credits, startsAt, endsAt, metering: "calendar" },
    );
  await subscription(11);
  await checkRemaining(1, "subscription itself is also a shared upper bound");
  await subscription(1000);
  await f.limit("tenant", f.a.tenantId, 10);
  const exhausted = await checkRemaining(
    0,
    "zero positive-Credit capacity is exposed",
  );
  assert.equal((exhausted.effectiveAllowance as Row).blocked, true);
  const model = (
    (await f.api(
      "read-original-model-for-free-variant",
      "GET",
      `${f.pa}/models`,
      f.ownerA.token,
    )) as unknown as Row[]
  )[0]!;
  const free = await f.api(
    "create-explicit-zero-rate-model",
    "POST",
    `${f.pa}/models`,
    f.ownerA.token,
    {
      name: "Free controlled model",
      ...(model.data as Row),
      scope: { all: true },
      inputRate: 0,
      outputRate: 0,
    },
    201,
  );
  await f.api(
    "zero-rate-request-preserves-existing-zero-cost-rule",
    "POST",
    "/v1/chat/completions",
    f.aliceA.token,
    f.completion(free.id),
  );
  await checkRemaining(
    0,
    "zero-cost execution does not consume positive budget",
  );
  await f.limit("tenant", f.a.tenantId, 1000);
  await f.limit("member", f.alice.id, 2000);
  await f.limit("department", f.parent.id, 1000);
  await f.limit("application", "uwork", 1000);
  const controller = new AbortController();
  const pending = fetch(f.origin + "/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${f.bobA.token}`,
      "idempotency-key": "journey-held-reservation",
    },
    body: JSON.stringify(f.completion(undefined, "hold")),
  })
    .then((response) => response.text())
    .catch(() => "cancelled");
  await f.held;
  const reserved = f.app.services.db.get<{ reserved: number; status: string }>(
    "SELECT reserved,status FROM ledger WHERE request_key=?",
    "journey-held-reservation",
  )!;
  assert.equal(reserved.status, "reserved");
  const during = await checkRemaining(
    1000 - 10 - reserved.reserved,
    "live sibling preoccupation reduces effective capacity",
  );
  controller.abort();
  await pending;
  for (let i = 0; i < 100; i++) {
    if (
      f.app.services.db.get<{ status: string }>(
        "SELECT status FROM ledger WHERE request_key=?",
        "journey-held-reservation",
      )?.status === "uncertain"
    )
      break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(
    f.app.services.db.get<{ status: string }>(
      "SELECT status FROM ledger WHERE request_key=?",
      "journey-held-reservation",
    )!.status,
    "uncertain",
  );
  await checkRemaining(
    1000 - 10 - reserved.reserved,
    "uncertain keeps the same held budget",
  );
  f.release();
  await f.reopen();
  await checkRemaining(
    1000 - 10 - reserved.reserved,
    "file-backed restart cannot lose shared uncertain consumption",
  );
  const entry = f.app.services.db.get<{ id: string }>(
    "SELECT id FROM ledger WHERE request_key=?",
    "journey-held-reservation",
  )!;
  await f.api(
    "owner-reconciles-with-controlled-evidence",
    "PUT",
    `${f.pa}/usage/${entry.id}/reconcile`,
    f.ownerA.token,
    { amount: 3, evidenceReference: "controlled:journey-provider-receipt" },
  );
  await checkRemaining(
    987,
    "reconciliation restores only independently evidenced capacity",
  );
  await new Promise((done) => setTimeout(done, 5));
  const aliceUsage = await f.api(
    "Alice-usage-remains-personal",
    "GET",
    "/api/client/usage",
    f.aliceA.token,
  );
  const bobUsage = await f.api(
    "Bob-usage-matches-reconciled-personal-ledger",
    "GET",
    "/api/client/usage",
    f.bobA.token,
  );
  assert.equal((aliceUsage.summary as Row).cost, 5);
  assert.equal((bobUsage.summary as Row).cost, 8);
  await f.api(
    "member-cannot-inspect-shared-aggregate",
    "GET",
    `${f.pa}/usage/aggregates?groupBy=department`,
    f.aliceA.token,
    undefined,
    403,
  );
  await subscription(1000, Date.now() - 2000, Date.now() - 1000);
  const inactive = await checkRemaining(
    0,
    "inactive subscription exposes no effective allowance",
  );
  assert.equal(
    (inactive.effectiveAllowance as Row).reason,
    "subscription_inactive",
  );
  await f.api(
    "inactive-budget-denies-model-before-dispatch",
    "POST",
    "/v1/chat/completions",
    f.aliceA.token,
    f.completion(),
    402,
  );
  await f.record("quota-reservation-restart", {
    personalAliceCost: 5,
    personalBobCost: 8,
    sharedSettledCredits: 13,
    heldReservedCredits: reserved.reserved,
    duringEffectiveAllowance: during.effectiveAllowance,
    inactiveEffectiveAllowance: inactive.effectiveAllowance,
    ownedFileDatabaseRestarted: true,
  });
});

test("multi-organization session switch keeps configuration, policy, historical usage and revocation tenant-bound", async (t) => {
  const f = await fixture(t);
  async function publish(prefix: string, token: string, welcome: string) {
    await f.api(
      "save-organization-welcome",
      "PUT",
      `${prefix}/configurations/new-chat`,
      token,
      {
        revision: 0,
        data: { welcome, riskNotice: "Synthetic organization notice" },
      },
    );
    await f.api(
      "publish-organization-welcome",
      "POST",
      `${prefix}/configurations/new-chat/publish`,
      token,
      { revision: 1 },
    );
  }
  await publish(f.pa, f.ownerA.token, "Organization A welcome");
  await publish(f.pb, f.ownerB.token, "Organization B welcome");
  await f.api(
    "create-A-department-security",
    "POST",
    `${f.pa}/policies/security`,
    f.ownerA.token,
    {
      name: "A department",
      scope: { departments: [f.parent.id] },
      priority: 10,
      data: { allowFilesystem: true },
    },
    201,
  );
  await f.api(
    "create-Bob-specific-security",
    "POST",
    `${f.pa}/policies/security`,
    f.ownerA.token,
    {
      name: "Bob",
      scope: { members: [f.bob.id] },
      priority: 20,
      data: { allowFilesystem: false },
    },
    201,
  );
  const before = await f.call(
    "Alice-cannot-query-Bob-policy-projection",
    "GET",
    `/api/client/configuration?userId=${f.bob.id}`,
    f.aliceA.token,
    undefined,
    200,
    { "x-user-id": String(f.bob.id), "x-tenant-id": f.b.tenantId },
  );
  assert.equal(before.body.tenantId, f.a.tenantId);
  assert.equal((before.body.security as Row).allowFilesystem, true);
  assert.equal(
    ((before.body.configuration as Row)["new-chat"] as Row).welcome,
    "Organization A welcome",
  );
  await f.api(
    "member-cannot-query-other-member-permission-simulation",
    "GET",
    `${f.pa}/permissions/${f.bob.id}`,
    f.aliceA.token,
    undefined,
    403,
  );
  const device = await f.api(
    "create-A-bound-device",
    "POST",
    "/api/auth/device-tokens",
    f.aliceA.token,
    { ttlHours: 1 },
    201,
  );
  await f.api(
    "A-interactive-consumption",
    "POST",
    "/v1/chat/completions",
    f.aliceA.token,
    f.completion(),
    200,
    { "idempotency-key": "same-user-different-tenant" },
  );
  const switched = await f.call(
    "cookie-switch-to-organization-B",
    "POST",
    "/api/auth/switch",
    "",
    { tenantId: f.b.tenantId },
    200,
    { cookie: f.aliceA.cookie, origin: "http://localhost:3000" },
  );
  const tokenB = String(switched.body.token);
  await f.api(
    "old-A-interactive-token-revoked",
    "GET",
    "/api/auth/me",
    f.aliceA.token,
    undefined,
    401,
  );
  await f.api(
    "old-A-cookie-revoked",
    "GET",
    "/api/auth/me",
    "",
    undefined,
    401,
    { cookie: f.aliceA.cookie },
  );
  const bConfig = await f.api(
    "B-current-configuration-ignores-forged-A-user",
    "GET",
    `/api/client/configuration?tenantId=${f.a.tenantId}&userId=${f.bob.id}`,
    tokenB,
  );
  assert.equal(bConfig.tenantId, f.b.tenantId);
  assert.equal(
    ((bConfig.configuration as Row)["new-chat"] as Row).welcome,
    "Organization B welcome",
  );
  assert.equal((bConfig.security as Row).allowFilesystem, false);
  const bModels = await f.api(
    "B-current-model-list",
    "GET",
    "/v1/models",
    tokenB,
  );
  assert.deepEqual(
    (bModels.data as Row[]).map((item) => item.id),
    [f.modelB.id],
  );
  await f.api(
    "same-request-key-is-independent-per-organization",
    "POST",
    "/v1/chat/completions",
    tokenB,
    f.completion(f.modelB.id),
    200,
    { "idempotency-key": "same-user-different-tenant" },
  );
  await f.api(
    "B-cannot-use-A-model-reference",
    "POST",
    "/v1/chat/completions",
    tokenB,
    f.completion(),
    404,
  );
  const deviceToken = String(device.token);
  const aDeviceConfig = await f.api(
    "A-device-stays-in-A-after-interactive-switch",
    "GET",
    "/api/client/configuration",
    deviceToken,
  );
  assert.equal(aDeviceConfig.tenantId, f.a.tenantId);
  await f.api(
    "A-device-still-consumes-A-budget",
    "POST",
    "/v1/chat/completions",
    deviceToken,
    f.completion(),
  );
  await f.api(
    "B-operator-can-read-B-directory",
    "GET",
    `${f.pb}/members`,
    tokenB,
  );
  await f.api(
    "B-role-demoted-without-changing-token",
    "PATCH",
    `${f.pb}/members/${f.alice.id}`,
    f.ownerB.token,
    { role: "member" },
  );
  await f.api(
    "B-current-role-rejects-directory-immediately",
    "GET",
    `${f.pb}/members`,
    tokenB,
    undefined,
    403,
  );
  await f.api(
    "B-seat-revoked-only-in-B",
    "PATCH",
    `${f.pb}/members/${f.alice.id}`,
    f.ownerB.token,
    { seat: false },
  );
  await f.api(
    "B-seat-rejects-config",
    "GET",
    "/api/client/configuration",
    tokenB,
    undefined,
    403,
  );
  await f.api(
    "A-device-seat-unaffected",
    "GET",
    "/api/client/configuration",
    deviceToken,
  );
  await f.api(
    "B-seat-restored",
    "PATCH",
    `${f.pb}/members/${f.alice.id}`,
    f.ownerB.token,
    { seat: true },
  );
  await f.api(
    "B-session-configuration-restored",
    "GET",
    "/api/client/configuration",
    tokenB,
  );
  await f.limit("department", f.parent.id, 0);
  await f.api(
    "move-Alice-out-of-A-parent",
    "PATCH",
    `${f.pa}/members/${f.alice.id}`,
    f.ownerA.token,
    { departmentId: f.otherDepartment.id },
  );
  const afterMove = await f.call(
    "existing-A-device-recomputes-scope-and-security",
    "GET",
    "/api/client/configuration",
    deviceToken,
  );
  assert.equal((afterMove.body.security as Row).allowFilesystem, false);
  assert.notEqual(afterMove.headers.get("etag"), before.headers.get("etag"));
  const movedModels = await f.api(
    "department-move-removes-A-parent-model",
    "GET",
    "/v1/models",
    deviceToken,
  );
  assert.equal((movedModels.data as Row[]).length, 0);
  await f.api(
    "department-move-rejects-old-A-model",
    "POST",
    "/v1/chat/completions",
    deviceToken,
    f.completion(),
    403,
  );
  const model = (
    (await f.api(
      "owner-reviews-A-model",
      "GET",
      `${f.pa}/models`,
      f.ownerA.token,
    )) as unknown as Row[]
  )[0]!;
  await f.api(
    "owner-grants-explicit-organization-model-scope",
    "PUT",
    `${f.pa}/models/${f.modelA.id}`,
    f.ownerA.token,
    {
      name: model.name,
      ...(model.data as Row),
      scope: { all: true },
      revision: model.revision,
    },
  );
  const movedQuota = await f.allowance(deviceToken);
  assert.equal(
    (movedQuota.effectiveAllowance as Row).blocked,
    false,
    "old department quota cannot govern moved member",
  );
  await f.api(
    "new-department-admission-preserves-old-department-facts",
    "POST",
    "/v1/chat/completions",
    deviceToken,
    f.completion(),
  );
  const facts = f.app.services.db.all<{
    department_id: string;
    amount: number;
  }>(
    "SELECT department_id,amount FROM ledger WHERE tenant_id=? AND user_id=? ORDER BY created_at,id",
    f.a.tenantId,
    String(f.alice.id),
  );
  assert.equal(
    facts.filter((row) => row.department_id === f.child.id).length,
    2,
  );
  assert.equal(
    facts.filter((row) => row.department_id === f.otherDepartment.id).length,
    1,
  );
  await f.api(
    "disable-A-membership-only",
    "PATCH",
    `${f.pa}/members/${f.alice.id}`,
    f.ownerA.token,
    { status: "disabled" },
  );
  await f.api(
    "A-device-revoked-on-A-disable",
    "GET",
    "/api/client/configuration",
    deviceToken,
    undefined,
    401,
  );
  await f.api(
    "B-session-survives-other-membership-disable",
    "POST",
    "/v1/chat/completions",
    tokenB,
    f.completion(f.modelB.id),
  );
  await f.reopen();
  await f.api(
    "reenable-A-after-file-restart",
    "PATCH",
    `${f.pa}/members/${f.alice.id}`,
    f.ownerA.token,
    { status: "active" },
  );
  await f.api(
    "reenabled-A-old-device-never-resurrects",
    "GET",
    "/api/auth/me",
    deviceToken,
    undefined,
    401,
  );
  await f.api(
    "reenabled-A-old-interactive-never-resurrects",
    "GET",
    "/api/auth/me",
    f.aliceA.token,
    undefined,
    401,
  );
  const freshA = await f.login("journey-alice@example.test", f.a.tenantId);
  const freshConfig = await f.api(
    "fresh-A-session-gets-A-current-policy",
    "GET",
    "/api/client/configuration",
    freshA.token,
  );
  assert.equal(freshConfig.tenantId, f.a.tenantId);
  await f.api(
    "B-member-cannot-read-admin-aggregate",
    "GET",
    `${f.pb}/usage/aggregates`,
    tokenB,
    undefined,
    403,
  );
  await new Promise((done) => setTimeout(done, 5));
  const usageA = await f.api(
    "A-own-usage-cannot-be-retargeted-to-B",
    "GET",
    `/api/client/usage?tenantId=${f.b.tenantId}&userId=${f.bob.id}`,
    freshA.token,
  );
  const usageB = await f.api(
    "B-own-usage-kept-separate-after-restart",
    "GET",
    "/api/client/usage",
    tokenB,
  );
  assert.equal((usageA.summary as Row).cost, 15);
  assert.equal((usageB.summary as Row).cost, 10);
  await f.record("multi-organization-policy-history", {
    aPersonalCredits: 15,
    bPersonalCredits: 10,
    oldDepartmentDispatches: 2,
    newDepartmentDispatches: 1,
    oldSessionCannotReviveAfterRestart: true,
  });
});
