import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authenticate } from "./access.js";
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
}
