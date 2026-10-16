import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Auth = { token?: string; cookie?: string };
type Session = { token: string; cookie: string };
type Device = { id: string; token: string };
type Me = {
  user: { id: string };
  tenant: { id: string };
  role: string;
  seat: boolean;
  kind: string;
  organizations: { id: string; role: string }[];
};
type Member = { id: string; role: string; status: string; seat: number };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function evidence(name: string, report: unknown) {
  const directory = process.env.UWORK_IDENTITY_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${name}.json`),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-identity-lifecycle-"));
  const key = randomBytes(32);
  const reservation = createServer();
  const state: { app?: Awaited<ReturnType<typeof createApp>> } = {};
  t.after(async () => {
    try {
      await state.app?.close();
    } finally {
      if (reservation.listening)
        await new Promise<void>((resolve) =>
          reservation.close(() => resolve()),
        );
      await rm(directory, { recursive: true, force: true });
    }
  });
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const options = {
    database: join(directory, "backend.sqlite"),
    masterKey: key,
    publicUrl: origin,
    worker: false,
  };
  state.app = await createApp(options);
  await state.app.listen({ host: "127.0.0.1", port });
  const passwords = {
    a: randomBytes(24).toString("hex"),
    b: randomBytes(24).toString("hex"),
  };
  const a = await bootstrap(state.app.services.db, {
    name: "Identity A",
    email: "identity-a@example.test",
    password: passwords.a,
  });
  const b = await bootstrap(state.app.services.db, {
    name: "Identity B",
    email: "identity-b@example.test",
    password: passwords.b,
  });
  // The only direct setup write beyond bootstrap: the same synthetic A user
  // starts in B as a member without a seat. All later business changes use HTTP.
  state.app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'member',0)",
    b.tenantId,
    a.userId,
  );
  async function call<T = Record<string, unknown>>(
    method: string,
    path: string,
    auth: Auth = {},
    body?: unknown,
    expected: number | readonly number[] = 200,
    errorCode?: string,
  ) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        connection: "close",
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.cookie ? { cookie: auth.cookie, origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const value = (text ? JSON.parse(text) : undefined) as T;
    if (typeof expected === "number")
      assert.equal(response.status, expected, `${method} ${path}`);
    else
      assert.ok(
        expected.includes(response.status),
        `${method} ${path} unexpected status ${response.status}`,
      );
    if (errorCode)
      assert.equal(
        (value as { error: { code: string } }).error.code,
        errorCode,
      );
    return { status: response.status, value, headers: response.headers };
  }
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    auth?: Auth,
    body?: unknown,
    expected = 200,
    errorCode?: string,
  ): Promise<T> {
    return (await call<T>(method, path, auth, body, expected, errorCode)).value;
  }
  function session(response: {
    value: { token: string };
    headers: Headers;
  }): Session {
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie);
    assert.ok(cookie.includes("HttpOnly"));
    assert.ok(cookie.includes("SameSite=Strict"));
    assert.ok(cookie.includes("Path=/"));
    assert.ok(cookie.includes("Max-Age=43200"));
    assert.ok(!cookie.includes("Secure"));
    assert.equal(
      cookie.split(";", 1)[0],
      `uwork_session=${response.value.token}`,
    );
    return { token: response.value.token, cookie: cookie.split(";", 1)[0]! };
  }
  async function login(
    which: "a" | "b",
    tenantId = which === "a" ? a.tenantId : b.tenantId,
  ) {
    return session(
      await call<{ token: string }>(
        "POST",
        "/api/auth/login",
        {},
        {
          email: `identity-${which}@example.test`,
          password: passwords[which],
          tenantId,
        },
      ),
    );
  }
  const switchTo = async (auth: Auth, tenantId: string) =>
    session(
      await call<{ token: string }>("POST", "/api/auth/switch", auth, {
        tenantId,
      }),
    );
  const issue = (auth: Auth, replaceId?: string) =>
    api<Device>(
      "POST",
      "/api/auth/device-tokens",
      auth,
      { ttlHours: 1, ...(replaceId ? { replaceId } : {}) },
      201,
    );
  const me = (auth: Auth) => api<Me>("GET", "/api/auth/me", auth);
  const members = (tenantId: string, auth: Auth) =>
    api<{ items: Member[] }>("GET", `/api/tenants/${tenantId}/members`, auth);
  async function reopen() {
    await state.app!.close();
    state.app = await createApp(options);
    await state.app.listen({ host: "127.0.0.1", port });
  }
  return {
    a,
    b,
    passwords,
    api,
    call,
    login,
    switchTo,
    issue,
    me,
    members,
    reopen,
    get db() {
      return state.app!.services.db;
    },
    session,
  };
}

test("switching a shared user changes cookie/role/seat projection while A devices remain governed by A", async (t) => {
  const f = await fixture(t);
  const first = await f.login("a"),
    adminB = await f.login("b");
  const device = await f.issue({ token: first.token });
  for (const [tenantId, token, welcome] of [
    [f.a.tenantId, first.token, "A welcome"],
    [f.b.tenantId, adminB.token, "B welcome"],
  ] as const) {
    const path = `/api/tenants/${tenantId}/configurations/new-chat`;
    const saved = await f.api<{ revision: number }>(
      "PUT",
      path,
      { token },
      { revision: 0, data: { welcome, riskNotice: "Synthetic risk notice" } },
    );
    await f.api(
      "POST",
      `${path}/publish`,
      { token },
      { revision: saved.revision },
    );
  }
  const switched = await f.switchTo({ cookie: first.cookie }, f.b.tenantId);
  assert.notEqual(switched.token, first.token);
  await f.api(
    "GET",
    "/api/auth/me",
    { token: first.token },
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  await f.api(
    "GET",
    "/api/auth/me",
    { cookie: first.cookie },
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  const before = await f.me({ cookie: switched.cookie });
  assert.deepEqual(
    {
      user: before.user.id,
      tenant: before.tenant.id,
      role: before.role,
      seat: before.seat,
      kind: before.kind,
    },
    {
      user: f.a.userId,
      tenant: f.b.tenantId,
      role: "member",
      seat: false,
      kind: "session",
    },
  );
  assert.equal(
    before.organizations.find((o) => o.id === f.a.tenantId)!.role,
    "owner",
  );
  await f.api(
    "GET",
    "/api/client/configuration",
    { cookie: switched.cookie },
    undefined,
    403,
    "NO_SEAT",
  );
  await f.api(
    "POST",
    "/api/auth/switch",
    { token: device.token },
    { tenantId: f.b.tenantId },
    403,
    "DEVICE_SCOPE",
  );
  await f.api(
    "GET",
    `/api/tenants/${f.b.tenantId}/members`,
    { token: device.token },
    undefined,
    403,
    "TENANT_MISMATCH",
  );
  const deviceMe = await f.me({ token: device.token });
  assert.deepEqual(
    {
      tenant: deviceMe.tenant.id,
      role: deviceMe.role,
      seat: deviceMe.seat,
      kind: deviceMe.kind,
    },
    { tenant: f.a.tenantId, role: "owner", seat: true, kind: "device" },
  );
  const aConfig = await f.api<{
    tenantId: string;
    configuration: Record<string, { welcome?: string }>;
  }>("GET", "/api/client/configuration", { token: device.token });
  assert.equal(aConfig.tenantId, f.a.tenantId);
  assert.equal(aConfig.configuration["new-chat"]!.welcome, "A welcome");
  await f.api(
    "PATCH",
    `/api/tenants/${f.b.tenantId}/members/${f.a.userId}`,
    adminB,
    { role: "auditor", seat: true },
  );
  const fresh = await f.me({ cookie: switched.cookie });
  assert.equal(fresh.role, "auditor");
  assert.equal(fresh.seat, true);
  const bConfig = await f.api<{
    tenantId: string;
    configuration: Record<string, { welcome?: string }>;
  }>("GET", "/api/client/configuration", { cookie: switched.cookie });
  assert.equal(bConfig.tenantId, f.b.tenantId);
  assert.equal(bConfig.configuration["new-chat"]!.welcome, "B welcome");
  assert.equal((await f.me({ token: device.token })).role, "owner");
  await f.api(
    "GET",
    `/api/tenants/${f.a.tenantId}/members`,
    { cookie: switched.cookie },
    undefined,
    403,
    "TENANT_MISMATCH",
  );
  await f.api("POST", "/api/auth/logout", { cookie: switched.cookie }, {}, 204);
  assert.equal((await f.me({ token: device.token })).tenant.id, f.a.tenantId);
  await evidence("switch-device-isolation", {
    passed: true,
    oldInteractiveTokenAndCookieRevoked: true,
    newCookieAttributesValidated: true,
    sharedUserBInitiallyMemberWithoutSeat: true,
    currentBProjectionAuditorWithSeat: true,
    deviceStaysAOwnerWithSeat: true,
    crossTenantDenied: true,
  });
});

test("device replacement and revokeDevices isolate current tenant/user and never revoke interactive or foreign IDs", async (t) => {
  const f = await fixture(t);
  const initialA = await f.login("a"),
    ownerB = await f.login("b");
  const currentB = await f.switchTo(initialA, f.b.tenantId);
  const currentA = await f.login("a"),
    otherInteractiveA = await f.login("a");
  await f.api(
    "PATCH",
    `/api/tenants/${f.b.tenantId}/members/${f.a.userId}`,
    ownerB,
    { seat: true },
  );
  const aDevice = await f.issue(currentA),
    bDevice = await f.issue(currentB),
    foreignBDevice = await f.issue(ownerB);
  const password = randomBytes(24).toString("hex");
  await f.api(
    "POST",
    `/api/tenants/${f.a.tenantId}/members`,
    currentA,
    {
      name: "Foreign A user",
      email: "identity-foreign@example.test",
      password,
      role: "member",
      seat: true,
    },
    201,
  );
  const foreign = f.session(
    await f.call<{ token: string }>(
      "POST",
      "/api/auth/login",
      {},
      {
        email: "identity-foreign@example.test",
        password,
        tenantId: f.a.tenantId,
      },
    ),
  );
  const foreignADevice = await f.issue(foreign);
  const replacements = [];
  for (const foreignId of [
    bDevice.id,
    foreignADevice.id,
    digest(currentA.token),
  ])
    replacements.push(await f.issue(currentA, foreignId));
  for (const auth of [currentA, bDevice, foreignADevice]) await f.me(auth);
  for (const foreignId of [bDevice.id, foreignADevice.id])
    await f.api(
      "DELETE",
      `/api/auth/device-tokens/${foreignId}`,
      currentA,
      undefined,
      204,
    );
  await f.me(bDevice);
  await f.me(foreignADevice);
  const ownReplacement = await f.issue(currentA, aDevice.id);
  await f.api(
    "GET",
    "/api/auth/me",
    aDevice,
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  await f.me(ownReplacement);
  await f.api(
    "POST",
    "/api/auth/logout",
    bDevice,
    { revokeDevices: true },
    403,
    "DEVICE_SCOPE",
  );
  await f.me(bDevice);
  const loggedOut = await f.call(
    "POST",
    "/api/auth/logout",
    currentA,
    { revokeDevices: true },
    204,
  );
  assert.ok(loggedOut.headers.get("set-cookie")?.includes("Max-Age=0"));
  for (const auth of [currentA, ownReplacement, ...replacements])
    await f.api("GET", "/api/auth/me", auth, undefined, 401, "SESSION_EXPIRED");
  for (const auth of [
    otherInteractiveA,
    currentB,
    bDevice,
    foreignADevice,
    foreignBDevice,
  ])
    await f.me(auth);
  await f.api(
    "POST",
    "/api/auth/logout",
    currentB,
    { revokeDevices: true },
    204,
  );
  await f.api(
    "GET",
    "/api/auth/me",
    bDevice,
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  await f.me(foreignBDevice);
  await f.me(foreignADevice);
  await f.me(otherInteractiveA);
  await evidence("device-replacement-logout", {
    passed: true,
    currentDeviceReplaced: true,
    foreignUserTenantAndInteractiveIdsNotRevoked: true,
    crossScopeDeleteNoEffect: true,
    deviceCannotBulkRevoke: true,
    tenantScopedBulkRevoke: true,
    otherInteractiveSessionPreserved: true,
    ownCookieCleared: true,
  });
});

test("two owners concurrently demote themselves without ever removing the last active owner", async (t) => {
  const f = await fixture(t);
  const first = await f.login("a");
  const path = `/api/tenants/${f.a.tenantId}/members`;
  await f.api(
    "PATCH",
    `${path}/${f.a.userId}`,
    first,
    { role: "admin" },
    409,
    "LAST_OWNER",
  );
  const password = randomBytes(24).toString("hex");
  const second = await f.api<{ id: string }>(
    "POST",
    path,
    first,
    {
      name: "Second owner",
      email: "identity-owner-two@example.test",
      password,
      role: "owner",
      seat: true,
    },
    201,
  );
  const secondSession = f.session(
    await f.call<{ token: string }>(
      "POST",
      "/api/auth/login",
      {},
      {
        email: "identity-owner-two@example.test",
        password,
        tenantId: f.a.tenantId,
      },
    ),
  );
  const actors = [
    { id: f.a.userId, session: first },
    { id: second.id, session: secondSession },
  ];
  const responses = await Promise.all(
    actors.map((actor) =>
      f.call<{ error?: { code: string } }>(
        "PATCH",
        `${path}/${actor.id}`,
        actor.session,
        { role: "admin" },
        [200, 409],
      ),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    responses.find((r) => r.status === 409)!.value.error!.code,
    "LAST_OWNER",
  );
  const current = (await f.members(f.a.tenantId, first)).items;
  const activeOwners = current.filter(
    (m) => m.role === "owner" && m.status === "active",
  );
  assert.equal(activeOwners.length, 1);
  const remaining = actors.find((actor) => actor.id === activeOwners[0]!.id)!;
  const demoted = actors.find((actor) => actor.id !== remaining.id)!;
  assert.equal((await f.me(remaining.session)).role, "owner");
  assert.equal((await f.me(demoted.session)).role, "admin");
  await f.api(
    "PATCH",
    `${path}/${remaining.id}`,
    remaining.session,
    { status: "disabled" },
    409,
    "LAST_OWNER",
  );
  await f.api(
    "PATCH",
    `${path}/${remaining.id}`,
    demoted.session,
    { role: "admin" },
    403,
    "FORBIDDEN",
  );
  await f.api(
    "PATCH",
    `${path}/${demoted.id}`,
    demoted.session,
    { role: "owner" },
    403,
    "FORBIDDEN",
  );
  await f.api("PATCH", `${path}/${demoted.id}`, remaining.session, {
    role: "owner",
  });
  assert.equal((await f.me(demoted.session)).role, "owner");
  await f.api("PATCH", `${path}/${demoted.id}`, demoted.session, {
    status: "disabled",
  });
  await f.api(
    "GET",
    "/api/auth/me",
    demoted.session,
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  assert.equal(
    (await f.members(f.a.tenantId, remaining.session)).items.filter(
      (m) => m.role === "owner" && m.status === "active",
    ).length,
    1,
  );
  await f.api("PATCH", `${path}/${demoted.id}`, remaining.session, {
    status: "active",
  });
  assert.equal(
    (await f.members(f.a.tenantId, remaining.session)).items.filter(
      (m) => m.role === "owner" && m.status === "active",
    ).length,
    2,
  );
  // Re-enabling a member does not revive the revoked pre-disable session.
  await f.api(
    "GET",
    "/api/auth/me",
    demoted.session,
    undefined,
    401,
    "SESSION_EXPIRED",
  );
  await evidence("last-owner-concurrency", {
    passed: true,
    simultaneousSelfDemotionStatuses: responses.map((r) => r.status),
    rejectedCode: "LAST_OWNER",
    activeOwnersAfterRace: 1,
    demotedAdminCannotModifyOrCreateOwner: true,
    rePromotionThenDisablePreservesOneOwner: true,
    reEnableDoesNotReviveSession: true,
  });
});

test("login limit boundary and existing cookie survive file-database restart", async (t) => {
  const f = await fixture(t);
  const owner = await f.login("a");
  for (let i = 0; i < 9; i++)
    await f.api(
      "POST",
      "/api/auth/login",
      {},
      {
        email: "identity-a@example.test",
        password: "wrong-synthetic-password",
      },
      401,
      "INVALID_LOGIN",
    );
  await f.api(
    "POST",
    "/api/auth/login",
    {},
    { email: "identity-a@example.test", password: f.passwords.a },
    429,
    "RATE_LIMIT",
  );
  const counter = () =>
    f.db.get<{ count: number; reset_at: number }>(
      "SELECT count,reset_at FROM auth_limits WHERE key='login:127.0.0.1'",
    )!;
  const before = { ...counter() };
  assert.equal(before.count, 10);
  await f.reopen();
  assert.deepEqual({ ...counter() }, before);
  await f.api(
    "POST",
    "/api/auth/login",
    {},
    { email: "identity-b@example.test", password: f.passwords.b },
    429,
    "RATE_LIMIT",
  );
  assert.equal((await f.me({ cookie: owner.cookie })).user.id, f.a.userId);
  const logout = await f.call(
    "POST",
    "/api/auth/logout",
    { cookie: owner.cookie },
    {},
    204,
  );
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  await f.api("GET", "/api/auth/me", owner, undefined, 401, "SESSION_EXPIRED");
  assert.deepEqual({ ...counter() }, before);
  await evidence("login-limit-restart", {
    passed: true,
    attemptedBeforeLimit: 10,
    boundary: 429,
    persistedCount: before.count,
    resetDeadlineUnchanged: true,
    existingCookieSurvivesRestart: true,
    logoutWorksWhileLoginLimited: true,
  });
});

test("device limit persists across restart and cannot delete a replacement target on rejection or affect another tenant", async (t) => {
  const f = await fixture(t);
  const initialA = await f.login("a");
  const currentB = await f.switchTo(initialA, f.b.tenantId);
  const currentA = await f.login("a");
  const first = await f.issue(currentA);
  for (let i = 1; i < 60; i++) await f.issue(currentA);
  await f.api(
    "POST",
    "/api/auth/device-tokens",
    currentA,
    { replaceId: first.id },
    429,
    "RATE_LIMIT",
  );
  await f.me(first);
  const counter = () =>
    f.db.get<{ count: number; reset_at: number }>(
      "SELECT count,reset_at FROM auth_limits WHERE key=?",
      `device:${f.a.tenantId}:${f.a.userId}`,
    )!;
  const before = { ...counter() };
  assert.equal(before.count, 60);
  await f.reopen();
  assert.deepEqual({ ...counter() }, before);
  await f.api(
    "POST",
    "/api/auth/device-tokens",
    currentA,
    { replaceId: first.id },
    429,
    "RATE_LIMIT",
  );
  await f.me(first);
  const otherTenant = await f.issue(currentB, first.id);
  assert.equal((await f.me(otherTenant)).tenant.id, f.b.tenantId);
  await f.me(first);
  await f.api("GET", "/v1/models", otherTenant, undefined, 403, "NO_SEAT");
  assert.equal(
    (await f.api<Device[]>("GET", "/api/auth/device-tokens", currentA)).length,
    60,
  );
  assert.equal(
    (await f.api<Device[]>("GET", "/api/auth/device-tokens", currentB)).length,
    1,
  );
  assert.deepEqual({ ...counter() }, before);
  await evidence("device-limit-restart", {
    passed: true,
    admittedCurrentTenant: 60,
    limitedReplacementDoesNotRevokeTarget: true,
    countAndResetPersistAcrossRestart: true,
    otherTenantCanIssueIndependently: true,
    otherTenantNoSeatStillDeniedExecution: true,
  });
});
