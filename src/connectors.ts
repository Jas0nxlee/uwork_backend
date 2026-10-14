import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import { authenticate, requirePermission } from "./access.js";
import { publishedAsset, visibleAssets } from "./assets.js";
import { rateLimit } from "./identity.js";
import { audit } from "./events.js";
import { assertExecution } from "./policy.js";
import { fail, id, now, text } from "./core.js";
import { readJson, safeRequest } from "./network.js";

export function connectorRoutes(
  app: FastifyInstance,
  db: Db,
  vault: Vault,
  allowPrivate: boolean,
) {
  app.post("/api/client/connectors/:id/rpc", async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "execute");
    rateLimit(db, `mcp:${a.tenantId}:${a.userId}`, 120, 60000);
    const asset = visibleAssets(db, a).find(
      (r) => r.id === (req.params as { id: string }).id,
    );
    if (!asset) fail(403, "CONNECTOR_DENIED", "连接器不可用或未授权");
    const d = publishedAsset(db, asset);
    if (d.kind !== "connector")
      fail(400, "INVALID_CONNECTOR", "资源不是连接器");
    const content = z
      .object({
        url: z.url(),
        credentialId: text.optional(),
        allowedTools: z.array(text).default([]),
      })
      .passthrough()
      .parse(d.content);
    assertExecution(db, a, "local", content.url);
    const body = z
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
      .strict()
      .parse(req.body);
    if (body.method === "tools/call") {
      const params = z
        .object({
          name: text,
          arguments: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(body.params);
      if (!content.allowedTools.includes(params.name))
        fail(403, "TOOL_DENIED", "未授权此工具");
    }
    const localSession = req.headers["mcp-session-id"];
    let remoteSession: string | undefined;
    if (body.method !== "initialize") {
      if (typeof localSession !== "string")
        fail(400, "MCP_SESSION_REQUIRED", "需要先初始化连接器");
      const session = db.get<{ remote_session: string | null }>(
        "SELECT remote_session FROM connector_sessions WHERE id=? AND tenant_id=? AND user_id=? AND asset_id=? AND asset_version=? AND expires_at>?",
        localSession,
        a.tenantId,
        a.userId,
        asset.id,
        asset.published_version,
        now(),
      );
      if (!session) fail(409, "MCP_SESSION_EXPIRED", "连接器会话已失效");
      remoteSession = session.remote_session
        ? vault.open(
            session.remote_session,
            `${a.tenantId}:${localSession}:mcp`,
          )
        : undefined;
    }
    const response = await safeRequest(
      content.url,
      {
        method: "POST",
        body,
        token: content.credentialId
          ? vault.read(a.tenantId, content.credentialId)
          : undefined,
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-03-26",
          ...(remoteSession ? { "mcp-session-id": remoteSession } : {}),
        },
        timeout: 30000,
      },
      allowPrivate,
    );
    if (body.id === undefined && response.statusCode === 202) {
      await response.close();
      return reply.code(202).send();
    }
    const type = String(response.headers["content-type"] ?? "");
    let result: unknown;
    if (type.includes("text/event-stream")) {
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
          const frames = raw.replaceAll("\r\n", "\n").split("\n\n");
          for (const frame of frames) {
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
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
    const validated = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number(), z.null()]),
        result: z.unknown().optional(),
        error: z
          .object({ code: z.number(), message: z.string().max(2000) })
          .optional(),
      })
      .passthrough()
      .parse(result);
    if (validated.id !== body.id)
      fail(502, "MCP_RESPONSE_ID", "连接器响应 ID 不匹配");
    if (body.method === "initialize" && !validated.error) {
      const sid = id();
      const remote = response.headers["mcp-session-id"];
      db.run(
        "INSERT INTO connector_sessions VALUES(?,?,?,?,?,?,?)",
        sid,
        a.tenantId,
        a.userId,
        asset.id,
        asset.published_version,
        typeof remote === "string"
          ? vault.seal(remote, `${a.tenantId}:${sid}:mcp`)
          : null,
        now() + 3600000,
      );
      reply.header("mcp-session-id", sid);
    }
    audit(db, a, `connector.${body.method}`, asset.id);
    return validated;
  });
}
