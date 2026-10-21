import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { hash } from "../../src/core.js";

const profile = process.argv[2] ?? "client-real-wecom-live-config-20261020";
assert.match(profile, /^client-real-wecom-live-config(?:-v\d+)?-20261020$/);
const output = "evidence/" + profile;
await mkdir(output, { mode: 0o700 });
const env = parseEnv(await readFile(".env", "utf8"));
const origin = `http://127.0.0.1:${Number(env.PORT)}`;
const bootstrap = await readFile("data/bootstrap-credentials.txt", "utf8");
const field = (name: string) => {
  const match = bootstrap.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  assert.ok(match);
  return match[1]!.trim();
};
const db = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
const facts: Record<string, unknown> = { status: "failed", checks: [] };
const checks = facts.checks as string[];
let token = "";
let attempt: { id: string; proof: string } | undefined;
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const value = response.status === 204 ? undefined : await response.json();
  return { status: response.status, value };
}
try {
  assert.equal((await api("/health")).status, 200);
  const login = await api("/api/auth/login", "POST", {
    email: field("Email"),
    password: field("Password"),
    tenantId: field("Tenant ID"),
    delivery: "token",
  });
  assert.equal(login.status, 200);
  token = login.value.token;
  assert.ok(token);
  const me = await api("/api/auth/me");
  assert.equal(me.status, 200);
  const tenantId = me.value.tenant.id;
  const config = await api(`/api/tenants/${tenantId}/wecom`);
  assert.equal(config.status, 200);
  assert.equal(config.value.configuration.corp_id, env.CorpId);
  assert.equal(config.value.configuration.agent_id, env.AgentId);
  const callback = new URL(config.value.callbackUrl);
  facts.callback = {
    https: callback.protocol === "https:",
    loopback: ["127.0.0.1", "localhost", "[::1]"].includes(callback.hostname),
  };
  checks.push("live-admin-configuration-matches-provided-real-application");
  const started = await api("/api/auth/wecom/attempts", "POST", { tenantId });
  assert.equal(started.status, 201);
  attempt = { id: started.value.id, proof: started.value.proof };
  const authorize = new URL(started.value.authorizeUrl);
  assert.equal(authorize.origin, "https://login.work.weixin.qq.com");
  assert.equal(authorize.searchParams.get("appid"), env.CorpId);
  assert.equal(authorize.searchParams.get("agentid"), env.AgentId);
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    config.value.callbackUrl,
  );
  assert.equal(authorize.searchParams.get("state"), attempt.id);
  checks.push("original-real-application-oauth-url-and-unique-state");
  const claim = await api(
    `/api/auth/wecom/attempts/${attempt.id}/claim`,
    "POST",
    { proof: attempt.proof, delivery: "token" },
  );
  assert.equal(claim.status, 200);
  assert.equal(claim.value.status, "pending");
  assert.equal(
    (
      await api(`/api/auth/wecom/attempts/${attempt.id}/cancel`, "POST", {
        proof: attempt.proof,
      })
    ).status,
    200,
  );
  const cancelled = await api(
    `/api/auth/wecom/attempts/${attempt.id}/claim`,
    "POST",
    { proof: attempt.proof, delivery: "token" },
  );
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.value.error.code, "ATTEMPT_USED");
  checks.push("own-pending-attempt-cancel-and-claim-denial");
  facts.status = "passed";
} catch (error) {
  facts.failure =
    error instanceof assert.AssertionError
      ? { kind: "assertion", code: error.code, operator: error.operator }
      : {
          kind: "runtime",
          name: error instanceof Error ? error.name : "unknown",
        };
} finally {
  if (attempt) {
    facts.ownAttemptCancelCleanup =
      (
        await api(`/api/auth/wecom/attempts/${attempt.id}/cancel`, "POST", {
          proof: attempt.proof,
        })
      ).status === 200;
  }
  if (token) {
    const ownHash = hash(token);
    facts.logoutStatus = (
      await api("/api/auth/logout", "POST", { revokeDevices: false })
    ).status;
    facts.ownSessionAbsent = !db
      .prepare("SELECT hash FROM sessions WHERE hash=?")
      .get(ownHash);
    facts.oldSessionRejected = (await api("/api/auth/me")).status === 401;
    if (
      facts.logoutStatus !== 204 ||
      !facts.ownSessionAbsent ||
      !facts.oldSessionRejected
    )
      facts.status = "failed";
    token = "";
  }
  db.close();
  await writeFile(
    output + "/result.json",
    JSON.stringify(facts, null, 2) + "\n",
    { mode: 0o600 },
  );
}
process.stdout.write(JSON.stringify(facts) + "\n");
process.exitCode = facts.status === "passed" ? 0 : 1;
