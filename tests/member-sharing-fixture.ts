import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap, issueSession } from "../src/identity.js";

export const SHARE_API = "/api/client/shares";
const TURN = "share-product-turn-1";
const CREATED = 1_792_000_000_000;
export const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// 固定测试输入独立计算摘要，不调用待实现的服务端算法。
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function publication(artifacts: Record<string, unknown>[] = []) {
  const base = {
    turnId: "share-turn-1",
    productTurnId: TURN,
    createdAt: CREATED,
  };
  const rows: Record<string, unknown>[] = [
    {
      ...base,
      rowId: 1,
      entityId: "share-entity-1",
      createdAtSeq: 1,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: CREATED,
      endedAt: CREATED + 1,
    },
    {
      ...base,
      rowId: 2,
      entityId: "share-entity-2",
      createdAtSeq: 2,
      kind: "userInput",
      origin: "realUser",
      text: "OWNED_MEMBER_SHARE_QUESTION <script>unsafe()</script>",
    },
    {
      ...base,
      rowId: 3,
      entityId: "share-entity-3",
      createdAtSeq: 3,
      kind: "assistantText",
      state: "complete",
      text: "OWNED_MEMBER_SHARE_ANSWER",
    },
  ];
  for (const descriptor of artifacts)
    rows.push({
      ...base,
      rowId: rows.length + 1,
      entityId: `share-entity-${rows.length + 1}`,
      createdAtSeq: rows.length + 1,
      kind: "artifact",
      artifactVersionId: descriptor.artifact_id,
      logicalArtifactKey: descriptor.logical_artifact_key,
      displayName: descriptor.display_name,
      artifactType: descriptor.artifact_type,
      mimeType: descriptor.mime_type,
      sizeBytes: descriptor.size_bytes,
      sha256: descriptor.sha256,
      ref: descriptor.ref,
      state: "current",
    });
  const confirm = {
    selected_product_turn_ids: [TURN],
    projection: { rows },
    integrity: {
      projection_sha256: sha(canonical(rows)),
      artifact_set_sha256: sha(
        canonical(
          [...artifacts].sort((a, b) =>
            String(a.artifact_id).localeCompare(String(b.artifact_id)),
          ),
        ),
      ),
    },
    disclosure_confirmation: {
      version: 1,
      accepted_at: CREATED,
      acknowledged_no_secret_detection: true,
    },
  };
  return {
    preparation: {
      client_request_id: randomUUID(),
      title: "Owned enterprise conversation",
      schema_version: 1,
      access_mode: "organization",
      payload_sha256: sha(canonical(confirm)),
      artifact_count: artifacts.length,
    },
    confirm,
  };
}

export async function shareFixture(t: TestContext) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 17),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const owner = await bootstrap(app.services.db, {
    name: "Sharing A",
    email: "sharing-owner@example.test",
    password: "owned-sharing-password",
  });
  const other = await bootstrap(app.services.db, {
    name: "Sharing B",
    email: "sharing-other@example.test",
    password: "owned-sharing-password",
  });
  const memberId = "owned-reader-without-seat";
  app.services.db.run(
    "INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,NULL,?)",
    memberId,
    "sharing-reader@example.test",
    "Reader",
    CREATED,
  );
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'member',0)",
    owner.tenantId,
    memberId,
  );
  const headersFor = (userId: string, tenantId: string, kind = "session") => ({
    authorization: `Bearer ${issueSession(app.services.db, userId, tenantId, kind).token}`,
  });
  const headers = headersFor(owner.userId, owner.tenantId);
  const member = headersFor(memberId, owner.tenantId);
  const outsider = headersFor(other.userId, other.tenantId);
  const device = headersFor(owner.userId, owner.tenantId, "device");
  const p = `/api/tenants/${owner.tenantId}`;
  async function configure(
    kind: "sharing" | "assistants" | "network",
    patch: object,
  ) {
    const url = `${p}/configurations/${kind}`;
    const old = (await app.inject({ url, headers })).json();
    const save = await app.inject({
      method: "PUT",
      url,
      headers,
      payload: { revision: old.revision, data: { ...old.published, ...patch } },
    });
    assert.equal(save.statusCode, 200, save.body);
    const publish = await app.inject({
      method: "POST",
      url: `${url}/publish`,
      headers,
      payload: { revision: save.json().revision },
    });
    assert.equal(publish.statusCode, 200, publish.body);
  }
  async function prepare(input = publication()) {
    const response = await app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations`,
      headers,
      payload: input.preparation,
    });
    assert.equal(response.statusCode, 201, response.body);
    return {
      ...input,
      preparationId: response.json().preparation_id as string,
    };
  }
  async function confirm(input: Awaited<ReturnType<typeof prepare>>) {
    const response = await app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations/${input.preparationId}/confirm`,
      headers,
      payload: input.confirm,
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as {
      share_code: string;
      share_url: string;
      access_mode: string;
    };
  }
  return {
    app,
    ...owner,
    other,
    memberId,
    headers,
    member,
    outsider,
    device,
    p,
    configure,
    prepare,
    confirm,
  };
}
