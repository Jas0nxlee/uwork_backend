import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { z } from "zod";
import { safeRequest, readJson } from "../../src/network.js";
import { hash } from "../../src/core.js";

const output = "evidence/client-real-wecom-callback-preflight-20261020";
await mkdir(output, { mode: 0o700 });
const env = parseEnv(await readFile(".env", "utf8"));
const db = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
const facts: Record<string, unknown> = {
  status: "partial",
  mainDatabaseReadOnly: true,
};
let accessToken = "";
let attempt: { origin: string; id: string; proof: string } | undefined;
async function upstream(path: string, params: Record<string, string>) {
  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/" + path);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return z
    .record(z.string(), z.unknown())
    .parse(
      await readJson(
        await safeRequest(url.toString(), { method: "GET", timeout: 15000 }),
      ),
    );
}
try {
  const token = await upstream("gettoken", {
    corpid: env.CorpId!,
    corpsecret: env.Secret!,
  });
  assert.equal(token.errcode, 0);
  accessToken = z.string().min(1).parse(token.access_token);
  const agent = await upstream("agent/get", {
    access_token: accessToken,
    agentid: env.AgentId!,
  });
  assert.equal(agent.errcode, 0);
  const domain = z.string().min(1).parse(agent.redirect_domain);
  const candidate = new URL("https://" + domain);
  assert.ok(
    !candidate.username &&
      !candidate.password &&
      candidate.pathname === "/" &&
      !candidate.search &&
      !candidate.hash,
  );
  facts.redirectDomainLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    candidate.hostname,
  );
  facts.publicHostMatchesApplication =
    candidate.hostname === new URL(env.PUBLIC_URL!).hostname;
  const response = await safeRequest(candidate.origin + "/health", {
    method: "GET",
    timeout: 10000,
  });
  facts.registeredDomainHealthHttpStatus = response.statusCode;
  if (response.statusCode === 200) {
    const health = z
      .object({ status: z.string(), version: z.string() })
      .safeParse(await readJson(response));
    facts.uworkHealthShapeMatches =
      health.success && health.data.version === "0.1.0";
    if (facts.uworkHealthShapeMatches) {
      const config = db
        .prepare(
          "SELECT tenant_id FROM enterprise_auth WHERE corp_id=? AND agent_id=?",
        )
        .get(env.CorpId!, env.AgentId!);
      assert.ok(config);
      const started = await safeRequest(
        candidate.origin + "/api/auth/wecom/attempts",
        {
          method: "POST",
          body: { tenantId: config.tenant_id },
          timeout: 10000,
        },
      );
      facts.remoteAttemptHttpStatus = started.statusCode;
      if (started.statusCode === 201) {
        const data = z
          .object({
            id: z.string(),
            proof: z.string(),
            authorizeUrl: z.string(),
          })
          .parse(await readJson(started));
        attempt = { origin: candidate.origin, id: data.id, proof: data.proof };
        const row = db
          .prepare("SELECT proof_hash FROM login_attempts WHERE id=?")
          .get(data.id);
        facts.registeredDomainRoutesToCurrentDatabase =
          row?.proof_hash === hash(data.proof);
        const authorize = new URL(data.authorizeUrl);
        facts.remoteApplicationMatches =
          authorize.searchParams.get("appid") === env.CorpId &&
          authorize.searchParams.get("agentid") === env.AgentId;
      }
    }
  }
} catch (error) {
  facts.probeFailure = {
    code:
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "PROBE_FAILED",
    kind: error instanceof Error ? error.name : "unknown",
  };
} finally {
  if (attempt) {
    const cancelled = await safeRequest(
      attempt.origin + `/api/auth/wecom/attempts/${attempt.id}/cancel`,
      { method: "POST", body: { proof: attempt.proof }, timeout: 10000 },
    );
    facts.ownRemoteAttemptCancelled = cancelled.statusCode === 200;
  }
  accessToken = "";
  db.close();
  await writeFile(
    output + "/result.json",
    JSON.stringify(facts, null, 2) + "\n",
    { mode: 0o600 },
  );
}
process.stdout.write(JSON.stringify(facts) + "\n");
