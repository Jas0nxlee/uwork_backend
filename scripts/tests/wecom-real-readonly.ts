import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Vault } from "../../src/vault.js";
import { createWecomProvider } from "../../src/wecom.js";
import { safeRequest, readJson } from "../../src/network.js";

const profile = process.argv[2] ?? "client-real-wecom-readonly-20261020";
assert.match(profile, /^client-real-wecom-readonly(?:-v[0-9]+)?-20261020$/);
const output = "evidence/" + profile;
await mkdir(output, { mode: 0o700 });
const env = parseEnv(await readFile(".env", "utf8"));
assert.ok(
  ["CorpId", "AgentId", "Secret", "MASTER_KEY", "DATABASE_PATH"].every(
    (key) => env[key],
  ),
);
const db = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
const facts: Record<string, unknown> = {
  status: "partial",
  mainDatabaseReadOnly: true,
  upstream: [],
};
const upstream = facts.upstream as {
  endpoint: string;
  status: number;
  errcode?: number;
  sourceIpRejected?: boolean;
}[];
let token: string | undefined;
const safeError = (error: unknown) => {
  const value = error as { code?: string; status?: number; message?: string };
  const match = value.message?.match(/errcode (\d+)/);
  return {
    code: value.code ?? "READ_FAILED",
    httpStatus: value.status,
    upstreamCode: match ? Number(match[1]) : undefined,
  };
};
try {
  const config = db
    .prepare("SELECT * FROM enterprise_auth WHERE corp_id=? AND agent_id=?")
    .get(env.CorpId!, env.AgentId!) as
    | {
        tenant_id: string;
        corp_id: string;
        agent_id: string;
        credential_id: string;
      }
    | undefined;
  assert.ok(config);
  const adapter = {
    get(sql: string, ...params: (string | number | null)[]) {
      return db.prepare(sql).get(...params);
    },
  };
  const vault = Reflect.construct(Vault, [
    adapter,
    Buffer.from(env.MASTER_KEY!, "hex"),
  ]) as Vault;
  const credential = vault.read(config.tenant_id, config.credential_id);
  assert.equal(credential, env.Secret);
  facts.configurationAndVaultMatch = true;
  async function transport(endpoint: string, params: Record<string, string>) {
    assert.ok(
      ["gettoken", "department/list", "user/list", "agent/get"].includes(
        endpoint,
      ),
    );
    assert.ok(upstream.length < 100, "Readonly request budget exceeded");
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/" + endpoint);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const response = await safeRequest(url.toString(), {
      method: "GET",
      timeout: 15000,
    });
    const data = z
      .record(z.string(), z.unknown())
      .parse(await readJson(response));
    upstream.push({
      endpoint,
      status: response.statusCode,
      ...(typeof data.errcode === "number" ? { errcode: data.errcode } : {}),
      ...(data.errcode === 60020 && typeof data.errmsg === "string"
        ? {
            sourceIpRejected: /not allow.*(?:access|from).*ip/i.test(
              data.errmsg,
            ),
          }
        : {}),
    });
    if (
      endpoint === "gettoken" &&
      data.errcode === 0 &&
      typeof data.access_token === "string"
    ) {
      token = data.access_token;
      facts.realTokenAccepted = true;
    }
    return data;
  }
  const provider = createWecomProvider(transport);
  try {
    const directory = await provider.directory(config, credential);
    facts.directory = {
      status: "passed",
      departments: directory.departments.length,
      members: directory.members.length,
      activeMembers: directory.members.filter((member) => member.active).length,
    };
  } catch (error) {
    facts.directory = { status: "failed", ...safeError(error) };
  }
  if (token) {
    try {
      const data = await transport("agent/get", {
        access_token: token,
        agentid: config.agent_id,
      });
      const redirect =
        typeof data.redirect_domain === "string"
          ? data.redirect_domain.trim()
          : "";
      facts.realApplication =
        data.errcode === 0
          ? {
              accepted: true,
              readableNamePresent: typeof data.name === "string" && !!data.name,
              redirectDomainConfigured: !!redirect,
              configuredPublicHostMatches:
                !!redirect && new URL(env.PUBLIC_URL!).hostname === redirect,
            }
          : {
              accepted: false,
              upstreamCode: data.errcode,
              detailsUnavailable: true,
            };
    } catch (error) {
      facts.realApplication = { accepted: false, ...safeError(error) };
    }
  }
  try {
    const response = await fetch("http://127.0.0.1:" + env.PORT + "/health", {
      signal: AbortSignal.timeout(5000),
    });
    facts.liveBackendHealthStatus = response.status;
  } catch {
    facts.liveBackendHealthStatus = "unavailable";
  }
  if ((facts.directory as { status: string }).status === "passed")
    facts.status = "readonly-api-passed";
} catch (error) {
  facts.failure = safeError(error);
} finally {
  token = undefined;
  db.close();
  await writeFile(
    output + "/result.json",
    JSON.stringify(facts, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(facts));
