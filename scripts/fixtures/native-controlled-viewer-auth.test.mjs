import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import * as auth from "./native-controlled-viewer-auth.mjs";
import {
  viewerAuthModeEnabled,
  stripViewerAuthFlag,
  assertViewerAuthCommand,
  createNativeControlledViewerAuth,
} from "./native-controlled-viewer-auth.mjs";
const { viewerAuthSafePath } = auth;

const origin = "https://127.0.0.1:50301";
const tenantId = "owned-tenant";
const prefix = `/api/tenants/${tenantId}`;
function fixture(options = {}) {
  let credential,
    acceptedCode,
    clock = 1000,
    requests = 0,
    bound = true;
  const config = {
    tenant_id: tenantId,
    corp_id: "ww-synthetic-never-called",
    agent_id: "1",
    credential_id: "first",
  };
  const controller = createNativeControlledViewerAuth({
    now: () => clock,
    callbackRequest: async (url, ca, signal) => {
      requests++;
      if (options.waitForAbort)
        return new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(Error("private aborted callback")),
            { once: true },
          ),
        );
      if (options.callbackFailure)
        throw Error("private callback details must disappear");
      acceptedCode = url.searchParams.get("code");
      await controller.provider.identity(
        { ...config, ...options.identityConfig },
        options.wrongCredential ? "wrong-private-credential" : credential,
        options.wrongCode ? "wrong-private-code" : url.searchParams.get("code"),
      );
      return 200;
    },
  });
  const api = async (path, method = "GET", body) => {
    if (path === prefix + "/wecom" && method === "GET")
      return {
        configuration: {
          ...config,
          ...(options.wrongCorp ? { corp_id: "other-corp" } : {}),
        },
      };
    if (path === prefix + "/credentials") {
      credential = body.value;
      return { id: "synthetic-ref" };
    }
    if (path === prefix + "/wecom" && method === "PUT") {
      assert.equal(body.corpId, config.corp_id);
      config.credential_id = body.credentialId;
      return { ok: true };
    }
    if (path === prefix + "/members" && method === "POST") {
      assert.equal(body.role, "member");
      assert.equal(body.seat, false);
      return { id: "reader" };
    }
    if (path === prefix + "/members/reader/wecom") {
      bound = body.externalId;
      return { ok: true };
    }
    if (path.startsWith(prefix + "/members?"))
      return {
        items: [
          {
            id: "reader",
            role: "member",
            seat: 0,
            status: "active",
            external_id: bound,
          },
        ],
      };
    throw Error("Unexpected test API path");
  };
  const server = new EventEmitter();
  const seed = async () => {
    await controller.seed({ api, tenantPrefix: prefix, tenantId });
    controller.observeOwnAttempts(server, { origin });
  };
  return {
    controller,
    server,
    seed,
    requests: () => requests,
    setClock: (value) => {
      clock = value;
    },
    config,
    credential: () => credential,
    code: () => acceptedCode,
  };
}
class Response extends EventEmitter {
  statusCode = 201;
  calls = [];
  write(...args) {
    this.calls.push({ method: "write", receiver: this, args });
    return false;
  }
  end(...args) {
    this.calls.push({ method: "end", receiver: this, args });
    this.emit("finish");
    return this;
  }
}
function attempt(
  f,
  {
    response = new Response(),
    path = "/api/auth/wecom/attempts",
    method = "POST",
    state = "a".repeat(32),
    expiresAt = 301000,
    corrupt = false,
  } = {},
) {
  const req = { method, url: path };
  for (const key of ["headers", "body", "on", "pipe"])
    Object.defineProperty(req, key, {
      get() {
        throw Error("Request authority/stream must remain unobserved");
      },
    });
  const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [k, v] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state,
  }))
    url.searchParams.set(k, v);
  f.server.emit("request", req, response);
  const body = corrupt
    ? "bad-json-private-material"
    : JSON.stringify({
        authorizeUrl: url.href,
        expiresAt,
        proof: "synthetic-proof-must-not-be-returned",
      });
  response.write(body.slice(0, 13));
  response.end(body.slice(13));
  return response;
}

test("unset mode is false; unsupported mode/workflow rejects before fixture IO", () => {
  let constructions = 0;
  if (viewerAuthModeEnabled(undefined, undefined, undefined)) constructions++;
  assert.equal(constructions, 0);
  assert.equal(viewerAuthModeEnabled("enabled", undefined, "controlled"), true);
  for (const args of [
    [undefined, undefined, "controlled"],
    ["enabled", "alwaysOn", "controlled"],
    ["enabled", undefined, "false"],
    ["enabled", undefined, "unknown-private-value"],
  ]) {
    assert.throws(
      () => viewerAuthModeEnabled(...args),
      (e) => !String(e).includes("unknown-private-value"),
    );
  }
});
test("Native and secondary environment filtering is implemented without mutating the parent", async () => {
  const env = {
    PATH: "owned",
    UWORK_NATIVE_VIEWER_AUTH: "controlled",
    OTHER: "kept",
  };
  const filtered = stripViewerAuthFlag(env);
  assert.deepEqual(filtered, { PATH: "owned", OTHER: "kept" });
  assert.equal(env.UWORK_NATIVE_VIEWER_AUTH, "controlled");
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("viewerAuthModeEnabled(") <
      source.indexOf("await mkdir(evidence"),
  );
  assert.ok(
    /function nativeEnvironment\(\)\s*\{\s*return stripViewerAuthFlag\(\{/u.test(
      source,
    ),
    "Shared child environment must explicitly strip the test flag",
  );
  assert.equal((source.match(/env: nativeEnvironment\(\)/gu) ?? []).length, 2);
  assert.match(
    source,
    /const controlledViewerAuth = viewerAuthEnabled\s*\? createNativeControlledViewerAuth\(\)\s*: undefined/u,
  );
  assert.match(
    source,
    /\.\.\.\(controlledViewerAuth\s*\? \{ wecomProvider: controlledViewerAuth\.provider \}\s*: \{\}\)/u,
  );
  assert.match(
    source,
    /if \(controlledViewerAuth\) \{\s*await controlledViewerAuth\.seed\(/u,
  );
  assert.match(
    source,
    /pathname: controlledViewerAuth\s*\? viewerAuthSafePath\(req\.raw\.url\)/u,
  );
});
test("control commands allow only the exact op, never caller-supplied subject or state", () => {
  for (const op of ["completeViewerAuth", "viewerAuthStatus"]) {
    assertViewerAuthCommand({ op }, op);
    for (const value of [
      { op, code: "private" },
      { op, tenantId },
      [],
      null,
      { op: "other" },
    ])
      assert.throws(() => assertViewerAuthCommand(value, op));
  }
});
test("seed retains CorpId and exposes only the ordinary reader hash and false seat", async () => {
  const f = fixture();
  await f.seed();
  const status = f.controller.safeStatus();
  assert.deepEqual(
    Object.keys(status).sort(),
    [
      "enabled",
      "seeded",
      "attemptPending",
      "attemptCount",
      "callbackCount",
      "identityCallCount",
      "callbackStatus",
      "readerHash",
      "seat",
      "error",
      "disposed",
    ].sort(),
  );
  assert.equal(status.seeded, true);
  assert.equal(status.seat, false);
  assert.match(status.readerHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(status).includes('"reader"'), false);
  const wrong = fixture({ wrongCorp: true });
  await assert.rejects(wrong.seed());
});
test("own successful response capture preserves chunks, callbacks, receiver and return values", async () => {
  const f = fixture();
  await f.seed();
  const res = new Response();
  const originalWrite = res.write,
    originalEnd = res.end;
  const result = attempt(f, { response: res });
  assert.equal(result, res);
  assert.equal(res.calls[0].receiver, res);
  assert.equal(res.calls[0].method, "write");
  assert.equal(res.write, originalWrite);
  assert.equal(res.end, originalEnd);
  assert.equal(f.controller.safeStatus().attemptPending, true);
  await f.controller.complete({ origin, ca: "public-test-ca" });
  assert.equal(f.requests(), 1);
  assert.equal(f.controller.safeStatus().identityCallCount, 1);
  assert.ok(!JSON.stringify(f.controller.safeStatus()).includes("proof"));
  await assert.rejects(f.controller.complete({ origin, ca: "public-test-ca" }));
  assert.equal(f.requests(), 1);
});
test("claim and non-successful responses remain untouched and cannot create pending state", async () => {
  const f = fixture();
  await f.seed();
  for (const [path, status] of [
    ["/api/auth/wecom/attempts/x/claim", 200],
    ["/api/auth/wecom/attempts", 400],
  ]) {
    const res = new Response();
    res.statusCode = status;
    const write = res.write,
      end = res.end;
    f.server.emit("request", { method: "POST", url: path }, res);
    if (path.endsWith("/claim")) {
      assert.equal(res.write, write);
      assert.equal(res.end, end);
    }
    res.end("unchanged-error-or-claim-response");
  }
  assert.equal(f.controller.safeStatus().attemptPending, false);
  await assert.rejects(f.controller.complete({ origin, ca: "public-test-ca" }));
  assert.equal(f.requests(), 0);
});
test("aborted, oversized, invalid and second attempts fail safely without changing responses", async () => {
  for (const kind of ["aborted", "oversized", "invalid", "second"]) {
    const f = fixture();
    await f.seed();
    if (kind === "invalid") attempt(f, { corrupt: true });
    else if (kind === "second") {
      attempt(f);
      attempt(f, { state: "b".repeat(32) });
    } else {
      const res = new Response();
      f.server.emit(
        "request",
        { method: "POST", url: "/api/auth/wecom/attempts" },
        res,
      );
      res.write(kind === "oversized" ? "x".repeat(16385) : "partial");
      if (kind === "aborted") res.emit("close");
      else res.end();
    }
    await assert.rejects(
      f.controller.complete({ origin, ca: "public-test-ca" }),
    );
    assert.equal(f.requests(), 0);
    assert.ok(f.controller.safeStatus().error);
    assert.ok(
      !JSON.stringify(f.controller.safeStatus()).includes("private-material"),
    );
  }
});
test("expired state, wrong callback origin, bad identity and directory never become authorized", async () => {
  const expired = fixture();
  await expired.seed();
  attempt(expired);
  expired.setClock(301001);
  await assert.rejects(expired.controller.complete({ origin, ca: "ca" }));
  assert.equal(expired.requests(), 0);
  const wrong = fixture();
  await wrong.seed();
  attempt(wrong);
  await assert.rejects(
    wrong.controller.complete({ origin: "https://127.0.0.1:50302", ca: "ca" }),
  );
  assert.equal(wrong.requests(), 0);
  for (const change of [
    { tenant_id: "other" },
    { corp_id: "other" },
    { agent_id: "2" },
  ]) {
    const f = fixture();
    await f.seed();
    await assert.rejects(
      f.controller.provider.identity(
        { ...f.config, ...change },
        f.credential(),
        "unknown-private-code",
      ),
      (e) => !String(e).includes("unknown-private-code"),
    );
  }
  await assert.rejects(wrong.controller.provider.directory());
});
test("callback IO errors are consumed once and safe; dispose clears pending without touching other listeners", async () => {
  const f = fixture({ callbackFailure: true });
  await f.seed();
  attempt(f);
  await assert.rejects(
    f.controller.complete({ origin, ca: "ca" }),
    (e) => !String(e).includes("private callback"),
  );
  await assert.rejects(f.controller.complete({ origin, ca: "ca" }));
  assert.equal(f.requests(), 1);
  const other = () => {};
  f.server.on("request", other);
  f.controller.dispose();
  assert.deepEqual(f.server.listeners("request"), [other]);
  assert.equal(f.controller.safeStatus().disposed, true);
  assert.equal(f.controller.safeStatus().attemptPending, false);
});

test("traffic projections erase every attempt identifier and callback query", () => {
  for (const suffix of ["claim", "cancel", "complete", "unknown", ""]) {
    const path = viewerAuthSafePath(
      "/api/auth/wecom/attempts/private-state" +
        (suffix ? "/" + suffix : "") +
        "?code=private-code#private-state",
    );
    assert.equal(path.includes("private"), false);
    assert.equal(
      path,
      "/api/auth/wecom/attempts/:id" +
        (suffix ? "/" + (suffix === "unknown" ? "other" : suffix) : ""),
    );
  }
  assert.equal(
    viewerAuthSafePath(
      "/api/auth/wecom/callback?state=private-state&code=private-code",
    ),
    "/api/auth/wecom/callback",
  );
  assert.equal(
    viewerAuthSafePath("/api/auth/wecom/attempts?ignored=private"),
    "/api/auth/wecom/attempts",
  );
  assert.equal(viewerAuthSafePath(undefined), null);
});

test("a successful identity cannot be replayed with the exact bound values", async () => {
  const f = fixture();
  await f.seed();
  attempt(f);
  await f.controller.complete({ origin, ca: "ca" });
  await assert.rejects(
    f.controller.provider.identity(f.config, f.credential(), f.code()),
  );
  assert.equal(f.controller.safeStatus().identityCallCount, 2);
  assert.equal(f.requests(), 1);
  f.controller.dispose();
});

test("identity binds each tenant, corp, agent, credential and one-time code during completion", async () => {
  for (const options of [
    { identityConfig: { tenant_id: "other" } },
    { identityConfig: { corp_id: "other" } },
    { identityConfig: { agent_id: "2" } },
    { identityConfig: { credential_id: "other" } },
    { wrongCredential: true },
    { wrongCode: true },
  ]) {
    const f = fixture(options);
    await f.seed();
    attempt(f);
    await assert.rejects(
      f.controller.complete({ origin, ca: "ca" }),
      (e) => !String(e).includes("private"),
    );
    assert.equal(f.requests(), 1);
    assert.equal(f.controller.safeStatus().identityCallCount, 1);
    await assert.rejects(f.controller.complete({ origin, ca: "ca" }));
    assert.equal(f.requests(), 1);
  }
});

test("write/end throw exactly the original error and release observer wrappers", async () => {
  for (const method of ["write", "end"]) {
    const f = fixture();
    await f.seed();
    const res = new Response();
    const sentinel = Error("original response failure");
    res[method] = function () {
      throw sentinel;
    };
    const originalWrite = res.write,
      originalEnd = res.end;
    f.server.emit(
      "request",
      { method: "POST", url: "/api/auth/wecom/attempts" },
      res,
    );
    assert.throws(
      () => res[method]("partial"),
      (e) => e === sentinel,
    );
    assert.equal(res.write, originalWrite);
    assert.equal(res.end, originalEnd);
    assert.equal(res.listenerCount("finish"), 0);
    assert.equal(res.listenerCount("close"), 0);
    assert.ok(f.controller.safeStatus().error);
    f.controller.dispose();
  }
});

test("dispose cancels its active callback and the absolute deadline also aborts it", async (t) => {
  for (const byDispose of [true, false]) {
    const f = fixture({ waitForAbort: true });
    await f.seed();
    attempt(f);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const completing = f.controller.complete({ origin, ca: "ca" });
    const outcome = assert.rejects(
      completing,
      (e) => !String(e).includes("private"),
    );
    if (byDispose) f.controller.dispose();
    else t.mock.timers.tick(10000);
    await outcome;
    t.mock.timers.reset();
    assert.equal(f.requests(), 1);
    assert.equal(f.controller.safeStatus().attemptPending, false);
  }
});

test("only one response can be observed in flight and a stalled response expires", async (t) => {
  for (const second of [true, false]) {
    const f = fixture();
    await f.seed();
    const res = new Response();
    const write = res.write,
      end = res.end;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    f.server.emit(
      "request",
      { method: "POST", url: "/api/auth/wecom/attempts" },
      res,
    );
    res.write("partial");
    if (second) {
      const another = new Response(),
        original = another.write;
      f.server.emit(
        "request",
        { method: "POST", url: "/api/auth/wecom/attempts" },
        another,
      );
      assert.equal(another.write, original);
    } else t.mock.timers.tick(10000);
    assert.equal(res.write, write);
    assert.equal(res.end, end);
    assert.equal(res.listenerCount("finish"), 0);
    await assert.rejects(f.controller.complete({ origin, ca: "ca" }));
    assert.equal(f.requests(), 0);
    f.controller.dispose();
    t.mock.timers.reset();
  }
});

test("observer reads only authorizeUrl/expiry and forwards exact byte and callback arguments", async () => {
  const f = fixture();
  await f.seed();
  const res = new Response();
  const parse = JSON.parse,
    callback = () => {},
    chunk = Buffer.from("projection-test");
  const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [k, v] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state: "a".repeat(32),
  }))
    url.searchParams.set(k, v);
  const body = { authorizeUrl: url.href, expiresAt: 301000 };
  for (const key of ["proof", "token", "id", "cookie"])
    Object.defineProperty(body, key, {
      get() {
        throw Error("Forbidden authority property");
      },
    });
  JSON.parse = (value) => (value === "projection-test" ? body : parse(value));
  try {
    f.server.emit(
      "request",
      { method: "POST", url: "/api/auth/wecom/attempts" },
      res,
    );
    assert.equal(res.write(chunk, "utf8", callback), false);
    assert.equal(res.end(callback), res);
  } finally {
    JSON.parse = parse;
  }
  assert.equal(res.calls[0].args[0], chunk);
  assert.equal(res.calls[0].args[1], "utf8");
  assert.equal(res.calls[0].args[2], callback);
  assert.equal(res.calls[1].args[0], callback);
  assert.equal(f.controller.safeStatus().attemptPending, true);
  f.controller.dispose();
});
