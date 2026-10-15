import {
  scrypt as scryptCallback,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { fail, hash, id, now, secret, text } from "./core.js";
import { audit } from "./events.js";
import { authenticate } from "./access.js";

const scrypt = promisify(scryptCallback);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
async function passwordMatches(password: string, value: string | null) {
  const [salt, digest] = (value ?? "dummy:00").split(":");
  const actual = (await scrypt(password, salt!, 64)) as Buffer;
  const expected = Buffer.from(digest!, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export async function bootstrap(
  db: Db,
  input: { name: string; email: string; password: string },
) {
  const data = z
    .object({
      name: text,
      email: z.email().toLowerCase(),
      password: z.string().min(14).max(200),
    })
    .parse(input);
  const digest = await passwordHash(data.password);
  const tenantId = id(),
    userId = id();
  db.transaction(() => {
    if (db.get("SELECT id FROM users WHERE email=?", data.email))
      fail(409, "EMAIL_EXISTS", "账号已存在");
    db.run(
      "INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)",
      tenantId,
      data.name,
      now(),
    );
    db.run(
      "INSERT INTO users VALUES(?,?,?,?,?)",
      userId,
      data.email,
      data.name,
      digest,
      now(),
    );
    db.run(
      "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,?,1)",
      tenantId,
      userId,
      "owner",
    );
    db.run(
      "INSERT INTO subscriptions VALUES(?,?,?,?,?,?)",
      tenantId,
      10,
      1000000,
      now(),
      now() + 365 * 86400000,
      "calendar",
    );
  });
  return { tenantId, userId };
}
export function issueSession(
  db: Db,
  userId: string,
  tenantId: string,
  kind = "session",
  scopes = ["execute"],
  ttl = 12 * 3600000,
) {
  const token = secret();
  const expiresAt = now() + ttl;
  db.run(
    "INSERT INTO sessions VALUES(?,?,?,?,?,?,?)",
    hash(token),
    userId,
    tenantId,
    expiresAt,
    kind,
    JSON.stringify(scopes),
    now(),
  );
  return { token, expiresAt };
}
export function purgeIdentity(db: Db, time: number) {
  db.run("DELETE FROM sessions WHERE expires_at<?", time);
  db.run("DELETE FROM login_attempts WHERE expires_at<?", time);
  db.run("DELETE FROM connector_sessions WHERE expires_at<?", time);
}
export function rateLimit(db: Db, key: string, max = 10, window = 15 * 60000) {
  db.transaction(() => {
    db.run("DELETE FROM auth_limits WHERE reset_at<?", now());
    db.run(
      "INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      key,
      now() + window,
    );
    if (
      db.get<{ count: number }>(
        "SELECT count FROM auth_limits WHERE key=?",
        key,
      )!.count > max
    )
      fail(429, "RATE_LIMIT", "请求过于频繁，请稍后重试");
  });
}
export function identityRoutes(
  app: FastifyInstance,
  db: Db,
  publicUrl: string,
) {
  const cookie = (token: string, ttl: number) =>
    `uwork_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${publicUrl.startsWith("https:") ? "; Secure" : ""}`;
  app.post("/api/auth/login", async (req, reply) => {
    rateLimit(db, `login:${req.ip}`);
    const data = z
      .object({
        email: z.email().toLowerCase(),
        password: z.string().max(200),
        tenantId: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const user = db.get<{ id: string; password: string | null }>(
      "SELECT id,password FROM users WHERE email=?",
      data.email,
    );
    if (
      !(await passwordMatches(data.password, user?.password ?? null)) ||
      !user
    )
      fail(401, "INVALID_LOGIN", "账号或密码不正确");
    const memberships = db.all<{ tenant_id: string }>(
      "SELECT tenant_id FROM members WHERE user_id=? AND status='active' ORDER BY tenant_id",
      user.id,
    );
    const tenantId = data.tenantId ?? memberships[0]?.tenant_id;
    if (!tenantId || !memberships.some((m) => m.tenant_id === tenantId))
      fail(403, "NO_MEMBERSHIP", "未加入此组织");
    const result = issueSession(db, user.id, tenantId);
    reply.header("set-cookie", cookie(result.token, 43200));
    audit(db, { tenantId, userId: user.id }, "identity.login");
    return result;
  });
  app.get("/api/auth/me", async (req) => {
    const actor = authenticate(db, req);
    return {
      user: db.get("SELECT id,email,name FROM users WHERE id=?", actor.userId),
      tenant: db.get(
        "SELECT id,name,source FROM tenants WHERE id=?",
        actor.tenantId,
      ),
      role: actor.role,
      seat: actor.seat,
      kind: actor.kind,
      expiresAt: db.get<{ expires_at: number }>(
        "SELECT expires_at FROM sessions WHERE hash=?",
        actor.sessionHash,
      )!.expires_at,
      organizations: db.all(
        "SELECT t.id,t.name,m.role FROM tenants t JOIN members m ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active'",
        actor.userId,
      ),
    };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const actor = authenticate(db, req);
    const { revokeDevices } = z
      .object({ revokeDevices: z.boolean().default(false) })
      .strict()
      .parse(req.body ?? {});
    if (revokeDevices && actor.kind !== "session")
      fail(403, "DEVICE_SCOPE", "仅交互会话可吊销全部终端凭据");
    if (revokeDevices)
      db.run(
        "DELETE FROM sessions WHERE tenant_id=? AND user_id=? AND kind='device'",
        actor.tenantId,
        actor.userId,
      );
    db.run("DELETE FROM sessions WHERE hash=?", actor.sessionHash);
    audit(db, actor, "identity.logout");
    reply.header("set-cookie", cookie("", 0)).code(204);
  });
  app.post("/api/auth/switch", async (req, reply) => {
    const actor = authenticate(db, req);
    if (actor.kind !== "session")
      fail(403, "DEVICE_SCOPE", "终端凭据不能切换组织");
    const { tenantId } = z.object({ tenantId: text }).strict().parse(req.body);
    if (
      !db.get(
        "SELECT user_id FROM members WHERE tenant_id=? AND user_id=? AND status='active'",
        tenantId,
        actor.userId,
      )
    )
      fail(403, "NO_MEMBERSHIP", "未加入此组织");
    const result = db.transaction(() => {
      db.run("DELETE FROM sessions WHERE hash=?", actor.sessionHash);
      const issued = issueSession(db, actor.userId, tenantId);
      audit(db, actor, "identity.switch", tenantId);
      return issued;
    });
    reply.header("set-cookie", cookie(result.token, 43200));
    return result;
  });
  app.post("/api/auth/device-tokens", async (req, reply) => {
    const actor = authenticate(db, req);
    rateLimit(db, `device:${actor.tenantId}:${actor.userId}`, 60, 3600000);
    if (actor.kind !== "session")
      fail(403, "DEVICE_SCOPE", "仅交互会话可签发终端凭据");
    const data = z
      .object({
        ttlHours: z.number().int().min(1).max(168).default(24),
        replaceId: z.string().max(80).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const result = db.transaction(() => {
      if (data.replaceId)
        db.run(
          "DELETE FROM sessions WHERE hash=? AND tenant_id=? AND user_id=? AND kind='device'",
          data.replaceId,
          actor.tenantId,
          actor.userId,
        );
      return issueSession(
        db,
        actor.userId,
        actor.tenantId,
        "device",
        ["execute"],
        data.ttlHours * 3600000,
      );
    });
    audit(db, actor, "identity.device-token.create");
    reply.code(201);
    return { ...result, id: hash(result.token) };
  });
  app.get("/api/auth/device-tokens", async (req) => {
    const a = authenticate(db, req);
    if (a.kind !== "session")
      fail(403, "DEVICE_SCOPE", "仅交互会话可管理终端凭据");
    return db.all(
      "SELECT hash as id,expires_at,created_at FROM sessions WHERE user_id=? AND tenant_id=? AND kind='device'",
      a.userId,
      a.tenantId,
    );
  });
  app.delete("/api/auth/device-tokens/:id", async (req, reply) => {
    const a = authenticate(db, req);
    if (a.kind !== "session")
      fail(403, "DEVICE_SCOPE", "仅交互会话可管理终端凭据");
    const { id } = req.params as { id: string };
    const removed = db.run(
      "DELETE FROM sessions WHERE hash=? AND user_id=? AND tenant_id=? AND kind='device'",
      id,
      a.userId,
      a.tenantId,
    ).changes;
    if (removed) audit(db, a, "identity.device-token.revoke", id);
    reply.code(204);
  });
}
