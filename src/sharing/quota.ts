import type { Db } from "../db.js";
import { fail, now, type Actor } from "../core.js";
import { rateLimit } from "../identity.js";

const MAX_PENDING = 20;
const NEW_PREPARATIONS_PER_HOUR = 60;
const MAX_TENANT_BYTES = 64 * 1024 * 1024;

/** 调用方在现存结果重放之后、同一分配事务之内调用；不为重试增加计数。 */
export function reservePreparationQuota(db: Db, actor: Actor) {
  const pending = db.get<{ n: number }>(
    "SELECT count(*) AS n FROM conversation_shares WHERE tenant_id=? AND creator_user_id=? AND status='preparing' AND expires_at>?",
    actor.tenantId,
    actor.userId,
    now(),
  )!.n;
  if (pending >= MAX_PENDING)
    fail(429, "SHARE_PREPARATION_LIMIT", "待完成的分享准备过多");
  rateLimit(
    db,
    `sharing:prepare:${actor.tenantId}:${actor.userId}`,
    NEW_PREPARATIONS_PER_HOUR,
    60 * 60 * 1000,
  );
}

export function assertShareStorageQuota(
  db: Db,
  tenantId: string,
  additionalBytes: number,
) {
  // SQLite length(TEXT) 统计字符；转 BLOB 后才是实际 UTF-8 存储字节。
  const used = db.get<{ bytes: number }>(
    `SELECT
       coalesce((SELECT sum(length(content)) FROM conversation_share_artifacts WHERE tenant_id=?),0)
       +coalesce((SELECT sum(length(CAST(confirmed_json AS BLOB))) FROM conversation_shares WHERE tenant_id=?),0) AS bytes`,
    tenantId,
    tenantId,
  )!.bytes;
  if (used + additionalBytes > MAX_TENANT_BYTES)
    fail(429, "SHARE_STORAGE_LIMIT", "企业分享存储已达到上限");
}
