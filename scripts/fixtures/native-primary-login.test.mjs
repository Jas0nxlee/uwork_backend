import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createNativeControlledViewerAuth } from "./native-controlled-viewer-auth.mjs";
import {
  primaryLoginModeEnabled,
  runNativeEmailBootstrap,
  primaryLoginPublicConfig,
  preparePrimaryLoginMember,
  createPrimaryLoginHold,
  primaryLimitMemberId,
  createPrimarySupplierWitness,
} from "./native-primary-login.mjs";

const origin = "https://127.0.0.1:50301";
const tenantId = "finite-tenant";
const prefix = `/api/tenants/${tenantId}`;
const nonce = "N".repeat(43);
const state = "finite-state";
const scope = {
  nonce,
  ownerId: 7,
  webContentsId: 8,
  sessionId: "finite-session",
};

function response(status, extra = {}) {
  return JSON.stringify({ status, ...extra });
}
function ssoUrl() {
  const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [key, value] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state,
    login_type: "CorpApp",
    lang: "zh",
  }))
    url.searchParams.set(key, value);
  return url;
}
function gateFixture(options = {}) {
  let clock = 1000,
    callbacks = 0;
  const cancellations = [];
  const gate = createPrimaryLoginHold({
    origin,
    tenantId,
    nonce,
    now: () => clock,
    completeBackend: async () => {
      callbacks++;
      await options.complete?.();
    },
  });
  const arm = (url = ssoUrl(), expiresAt = 301000) =>
    gate.observeResponse({
      path: "/api/auth/wecom/attempts",
      status: 201,
      payload: JSON.stringify({
        id: state,
        proof: "FINITE_PROOF_ONLY",
        authorizeUrl: url.href,
        expiresAt,
      }),
    });
  const capture = (extra = {}) =>
    gate.captureSso(
      {
        ...scope,
        id: 11,
        resourceType: "mainFrame",
        method: "GET",
        url: ssoUrl().href,
        ...extra,
      },
      (value) => cancellations.push(value),
    );
  const claim = (
    status,
    extra = {},
    path = `/api/auth/wecom/attempts/${state}/claim`,
  ) =>
    gate.observeResponse({
      path,
      status: 200,
      payload: response(status, extra),
    });
  return {
    gate,
    arm,
    capture,
    claim,
    cancellations,
    callbacks: () => callbacks,
    bind: () => gate.bindGuest(scope),
    advance: (value = 1) => {
      clock += value;
    },
  };
}
function memberFixture(options = {}) {
  const calls = [];
  const member = {
    id: "finite-reader",
    role: "member",
    seat: 0,
    status: "active",
    external_id: null,
    department_id: null,
  };
  const config = { corp_id: "ww-synthetic-never-called", agent_id: "1" };
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method });
    assert.ok(
      path.startsWith(prefix + "/"),
      "setup stays on normal tenant management API",
    );
    if (path === prefix + "/wecom" && method === "GET")
      return { configuration: config };
    if (path === prefix + "/credentials" && method === "POST")
      return { id: "finite-reference" };
    if (path === prefix + "/wecom" && method === "PUT") return { ok: true };
    if (path === prefix + "/members" && method === "POST") {
      assert.equal(body.role, "member");
      assert.equal(body.seat, false, "original viewer seed is unchanged");
      return { id: member.id };
    }
    if (path === `${prefix}/members/${member.id}/wecom` && method === "PUT") {
      member.external_id = body.externalId;
      return { ok: true };
    }
    if (path.startsWith(prefix + "/members?") && method === "GET")
      return { items: [{ ...member }] };
    if (path === `${prefix}/members/${member.id}` && method === "PATCH") {
      if (!options.refuseSeat) {
        member.seat = +body.seat;
        member.department_id = body.departmentId;
      }
      return { ok: true };
    }
    throw Error("Unexpected finite management operation");
  };
  return { calls, api, controller: createNativeControlledViewerAuth() };
}

test("C1 primary is opt-in and incompatible modes fail before any initialization", () => {
  assert.equal(
    primaryLoginModeEnabled(undefined, undefined, undefined, undefined),
    false,
  );
  assert.equal(
    primaryLoginModeEnabled("enabled", undefined, undefined, "controlled"),
    true,
  );
  for (const args of [
    [undefined, undefined, undefined, "controlled"],
    ["enabled", "alwaysOn", undefined, "controlled"],
    ["enabled", undefined, "controlled", "controlled"],
    ["enabled", undefined, undefined, "anything"],
  ])
    assert.throws(() => primaryLoginModeEnabled(...args), /invalid_mode/);
});

test("C1 empty preparation writes only public config; email, store and generation closures never run", async (t) => {
  const home = await mkdtemp(join(import.meta.dirname, "c1-owned-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = primaryLoginPublicConfig(origin, tenantId);
  await writeFile(
    join(home, "enterprise-identity.json"),
    JSON.stringify(config),
  );
  await writeFile(
    join(home, "setting.json"),
    JSON.stringify({ httpProxyCaCertPath: "owned-public-ca" }),
  );
  let emailCalls = 0,
    supplierCalls = 0;
  await runNativeEmailBootstrap(true, async () => {
    emailCalls++;
    supplierCalls += 2;
    await writeFile(join(home, "credentials.json"), "FINITE_FAKE_SESSION");
  });
  await runNativeEmailBootstrap(true, async () => {
    await writeFile(join(home, "ucas-gateway.json"), "FINITE_FAKE_GATEWAY");
  });
  assert.deepEqual((await readdir(home)).sort(), [
    "enterprise-identity.json",
    "setting.json",
  ]);
  assert.equal(emailCalls, 0);
  assert.equal(supplierCalls, 0);
  assert.equal(config.organizations[0].corpId, "ww-synthetic-never-called");
  assert.equal(config.organizations[0].agentId, "1");
  assert.deepEqual(Object.keys(config).sort(), [
    "apiBaseUrl",
    "backend",
    "callbackUrl",
    "organizations",
  ]);
});

test("C1 default bootstrap executes original operations in caller order and preserves results", async () => {
  const observed = [];
  assert.equal(
    await runNativeEmailBootstrap(false, async () => {
      observed.push("email-and-baseline");
      return 42;
    }),
    42,
  );
  await runNativeEmailBootstrap(false, async () =>
    observed.push("encrypted-store"),
  );
  assert.deepEqual(observed, ["email-and-baseline", "encrypted-store"]);
});

test("C1 primary quota targets the actual ordinary member, while default remains JourneyA", () => {
  assert.equal(
    primaryLimitMemberId(false, "journey-a", "primary-reader"),
    "journey-a",
  );
  assert.equal(
    primaryLimitMemberId(true, "journey-a", "primary-reader"),
    "primary-reader",
  );
  assert.throws(() => primaryLimitMemberId(true, "journey-a", undefined));
});

test("primary supplier checks the backend Bearer only on chat/models and exports no key", () => {
  const key = "FINITE_SUPPLIER_KEY",
    witness = createPrimarySupplierWitness(key);
  assert.equal(witness.check("/v1/traces", undefined), true);
  assert.equal(witness.check("/v1/models", `Bearer ${key}`), true);
  assert.equal(witness.check("/v1/chat/completions", `Bearer ${key}`), true);
  assert.equal(witness.check("/v1/chat/completions", "Bearer other"), false);
  assert.deepEqual(witness.safeStatus(), {
    chatMatched: 1,
    modelsMatched: 1,
    rejected: 1,
  });
  assert.ok(!JSON.stringify(witness.safeStatus()).includes(key));
  witness.dispose();
  assert.equal(witness.check("/v1/models", `Bearer ${key}`), false);
});

test("primary unknown generation routes cannot reach common modelCalls or produce a model response", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  if (\n    primarySupplierWitness &&");
  const end = source.indexOf("  const traceRequestStartedAtMs", start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const execute = new AsyncFunction(
    "req",
    "res",
    "primarySupplierWitness",
    "calls",
    source.slice(start, end) + '\ncalls.count++; return "model-response";',
  );
  for (const path of [
    "/unexpected",
    "/v1/chat/completions?x",
    "/v1/models?x",
  ]) {
    const calls = { count: 0 },
      res = {
        status: null,
        writeHead(status) {
          this.status = status;
          return this;
        },
        end() {},
      };
    const result = await execute(
      { url: path, headers: { authorization: "Bearer other" }, resume() {} },
      res,
      createPrimarySupplierWitness("finite-key"),
      calls,
    );
    assert.equal(calls.count, 0);
    assert.equal(result, undefined);
    assert.equal(res.status, 401);
  }
});

test("C1 actual staged common closures skip both email/model initialization and dynamic credential imports", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("let identity, me;");
  const end = source.indexOf("const configDir =", start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const body = source.slice(start, end);
  const execute = new AsyncFunction(
    "primaryLoginEnabled",
    "runNativeEmailBootstrap",
    "api",
    "randomBytes",
    "p",
    "model",
    "dB",
    "memberPassword",
    body + "return {identity,me};",
  );
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    return { token: "FINITE_SESSION", user: {} };
  };
  const random = () => ({ toString: () => "FINITE_PASSWORD" });
  await execute(
    true,
    runNativeEmailBootstrap,
    api,
    random,
    prefix,
    { id: "finite-model" },
    { id: "finite-department" },
    "FINITE_PASSWORD",
  );
  assert.deepEqual(calls, []);
  await execute(
    false,
    runNativeEmailBootstrap,
    api,
    random,
    prefix,
    { id: "finite-model" },
    { id: "finite-department" },
    "FINITE_PASSWORD",
  );
  assert.deepEqual(calls, [
    prefix + "/members",
    "/api/auth/login",
    "/v1/chat/completions",
    "/v1/chat/completions",
    "/api/auth/logout",
    "/api/auth/login",
    "/api/auth/me",
  ]);
  const importBody = source.indexOf("  const load = (path) => import(");
  const importStart = source.lastIndexOf(
    "await runNativeEmailBootstrap(",
    importBody,
  );
  const importEnd = source.indexOf(
    'await writeFile(\n  join(appRoot, "package.json")',
    importBody,
  );
  assert.ok(importStart > end && importEnd > importBody);
  // undefined production paths/import bindings are deliberately absent: primary must never evaluate them.
  await new AsyncFunction(
    "primaryLoginEnabled",
    "runNativeEmailBootstrap",
    source.slice(importStart, importEnd),
  )(true, runNativeEmailBootstrap);
});

test("C1 original reader is promoted via real API shape PATCH; no member login or model initialization", async (t) => {
  const f = memberFixture();
  t.after(() => f.controller.dispose());
  const member = await preparePrimaryLoginMember({
    ...f,
    tenantId,
    tenantPrefix: prefix,
    departmentId: "finite-department",
  });
  assert.equal(member.id, "finite-reader");
  assert.equal(member.seat, true);
  assert.equal(member.role, "member");
  assert.equal(member.departmentId, "finite-department");
  assert.equal(
    f.controller.safeStatus().seat,
    false,
    "legacy snapshot is not relabeled",
  );
  assert.ok(
    f.calls.some(
      ({ path, method }) =>
        path.endsWith("/finite-reader") && method === "PATCH",
    ),
  );
  assert.ok(
    !f.calls.some(
      ({ path }) =>
        path.includes("/auth/") || path.includes("/chat/completions"),
    ),
  );
});

test("C1 promotion requires a successful current management readback", async (t) => {
  const f = memberFixture({ refuseSeat: true });
  t.after(() => f.controller.dispose());
  await assert.rejects(
    preparePrimaryLoginMember({
      ...f,
      tenantId,
      tenantPrefix: prefix,
      departmentId: "finite-department",
    }),
    /member_readback/,
  );
});

test("C2 unique original SSO remains held; pending observed after capture alone permits callback", async (t) => {
  const f = gateFixture();
  t.after(() => f.gate.dispose());
  f.arm();
  f.bind();
  f.claim("pending");
  f.capture();
  assert.equal(f.gate.safeStatus().held, true);
  assert.equal(f.cancellations.length, 0);
  assert.equal(f.gate.safeStatus().pendingObserved, false);
  f.advance();
  f.claim("pending");
  await f.gate.completeCallback();
  assert.equal(f.callbacks(), 1);
  assert.equal(f.cancellations.length, 0);
  f.claim("authorized", { token: "FINITE_PRIVATE_SESSION", tenantId });
  f.gate.guestClosed(scope);
  f.gate.observePublicAuthenticated({
    nonce,
    ownerId: scope.ownerId,
    authenticated: true,
  });
  assert.equal(f.gate.safeStatus().guardSatisfied, true);
  assert.equal(
    f.cancellations.length,
    0,
    "natural guest destruction owns request cancellation",
  );
  const safe = JSON.stringify(f.gate.safeStatus());
  for (const secret of [
    nonce,
    state,
    "FINITE_PROOF_ONLY",
    "FINITE_PRIVATE_SESSION",
    ssoUrl().href,
  ])
    assert.ok(!safe.includes(secret));
  await assert.rejects(f.gate.completeCallback());
  assert.equal(f.callbacks(), 1);
});

test("C2 incomplete private constructor scope cannot become an unbound gate", () => {
  for (const extra of [
    { tenantId: undefined },
    { tenantId: "" },
    { nonce: "" },
    { origin: "https://127.0.0.1:3000" },
  ]) {
    assert.throws(() =>
      createPrimaryLoginHold({
        origin,
        tenantId,
        nonce,
        completeBackend: async () => {},
        ...extra,
      }),
    );
  }
});

test("C2 callback cannot bypass either SSO capture or a later pending claim", async (t) => {
  for (const captured of [false, true]) {
    const f = gateFixture();
    t.after(() => f.gate.dispose());
    f.arm();
    f.bind();
    if (captured) f.capture();
    await assert.rejects(f.gate.completeCallback(), /callback_not_ready/);
    assert.equal(f.callbacks(), 0);
  }
});

test("C2 exact URL, all production parameters and original state are required", (t) => {
  const changes = [
    (u) => {
      u.hostname = "login.work.weixin.qq.com.example.test";
    },
    (u) => {
      u.protocol = "http:";
    },
    (u) => {
      u.port = "444";
    },
    (u) => {
      u.username = "finite";
    },
    (u) => {
      u.hash = "finite";
    },
    (u) => {
      u.pathname += "/other";
    },
    (u) => {
      u.searchParams.set("appid", "other");
    },
    (u) => {
      u.searchParams.set("agentid", "other");
    },
    (u) => {
      u.searchParams.set("redirect_uri", origin + "/wrong");
    },
    (u) => {
      u.searchParams.set("state", "other");
    },
    (u) => {
      u.searchParams.append("state", state);
    },
    (u) => {
      u.searchParams.set("nonce", "must-not-be-added");
    },
    (u) => {
      u.searchParams.delete("lang");
    },
  ];
  for (const change of changes) {
    const f = gateFixture();
    t.after(() => f.gate.dispose());
    f.arm();
    f.bind();
    const url = ssoUrl();
    change(url);
    assert.throws(() => f.capture({ url: url.href }));
    assert.deepEqual(f.cancellations, [{ cancel: true }]);
    assert.equal(f.callbacks(), 0);
    assert.equal(f.gate.safeStatus().guardSatisfied, false);
  }
});

test("C2 nonce, owner, original guest Session and one main-frame GET are bound", (t) => {
  for (const extra of [
    { nonce: "wrong" },
    { ownerId: 9 },
    { webContentsId: 9 },
    { sessionId: "other" },
    { method: "POST" },
    { resourceType: "subFrame" },
  ]) {
    const f = gateFixture();
    t.after(() => f.gate.dispose());
    f.arm();
    f.bind();
    assert.throws(() => f.capture(extra));
    assert.deepEqual(f.cancellations, [{ cancel: true }]);
  }
});

test("C2 second matching request cancels both and never advances callback", (t) => {
  const f = gateFixture();
  t.after(() => f.gate.dispose());
  f.arm();
  f.bind();
  f.capture();
  assert.throws(() => f.capture({ id: 12 }));
  assert.deepEqual(f.cancellations, [{ cancel: true }, { cancel: true }]);
  assert.equal(f.callbacks(), 0);
});

test("C2 expiry, wrong state response and oversized response fail without authorizing", (t) => {
  for (const kind of ["expired", "oversized", "wrong-claim"]) {
    const f = gateFixture();
    t.after(() => f.gate.dispose());
    if (kind === "expired") assert.throws(() => f.arm(ssoUrl(), 1000));
    else if (kind === "oversized")
      assert.throws(() =>
        f.gate.observeResponse({
          path: "/api/auth/wecom/attempts",
          status: 201,
          payload: "x".repeat(16385),
        }),
      );
    else {
      f.arm();
      f.bind();
      f.capture();
      f.advance();
      assert.throws(() =>
        f.claim("pending", {}, "/api/auth/wecom/attempts/other/claim"),
      );
    }
    assert.equal(f.callbacks(), 0);
    assert.equal(f.gate.safeStatus().guardSatisfied, false);
  }
});

test("C2 finite timeout and dispose release held request at most once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const timed of [true, false]) {
    const f = gateFixture();
    f.arm();
    f.bind();
    f.capture();
    if (timed) t.mock.timers.tick(20000);
    else f.gate.dispose();
    f.gate.dispose();
    f.gate.dispose();
    assert.deepEqual(f.cancellations, [{ cancel: true }]);
    assert.equal(f.gate.safeStatus().guardSatisfied, false);
  }
});

test("C2 private authority accessors are never read and irrelevant responses stay untouched", (t) => {
  const f = gateFixture();
  t.after(() => f.gate.dispose());
  f.arm();
  f.bind();
  const details = {
    ...scope,
    id: 11,
    method: "GET",
    resourceType: "mainFrame",
    url: ssoUrl().href,
  };
  for (const key of ["headers", "body", "proof", "token"])
    Object.defineProperty(details, key, {
      get() {
        throw Error("private authority must not be inspected");
      },
    });
  f.gate.captureSso(details, (value) => f.cancellations.push(value));
  assert.equal(
    f.gate.observeResponse({
      path: "/unrelated",
      status: 200,
      get payload() {
        throw Error("must remain unobserved");
      },
    }),
    false,
  );
  assert.equal(f.gate.safeStatus().held, true);
});

test("C2 guest closing before original successful claim is failure, not authentication", (t) => {
  const f = gateFixture();
  t.after(() => f.gate.dispose());
  f.arm();
  f.bind();
  f.capture();
  assert.throws(() => f.gate.guestClosed(scope), /guest_closed_before_claim/);
  assert.equal(f.gate.safeStatus().guardSatisfied, false);
});

test("C2 callback failures cannot become accepted or expose their cause", async (t) => {
  const f = gateFixture({
    complete: async () => {
      throw Error("FINITE_PRIVATE_CALLBACK");
    },
  });
  t.after(() => f.gate.dispose());
  f.arm();
  f.bind();
  f.capture();
  f.advance();
  f.claim("pending");
  await assert.rejects(f.gate.completeCallback(), /callback_failed/);
  assert.ok(
    !JSON.stringify(f.gate.safeStatus()).includes("FINITE_PRIVATE_CALLBACK"),
  );
  assert.deepEqual(f.cancellations, [{ cancel: true }]);
});

test("C2 disposal during callback blocks its late success without a second release", async () => {
  let finish;
  const f = gateFixture({
    complete: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  f.arm();
  f.bind();
  f.capture();
  f.advance();
  f.claim("pending");
  const operation = f.gate.completeCallback();
  f.gate.dispose();
  finish();
  await assert.rejects(operation);
  assert.equal(f.gate.safeStatus().guardSatisfied, false);
  assert.deepEqual(f.cancellations, [{ cancel: true }]);
});
