import type { Db } from "../db.js";
import { audit } from "../events.js";
import { fail, id, now, type Actor } from "../core.js";
import {
  SHARING_LIMITS,
  type ShareArtifactDescriptor,
  type ShareConfirm,
  type SharePreparation,
} from "./contracts.js";
import { shareJsonSha256 } from "./integrity.js";
import { assertArtifactReferences } from "./artifactReferences.js";
import { assertShareStorageQuota, reservePreparationQuota } from "./quota.js";

export interface ShareRow {
  id: string;
  tenant_id: string;
  creator_user_id: string;
  request_fingerprint: string;
  title: string;
  payload_sha256: string;
  artifact_count: number;
  status: "preparing" | "confirmed" | "revoked" | "expired";
  share_code: string | null;
  confirmed_json: string | null;
  confirmed_at: number | null;
  expires_at: number;
}
interface ArtifactRow {
  artifact_id: string;
  descriptor: string;
  content: Uint8Array;
  size_bytes: number;
  sha256: string;
}

export function unavailable(): never {
  fail(404, "SHARE_NOT_FOUND", "分享不可用");
}
export function shareRecord(row: ShareRow, publicUrl: string) {
  return {
    share_code: row.share_code!,
    share_url: new URL(`/share/${row.share_code!}`, publicUrl).href,
    access_mode: "organization" as const,
    expires_at: row.expires_at,
  };
}
function preparationData(row: ShareRow, publicUrl: string) {
  const common = {
    preparation_id: row.id,
    access_mode: "organization" as const,
    expires_at: row.expires_at,
  };
  if (row.status === "confirmed")
    return {
      ...common,
      status: "confirmed" as const,
      share: shareRecord(row, publicUrl),
    };
  return { ...common, status: "preparing" as const };
}

function assertLivePreparation(row: ShareRow) {
  if (
    row.status === "expired" ||
    row.status === "revoked" ||
    row.expires_at <= now()
  )
    fail(410, "SHARE_EXPIRED", "分享准备已失效");
}
export function ownedPreparation(db: Db, actor: Actor, preparationId: string) {
  const row = db.get<ShareRow>(
    "SELECT * FROM conversation_shares WHERE tenant_id=? AND creator_user_id=? AND id=?",
    actor.tenantId,
    actor.userId,
    preparationId,
  );
  if (!row) unavailable();
  assertLivePreparation(row);
  return row;
}
export function storedArtifacts(db: Db, row: ShareRow) {
  return db.all<ArtifactRow>(
    "SELECT * FROM conversation_share_artifacts WHERE tenant_id=? AND preparation_id=?",
    row.tenant_id,
    row.id,
  );
}

export function prepareShare(
  db: Db,
  actor: Actor,
  body: SharePreparation,
  publicUrl: string,
) {
  return db.transaction(() => {
    const fingerprint = shareJsonSha256(body);
    const existing = db.get<ShareRow>(
      "SELECT * FROM conversation_shares WHERE tenant_id=? AND creator_user_id=? AND client_request_id=?",
      actor.tenantId,
      actor.userId,
      body.client_request_id,
    );
    if (existing) {
      if (existing.request_fingerprint !== fingerprint)
        fail(409, "SHARE_REQUEST_CONFLICT", "分享重试内容与原请求不一致");
      assertLivePreparation(existing);
      return { created: false, data: preparationData(existing, publicUrl) };
    }
    purgeExpiredShares(db, now(), 1000, actor.tenantId);
    reservePreparationQuota(db, actor);
    assertShareStorageQuota(db, actor.tenantId, 0);
    const preparationId = id();
    const time = now();
    db.run(
      `INSERT INTO conversation_shares
       (id,tenant_id,creator_user_id,client_request_id,request_fingerprint,title,schema_version,
        access_mode,payload_sha256,artifact_count,status,created_at,expires_at)
       VALUES(?,?,?,?,?,?,1,'organization',?,?,'preparing',?,?)`,
      preparationId,
      actor.tenantId,
      actor.userId,
      body.client_request_id,
      fingerprint,
      body.title,
      body.payload_sha256,
      body.artifact_count,
      time,
      time + SHARING_LIMITS.preparationTtlMs,
    );
    audit(db, actor, "sharing.prepare", preparationId);
    return {
      created: true,
      data: preparationData(
        ownedPreparation(db, actor, preparationId),
        publicUrl,
      ),
    };
  });
}

export function uploadShareArtifact(
  db: Db,
  actor: Actor,
  preparationId: string,
  descriptor: ShareArtifactDescriptor,
  bytes: Uint8Array,
) {
  return db.transaction(() => {
    const row = ownedPreparation(db, actor, preparationId);
    const artifacts = storedArtifacts(db, row);
    const existing = artifacts.find(
      (entry) => entry.artifact_id === descriptor.artifact_id,
    );
    if (existing) {
      if (
        shareJsonSha256(JSON.parse(existing.descriptor)) !==
          shareJsonSha256(descriptor) ||
        !Buffer.from(existing.content).equals(bytes)
      )
        fail(409, "SHARE_ARTIFACT_CONFLICT", "附件重试内容与原请求不一致");
    } else {
      // 已确认内容不可变，但既有同字节上传的确认丢包重试仍应幂等返回。
      if (row.status !== "preparing")
        fail(409, "SHARE_ALREADY_CONFIRMED", "分享已经发布");
      if (artifacts.length >= row.artifact_count)
        fail(400, "SHARE_ARTIFACT_LIMIT", "附件数量超过准备声明");
      if (
        artifacts.reduce(
          (total, entry) => total + entry.size_bytes,
          bytes.byteLength,
        ) > SHARING_LIMITS.maxTotalArtifactBytes
      )
        fail(400, "SHARE_ARTIFACT_LIMIT", "附件总大小超过限制");
      purgeExpiredShares(db, now(), 1000, actor.tenantId);
      assertShareStorageQuota(db, actor.tenantId, bytes.byteLength);
      db.run(
        `INSERT INTO conversation_share_artifacts
         (tenant_id,preparation_id,artifact_id,descriptor,content,size_bytes,sha256,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        actor.tenantId,
        preparationId,
        descriptor.artifact_id,
        JSON.stringify(descriptor),
        bytes,
        bytes.byteLength,
        descriptor.sha256,
        now(),
      );
    }
    return {
      created: !existing,
      data: {
        artifact_id: descriptor.artifact_id,
        size_bytes: descriptor.size_bytes,
        sha256: descriptor.sha256,
        status: "uploaded" as const,
        safety_status: "not_scanned",
      },
    };
  });
}

export function confirmShare(
  db: Db,
  actor: Actor,
  preparationId: string,
  body: ShareConfirm,
  publicUrl: string,
) {
  return db.transaction(() => {
    const row = ownedPreparation(db, actor, preparationId);
    if (shareJsonSha256(body) !== row.payload_sha256)
      fail(409, "SHARE_PAYLOAD_CONFLICT", "分享确认内容与准备摘要不一致");
    if (row.status === "confirmed") return shareRecord(row, publicUrl);
    const artifacts = storedArtifacts(db, row);
    if (artifacts.length !== row.artifact_count)
      fail(409, "SHARE_ARTIFACTS_INCOMPLETE", "分享附件尚未上传完整");
    const descriptors = artifacts
      .map((entry) => JSON.parse(entry.descriptor) as ShareArtifactDescriptor)
      .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
    if (
      descriptors.some(
        (descriptor) =>
          !body.selected_product_turn_ids.includes(
            descriptor.producer_product_turn_id,
          ),
      )
    )
      fail(400, "SHARE_TURN_INVALID", "附件必须属于所选轮次");
    if (
      shareJsonSha256(body.projection.rows) !==
        body.integrity.projection_sha256 ||
      shareJsonSha256(descriptors) !== body.integrity.artifact_set_sha256
    )
      fail(409, "SHARE_INTEGRITY_INVALID", "分享内容或附件摘要不一致");
    assertArtifactReferences(body, descriptors);
    const confirmedJson = JSON.stringify(body);
    purgeExpiredShares(db, now(), 1000, actor.tenantId);
    assertShareStorageQuota(
      db,
      actor.tenantId,
      Buffer.byteLength(confirmedJson, "utf8"),
    );
    const time = now();
    const code = id();
    const result = db.run(
      `UPDATE conversation_shares SET status='confirmed',share_code=?,confirmed_json=?,confirmed_at=?,expires_at=?
       WHERE tenant_id=? AND id=? AND status='preparing'`,
      code,
      confirmedJson,
      time,
      time + SHARING_LIMITS.shareTtlMs,
      actor.tenantId,
      row.id,
    );
    if (result.changes !== 1)
      fail(409, "SHARE_STATE_CONFLICT", "分享状态已改变");
    audit(db, actor, "sharing.publish", row.id, {
      artifacts: artifacts.length,
    });
    return shareRecord(ownedPreparation(db, actor, row.id), publicUrl);
  });
}

/** 保留稳定重试键的墓碑；过期清理不能让同一个 client_request_id 重新发布。 */
export function purgeExpiredShares(
  db: Db,
  time = now(),
  limit = 100,
  tenantId?: string,
) {
  return db.transaction(() => {
    const rows = db.all<{ id: string; tenant_id: string }>(
      `SELECT id,tenant_id FROM conversation_shares WHERE status IN ('preparing','confirmed')
       AND expires_at<=? ${tenantId === undefined ? "" : "AND tenant_id=?"} ORDER BY expires_at,id LIMIT ?`,
      time,
      ...(tenantId === undefined ? [] : [tenantId]),
      Number.isFinite(limit)
        ? Math.max(1, Math.min(1000, Math.trunc(limit)))
        : 100,
    );
    for (const row of rows) {
      db.run(
        "DELETE FROM conversation_share_artifacts WHERE tenant_id=? AND preparation_id=?",
        row.tenant_id,
        row.id,
      );
      db.run(
        "UPDATE conversation_shares SET status='expired',title='',confirmed_json=NULL WHERE tenant_id=? AND id=?",
        row.tenant_id,
        row.id,
      );
    }
    return rows.length;
  });
}
