import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrimaryLoginHold,
  primaryLoginPublicConfig,
} from "./native-primary-login.mjs";
import { assertPrimaryCommand } from "./native-primary-login-adapter.mjs";
import {
  wecomIdentityConfigSchema,
  resolveWeComIdentityOrganization,
} from "../../clients/uwork/packages/shared/src/wecom-identity-config.ts";
import {
  createTwoOrganizationAuth,
  twoOrganizationPublicConfig,
  TWO_ORG_PROFILES,
  twoOrganizationModeEnabled,
  twoOrganizationExecutionModeEnabled,
  assertTwoOrganizationCommand,
} from "./native-two-organization-login.mjs";
const origin = "https://127.0.0.1:50301",
  nonce = "N".repeat(43),
  tokens = { A: "A".repeat(43), B: "B".repeat(43) };
const errorCode = (code) => (e) => e?.code === code;
test("native organization execution is explicit and cannot activate outside dual login", () => {
  assert.equal(twoOrganizationExecutionModeEnabled(true, undefined), false);
  assert.equal(twoOrganizationExecutionModeEnabled(false, undefined), false);
  assert.equal(twoOrganizationExecutionModeEnabled(true, "controlled"), true);
  assert.throws(
    () => twoOrganizationExecutionModeEnabled(false, "controlled"),
    errorCode("execution-mode"),
  );
  assert.throws(
    () => twoOrganizationExecutionModeEnabled(true, "true"),
    errorCode("execution-mode"),
  );
});
function url(state) {
  const u = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [k, v] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state,
    login_type: "CorpApp",
    lang: "zh",
  }))
    u.searchParams.set(k, v);
  return u;
}
function apiFor(key) {
  let member, secret;
  const api = async (path, method = "GET", body) => {
    if (method === "POST" && path.endsWith("/credentials")) {
      secret = body.value;
      return { id: "credential-" + key };
    }
    if (method === "POST" && path.endsWith("/departments"))
      return { id: "department-" + key };
    if (method === "POST" && path.endsWith("/members")) {
      member = {
        id: "member-" + key,
        email: body.email,
        name: body.name,
        role: body.role,
        status: "active",
        seat: body.seat,
        department_id: body.departmentId,
      };
      return { id: member.id };
    }
    if (
      method === "PUT" &&
      path.endsWith("/wecom") &&
      path.includes("/members/")
    ) {
      member.external_id = body.externalId;
      return { ok: true };
    }
    if (method === "PUT" && path.endsWith("/wecom")) return { ok: true };
    if (method === "GET" && path.includes("/members?q="))
      return { items: [member] };
    throw Error("Unexpected fixture API");
  };
  return { api, secret: () => secret };
}
async function fixture(sharedSession = false) {
  let clock = 1000,
    callbacks = 0;
  const apis = { A: apiFor("A"), B: apiFor("B") };
  let control;
  control = createTwoOrganizationAuth({
    origin,
    nonce,
    makeHold: createPrimaryLoginHold,
    now: () => clock,
    sendCallback: async (u) => {
      const key = u.searchParams.get("state").endsWith("A") ? "A" : "B";
      callbacks++;
      await control.provider.identity(
        {
          tenant_id: "tenant-" + key,
          corp_id: "ww-synthetic-never-called",
          agent_id: "1",
          credential_id: "credential-" + key,
        },
        apis[key].secret(),
        u.searchParams.get("code"),
      );
      return 200;
    },
  });
  const metadata = await control.seed({
    A: { tenantId: "tenant-A", api: apis.A.api },
    B: { tenantId: "tenant-B", api: apis.B.api },
    certificate: Buffer.from("UNIT_ONLY"),
  });
  const response = (path, status, body, extra = {}) =>
    control.observeResponse({
      path,
      status,
      payload: body === undefined ? "" : JSON.stringify(body),
      ...extra,
    });
  const start = (key, extra = {}) =>
    response(
      "/api/auth/wecom/attempts",
      201,
      {
        id: "state-" + key,
        proof: "unit-proof-" + key,
        authorizeUrl: url("state-" + key).href,
        expiresAt: 301000,
      },
      { method: "POST", requestTenantId: "tenant-" + key, ...extra },
    );
  const scope = (key) => ({
    nonce,
    ownerId: 7,
    webContentsId: key === "A" ? 8 : 9,
    sessionId: sharedSession ? "session-common" : "session-" + key,
  });
  const capture = (key, extra = {}) => {
    const s = scope(key);
    control.hold.bindGuest(s);
    control.hold.captureSso(
      {
        ...s,
        id: key === "A" ? 11 : 12,
        method: "GET",
        resourceType: "mainFrame",
        url: url("state-" + key).href,
        ...extra,
      },
      () => {},
    );
  };
  const pending = (key) => {
    clock++;
    return response(
      `/api/auth/wecom/attempts/state-${key}/claim`,
      200,
      { status: "pending" },
      { method: "POST" },
    );
  };
  const me = (key, extra = {}) =>
    response(
      "/api/auth/me",
      200,
      {
        user: { id: "member-" + key, email: TWO_ORG_PROFILES[key].email },
        tenant: { id: "tenant-" + key },
        role: "member",
        seat: true,
        kind: "session",
        ...extra,
      },
      { method: "GET", authorization: "Bearer " + tokens[key] },
    );
  const finish = async (key) => {
    await control.completeCallback(key);
    response(
      `/api/auth/wecom/attempts/state-${key}/claim`,
      200,
      { status: "authorized", token: tokens[key], tenantId: "tenant-" + key },
      { method: "POST" },
    );
    me(key);
    control.hold.guestClosed(scope(key));
    control.hold.observePublicAuthenticated({
      nonce,
      ownerId: 7,
      authenticated: true,
    });
  };
  const login = async (key) => {
    start(key);
    capture(key);
    pending(key);
    await finish(key);
  };
  const logout = (authorization = "Bearer " + tokens.A) =>
    response("/api/auth/logout", 204, undefined, {
      method: "POST",
      authorization,
    });
  return {
    control,
    metadata,
    apis,
    response,
    start,
    capture,
    pending,
    finish,
    login,
    logout,
    me,
    scope,
    callbacks: () => callbacks,
    close: () => control.dispose(),
  };
}

test("actual shared schema parses same-Corp two orgs and resolver honors explicit A default and B", () => {
  const c = twoOrganizationPublicConfig(
    origin,
    { A: "tenant-A", B: "tenant-B" },
    primaryLoginPublicConfig,
    (raw) => wecomIdentityConfigSchema.parse(raw),
  );
  assert.equal(c.organizations.length, 2);
  assert.equal(c.organizations[0].corpId, c.organizations[1].corpId);
  assert.equal(resolveWeComIdentityOrganization(c).orgId, "tenant-A");
  assert.equal(
    resolveWeComIdentityOrganization(c, "tenant-B").orgId,
    "tenant-B",
  );
  assert.throws(() =>
    twoOrganizationPublicConfig(
      origin,
      { A: "tenant-A", B: "tenant-A" },
      primaryLoginPublicConfig,
      (raw) => wecomIdentityConfigSchema.parse(raw),
    ),
  );
});
test("actual single-slot holds complete A then real-owner logout then B each once", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    assert.equal(f.control.safeStatus().slots.A.guardSatisfied, true);
    assert.equal(f.logout(), true);
    await f.login("B");
    const s = f.control.safeStatus();
    assert.equal(s.callbackCount, 2);
    assert.equal(s.slots.B.guardSatisfied, true);
    assert.equal(s.slots.A.identityCount, 1);
    assert.equal(s.slots.B.identityCount, 1);
    assert.equal(f.callbacks(), 2);
    assert.notEqual(f.metadata.A.email, f.metadata.B.email);
    assert.notEqual(f.metadata.A.externalId, f.metadata.B.externalId);
  } finally {
    f.close();
  }
});
test("admin logout204 does not open B; unlogged-in B attempt is rejected", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    assert.equal(f.logout("Bearer " + "Z".repeat(43)), false);
    assert.equal(f.control.safeStatus().logoutAOwnerMatched, false);
    assert.throws(() => f.start("B"), errorCode("attempt_slot"));
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("claimed A token plus mismatching real me owner cannot open logout gate", async () => {
  const f = await fixture();
  try {
    f.start("A");
    f.capture("A");
    f.pending("A");
    await f.control.completeCallback("A");
    f.response(
      "/api/auth/wecom/attempts/state-A/claim",
      200,
      { status: "authorized", token: tokens.A, tenantId: "tenant-A" },
      { method: "POST" },
    );
    assert.throws(
      () => f.me("A", { tenant: { id: "tenant-B" } }),
      errorCode("me_owner"),
    );
    assert.equal(f.control.safeStatus().logoutAOwnerMatched, false);
    assert.equal(f.control.hold.safeStatus().failed, "me_owner");
  } finally {
    f.close();
  }
});
test("successful claim hash cannot rebind after me and open B with tokenX logout", async () => {
  const f = await fixture();
  try {
    f.start("A");
    f.capture("A");
    f.pending("A");
    await f.control.completeCallback("A");
    f.response(
      "/api/auth/wecom/attempts/state-A/claim",
      200,
      { status: "authorized", token: tokens.A, tenantId: "tenant-A" },
      { method: "POST" },
    );
    f.me("A");
    let rejected = false;
    try {
      f.response(
        "/api/auth/wecom/attempts/state-A/claim",
        200,
        { status: "authorized", token: "X".repeat(43), tenantId: "tenant-A" },
        { method: "POST" },
      );
    } catch (e) {
      assert.equal(e.code, "claim_replay");
      rejected = true;
    }
    if (!rejected) {
      f.control.hold.guestClosed(f.scope("A"));
      f.control.hold.observePublicAuthenticated({
        nonce,
        ownerId: 7,
        authenticated: true,
      });
      f.logout("Bearer " + "X".repeat(43));
    }
    assert.equal(f.control.safeStatus().logoutAOwnerMatched, false);
    assert.equal(rejected, true);
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("control-plane GET is not a Host proof and claimed-session reads are counted", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    assert.equal(
      f.response(
        "/api/client/usage",
        200,
        { summary: { cost: 0 } },
        { method: "GET", authorization: "Bearer " + "Z".repeat(43) },
      ),
      false,
    );
    assert.equal(f.control.safeStatus().slots.A.hostReads.usage, 0);
    assert.equal(
      f.response(
        "/api/client/usage",
        200,
        { summary: { cost: 7 } },
        { method: "GET", authorization: "Bearer " + tokens.A },
      ),
      true,
    );
    assert.equal(f.control.safeStatus().slots.A.hostReads.usage, 1);
  } finally {
    f.close();
  }
});
test("real /v1/models path counts only the original claimed Host session", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    assert.equal(
      f.response(
        "/v1/models",
        200,
        { data: [{ id: "model-A" }] },
        { method: "GET", authorization: "Bearer " + tokens.A },
      ),
      true,
    );
    assert.equal(f.control.safeStatus().slots.A.hostReads.models, 1);
    assert.equal(
      f.response(
        "/api/client/models",
        200,
        { data: [] },
        { method: "GET", authorization: "Bearer " + tokens.A },
      ),
      false,
    );
    assert.equal(f.control.safeStatus().slots.A.hostReads.models, 1);
  } finally {
    f.close();
  }
});
test("wrong or old Main nonce is rejected before guest or callback admission", async () => {
  const f = await fixture();
  try {
    f.start("A");
    assert.throws(
      () =>
        f.control.hold.bindGuest({ ...f.scope("A"), nonce: "O".repeat(43) }),
      errorCode("nonce"),
    );
    assert.equal(f.callbacks(), 0);
    assert.equal(f.control.hold.safeStatus().failed, "nonce");
  } finally {
    f.close();
  }
});
test("B wrong state cannot reuse A authorization URL", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    f.logout();
    f.start("B");
    assert.throws(() => f.capture("B", { url: url("state-A").href }));
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("retired A guest frame cannot complete B", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    f.logout();
    f.start("B");
    f.capture("B");
    assert.throws(() => f.control.hold.guestClosed(f.scope("A")));
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("B fresh bind rejects retired A guest before B has any guest", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    f.logout();
    f.start("B");
    assert.throws(
      () => f.control.hold.bindGuest(f.scope("A")),
      errorCode("retired_guest"),
    );
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("same Main and same SessionId accept new B webContents", async () => {
  const f = await fixture(true);
  try {
    await f.login("A");
    f.logout();
    await f.login("B");
    assert.equal(f.control.safeStatus().slots.B.guardSatisfied, true);
    assert.equal(f.callbacks(), 2);
  } finally {
    f.close();
  }
});
test("fixed A completion replay during B and unscoped callback are rejected", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    f.logout();
    f.start("B");
    f.capture("B");
    f.pending("B");
    assert.throws(
      () => f.control.completeCallback("A"),
      errorCode("callback_slot"),
    );
    assert.throws(
      () => f.control.hold.completeCallback(),
      errorCode("callback_scope_required"),
    );
    await f.finish("B");
    assert.equal(f.callbacks(), 2);
    await assert.rejects(f.control.completeCallback("B"));
    assert.equal(f.callbacks(), 2);
  } finally {
    f.close();
  }
});
test("B cannot use A provider credential or code outside its callback", async () => {
  const f = await fixture();
  try {
    await f.login("A");
    f.logout();
    await assert.rejects(
      f.control.provider.identity(
        {
          tenant_id: "tenant-B",
          corp_id: "ww-synthetic-never-called",
          agent_id: "1",
          credential_id: "credential-B",
        },
        f.apis.A.secret(),
        "OLD_A_CODE",
      ),
      errorCode("idp_binding"),
    );
    assert.equal(f.callbacks(), 1);
  } finally {
    f.close();
  }
});
test("new mode rejects all conflicts and callback ops have no freeform payload", () => {
  assert.equal(
    twoOrganizationModeEnabled(undefined, undefined, undefined),
    false,
  );
  assert.equal(
    twoOrganizationModeEnabled("enabled", undefined, "controlled"),
    true,
  );
  for (const conflict of ["single", "viewer", "file", "usage"]) {
    const flags = {
      single: undefined,
      viewer: undefined,
      file: undefined,
      usage: undefined,
    };
    flags[conflict] = "controlled";
    assert.throws(
      () =>
        twoOrganizationModeEnabled(
          "enabled",
          undefined,
          "controlled",
          flags.single,
          flags.viewer,
          flags.file,
          flags.usage,
        ),
      errorCode("mode"),
    );
  }
  assertTwoOrganizationCommand(
    { op: "completeTwoOrganizationA" },
    assertPrimaryCommand,
  );
  assertTwoOrganizationCommand({ op: "stopNative" }, assertPrimaryCommand);
  for (const c of [
    { op: "completePrimaryLogin" },
    { op: "completeTwoOrganizationB", tenantId: "tenant-A" },
    { op: "configure" },
  ])
    assert.throws(
      () => assertTwoOrganizationCommand(c, assertPrimaryCommand),
      errorCode("command"),
    );
});
