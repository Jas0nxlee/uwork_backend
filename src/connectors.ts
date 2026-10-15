import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate, requirePermission } from "./access.js";
import { fail } from "./core.js";
import type { ConnectorService } from "./connector-service.js";

export function connectorRoutes(
  app: FastifyInstance,
  db: Db,
  connectors: ConnectorService,
) {
  app.post("/api/client/connectors/:id/rpc", async (req, reply) => {
    const actor = authenticate(db, req);
    const session = req.headers["mcp-session-id"];
    const response = await connectors.rpc(
      actor,
      (req.params as { id: string }).id,
      req.body,
      {
        sessionId: typeof session === "string" ? session : undefined,
      },
    );
    if (response.sessionId) reply.header("mcp-session-id", response.sessionId);
    return response.result === undefined
      ? reply.code(202).send()
      : response.result;
  });
  // 显式回收连接器会话：客户端关闭时不能在服务端只等到 1 小时自然过期。
  app.delete("/api/client/connectors/:id/rpc", async (req, reply) => {
    const actor = authenticate(db, req);
    requirePermission(actor, "execute");
    const session = req.headers["mcp-session-id"];
    if (typeof session !== "string" || !/^[\x21-\x7e]{1,1000}$/.test(session))
      fail(400, "MCP_SESSION_REQUIRED", "需要提供连接器会话标识");
    // 只删除当前凭证持有者自己的会话；他人的会话 ID 不产生任何效果。
    connectors.release(actor, session);
    return reply.code(204).send();
  });
}
