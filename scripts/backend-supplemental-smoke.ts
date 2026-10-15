import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { createApp as CreateApp } from "../src/app.js";
import type { WecomProvider } from "../src/wecom.js";

type Row = Record<string, unknown>;
const startedAt = new Date().toISOString();
const evidence = resolve("evidence");
const traffic: Record<string, number> = {};
const results: { operation: string; passed: boolean }[] = [];
const gitHead = (
  await promisify(execFile)("git", ["rev-parse", "HEAD"])
).stdout.trim();
const directory = await mkdtemp(join(tmpdir(), "uwork-supplemental-"));
const database = join(directory, "backend.sqlite");
const key = randomBytes(32);
let app: Awaited<ReturnType<typeof CreateApp>> | undefined;
let origin = "",
  releaseMalformed: (() => void) | undefined;
const vendorRecords: {
  request: number;
  inputTokens: number;
  outputTokens: number;
  fixtureCredits: number;
}[] = [];
const vendor = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  assert.equal(request.headers.authorization, "Bearer supplemental-model-key");
  assert.ok(JSON.parse(Buffer.concat(chunks).toString()).messages);
  vendorRecords.push({
    request: vendorRecords.length + 1,
    inputTokens: 12,
    outputTokens: 3,
    fixtureCredits: 15,
  });
  await new Promise<void>((done) => {
    releaseMalformed = done;
  });
  response.writeHead(200, { "content-type": "application/json" });
  response.end("{malformed-controlled-response");
});
const wecom: WecomProvider = {
  identity: async (_configuration, credential, code) => {
    assert.equal(credential, "supplemental-wecom-key");
    assert.equal(code, "supplemental-wecom-code");
    return "supplemental-wecom-user";
  },
  directory: async () => ({ departments: [], members: [] }),
};
async function start() {
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const { createApp } = await import(
    pathToFileURL(resolve("dist/app.js")).href
  );
  app = await createApp({
    database,
    masterKey: key,
    publicUrl: `http://127.0.0.1:${port}`,
    worker: true,
    allowPrivateUpstreams: true,
    logger: false,
    wecomProvider: wecom,
  });
  app!.addHook("onResponse", async (request, reply) => {
    const template = `${request.method} ${request.routeOptions.url ?? "<unmatched>"} ${reply.statusCode}`;
    traffic[template] = (traffic[template] ?? 0) + 1;
  });
  origin = await app!.listen({ host: "127.0.0.1", port });
}
async function raw(
  method: string,
  path: string,
  token?: string,
  payload?: unknown,
  expected = 200,
) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== expected)
    throw new Error(
      `${method} ${path.split("?")[0]} expected ${expected}, received ${response.status}`,
    );
  return response;
}
async function api<T = Row>(
  method: string,
  path: string,
  token?: string,
  payload?: unknown,
  expected = 200,
): Promise<T> {
  const response = await raw(method, path, token, payload, expected);
  return (await response.json()) as T;
}
async function passed(operation: string) {
  results.push({ operation, passed: true });
  console.log(`PASS ${operation}`);
}
let reconciliation: Row | undefined;
try {
  await mkdir(evidence, { recursive: true });
  await start();
  const { bootstrap } = await import(
    pathToFileURL(resolve("dist/identity.js")).href
  );
  const a = (await bootstrap(app!.services.db, {
    name: "supplemental-A",
    email: "supplemental-a@example.test",
    password: "Supplement-controlled-password!",
  })) as { tenantId: string; userId: string };
  const b = (await bootstrap(app!.services.db, {
    name: "supplemental-B",
    email: "supplemental-b@example.test",
    password: "Supplement-controlled-password!",
  })) as { tenantId: string; userId: string };
  // 唯一初始SQL：明确建立同一合成用户的第二组织membership；所有被测行为仍走真实HTTP。
  app!.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,?,?)",
    b.tenantId,
    a.userId,
    "auditor",
    1,
  );
  let token = String(
    (
      await api("POST", "/api/auth/login", undefined, {
        email: "supplemental-a@example.test",
        password: "Supplement-controlled-password!",
        tenantId: a.tenantId,
      })
    ).token,
  );
  const p = `/api/tenants/${a.tenantId}`;
  const initial = await api<{ organizations: Row[] }>(
    "GET",
    "/api/auth/me",
    token,
  );
  assert.equal(initial.organizations.length, 2);
  await raw("GET", `/api/tenants/${b.tenantId}`, token, undefined, 403);
  const oldToken = token;
  token = String(
    (await api("POST", "/api/auth/switch", token, { tenantId: b.tenantId }))
      .token,
  );
  await raw("GET", "/api/auth/me", oldToken, undefined, 401);
  const switched = await api<{ user: Row; tenant: Row; role: string }>(
    "GET",
    "/api/auth/me",
    token,
  );
  assert.equal(switched.tenant.id, b.tenantId);
  assert.equal(switched.user.id, a.userId);
  assert.equal(switched.role, "auditor");
  await raw("GET", p, token, undefined, 403);
  await raw("GET", `/api/tenants/${b.tenantId}`, token);
  await raw(
    "POST",
    `/api/tenants/${b.tenantId}/departments`,
    token,
    { name: "no-owner-inheritance" },
    403,
  );
  token = String(
    (await api("POST", "/api/auth/switch", token, { tenantId: a.tenantId }))
      .token,
  );
  assert.equal(
    (await api<{ tenant: Row }>("GET", "/api/auth/me", token)).tenant.id,
    a.tenantId,
  );
  await passed("POST /api/auth/switch");

  await new Promise<void>((done) => vendor.listen(0, "127.0.0.1", done));
  const credential = String(
    (
      await api(
        "POST",
        `${p}/credentials`,
        token,
        { name: "supplemental-model-key", value: "supplemental-model-key" },
        201,
      )
    ).id,
  );
  const model = String(
    (
      await api(
        "POST",
        `${p}/models`,
        token,
        {
          name: "supplemental-model",
          upstreamModel: "controlled",
          baseUrl: `http://127.0.0.1:${(vendor.address() as { port: number }).port}/v1`,
          credentialId: credential,
          maxOutputTokens: 128,
          inputRate: 1000,
          outputRate: 1000,
          scope: { all: true },
        },
        201,
      )
    ).id,
  );
  const permissions = await api<{
    status: string;
    seat: boolean;
    resources: Row[];
    security: Row;
  }>("GET", `${p}/permissions/${a.userId}`, token);
  assert.equal(permissions.status, "active");
  assert.equal(permissions.seat, true);
  assert.ok(permissions.resources.some((row) => row.id === model));
  assert.equal(permissions.security.allowNetwork, true);
  await passed("GET /api/tenants/{tenantId}/permissions/{userId}");

  const before = await api<{ usage: { consumed: number; reserved: number } }>(
    "GET",
    `${p}/subscription`,
    token,
  );
  const gateway = raw(
    "POST",
    "/v1/chat/completions",
    token,
    {
      model,
      messages: [{ role: "user", content: "supplemental-uncertain" }],
      max_tokens: 32,
    },
    502,
  );
  const deadline = Date.now() + 10000;
  while (vendorRecords.length !== 1 || !releaseMalformed) {
    if (Date.now() > deadline)
      throw new Error("Controlled upstream was not dispatched");
    await delay(20);
  }
  const inFlight = await api<{ usage: { consumed: number; reserved: number } }>(
    "GET",
    `${p}/subscription`,
    token,
  );
  assert.ok(inFlight.usage.reserved > before.usage.reserved);
  releaseMalformed();
  const rejected = (await (await gateway).json()) as {
    error: { code: string };
  };
  assert.equal(rejected.error.code, "UPSTREAM_FORMAT");
  const usage = await api<{ items: Row[] }>("GET", `${p}/usage`, token);
  const entry = usage.items.find((row) => row.status === "uncertain");
  assert.ok(entry);
  assert.equal(entry.amount, entry.reserved);
  assert.ok(Number(entry.reserved) >= 15);
  const uncertain = await api<{
    usage: { consumed: number; reserved: number };
  }>("GET", `${p}/subscription`, token);
  assert.equal(uncertain.usage.reserved, 0);
  assert.equal(uncertain.usage.consumed, Number(entry.reserved));
  const manualAmount = vendorRecords[0]!.fixtureCredits;
  await api("PUT", `${p}/usage/${entry.id}/reconcile`, token, {
    amount: manualAmount,
    evidenceReference: "controlled-vendor-request-1:12-input+3-output-at-1000",
  });
  const settled = (
    await api<{ items: Row[] }>("GET", `${p}/usage`, token)
  ).items.find((row) => row.id === entry.id)!;
  assert.equal(settled.status, "settled");
  assert.equal(settled.amount, manualAmount);
  const after = await api<{ usage: { consumed: number; reserved: number } }>(
    "GET",
    `${p}/subscription`,
    token,
  );
  assert.equal(after.usage.consumed, manualAmount);
  assert.equal(after.usage.reserved, 0);
  await raw(
    "PUT",
    `${p}/usage/${entry.id}/reconcile`,
    token,
    {
      amount: manualAmount,
      evidenceReference: "duplicate-settled-entry-is-not-uncertain",
    },
    409,
  );
  assert.equal(vendorRecords.length, 1);
  reconciliation = {
    controlledVendorDispatchedRequests: 1,
    independentFixtureVendorLedger: vendorRecords,
    pendingReservedCredits: inFlight.usage.reserved,
    uncertainConsumedCredits: uncertain.usage.consumed,
    confirmedCredits: manualAmount,
    releasedCreditDifference: uncertain.usage.consumed - after.usage.consumed,
    finalReservedCredits: 0,
    duplicateSettledReconciliation: 409,
    source: "controlled fixture vendor ledger, not a real supplier invoice",
  };
  await passed("PUT /api/tenants/{tenantId}/usage/{id}/reconcile");

  const agent = String(
    (
      await api(
        "POST",
        `${p}/agents`,
        token,
        {
          name: "supplemental-original-agent",
          modelId: model,
          instructions: "original",
          maxOutputTokens: 32,
          scope: { all: true },
        },
        201,
      )
    ).id,
  );
  await api("POST", `${p}/agents/${agent}/publish`, token, { version: 1 });
  const previous = (await api<Row[]>("GET", `${p}/agents`, token)).find(
    (row) => row.id === agent,
  )!;
  const edited = await api("PUT", `${p}/agents/${agent}`, token, {
    revision: previous.revision,
    name: "supplemental-edited-agent",
    modelId: model,
    instructions: "persisted-v2-instructions",
    maxOutputTokens: 64,
    scope: { all: true },
    assetIds: [],
  });
  assert.equal(edited.version, 2);
  await api("POST", `${p}/agents/${agent}/publish`, token, { version: 2 });
  await app!.close();
  app = undefined;
  await start();
  const persisted = (
    await api<(Row & { data: Row })[]>("GET", `${p}/agents`, token)
  ).find((row) => row.id === agent)!;
  assert.equal(persisted.name, "supplemental-edited-agent");
  assert.equal(persisted.data.instructions, "persisted-v2-instructions");
  assert.equal(persisted.published_version, 2);
  await passed("PUT /api/tenants/{tenantId}/agents/{id}");

  const capability = await api("GET", `${p}/runtimes/capability`, token);
  assert.equal(capability.available, false);
  assert.equal(capability.image, "not-configured");
  assert.equal(capability.network, false);
  assert.equal(capability.hostMounts, false);
  assert.equal(capability.credentialInjection, false);
  assert.equal(capability.maxTenantRuntimes, 4);
  await passed("GET /api/tenants/{tenantId}/runtimes/capability");

  const wecomCredential = String(
    (
      await api(
        "POST",
        `${p}/credentials`,
        token,
        { name: "supplemental-WeCom", value: "supplemental-wecom-key" },
        201,
      )
    ).id,
  );
  await api("PUT", `${p}/wecom`, token, {
    corpId: "ww-supplemental-controlled",
    agentId: "1",
    credentialId: wecomCredential,
  });
  await api("PUT", `${p}/members/${a.userId}/wecom`, token, {
    externalId: "supplemental-wecom-user",
  });
  const attempt = await api(
    "POST",
    "/api/auth/wecom/attempts",
    undefined,
    { tenantId: a.tenantId },
    201,
  );
  const callback = await raw(
    "GET",
    `/api/auth/wecom/callback?state=${String(attempt.id)}&code=supplemental-wecom-code`,
  );
  assert.ok((await callback.text()).includes("扫码验证完成"));
  const claimed = await api(
    "POST",
    `/api/auth/wecom/attempts/${attempt.id}/claim`,
    undefined,
    { proof: attempt.proof },
  );
  assert.equal(claimed.status, "authorized");
  assert.equal(claimed.tenantId, a.tenantId);
  assert.equal(
    (await api<{ user: Row }>("GET", "/api/auth/me", String(claimed.token)))
      .user.id,
    a.userId,
  );
  await passed("GET /api/auth/wecom/callback");

  const specification = await api<{
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
  }>("GET", "/api/openapi.json");
  assert.equal(specification.openapi, "3.1.0");
  const operations = Object.values(specification.paths).reduce(
    (sum, methods) => sum + Object.keys(methods).length,
    0,
  );
  assert.equal(operations, 131);
  assert.ok(specification.paths["/api/auth/switch"]?.post);
  assert.ok(
    specification.paths["/api/tenants/{tenantId}/usage/{id}/reconcile"]?.put,
  );
  await passed("GET /api/openapi.json");
  await writeFile(
    join(evidence, "whole-backend-supplemental-report.json"),
    JSON.stringify(
      {
        status: "passed",
        gitHead,
        node: process.version,
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        reconciliation,
        openApiOperations: operations,
        directDatabaseUse:
          "initialization only: bootstrap two synthetic organizations and add same user's second membership",
        boundaries: [
          "controlled WeCom identity provider; not real organization callback acceptance",
          "controlled vendor ledger; not actual paid-model billing",
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} catch (error) {
  process.exitCode = 1;
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "whole-backend-supplemental-report.json"),
    JSON.stringify(
      {
        status: "failed",
        gitHead,
        node: process.version,
        results,
        error: error instanceof Error ? error.message : "failure",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.error(error instanceof Error ? error.message : "supplemental_failed");
} finally {
  releaseMalformed?.();
  await app?.close();
  vendor.closeAllConnections();
  await new Promise<void>((done) => vendor.close(() => done()));
  try {
    await writeFile(
      join(evidence, "whole-backend-supplemental-requests.json"),
      JSON.stringify({ records: traffic }, null, 2),
      { mode: 0o600 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log("SUPPLEMENTAL FIXTURE CLEANED");
}
