import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
const evidence = resolve("evidence/client-session-auth-20261017");

test("opaque interactive sessions own model access and usage without exposing provider keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-session-auth-"));
  const cleanup: (() => Promise<void>)[] = [
    () => rm(directory, { recursive: true, force: true }),
  ];
  t.after(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    assert.equal(failures.length, 0, "all owned resources must close");
  });
  const vendorKey = randomBytes(32).toString("hex");
  const contexts = [
    { role: "system", content: "Synthetic context: answer briefly." },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Current question" },
  ];
  const calls: Row[] = [];
  let validProviderAuthentication = true;
  const provider = createServer(async (req, res) => {
    validProviderAuthentication &&=
      req.headers.authorization === `Bearer ${vendorKey}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Row);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "session-result" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  cleanup.push(async () => {
    provider.closeAllConnections();
    await new Promise<void>((done, reject) =>
      provider.close((error) => (error ? reject(error) : done())),
    );
  });
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    worker: false,
  });
  cleanup.push(() => app.close());
  const owner = await bootstrap(app.services.db, {
    name: "Synthetic session tenant",
    email: "session-owner@example.test",
    password: "Synthetic-session-password!",
  });
  const other = await bootstrap(app.services.db, {
    name: "Other synthetic tenant",
    email: "other-owner@example.test",
    password: "Synthetic-session-password!",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const checks: { name: string; status: number }[] = [];
  async function api(
    name: string,
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
    extraHeaders: Record<string, string> = {},
  ): Promise<Row> {
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, expected, name);
    // Never pass key-bearing content to an assertion message or evidence.
    assert.ok(
      !text.includes(vendorKey),
      `${name}: no provider key in response`,
    );
    const value = (text ? JSON.parse(text) : {}) as Row;
    checks.push({ name, status: response.status });
    return value;
  }
  async function login(email: string) {
    return String(
      (
        await api("interactive-login", "POST", "/api/auth/login", undefined, {
          email,
          password: "Synthetic-session-password!",
        })
      ).token,
    );
  }
  const ownerToken = await login("session-owner@example.test");
  const p = `/api/tenants/${owner.tenantId}`;
  const department = await api(
    "create-parent-department",
    "POST",
    `${p}/departments`,
    ownerToken,
    { name: "Parent" },
    201,
  );
  const child = await api(
    "create-child-department",
    "POST",
    `${p}/departments`,
    ownerToken,
    { name: "Child", parentId: department.id },
    201,
  );
  const alice = await api(
    "create-alice-member",
    "POST",
    `${p}/members`,
    ownerToken,
    {
      name: "Alice",
      email: "session-alice@example.test",
      password: "Synthetic-session-password!",
      role: "member",
      seat: true,
      departmentId: child.id,
    },
    201,
  );
  const bob = await api(
    "create-bob-member",
    "POST",
    `${p}/members`,
    ownerToken,
    {
      name: "Bob",
      email: "session-bob@example.test",
      password: "Synthetic-session-password!",
      role: "member",
      seat: true,
    },
    201,
  );
  const aliceToken = await login("session-alice@example.test");
  const bobToken = await login("session-bob@example.test");
  const me = await api(
    "interactive-session-kind-and-user",
    "GET",
    "/api/auth/me",
    aliceToken,
  );
  assert.equal(me.kind, "session");
  assert.equal((me.user as Row).id, alice.id);
  assert.ok(
    !aliceToken.includes("."),
    "opaque session is not client-asserted JWT claims",
  );
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM sessions WHERE hash=?",
      createHash("sha256").update(aliceToken).digest("hex"),
    )!.count,
    1,
  );
  const credential = await api(
    "create-provider-vault-reference",
    "POST",
    `${p}/credentials`,
    ownerToken,
    { name: "Synthetic provider", value: vendorKey },
    201,
  );
  const modelInput = {
    name: "Managed session model",
    upstreamModel: "synthetic-upstream",
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
    credentialId: credential.id,
    inputRate: 1000,
    outputRate: 1000,
    maxOutputTokens: 16,
    scope: { all: true },
  };
  const model = await api(
    "create-managed-model",
    "POST",
    `${p}/models`,
    ownerToken,
    modelInput,
    201,
  );
  const configuration = await api(
    "session-fetches-backend-configuration",
    "GET",
    "/api/client/configuration",
    aliceToken,
  );
  assert.equal(configuration.tenantId, owner.tenantId);
  const models = await api(
    "session-fetches-model-directory",
    "GET",
    "/v1/models",
    aliceToken,
  );
  const listed = (models.data as Row[]).find((item) => item.id === model.id)!;
  assert.ok(listed);
  for (const forbidden of [
    "baseUrl",
    "credentialId",
    "apiKey",
    "api_key",
    "token",
    "secret",
  ])
    assert.equal(
      forbidden in listed,
      false,
      "directory carries public metadata only",
    );
  const completion = { model: model.id, messages: contexts, max_tokens: 16 };
  await api(
    "session-alice-direct-completion",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    200,
    { "idempotency-key": "alice-original" },
  );
  assert.deepEqual(calls[0]!.messages, contexts);
  assert.equal(calls[0]!.model, "synthetic-upstream");
  await api(
    "session-bob-direct-completion",
    "POST",
    "/v1/chat/completions",
    bobToken,
    completion,
    200,
    { "idempotency-key": "bob-original" },
  );
  await api(
    "body-user-id-forgery-rejected",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    { ...completion, user_id: bob.id },
    400,
  );
  await api(
    "header-user-id-does-not-change-actor",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    200,
    {
      "idempotency-key": "alice-header-forgery",
      "x-user-id": String(bob.id),
      "x-tenant-id": other.tenantId,
    },
  );
  assert.equal(
    app.services.db.get<{ user_id: string }>(
      "SELECT user_id FROM ledger WHERE request_key=?",
      "alice-header-forgery",
    )!.user_id,
    alice.id,
  );
  await api(
    "foreign-user-cannot-replay-alice",
    "POST",
    "/v1/chat/completions",
    bobToken,
    completion,
    409,
    { "idempotency-key": "alice-original" },
  );
  assert.equal(calls.length, 3);
  await new Promise((done) => setTimeout(done, 5));
  const aliceUsage = await api(
    "own-usage-ignores-forged-query-user",
    "GET",
    `/api/client/usage?userId=${bob.id}&user_id=${bob.id}`,
    aliceToken,
  );
  const bobUsage = await api(
    "bob-own-usage",
    "GET",
    "/api/client/usage",
    bobToken,
  );
  assert.equal((aliceUsage.summary as Row).cost, 10);
  assert.equal((bobUsage.summary as Row).cost, 5);
  assert.equal((aliceUsage.summary as Row).requestCount, 2);
  assert.equal((bobUsage.summary as Row).requestCount, 1);
  await api(
    "member-cannot-read-admin-usage",
    "GET",
    `${p}/usage`,
    aliceToken,
    undefined,
    403,
  );
  await api(
    "cross-tenant-path-rejected",
    "GET",
    `/api/tenants/${other.tenantId}/usage`,
    aliceToken,
    undefined,
    403,
  );
  const usage = await api(
    "admin-filtered-alice-usage",
    "GET",
    `${p}/usage?userId=${alice.id}`,
    ownerToken,
  );
  assert.equal(usage.total, 2);
  assert.ok((usage.items as Row[]).every((row) => row.user_id === alice.id));
  const aggregates = (await api(
    "admin-member-usage-aggregates",
    "GET",
    `${p}/usage/aggregates?groupBy=member`,
    ownerToken,
  )) as unknown as Row[];
  assert.equal(aggregates.find((row) => row.subject === alice.id)!.credits, 10);
  assert.equal(aggregates.find((row) => row.subject === bob.id)!.credits, 5);
  await api(
    "member-cannot-change-quota",
    "PUT",
    `${p}/limits`,
    aliceToken,
    { subjectType: "member", subjectId: alice.id, amount: 100 },
    403,
  );
  await api("set-member-zero-quota", "PUT", `${p}/limits`, ownerToken, {
    subjectType: "member",
    subjectId: alice.id,
    amount: 0,
  });
  await api(
    "member-quota-enforced-402",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    402,
  );
  await api(
    "remove-member-quota",
    "DELETE",
    `${p}/limits/member/${alice.id}`,
    ownerToken,
    undefined,
    204,
  );
  await api(
    "set-parent-department-zero-quota",
    "PUT",
    `${p}/limits`,
    ownerToken,
    { subjectType: "department", subjectId: department.id, amount: 0 },
  );
  await api(
    "ancestor-department-quota-enforced-402",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    402,
  );
  await api(
    "remove-department-quota",
    "DELETE",
    `${p}/limits/department/${department.id}`,
    ownerToken,
    undefined,
    204,
  );
  await api(
    "revoke-member-seat",
    "PATCH",
    `${p}/members/${alice.id}`,
    ownerToken,
    { seat: false },
  );
  await api(
    "seat-enforced-on-existing-session-403",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    403,
  );
  await api(
    "restore-member-seat",
    "PATCH",
    `${p}/members/${alice.id}`,
    ownerToken,
    { seat: true },
  );
  await api(
    "promote-member-to-operator",
    "PATCH",
    `${p}/members/${alice.id}`,
    ownerToken,
    { role: "operator" },
  );
  await api(
    "role-change-visible-to-existing-session",
    "GET",
    `${p}/members`,
    aliceToken,
  );
  await api(
    "restore-member-role",
    "PATCH",
    `${p}/members/${alice.id}`,
    ownerToken,
    { role: "member" },
  );
  await api(
    "member-management-read-denied-again",
    "GET",
    `${p}/members`,
    aliceToken,
    undefined,
    403,
  );
  await api(
    "scope-model-to-alice",
    "PUT",
    `${p}/models/${model.id}`,
    ownerToken,
    { ...modelInput, scope: { members: [alice.id] }, revision: 1 },
  );
  const bobModels = await api(
    "model-scope-removes-bob-directory",
    "GET",
    "/v1/models",
    bobToken,
  );
  assert.equal((bobModels.data as Row[]).length, 0);
  await api(
    "model-scope-rechecks-existing-bob-session-403",
    "POST",
    "/v1/chat/completions",
    bobToken,
    completion,
    403,
  );
  const wecomCredential = await api(
    "create-synthetic-identity-reference",
    "POST",
    `${p}/credentials`,
    ownerToken,
    { name: "Synthetic identity only", value: randomBytes(24).toString("hex") },
    201,
  );
  await api(
    "configure-synthetic-identity-without-network",
    "PUT",
    `${p}/wecom`,
    ownerToken,
    {
      corpId: "synthetic-corp",
      agentId: "1",
      credentialId: wecomCredential.id,
    },
  );
  await api(
    "owner-binds-synthetic-wecom-user",
    "PUT",
    `${p}/members/${alice.id}/wecom`,
    ownerToken,
    { externalId: "synthetic-wecom-alice" },
  );
  await api(
    "member-cannot-rebind-identity",
    "PUT",
    `${p}/members/${bob.id}/wecom`,
    bobToken,
    { externalId: "forged" },
    403,
  );
  await api(
    "duplicate-wecom-binding-rejected",
    "PUT",
    `${p}/members/${bob.id}/wecom`,
    ownerToken,
    { externalId: "synthetic-wecom-alice" },
    409,
  );
  const members = await api(
    "admin-member-mapping-readable",
    "GET",
    `${p}/members`,
    ownerToken,
  );
  assert.equal(
    (members.items as Row[]).find((row) => row.id === alice.id)!.external_id,
    "synthetic-wecom-alice",
  );
  await api("disable-member", "PATCH", `${p}/members/${alice.id}`, ownerToken, {
    status: "disabled",
  });
  await api(
    "disable-revokes-existing-session-401",
    "POST",
    "/v1/chat/completions",
    aliceToken,
    completion,
    401,
  );
  await api(
    "reenable-member",
    "PATCH",
    `${p}/members/${alice.id}`,
    ownerToken,
    { status: "active" },
  );
  await api(
    "reenable-does-not-restore-old-session",
    "GET",
    "/api/auth/me",
    aliceToken,
    undefined,
    401,
  );
  const freshAlice = await login("session-alice@example.test");
  await api(
    "fresh-interactive-session-valid",
    "GET",
    "/api/auth/me",
    freshAlice,
  );
  const time = Date.now();
  await api(
    "expire-local-subscription",
    "PUT",
    `${p}/subscription`,
    ownerToken,
    {
      seats: 10,
      credits: 1000000,
      startsAt: time - 2000,
      endsAt: time - 1000,
      metering: "calendar",
    },
  );
  await api(
    "subscription-blocks-model-call-402",
    "POST",
    "/v1/chat/completions",
    freshAlice,
    completion,
    402,
  );
  assert.equal(
    calls.length,
    3,
    "all denied operations stop before supplier dispatch",
  );
  assert.ok(
    validProviderAuthentication,
    "only backend-injected provider key authenticates upstream",
  );
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM ledger",
    )!.count,
    3,
  );
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM ledger WHERE status='settled'",
    )!.count,
    3,
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(
      {
        status: "passed",
        checks,
        localProviderCalls: calls.length,
        actualProviderCalls: 0,
        settledCredits: 15,
        contextMessages: contexts.length,
        credentialExposure: false,
        authentication:
          "Opaque interactive session from login, not a vendor key or caller-supplied user identifier",
        cleanup:
          "Owned temporary database and two HTTP listeners removed on test teardown",
        boundaries: [
          "Synthetic local identity mapping only; no actual WeCom login/directory call",
          "No external MCP/drive",
          "No main environment/database reads or writes",
          "Not Electron/native UI acceptance",
        ],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
});
