import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { modelSchema } from "./models.js";
import { completionSchema } from "./gateway.js";
import { agentSchema } from "./runtime.js";
import { configurationSchemas } from "./policy.js";
import { scopeSchema } from "./core.js";

export function openApi(app: FastifyInstance, publicUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const bodies: Record<string, unknown> = {
    "POST /api/auth/login": z.toJSONSchema(
      z
        .object({
          email: z.email(),
          password: z.string(),
          tenantId: z.string().optional(),
        })
        .strict(),
    ),
    "POST /api/tenants/:tenantId/models": z.toJSONSchema(modelSchema, {
      io: "input",
    }),
    "POST /api/tenants/:tenantId/agents": z.toJSONSchema(agentSchema, {
      io: "input",
    }),
    "POST /v1/chat/completions": z.toJSONSchema(completionSchema, {
      io: "input",
    }),
    "POST /api/tenants/:tenantId/policies": z.toJSONSchema(
      z.object({
        family: z.enum([
          "model",
          "skill",
          "expert",
          "connector",
          "playbook",
          "instruction",
        ]),
        name: z.string(),
        scope: scopeSchema,
        mode: z.enum(["allow", "deny", "distribute"]),
        resourceIds: z.array(z.string()),
      }),
      { io: "input" },
    ),
  };
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/") && !route.url.startsWith("/v1/")) return;
    const path = route.url.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method]) {
      if (method === "HEAD") continue;
      const body = bodies[`${method} ${route.url}`];
      paths[path] ??= {};
      paths[path]![method.toLowerCase()] = {
        operationId: `${method.toLowerCase()}_${route.url.replace(/[^a-zA-Z0-9]/g, "_")}`,
        security:
          route.url.startsWith("/api/auth/wecom/") ||
          route.url === "/api/auth/login" ||
          route.url === "/api/openapi.json"
            ? []
            : [{ bearerAuth: [] }],
        parameters: [...route.url.matchAll(/:([a-zA-Z0-9_]+)/g)].map((m) => ({
          name: m[1],
          in: "path",
          required: true,
          schema: { type: "string" },
        })),
        ...(body
          ? {
              requestBody: {
                required: true,
                content: { "application/json": { schema: body } },
              },
            }
          : {}),
        responses: {
          "200": { description: "成功" },
          "201": { description: "已创建" },
          "202": { description: "已受理" },
          "204": { description: "已完成" },
          "304": { description: "版本未变" },
          "400": { description: "输入错误" },
          "401": { description: "会话失效" },
          "402": { description: "额度或订阅不足" },
          "403": { description: "访问被拒绝" },
          "409": { description: "状态/版本/幂等冲突" },
          "429": { description: "速率/并发限制" },
          "502": { description: "上游错误" },
          "503": { description: "外部依赖未配置" },
        },
      };
    }
  });
  app.get("/api/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "UWork Enterprise Backend",
      version: "0.1.0",
      description:
        "Self-owned API; not a WorkBuddy server contract. See docs/api.md for request examples, security and metering semantics.",
    },
    servers: [{ url: publicUrl }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "uwork_session" },
      },
      schemas: Object.fromEntries(
        Object.entries(configurationSchemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { io: "input" }),
        ]),
      ),
    },
  }));
  return paths;
}
