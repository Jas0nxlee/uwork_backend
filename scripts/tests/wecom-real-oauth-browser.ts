import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";

const profile = process.argv[3] ?? "client-real-wecom-oauth-browser-20261020";
assert.match(profile, /^client-real-wecom-oauth-browser(?:-v\d+)?-20261020$/);
const root = "/Users/ljp/Library/Caches/uwork-backend/" + profile;
const env = parseEnv(await readFile(".env", "utf8"));
const origin = `http://127.0.0.1:${Number(env.PORT)}`;
const db = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
const stateFile = root + "/attempt.json";
let token = "";
async function api(path: string, body?: unknown) {
  const r = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    value: r.status === 204 ? undefined : await r.json(),
  };
}
if (process.argv[2] === "start") {
  await mkdir(root, { mode: 0o700 });
  const config = db
    .prepare(
      "SELECT tenant_id FROM enterprise_auth WHERE corp_id=? AND agent_id=?",
    )
    .get(env.CorpId!, env.AgentId!);
  assert.ok(config);
  const started = await api("/api/auth/wecom/attempts", {
    tenantId: config.tenant_id,
  });
  assert.equal(started.status, 201);
  await writeFile(stateFile, JSON.stringify(started.value), { mode: 0o600 });
  process.stdout.write(
    JSON.stringify({ ownAttemptCreated: true, privateControlFile: stateFile }) +
      "\n",
  );
} else if (process.argv[2] === "finish") {
  const attempt = JSON.parse(await readFile(stateFile, "utf8"));
  const facts: Record<string, unknown> = {
    status: "partial",
    realBrowserAttempt: true,
  };
  try {
    const row = db
      .prepare("SELECT status FROM login_attempts WHERE id=?")
      .get(attempt.id);
    facts.attemptStatus = row?.status;
    if (row?.status === "authorized") {
      const claim = await api(`/api/auth/wecom/attempts/${attempt.id}/claim`, {
        proof: attempt.proof,
        delivery: "token",
      });
      assert.equal(claim.status, 200);
      assert.equal(claim.value.status, "authorized");
      token = claim.value.token;
      assert.ok(token);
      const me = await api("/api/auth/me");
      assert.equal(me.status, 200);
      assert.ok(me.value.membership.externalId);
      facts.realWecomMemberSessionVerified = true;
      facts.status = "passed-real-oauth";
    }
  } finally {
    if (token) {
      facts.ownSessionLogoutStatus = (
        await api("/api/auth/logout", { revokeDevices: false })
      ).status;
      facts.oldSessionRejected = (await api("/api/auth/me")).status === 401;
      token = "";
    }
    facts.ownAttemptCancelStatus = (
      await api(`/api/auth/wecom/attempts/${attempt.id}/cancel`, {
        proof: attempt.proof,
      })
    ).status;
    await rm(stateFile);
    await mkdir("evidence/" + profile, { mode: 0o700 });
    await writeFile(
      "evidence/" + profile + "/result.json",
      JSON.stringify(facts, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(facts) + "\n");
  }
} else throw new Error("Use start or finish");
db.close();
