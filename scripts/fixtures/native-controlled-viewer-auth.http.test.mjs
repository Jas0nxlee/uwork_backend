import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Agent, fetch } from "undici";
import { createApp } from "../../src/app.ts";
import { bootstrap } from "../../src/identity.ts";
import { publication } from "../../tests/member-sharing-fixture.ts";
import {
  createNativeControlledViewerAuth,
  viewerAuthSafePath,
} from "./native-controlled-viewer-auth.mjs";

const execute = promisify(execFile),
  closures = [];
async function refused(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) => resolve(error.code === "ECONNREFUSED"));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function fixture(t, options = {}) {
  const root = await mkdtemp("/tmp/uwork-vca-");
  await chmod(root, 0o700);
  const controller = createNativeControlledViewerAuth();
  let backendOrigin = "",
    app,
    client,
    proxy,
    publicPort;
  const held = Promise.withResolvers(),
    disconnected = Promise.withResolvers();
  const statuses = [];
  t.after(async () => {
    const cleanupErrors = [];
    const close = async (name, operation) => {
      try {
        await operation();
      } catch {
        cleanupErrors.push(name);
      }
    };
    controller.dispose();
    if (client) await close("client", () => client.close());
    if (proxy)
      await close("proxy", () => {
        proxy.closeAllConnections();
        return new Promise((resolve, reject) =>
          proxy.close((e) => (e ? reject(e) : resolve())),
        );
      });
    if (app) await close("app", () => app.close());
    const ports = [
      ...(publicPort ? [publicPort] : []),
      ...(backendOrigin ? [Number(new URL(backendOrigin).port)] : []),
    ];
    const portResults = await Promise.all(ports.map(refused));
    let writers = null;
    try {
      const out = await execute("/usr/sbin/lsof", ["-F", "pfa", "+D", root]);
      writers = out.stdout
        .split("\n")
        .filter((s) => s === "aw" || s === "au").length;
    } catch (e) {
      if (e.code === 1 && !e.stderr?.trim()) writers = 0;
      else cleanupErrors.push("fd_check");
    }
    let rootRemoved = false;
    if (writers === 0 && portResults.every(Boolean) && !cleanupErrors.length) {
      await close("root", async () => {
        await rm(root, { recursive: true });
        rootRemoved = true;
      });
    }
    closures.push({
      root,
      pid: process.pid,
      ports,
      portsRefused: portResults.every(Boolean),
      writableFds: writers,
      rootRemoved,
      cleanupErrors,
    });
    assert.ok(
      portResults.every(Boolean),
      "Owned HTTP listeners must be closed",
    );
    assert.equal(
      writers,
      0,
      "Unexpected writer: keep owned temporary root private",
    );
    assert.equal(
      cleanupErrors.length,
      0,
      "Owned temporary resources must all close",
    );
    assert.equal(rootRemoved, true, "Owned temporary root must be removed");
  });
  const keyPath = join(root, "tls.key"),
    certPath = join(root, "tls.crt");
  await execute("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  await chmod(keyPath, 0o600);
  await chmod(certPath, 0o600);
  const ca = await readFile(certPath);
  proxy = createHttpsServer(
    { key: await readFile(keyPath), cert: ca },
    (req, res) => {
      if (
        options.holdCallback &&
        viewerAuthSafePath(req.url) === "/api/auth/wecom/callback"
      ) {
        res.writeHead(200);
        res.write(" ");
        const drip = setInterval(() => res.write(" "), 50);
        res.once("close", () => {
          clearInterval(drip);
          disconnected.resolve();
        });
        held.resolve();
        return;
      }
      const target = httpRequest(
        backendOrigin + req.url,
        { method: req.method, headers: req.headers },
        (upstream) => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        },
      );
      target.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.once("close", () => target.destroy());
      req.pipe(target);
    },
  );
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  publicPort = proxy.address().port;
  const origin = `https://127.0.0.1:${publicPort}`;
  app = await createApp({
    database: join(root, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: origin,
    worker: false,
    wecomProvider: controller.provider,
  });
  app.addHook("onResponse", async (req, reply) =>
    statuses.push({
      method: req.method,
      path: viewerAuthSafePath(req.url),
      status: reply.statusCode,
    }),
  );
  backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  client = new Agent({ connect: { ca } });
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Owned controlled viewer",
    email: "viewer-owner@example.test",
    password,
  });
  let ownerCookie;
  async function request(
    path,
    { method = "GET", body, cookie, status = 200 } = {},
  ) {
    const response = await fetch(origin + path, {
      dispatcher: client,
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status, "Owned HTTPS response status");
    return response;
  }
  async function api(path, method = "GET", body) {
    const response = await request(path, {
      method,
      body,
      cookie: ownerCookie,
      status:
        method === "POST" && /\/(credentials|members)$/u.test(path) ? 201 : 200,
    });
    return response.json();
  }
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "viewer-owner@example.test", password, delivery: "cookie" },
  });
  ownerCookie = login.headers.get("set-cookie").split(";")[0];
  assert.ok(
    !("token" in (await login.json())),
    "Cookie-only fixture owner login",
  );
  const p = `/api/tenants/${owner.tenantId}`;
  const initialCredential = await api(p + "/credentials", "POST", {
    name: "Initial synthetic provider",
    value: randomBytes(24).toString("hex"),
  });
  await api(p + "/wecom", "PUT", {
    corpId: "ww-synthetic-never-called",
    agentId: "1",
    credentialId: initialCredential.id,
  });
  await controller.seed({ api, tenantPrefix: p, tenantId: owner.tenantId });
  controller.observeOwnAttempts(app.server, { origin });
  const members = await api(p + "/members?q=native-viewer-reader");
  const reader = members.items[0];
  assert.ok(
    reader.role === "member" && reader.seat === 0 && reader.status === "active",
  );
  const config = await api(p + "/configurations/sharing");
  const draft = await api(p + "/configurations/sharing", "PUT", {
    revision: config.revision,
    data: { ...config.published, publish: "organization", files: true },
  });
  await api(p + "/configurations/sharing/publish", "POST", {
    revision: draft.revision,
  });
  const data = publication();
  const prep = await request("/api/client/shares/preparations", {
    method: "POST",
    body: data.preparation,
    cookie: ownerCookie,
    status: 201,
  });
  const preparation = await prep.json();
  const share = await (
    await request(
      `/api/client/shares/preparations/${preparation.preparation_id}/confirm`,
      { method: "POST", body: data.confirm, cookie: ownerCookie },
    )
  ).json();
  const previewPath = `/api/client/shares/${share.share_code}/preview`;
  async function attempt() {
    return (
      await request("/api/auth/wecom/attempts", {
        method: "POST",
        body: { tenantId: owner.tenantId },
        status: 201,
      })
    ).json();
  }
  async function claim(attempt, status = 200) {
    return request(`/api/auth/wecom/attempts/${attempt.id}/claim`, {
      method: "POST",
      body: { proof: attempt.proof, delivery: "cookie" },
      status,
    });
  }
  return {
    controller,
    ca,
    origin,
    api,
    request,
    p,
    reader,
    owner,
    statuses,
    previewPath,
    attempt,
    claim,
    callbackHeld: held.promise,
    callbackDisconnected: disconnected.promise,
    noModels() {
      for (const table of ["ledger", "traces", "gateway_calls"])
        assert.equal(
          app.services.db.get(`SELECT count(*) AS n FROM ${table}`).n,
          0,
        );
    },
  };
}

test("real HTTPS callback and normal poll/cookie claim authorize same-tenant no-seat readonly member", async (t) => {
  const f = await fixture(t);
  await (await f.request(f.previewPath, { status: 401 })).arrayBuffer();
  const a = await f.attempt();
  const pending = await f.claim(a);
  assert.equal((await pending.json()).status, "pending");
  assert.equal(pending.headers.has("set-cookie"), false);
  await f.controller.complete({ origin: f.origin, ca: f.ca });
  const claimed = await f.claim(a);
  const value = await claimed.json();
  assert.deepEqual(
    Object.keys(value).sort(),
    ["status", "expiresAt", "tenantId"].sort(),
  );
  assert.equal(value.status, "claimed");
  assert.equal(value.tenantId, f.owner.tenantId);
  const setCookie = claimed.headers.get("set-cookie");
  assert.ok(
    setCookie.includes("HttpOnly") &&
      setCookie.includes("SameSite=Strict") &&
      setCookie.includes("Secure"),
  );
  const cookie = setCookie.split(";")[0];
  const me = await (await f.request("/api/auth/me", { cookie })).json();
  assert.equal(me.user.id, f.reader.id);
  assert.equal(me.role, "member");
  assert.equal(me.seat, false);
  assert.equal(me.tenant.id, f.owner.tenantId);
  const preview = await (await f.request(f.previewPath, { cookie })).json();
  assert.equal(preview.can_revoke, false);
  assert.equal(preview.rows.length, 3);
  await (
    await f.request(f.previewPath.replace("/preview", "/continuation"), {
      method: "POST",
      cookie,
      body: {},
      status: 403,
    })
  ).arrayBuffer();
  await (
    await f.request("/api/auth/logout", { method: "POST", cookie, status: 204 })
  ).arrayBuffer();
  await (await f.request(f.previewPath, { cookie, status: 401 })).arrayBuffer();
  await f.claim(a, 409);
  assert.equal(
    f.statuses.filter(
      (s) => s.path === "/api/auth/wecom/callback" && s.status === 200,
    ).length,
    1,
  );
  assert.equal(JSON.stringify(f.statuses).includes(a.id), false);
  f.noModels();
});
test("unmapped provider identity is rejected by original callback and never sets a claim cookie", async (t) => {
  const f = await fixture(t);
  await f.api(`${f.p}/members/${f.reader.id}/wecom`, "PUT", {
    externalId: "different-owned-identity",
  });
  const a = await f.attempt();
  await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
  assert.ok(
    f.statuses.some(
      (s) => s.path === "/api/auth/wecom/callback" && s.status === 403,
    ),
  );
  const claim = await f.claim(a);
  assert.equal((await claim.json()).status, "failed");
  assert.equal(claim.headers.has("set-cookie"), false);
  f.noModels();
});
test("normal cancellation and active-member recheck remain authoritative", async (t) => {
  const f = await fixture(t);
  const a = await f.attempt();
  await f.controller.complete({ origin: f.origin, ca: f.ca });
  await f.api(`${f.p}/members/${f.reader.id}`, "PATCH", { status: "disabled" });
  const claim = await f.claim(a, 403);
  await claim.arrayBuffer();
  assert.equal(claim.headers.has("set-cookie"), false);
  f.noModels();
});
test("cancelled actual attempt is not resurrected by the fixture callback", async (t) => {
  const f = await fixture(t);
  const a = await f.attempt();
  await (
    await f.request(`/api/auth/wecom/attempts/${a.id}/cancel`, {
      method: "POST",
      body: { proof: a.proof },
    })
  ).arrayBuffer();
  await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
  assert.ok(
    f.statuses.some(
      (s) => s.path === "/api/auth/wecom/callback" && s.status === 400,
    ),
  );
  await (await f.claim(a, 409)).arrayBuffer();
  f.noModels();
  assert.equal(JSON.stringify(f.statuses).includes(a.id), false);
});

test("a wrong tenant cannot create a controlled pending attempt or callback", async (t) => {
  const f = await fixture(t);
  await (
    await f.request("/api/auth/wecom/attempts", {
      method: "POST",
      body: { tenantId: "other-owned-tenant" },
      status: 503,
    })
  ).arrayBuffer();
  await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
  assert.equal(f.controller.safeStatus().callbackCount, 0);
  assert.equal(f.controller.safeStatus().identityCallCount, 0);
  f.noModels();
});

test("an attempt expired by the original auth clock cannot be authorized or claimed", async (t) => {
  const f = await fixture(t);
  const a = await f.attempt();
  t.mock.method(Date, "now", () => a.expiresAt + 1);
  await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
  assert.ok(
    f.statuses.some(
      (s) => s.path === "/api/auth/wecom/callback" && s.status === 400,
    ),
  );
  await (await f.claim(a, 400)).arrayBuffer();
  assert.equal(f.controller.safeStatus().identityCallCount, 0);
  f.noModels();
});
test("callback TLS must validate the owned CA; failure consumes its one callback", async (t) => {
  const f = await fixture(t);
  const a = await f.attempt();
  await assert.rejects(
    f.controller.complete({ origin: f.origin, ca: "invalid-owned-test-ca" }),
  );
  await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
  const claim = await f.claim(a);
  assert.equal((await claim.json()).status, "pending");
  assert.equal(claim.headers.has("set-cookie"), false);
  f.noModels();
});

test(
  "dispose disconnects its actual in-flight owned HTTPS callback",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, { holdCallback: true });
    await f.attempt();
    const completing = f.controller.complete({ origin: f.origin, ca: f.ca });
    const rejected = assert.rejects(completing);
    await f.callbackHeld;
    f.controller.dispose();
    await rejected;
    await f.callbackDisconnected;
    assert.equal(f.controller.safeStatus().callbackCount, 1);
    f.noModels();
  },
);

test(
  "absolute callback deadline stops continuously dripping HTTPS response bytes",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, { holdCallback: true });
    await f.attempt();
    const start = performance.now();
    const completing = f.controller.complete({ origin: f.origin, ca: f.ca });
    const rejected = assert.rejects(completing);
    await f.callbackHeld;
    await rejected;
    await f.callbackDisconnected;
    assert.ok(
      performance.now() - start >= 9000 && performance.now() - start < 15000,
      "Absolute deadline is independent of repeated response bytes",
    );
    await assert.rejects(f.controller.complete({ origin: f.origin, ca: f.ca }));
    assert.equal(f.controller.safeStatus().callbackCount, 1);
    f.noModels();
  },
);
test.after(() =>
  process.stdout.write(
    "CONTROLLED_VIEWER_HTTP_CLOSURE=" +
      JSON.stringify({
        fixtures: closures,
        NativeStarted: false,
        commonProfileCreated: false,
      }) +
      "\n",
  ),
);
