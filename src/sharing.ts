import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { fail, now, type Actor } from "./core.js";
import { activeSubscription } from "./entitlements.js";
import { audit } from "./events.js";
import {
  assertChannel,
  configuration,
  configurationSchemas,
  ipAllowed,
} from "./policy.js";
import {
  SHARE_ID,
  SHARING_ARTIFACTS,
  SHARING_LIMITS,
  preparationSchema,
  parseArtifact,
  parseConfirmation,
  type ShareArtifactDescriptor,
  type ShareConfirm,
} from "./sharing/contracts.js";
import { assertShareJson } from "./sharing/integrity.js";
import {
  confirmShare,
  ownedPreparation,
  prepareShare,
  storedArtifacts,
  unavailable,
  uploadShareArtifact,
  type ShareRow,
} from "./sharing/store.js";

export { purgeExpiredShares } from "./sharing/store.js";
const API = "/api/client/shares";

function sharingPolicy(db: Db, tenantId: string) {
  return configurationSchemas.sharing.parse(
    configuration(db, tenantId, "sharing").published,
  );
}
function session(db: Db, request: FastifyRequest) {
  const actor = authenticate(db, request);
  if (actor.kind !== "session")
    fail(403, "SHARE_SESSION_REQUIRED", "分享需要有效登录会话");
  if (!ipAllowed(db, actor, request.ip))
    fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
  return actor;
}
function publisher(db: Db, request: FastifyRequest, files = false) {
  const actor = session(db, request);
  return assertPublisher(db, actor, files);
}
function assertPublisher(db: Db, actor: Actor, files = false) {
  requirePermission(actor, "execute");
  activeSubscription(db, actor.tenantId);
  assertChannel(db, actor, "local");
  const policy = sharingPolicy(db, actor.tenantId);
  if (policy.publish === "disabled" || (files && !policy.files))
    fail(403, "SHARING_DISABLED", "企业分享或附件权限已关闭");
  return { actor, policy };
}
function visibleRow(db: Db, actor: Actor, code: string) {
  const row = db.get<ShareRow>(
    "SELECT * FROM conversation_shares WHERE tenant_id=? AND share_code=? AND status='confirmed' AND expires_at>?",
    actor.tenantId,
    code,
    now(),
  );
  if (!row) unavailable();
  if (sharingPolicy(db, actor.tenantId).publish === "disabled")
    fail(403, "SHARING_DISABLED", "企业分享权限已关闭");
  return row;
}
function viewer(db: Db, request: FastifyRequest, code: string, files = false) {
  SHARE_ID.parse(code);
  const actor = session(db, request);
  const row = visibleRow(db, actor, code);
  if (files && !sharingPolicy(db, actor.tenantId).files)
    fail(403, "SHARING_FILES_DISABLED", "企业分享附件权限已关闭");
  return { actor, row };
}

/** 浏览页复用此实时访问决策，不要求模型席位，也不读取另一个身份缓存。 */
export function readShareForViewer(
  db: Db,
  request: FastifyRequest,
  code: string,
  publicUrl: string,
) {
  const { actor, row } = viewer(db, request, code);
  const confirmed = JSON.parse(row.confirmed_json!) as ShareConfirm;
  return {
    schema_version: 1,
    can_revoke:
      row.creator_user_id === actor.userId ||
      ["owner", "admin", "operator"].includes(actor.role),
    share: {
      title: row.title,
      access_mode: "organization" as const,
      created_at: row.confirmed_at!,
      expires_at: row.expires_at,
    },
    rows: confirmed.projection.rows,
    artifacts: storedArtifacts(db, row).map((entry) => ({
      ...(JSON.parse(entry.descriptor) as ShareArtifactDescriptor),
      url: new URL(`${API}/${code}/artifacts/${entry.artifact_id}`, publicUrl)
        .href,
      url_expires_at: row.expires_at,
    })),
    integrity: confirmed.integrity,
  };
}

/** 公开登录引导只提供企业定位；分享码仍不能授权读取正文。 */
export function sharingLoginContext(db: Db, code: string) {
  SHARE_ID.parse(code);
  const row = db.get<{ tenant_id: string }>(
    "SELECT tenant_id FROM conversation_shares WHERE share_code=? AND status='confirmed' AND expires_at>?",
    code,
    now(),
  );
  if (!row || sharingPolicy(db, row.tenant_id).publish === "disabled")
    unavailable();
  return { tenantId: row.tenant_id };
}

function artifactForViewer(db: Db, request: FastifyRequest) {
  const { code, id } = request.params as { code: string; id: string };
  SHARE_ID.parse(id);
  const { row } = viewer(db, request, code, true);
  const artifact = storedArtifacts(db, row).find(
    (entry) => entry.artifact_id === id,
  );
  if (!artifact) unavailable();
  return {
    descriptor: JSON.parse(artifact.descriptor) as ShareArtifactDescriptor,
    bytes: Buffer.from(artifact.content),
  };
}

export function sharingRoutes(app: FastifyInstance, db: Db, publicUrl: string) {
  // 只使用部署配置 origin；请求 Host、上传名称和外部 URL 均不能改变分享出口。
  const origin = new URL(publicUrl).origin;
  app.get(`${API}/capabilities`, async (request) => {
    const { policy } = publisher(db, request);
    return {
      schema_version: 1,
      access_modes: ["organization"],
      ttl_ms: SHARING_LIMITS.shareTtlMs,
      preparation_ttl_ms: SHARING_LIMITS.preparationTtlMs,
      max_rows: SHARING_LIMITS.maxRows,
      max_payload_bytes: SHARING_LIMITS.maxPayloadBytes,
      max_artifact_count: policy.files ? SHARING_LIMITS.maxArtifactCount : 0,
      max_artifact_bytes: SHARING_LIMITS.maxArtifactBytes,
      max_total_artifact_bytes: SHARING_LIMITS.maxTotalArtifactBytes,
      allowed_artifacts: policy.files ? SHARING_ARTIFACTS : [],
    };
  });
  app.post(`${API}/preparations`, async (request, reply) => {
    assertShareJson(request.body);
    const body = preparationSchema.parse(request.body);
    const { actor } = publisher(db, request, body.artifact_count > 0);
    const result = prepareShare(db, actor, body, origin);
    reply.code(result.created ? 201 : 200);
    return result.data;
  });
  app.post(`${API}/preparations/:id/artifacts`, async (request, reply) => {
    const id = SHARE_ID.parse((request.params as { id: string }).id);
    const actor = session(db, request);
    ownedPreparation(db, actor, id);
    // 无权定位的准备 ID 统一 404，不能由其他企业的发布/附件策略改变响应。
    assertPublisher(db, actor, true);
    const { descriptor, bytes } = parseArtifact(request.body);
    const result = uploadShareArtifact(db, actor, id, descriptor, bytes);
    reply.code(result.created ? 201 : 200);
    return result.data;
  });
  app.post(`${API}/preparations/:id/confirm`, async (request) => {
    const id = SHARE_ID.parse((request.params as { id: string }).id);
    const actor = session(db, request);
    const row = ownedPreparation(db, actor, id);
    assertPublisher(db, actor);
    if (row.artifact_count > 0 && !sharingPolicy(db, actor.tenantId).files)
      fail(403, "SHARING_FILES_DISABLED", "企业分享附件权限已关闭");
    return confirmShare(db, actor, id, parseConfirmation(request.body), origin);
  });
  app.get(`${API}/:code/preview`, async (request) =>
    readShareForViewer(
      db,
      request,
      (request.params as { code: string }).code,
      origin,
    ),
  );
  app.get(`${API}/:code/artifacts/:id`, async (request) => {
    const artifact = artifactForViewer(db, request);
    return {
      descriptor: artifact.descriptor,
      content_base64: artifact.bytes.toString("base64"),
    };
  });
  app.get(`${API}/:code/artifacts/:id/content`, async (request, reply) => {
    const artifact = artifactForViewer(db, request);
    return reply
      .type("application/octet-stream")
      .header(
        "content-disposition",
        `attachment; filename="shared-file.${artifact.descriptor.extension}"; filename*=UTF-8''${encodeURIComponent(artifact.descriptor.display_name)}`,
      )
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(artifact.bytes);
  });
  app.delete(`${API}/:code`, async (request, reply) => {
    const actor = session(db, request);
    const code = SHARE_ID.parse((request.params as { code: string }).code);
    db.transaction(() => {
      const row = db.get<ShareRow>(
        "SELECT * FROM conversation_shares WHERE tenant_id=? AND share_code=?",
        actor.tenantId,
        code,
      );
      if (!row) unavailable();
      // 撤销属于收口，不能因发布权限/席位被撤而反向阻止内容下架。
      if (row.creator_user_id !== actor.userId)
        requirePermission(actor, "write");
      if (row.status !== "revoked") {
        db.run(
          "DELETE FROM conversation_share_artifacts WHERE tenant_id=? AND preparation_id=?",
          actor.tenantId,
          row.id,
        );
        db.run(
          "UPDATE conversation_shares SET status='revoked',title='',confirmed_json=NULL WHERE tenant_id=? AND id=?",
          actor.tenantId,
          row.id,
        );
        audit(db, actor, "sharing.revoke", row.id);
      }
    });
    reply.code(204).send();
  });
  app.post(`${API}/:code/continuation`, async (request) => {
    viewer(db, request, (request.params as { code: string }).code);
    fail(403, "SHARE_READONLY", "企业分享仅支持只读查看");
  });
}
