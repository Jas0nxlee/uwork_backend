import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type JsonResponse = Record<string, unknown> & { error?: { code: string } };
interface Ledger {
  status: string;
  amount: number;
  reserved: number;
}
interface NetworkCase {
  mode: string;
  target: string;
  expectedStatus: number;
  status: number;
  code: string | undefined;
  newUpstreamConnections: number;
}
const outputDirectory = resolve("evidence");
await mkdir(outputDirectory, { recursive: true });
const cases: NetworkCase[] = [];
const received: string[] = [];
let connections = 0;
const upstream = createServer((req, res) => {
  received.push(req.url ?? "");
  req.resume();
  res
    .writeHead(302, {
      location: `http://127.0.0.1:${port}/forbidden`,
    })
    .end();
});
upstream.on("connection", () => connections++);
await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
const address = upstream.address();
assert.ok(address && typeof address !== "string");
const port = address.port;

async function exercise(allowPrivateUpstreams: boolean): Promise<Ledger[]> {
  const app = await createApp({
    database: ":memory:",
    masterKey: randomBytes(32),
    publicUrl: "http://127.0.0.1",
    allowPrivateUpstreams,
  });
  const account = {
    email: "security-probe-strict@example.test",
    password: "security-probe-controlled-password",
  };
  try {
    const { tenantId } = await bootstrap(app.services.db, {
      name: "security-probe-strict-network",
      ...account,
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      token?: string,
    ) => {
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(6000),
      });
      return {
        status: response.status,
        body: (await response.json()) as JsonResponse,
      };
    };
    const login = await request("/api/auth/login", "POST", account);
    assert.equal(login.status, 200);
    const token = login.body.token;
    assert.ok(typeof token === "string");
    const credential = await request(
      `/api/tenants/${tenantId}/credentials`,
      "POST",
      { name: "security-probe-key", value: "security-probe-synthetic-only" },
      token,
    );
    assert.equal(credential.status, 201);
    const targets: [string, number, string][] = allowPrivateUpstreams
      ? [[`http://127.0.0.1:${port}/redirect`, 502, "UPSTREAM_REJECTED"]]
      : [
          [`http://127.0.0.1:${port}/private`, 400, "HTTPS_REQUIRED"],
          [`https://127.0.0.1:${port}/private`, 400, "PRIVATE_UPSTREAM"],
          [`https://127.1:${port}/private`, 400, "PRIVATE_UPSTREAM"],
          [`https://2130706433:${port}/private`, 400, "PRIVATE_UPSTREAM"],
          [
            `https://[::ffff:127.0.0.1]:${port}/private`,
            400,
            "PRIVATE_UPSTREAM",
          ],
          [`https://localhost:${port}/private`, 400, "PRIVATE_UPSTREAM"],
        ];
    for (const [target, status, code] of targets) {
      const model = await request(
        `/api/tenants/${tenantId}/models`,
        "POST",
        {
          name: "security-probe-network",
          upstreamModel: "controlled",
          baseUrl: target,
          credentialId: credential.body.id,
          scope: { all: true },
          maxOutputTokens: 16,
        },
        token,
      );
      assert.equal(model.status, 201);
      const before = connections;
      const result = await request(
        "/v1/chat/completions",
        "POST",
        {
          model: model.body.id,
          messages: [{ role: "user", content: "security-probe-controlled" }],
        },
        token,
      );
      cases.push({
        mode: allowPrivateUpstreams
          ? "controlled-loopback-redirect"
          : "default-private-denial",
        target,
        expectedStatus: status,
        status: result.status,
        code: result.body.error?.code,
        newUpstreamConnections: connections - before,
      });
      assert.equal(result.status, status);
      assert.equal(result.body.error?.code, code);
      if (!allowPrivateUpstreams) assert.equal(connections, before);
    }
    const ledger = app.services.db.all<Ledger>(
      "SELECT status,amount,reserved FROM ledger",
    );
    if (!allowPrivateUpstreams)
      assert.ok(
        ledger.every((row) => row.status === "released" && row.amount === 0),
      );
    return ledger.map((row) => ({ ...row }));
  } finally {
    await app.close();
  }
}

let failure: string | undefined;
let strictLedger: Ledger[] = [],
  redirectLedger: Ledger[] = [];
try {
  const local = await lookup("localhost", { all: true });
  assert.ok(
    local.length &&
      local.every((entry) =>
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(entry.address),
      ),
    "Security smoke requires localhost to resolve only to loopback",
  );
  strictLedger = await exercise(false);
  assert.equal(connections, 0);
  redirectLedger = await exercise(true);
  assert.deepEqual(received, ["/redirect/chat/completions"]);
} catch (error) {
  failure = error instanceof Error ? error.message : "security_smoke_failed";
  process.exitCode = 1;
} finally {
  upstream.closeAllConnections();
  await new Promise<void>((done) => upstream.close(() => done()));
  await writeFile(
    resolve(outputDirectory, "whole-backend-strict-network.json"),
    JSON.stringify(
      {
        status: failure ? "failed" : "passed",
        node: process.version,
        cases,
        strictLedger,
        redirectLedger,
        upstreamConnections: connections,
        upstreamRequests: received,
        ...(failure ? { failure } : {}),
        boundary:
          "Default false private-denial uses actual HTTP. Redirect transport separately uses explicit loopback-only allowPrivate=true. Not public TLS/DNS-rebinding or supplier acceptance.",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    passed: !failure,
    cases: cases.length,
    strictUpstreamConnections: cases
      .filter((entry) => entry.mode === "default-private-denial")
      .reduce((sum, entry) => sum + entry.newUpstreamConnections, 0),
    redirectRequests: received.length,
    forbiddenRedirectFollowed: received.includes("/forbidden"),
  }),
);
