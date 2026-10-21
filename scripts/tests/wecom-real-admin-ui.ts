import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { parseEnv } from "node:util";
import type { ViteDevServer } from "vite";
import { createApp } from "../../src/app.js";
import { bootstrap as createTenant } from "../../src/identity.js";
import {
  OwnedAdminBrowser,
  portClosed,
} from "../fixtures/owned-admin-browser.js";

const profile = process.argv[2];
const development = process.env.UWORK_WECOM_ADMIN_DEV === "1";
assert.ok(profile && /^real-wecom-admin-v\d+-20261021$/.test(profile));
const evidence = resolve("evidence", profile);
const root = join("/Users/ljp/Library/Caches/uwork-backend", profile);
await mkdir(evidence, { mode: 0o700 });
await mkdir(root, { mode: 0o700 });
const env = parseEnv(await readFile(".env", "utf8"));
const bootstrap = await readFile("data/bootstrap-credentials.txt", "utf8");
const field = (name: string) => {
  const match = bootstrap.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  assert.ok(match);
  return match[1]!.trim();
};
const main = new DatabaseSync(env.DATABASE_PATH!, { readOnly: true });
function identitySnapshot(db: DatabaseSync) {
  return Object.fromEntries(
    ["users", "departments", "members"].map((table) => {
      const rows = db
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort();
      return [
        table,
        {
          count: rows.length,
          digest: createHash("sha256").update(rows.join("\n")).digest("hex"),
        },
      ];
    }),
  );
}
const beforeMain = identitySnapshot(main);
const clonePath = join(root, "clone.sqlite");
const facts: Record<string, unknown> = {
  status: "failed",
  mainReadOnly: true,
  worker: false,
  frontend: development ? "vite-source" : "static-build",
  stages: [],
};
const traffic: { kind: string; status: number }[] = [];
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let browser: OwnedAdminBrowser | undefined;
let port = 0;
let frontendPort = 0;
let frontend: ViteDevServer | undefined;
let secretLeaked = false;
let readDb: DatabaseSync | undefined;
try {
  await backup(main, clonePath);
  await chmod(clonePath, 0o600);
  const clone = new DatabaseSync(clonePath);
  clone.exec("DELETE FROM instance_lease");
  const roles = clone
    .prepare(
      "SELECT tenant_id,user_id,role,seat FROM members ORDER BY tenant_id,user_id",
    )
    .all();
  const before = identitySnapshot(clone);
  clone.close();
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  const backendOrigin = `http://127.0.0.1:${port}`;
  if (development) {
    const { createServer: createViteServer } = await import("vite");
    frontend = await createViteServer({
      configFile: resolve("admin/vite.config.ts"),
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: true,
        open: false,
        proxy: { "/api": backendOrigin, "/v1": backendOrigin },
      },
    });
    await frontend.listen();
    frontendPort = (frontend.httpServer!.address() as { port: number }).port;
  }
  const origin = development
    ? `http://127.0.0.1:${frontendPort}`
    : backendOrigin;
  app = await createApp({
    database: clonePath,
    masterKey: Buffer.from(env.MASTER_KEY!, "hex"),
    publicUrl: origin,
    worker: false,
    logger: false,
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (
      req.url === "/api/auth/login" &&
      reply.statusCode === 200 &&
      typeof payload === "string"
    ) {
      const body = JSON.parse(payload) as Record<string, unknown>;
      facts.browserLoginReturnedToken = typeof body.token === "string";
      facts.browserLoginHttpOnlyCookie = String(
        reply.getHeader("set-cookie"),
      ).includes("HttpOnly");
    }
    if (
      req.url === "/api/auth/switch" &&
      reply.statusCode === 200 &&
      typeof payload === "string"
    ) {
      const body = JSON.parse(payload) as Record<string, unknown>;
      const values = (facts.browserSwitchReturnedTokens ??= []) as boolean[];
      values.push(typeof body.token === "string");
      const cookies = (facts.browserSwitchHttpOnlyCookies ??= []) as boolean[];
      cookies.push(String(reply.getHeader("set-cookie")).includes("HttpOnly"));
    }
    if (
      typeof payload === "string" &&
      env.Secret &&
      payload.includes(env.Secret)
    )
      secretLeaked = true;
    const kind = req.url.includes("/wecom/sync")
      ? "sync"
      : req.url.includes("/wecom")
        ? "wecom-config"
        : req.url.includes("/members")
          ? "members"
          : req.url.includes("/departments")
            ? "departments"
            : req.url.startsWith("/api/auth/")
              ? "auth"
              : "other";
    if (kind !== "other") traffic.push({ kind, status: reply.statusCode });
    return payload;
  });
  await app.listen({ host: "127.0.0.1", port });
  const control = join(root, "control.json");
  await writeFile(
    control,
    JSON.stringify({
      origin,
      development,
      email: field("Email"),
      password: field("Password"),
      corpId: env.CorpId,
      agentId: env.AgentId,
    }),
    { mode: 0o600 },
  );
  browser = new OwnedAdminBrowser({
    root,
    evidence,
    name: profile,
    redact: (value) =>
      [env.Secret!, env.MASTER_KEY!, field("Password")].reduce(
        (text, secret) => text.replaceAll(secret, "[redacted]"),
        value,
      ),
  });
  await browser.start();
  const driver = resolve("scripts/tests/wecom-real-admin-ui.py");
  const run = (stage: string) =>
    browser!.run(driver, stage, { UWORK_WECOM_UI_CONTROL: control });
  const stages = facts.stages as Record<string, unknown>[];
  stages.push(await run("login-config"));
  assert.equal(facts.browserLoginHttpOnlyCookie, true);
  assert.equal(
    facts.browserLoginReturnedToken,
    false,
    "Admin browser login must use cookie-only delivery",
  );
  const second = await createTenant(app.services.db, {
    name: "Owned UI switch test",
    email: "owned-ui-switch@example.test",
    password: "owned-ui-switch-test-password",
  });
  const currentUser = app.services.db.get<{ id: string }>(
    "SELECT id FROM users WHERE email=?",
    field("Email"),
  );
  assert.ok(currentUser);
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'owner',1)",
    second.tenantId,
    currentUser.id,
  );
  const currentControl = JSON.parse(await readFile(control, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    control,
    JSON.stringify({
      ...currentControl,
      primaryTenant: field("Tenant ID"),
      secondaryTenant: second.tenantId,
    }),
    { mode: 0o600 },
  );
  stages.push(await run("switch"));
  assert.deepEqual(facts.browserSwitchReturnedTokens, [false, false]);
  assert.deepEqual(facts.browserSwitchHttpOnlyCookies, [true, true]);
  const read = new DatabaseSync(clonePath, { readOnly: true });
  readDb = read;
  let afterFirst: ReturnType<typeof identitySnapshot> | undefined;
  for (const stage of ["sync-first", "sync-repeat"]) {
    stages.push(await run(stage));
    assert.equal(
      traffic.filter((row) => row.kind === "sync" && row.status === 200).length,
      stage === "sync-first" ? 1 : 2,
    );
    for (const member of roles) {
      const current = read
        .prepare(
          "SELECT role,seat FROM members WHERE tenant_id=? AND user_id=?",
        )
        .get(member.tenant_id!, member.user_id!);
      assert.ok(current);
      assert.equal(current.role, member.role);
      assert.equal(current.seat, member.seat);
    }
    assert.equal(read.prepare("PRAGMA foreign_key_check").all().length, 0);
    if (afterFirst) assert.deepEqual(identitySnapshot(read), afterFirst);
    else afterFirst = identitySnapshot(read);
  }
  const counts = {
    members: Number(
      read
        .prepare("SELECT COUNT(*) AS n FROM members WHERE tenant_id=?")
        .get(field("Tenant ID"))!.n,
    ),
    departments: Number(
      read
        .prepare("SELECT COUNT(*) AS n FROM departments WHERE tenant_id=?")
        .get(field("Tenant ID"))!.n,
    ),
  };
  await writeFile(join(root, "counts.json"), JSON.stringify(counts), {
    mode: 0o600,
  });
  stages.push(await run("directory"));
  stages.push(await run("logout"));
  read.close();
  readDb = undefined;
  assert.equal(secretLeaked, false);
  facts.status = "passed";
  facts.idempotent = true;
  facts.rolesAndSeatsPreserved = true;
  facts.counts = counts;
  facts.beforeCounts = Object.fromEntries(
    Object.entries(before).map(([key, value]) => [key, value.count]),
  );
} catch (error) {
  facts.failure =
    error instanceof assert.AssertionError
      ? {
          type: "assertion",
          operator: error.operator,
          message: error.message.split("\n")[0],
        }
      : { type: error instanceof Error ? error.name : "unknown" };
} finally {
  facts.traffic = traffic;
  facts.secretLeaked = secretLeaked;
  const browserCleanup = await browser?.close();
  facts.browserCleanup = browserCleanup;
  if (browserCleanup && !browserCleanup.fullyClosed) facts.status = "failed";
  readDb?.close();
  await frontend?.close();
  facts.frontendPortClosed = frontendPort
    ? await portClosed(frontendPort)
    : true;
  await app?.close();
  facts.backendPortClosed = port ? await portClosed(port) : true;
  facts.mainUnchanged =
    JSON.stringify(identitySnapshot(main)) === JSON.stringify(beforeMain);
  main.close();
  if (
    !facts.mainUnchanged ||
    !facts.backendPortClosed ||
    !facts.frontendPortClosed
  )
    facts.status = "failed";
  if (!browserCleanup || browserCleanup.fullyClosed) {
    await rm(root, { recursive: true, force: true });
    facts.privateRootRemoved = true;
  }
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(facts, null, 2),
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(facts));
process.exitCode = facts.status === "passed" ? 0 : 1;
