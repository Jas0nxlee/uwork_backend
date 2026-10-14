import { z } from "zod";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import { currentActor, requirePermission } from "./access.js";
import { publishedAsset, visibleAssets } from "./assets.js";
import { rateLimit } from "./identity.js";
import { audit } from "./events.js";
import { assertExecution } from "./policy.js";
import { fail, id, now, text, type Actor } from "./core.js";
import { readJson, safeRequest } from "./network.js";

export const connectorRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(100), z.number().int()]).optional(),
    method: z.enum([
      "initialize",
      "notifications/initialized",
      "notifications/cancelled",
      "ping",
      "tools/list",
      "tools/call",
      "resources/list",
      "resources/read",
      "prompts/list",
      "prompts/get",
    ]),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const responseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number(), message: z.string().max(2000) })
      .passthrough()
      .optional(),
  })
  .refine(
    (value) => Object.hasOwn(value, "result") !== Object.hasOwn(value, "error"),
  );
const contentSchema = z
  .object({
    url: z.url(),
    credentialId: text.optional(),
    allowedTools: z.array(text).max(100).default([]),
  })
  .passthrough();
export interface ConnectorBinding {
  id: string;
  version: number;
}
interface RpcOptions {
  client?: "uwork" | "agent";
  version?: number;
  sessionId?: string;
  signal?: AbortSignal;
  timeout?: number;
  beforeDispatch?: () => void;
  runId?: string;
}

export class ConnectorService {
  constructor(
    private db: Db,
    private vault: Vault,
    private allowPrivate: boolean,
  ) {}
  authorize(
    actor: Actor,
    assetId: string,
    client: "uwork" | "agent",
    version?: number,
  ) {
    requirePermission(actor, "execute");
    const session = actor.sessionHash
      ? this.db.get<{ kind: string; scopes: string }>(
          "SELECT kind,scopes FROM sessions WHERE hash=? AND tenant_id=? AND user_id=? AND expires_at>?",
          actor.sessionHash,
          actor.tenantId,
          actor.userId,
          now(),
        )
      : undefined;
    if (actor.sessionHash && !session)
      fail(401, "SESSION_EXPIRED", "连接器请求凭据已失效");
    const fresh = {
      ...currentActor(this.db, actor.tenantId, actor.userId),
      kind: session?.kind ?? actor.kind,
      scopes: session ? (JSON.parse(session.scopes) as string[]) : actor.scopes,
      sessionHash: actor.sessionHash,
    };
    requirePermission(fresh, "execute");
    const asset = visibleAssets(this.db, fresh, client).find(
      (item) => item.id === assetId,
    );
    if (!asset) fail(403, "CONNECTOR_DENIED", "连接器不可用或未授权");
    if (version !== undefined && asset.published_version !== version)
      fail(409, "CONNECTOR_VERSION_CHANGED", "连接器发布版本已变更");
    const published = publishedAsset(this.db, asset);
    if (published.kind !== "connector")
      fail(400, "INVALID_CONNECTOR", "资源不是连接器");
    const content = contentSchema.parse(published.content);
    assertExecution(
      this.db,
      fresh,
      client === "agent" ? "agents" : "local",
      content.url,
    );
    return { actor: fresh, asset, content };
  }
  async rpc(
    actor: Actor,
    assetId: string,
    input: unknown,
    options: RpcOptions = {},
  ) {
    const body = connectorRequest.parse(input),
      client = options.client ?? "uwork";
    const guardRun = () => {
      if (
        options.runId &&
        !this.db.get(
          "SELECT id FROM runs WHERE id=? AND tenant_id=? AND user_id=? AND status='running' AND cancel_requested=0",
          options.runId,
          actor.tenantId,
          actor.userId,
        )
      )
        fail(499, "CANCELLED", "连接器父运行已停止");
      options.signal?.throwIfAborted();
    };
    const target = this.authorize(actor, assetId, client, options.version);
    rateLimit(this.db, `mcp:${actor.tenantId}:${actor.userId}`, 120, 60000);
    if (body.method === "tools/call") {
      const params = z
        .object({
          name: text,
          arguments: z.record(z.string(), z.unknown()).optional(),
          _meta: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(body.params);
      if (!target.content.allowedTools.includes(params.name))
        fail(403, "TOOL_DENIED", "未授权此工具");
    }
    const sessionId = options.sessionId;
    let remoteSession: string | undefined;
    if (body.method !== "initialize") {
      if (!sessionId) fail(400, "MCP_SESSION_REQUIRED", "需要先初始化连接器");
      const session = this.db.get<{ remote_session: string | null }>(
        "SELECT remote_session FROM connector_sessions WHERE id=? AND tenant_id=? AND user_id=? AND asset_id=? AND asset_version=? AND expires_at>?",
        sessionId,
        actor.tenantId,
        actor.userId,
        assetId,
        target.asset.published_version,
        now(),
      );
      if (!session) fail(409, "MCP_SESSION_EXPIRED", "连接器会话已失效");
      remoteSession = session.remote_session
        ? this.vault.open(
            session.remote_session,
            `${actor.tenantId}:${sessionId}:mcp`,
          )
        : undefined;
    }
    const credential = target.content.credentialId;
    const token = credential
      ? this.vault.read(actor.tenantId, credential)
      : undefined;
    const response = await safeRequest(
      target.content.url,
      {
        method: "POST",
        body,
        token,
        signal: options.signal,
        timeout: options.timeout ?? 30000,
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-03-26",
          ...(remoteSession ? { "mcp-session-id": remoteSession } : {}),
        },
        onDispatch: () => {
          options.signal?.throwIfAborted();
          this.authorize(
            actor,
            assetId,
            client,
            target.asset.published_version!,
          );
          if (body.method !== "notifications/cancelled") guardRun();
          if (
            credential &&
            this.vault.read(actor.tenantId, credential) !== token
          )
            fail(409, "CREDENTIAL_CHANGED", "连接器凭据在请求前已变更");
          options.beforeDispatch?.();
        },
      },
      this.allowPrivate,
    );
    if (body.id === undefined) {
      await response.close();
      if (response.statusCode !== 202)
        fail(502, "MCP_NOTIFICATION_REJECTED", "连接器未接受通知");
      return { result: undefined, sessionId: undefined };
    }
    let result: unknown;
    if (
      String(response.headers["content-type"] ?? "").includes(
        "text/event-stream",
      )
    ) {
      try {
        if (response.statusCode !== 200)
          fail(502, "MCP_REJECTED", "连接器拒绝请求");
        const decoder = new TextDecoder();
        let raw = "",
          bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 1024 * 1024)
            fail(502, "MCP_RESPONSE_LIMIT", "连接器响应超出限制");
          raw += decoder.decode(chunk, { stream: true });
          raw = raw.replaceAll("\r\n", "\n");
          let boundary: number;
          while ((boundary = raw.indexOf("\n\n")) !== -1) {
            const frame = raw.slice(0, boundary);
            raw = raw.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              fail(502, "MCP_FORMAT", "连接器事件格式不正确");
            }
            if (
              parsed &&
              typeof parsed === "object" &&
              "id" in parsed &&
              parsed.id === body.id
            ) {
              result = parsed;
              break;
            }
          }
          if (result) break;
        }
        if (!result) fail(502, "MCP_INCOMPLETE", "连接器未返回请求结果");
      } finally {
        await response.close();
      }
    } else result = await readJson(response, 1024 * 1024);
    const validated = responseSchema.safeParse(result);
    if (!validated.success) fail(502, "MCP_FORMAT", "连接器响应格式不正确");
    if (validated.data.id !== body.id)
      fail(502, "MCP_RESPONSE_ID", "连接器响应 ID 不匹配");
    return this.db.transaction(() => {
      let sid: string | undefined;
      if (body.method === "initialize" && !validated.data.error) {
        this.authorize(actor, assetId, client, target.asset.published_version!);
        guardRun();
        sid = id();
        const remote = response.headers["mcp-session-id"];
        if (
          remote !== undefined &&
          (typeof remote !== "string" || !/^[\x21-\x7e]{1,1000}$/.test(remote))
        )
          fail(502, "MCP_SESSION_FORMAT", "连接器会话标识无效");
        this.db.run(
          "INSERT INTO connector_sessions(id,tenant_id,user_id,asset_id,asset_version,remote_session,expires_at,run_id) VALUES(?,?,?,?,?,?,?,?)",
          sid,
          actor.tenantId,
          actor.userId,
          assetId,
          target.asset.published_version,
          typeof remote === "string"
            ? this.vault.seal(remote, `${actor.tenantId}:${sid}:mcp`)
            : null,
          now() + 3600000,
          options.runId ?? null,
        );
      }
      const returnedSession = response.headers["mcp-session-id"];
      const secrets = [
        token,
        remoteSession,
        typeof returnedSession === "string" ? returnedSession : undefined,
      ].filter((value): value is string => !!value);
      let nodes = 0;
      const redact = (value: unknown, depth = 0): unknown => {
        if (++nodes > 10000 || depth > 20)
          fail(502, "MCP_RESPONSE_LIMIT", "连接器响应结构超出限制");
        if (typeof value === "string")
          return secrets.reduce(
            (text, secret) => text.replaceAll(secret, "[REDACTED]"),
            value,
          );
        if (Array.isArray(value))
          return value.map((child) => redact(child, depth + 1));
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              redact(key, depth + 1) as string,
              redact(child, depth + 1),
            ]),
          );
        return value;
      };
      if (Object.hasOwn(validated.data, "result"))
        validated.data.result = redact(validated.data.result);
      if (validated.data.error)
        validated.data.error = responseSchema.shape.error.parse(
          redact(validated.data.error),
        );
      audit(this.db, actor, `connector.${body.method}`, assetId);
      return { result: validated.data, sessionId: sid };
    });
  }
  release(actor: Actor, sessionId: string) {
    this.db.run(
      "DELETE FROM connector_sessions WHERE id=? AND tenant_id=? AND user_id=?",
      sessionId,
      actor.tenantId,
      actor.userId,
    );
  }
}
