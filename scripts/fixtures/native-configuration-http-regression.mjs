import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createApp } from "../../src/app.ts";
import { bootstrap } from "../../src/identity.ts";
import {
  MAX_NATIVE_CONFIGURATION_BYTES,
  projectNativeConfigurationReceipt,
} from "./native-configuration-capture.mjs";

// Standalone loopback HTTP regression; never imports/launches the Native fixture.
const runLabel = process.argv[2] ?? `run-${Date.now()}`;
if (!/^[a-z0-9-]{1,80}$/.test(runLabel)) throw Error("Invalid owned run label");
const evidence = join(
  "evidence/client-native-configuration-witness-fetched-at-20261018",
  runLabel,
);
await mkdir(evidence, { mode: 0o700 });
const directory = await mkdtemp(join(tmpdir(), "uwork-configuration-http-"));
await chmod(directory, 0o700);
const traffic = [],
  phases = [],
  cleanupErrors = [];
const ports = [];
let app,
  proxy,
  observation,
  token = "",
  failure = false;
const requestBuffer = (origin, path, method = "GET", payload) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      origin + path,
      {
        method,
        agent: false,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_NATIVE_CONFIGURATION_BYTES)
            request.destroy(Error("Owned HTTP body limit"));
          else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.setTimeout(10000, () =>
      request.destroy(Error("Owned HTTP timeout")),
    );
    request.once("error", reject);
    request.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
const requestJSON = async (origin, path, method = "GET", payload) => {
  const response = await requestBuffer(origin, path, method, payload);
  assert.equal(response.status, 200, "Owned API status");
  return JSON.parse(response.bytes.toString("utf8"));
};
const portClosed = (port) =>
  new Promise((resolve) => {
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
const summary = {
  status: "failed",
  boundary:
    "actual isolated createApp TCP HTTP to pure receipt projection; no Native",
  phases,
  traffic,
  modelRequests: null,
  ledgerRows: null,
  credentialRows: null,
  cleanup: null,
};
try {
  app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://127.0.0.1",
    worker: false,
  });
  app.addHook("onResponse", async (request, reply) => {
    traffic.push({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
    });
  });
  const password = randomBytes(24).toString("hex");
  const email = "configuration-http@example.test";
  const owner = await bootstrap(app.services.db, {
    name: "Owned configuration HTTP",
    email,
    password,
  });
  const backend = await app.listen({ host: "127.0.0.1", port: 0 });
  ports.push(Number(new URL(backend).port));
  assert.notEqual(ports[0], 3000);
  token = (
    await requestJSON(backend, "/api/auth/login", "POST", { email, password })
  ).token;
  assert.equal(typeof token, "string");
  proxy = createServer((request, response) => {
    const complete = observation;
    const requestStartedAtMs = Date.now();
    const clientRemoteAddress = request.socket.remoteAddress;
    const clientRemotePort = request.socket.remotePort;
    const target = httpRequest(
      backend + "/api/client/configuration",
      { method: "GET", agent: false, headers: request.headers },
      (reply) => {
        const chunks = [];
        let bodyBytes = 0,
          upstreamEndedAtMs = null,
          finished = false;
        let outcome = "complete";
        const finish = (downstreamFinished) => {
          if (finished) return;
          finished = true;
          const bytes = Buffer.concat(chunks);
          let body;
          try {
            if (outcome === "complete")
              body = JSON.parse(bytes.toString("utf8"));
          } catch {
            outcome = "invalid_json";
          }
          const receipt = projectNativeConfigurationReceipt(phases.length + 1, {
            requestStartedAtMs,
            upstreamEndedAtMs,
            responseFinishedAtMs: downstreamFinished ? Date.now() : null,
            observedAtMs: Date.now(),
            upstreamEnded: upstreamEndedAtMs !== null,
            downstreamFinished,
            closedBeforeFinish: !downstreamFinished,
            clientRemoteAddress,
            clientRemotePort,
            replyStatus: reply.statusCode,
            bodyBytes,
            outcome,
            body,
          });
          complete.resolve({ receipt, bytes, headers: reply.headers, body });
        };
        reply.on("data", (chunk) => {
          bodyBytes = Math.min(
            MAX_NATIVE_CONFIGURATION_BYTES + 1,
            bodyBytes + chunk.length,
          );
          if (bodyBytes > MAX_NATIVE_CONFIGURATION_BYTES) {
            outcome = "body_limit";
            chunks.length = 0;
          } else if (outcome === "complete") chunks.push(chunk);
        });
        reply.once("end", () => {
          upstreamEndedAtMs = Date.now();
        });
        reply.once("error", () => {
          outcome = "upstream_error";
          finish(false);
        });
        response.once("finish", () => finish(response.writableFinished));
        response.once("close", () => {
          if (!response.writableFinished) finish(false);
        });
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      },
    );
    target.once("error", () => {
      complete.reject(Error("Owned proxy upstream failed"));
      response.writeHead(502).end();
    });
    request.pipe(target);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyPort = proxy.address().port;
  ports.push(proxyPort);
  assert.notEqual(proxyPort, 3000);
  const path = `/api/tenants/${owner.tenantId}/configurations/desktop`;
  const sample = async (phase, published) => {
    observation = Promise.withResolvers();
    const clientStartedAtMs = Date.now();
    const response = await requestBuffer(
      `http://127.0.0.1:${proxyPort}`,
      "/api/client/configuration",
    );
    const clientEndedAtMs = Date.now();
    const captured = await observation.promise;
    phases.push({
      phase,
      clientStartedAtMs,
      clientEndedAtMs,
      expectedVersion: published.version,
      actualVersion: captured.body?.versions?.desktop,
      actualFetchedAt: captured.body?.fetchedAt,
      fetchedAtWithinRequest:
        Number.isSafeInteger(captured.body?.fetchedAt) &&
        captured.body.fetchedAt >= clientStartedAtMs &&
        captured.body.fetchedAt <= clientEndedAtMs,
      configurationMatchesPublished: isDeepStrictEqual(
        captured.body?.configuration?.desktop,
        published.published,
      ),
      bodyBytesIdentical: response.bytes.equals(captured.bytes),
      responseHeadersIdentical: isDeepStrictEqual(
        response.headers,
        captured.headers,
      ),
      receipt: captured.receipt,
    });
  };
  await sample("default", await requestJSON(backend, path));
  for (const enabled of [true, false]) {
    const previous = await requestJSON(backend, path);
    const data = {
      desktopContextPrompt: { enabled: !enabled },
      rendererActionTrace: {
        enabled,
        sampleRatio: 0.2,
        enabledGroups: ["settings"],
      },
    };
    const saved = await requestJSON(backend, path, "PUT", {
      revision: previous.revision,
      data,
    });
    const published = await requestJSON(backend, path + "/publish", "POST", {
      revision: saved.revision,
    });
    const readback = await requestJSON(backend, path);
    assert.equal(readback.version, published.version);
    assert.ok(
      isDeepStrictEqual(readback.published, data),
      "Actual published desktop data",
    );
    await sample(enabled ? "trace-on" : "trace-off", readback);
  }
  summary.ledgerRows = app.services.db.get(
    "SELECT count(*) AS n FROM ledger",
  ).n;
  summary.credentialRows = app.services.db.get(
    "SELECT count(*) AS n FROM credentials",
  ).n;
  const allowed = new Set([
    "/api/auth/login",
    "/api/client/configuration",
    "/api/tenants/:tenantId/configurations/:kind",
    "/api/tenants/:tenantId/configurations/:kind/publish",
  ]);
  summary.modelRequests = traffic.filter(
    (entry) => !allowed.has(entry.route),
  ).length;
  assert.equal(summary.ledgerRows, 0);
  assert.equal(summary.credentialRows, 0);
  assert.equal(summary.modelRequests, 0);
  for (const phase of phases) {
    assert.equal(
      phase.fetchedAtWithinRequest,
      true,
      "Actual fetchedAt numeric milliseconds inside GET interval",
    );
    assert.equal(
      phase.actualVersion,
      phase.expectedVersion,
      "Actual published desktop version",
    );
    assert.equal(
      phase.configurationMatchesPublished,
      true,
      "Actual published desktop configuration",
    );
    assert.equal(phase.bodyBytesIdentical, true, "Transparent proxy bytes");
    assert.equal(
      phase.responseHeadersIdentical,
      true,
      "Transparent proxy headers",
    );
    assert.equal(
      phase.receipt.status,
      "sent",
      "Real HTTP configuration must project as sent",
    );
    assert.equal(phase.receipt.fetchedAt, phase.actualFetchedAt);
    assert.equal(phase.receipt.desktopVersion, phase.expectedVersion);
  }
  assert.deepEqual(
    phases.map((phase) => phase.receipt.traceEnabled),
    [false, true, false],
  );
  summary.status = "passed";
} catch {
  failure = true;
} finally {
  const attempt = async (operation) => {
    try {
      await operation();
    } catch {
      cleanupErrors.push("cleanup_failed");
    }
  };
  if (proxy)
    await attempt(async () => {
      proxy.closeAllConnections();
      await new Promise((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    });
  if (app) await attempt(() => app.close());
  const closed = await Promise.all(ports.map(portClosed));
  if (!closed.every(Boolean)) cleanupErrors.push("owned_port_not_closed");
  if (!cleanupErrors.length)
    await attempt(() => rm(directory, { recursive: true }));
  summary.cleanup = {
    backendClosed: !app?.server.listening,
    proxyClosed: !proxy?.listening,
    portsClosed: closed.every(Boolean),
    ownedRootRemoved: !cleanupErrors.length,
    errors: cleanupErrors,
  };
  if (cleanupErrors.length) failure = true;
  await writeFile(
    join(evidence, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    status: summary.status,
    phases: phases.map((phase) => ({
      phase: phase.phase,
      status: phase.receipt.status,
      fetchedAtType: typeof phase.actualFetchedAt,
      fetchedAtWithinRequest: phase.fetchedAtWithinRequest,
      bytesIdentical: phase.bodyBytesIdentical,
      headersIdentical: phase.responseHeadersIdentical,
    })),
    modelRequests: summary.modelRequests,
    ledgerRows: summary.ledgerRows,
    credentialRows: summary.credentialRows,
    cleanup: summary.cleanup,
  }),
);
if (failure) process.exitCode = 1;
