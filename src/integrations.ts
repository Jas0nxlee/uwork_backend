import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Vault } from "./vault.js";
import { authenticate, requirePermission } from "./access.js";
import { audit } from "./events.js";
import { fail, text, serviceUrl } from "./core.js";
import { readJson, safeRequest } from "./network.js";

export function integrationRoutes(
  app: FastifyInstance,
  db: Db,
  vault: Vault,
  allowPrivate: boolean,
  readSandboxCapability: () => Promise<boolean>,
) {
  const p = "/api/tenants/:tenantId/integrations";
  app.get(p, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const rows = db.all<{ kind: string; enabled: number }>(
      "SELECT kind,enabled,base_url,credential_id FROM integrations WHERE tenant_id=?",
      a.tenantId,
    );
    const sandboxAvailable = await readSandboxCapability();
    return {
      integrations: rows,
      capabilities: {
        drive: rows.some((r) => r.kind === "drive" && r.enabled)
          ? "configured-adapter"
          : "unavailable",
        payments: "unavailable",
        cloudSandbox: sandboxAvailable ? "isolated-docker" : "unavailable",
        modelProtocol: "openai-compatible",
        runtime: sandboxAvailable ? "model-and-isolated-code" : "model-only",
      },
    };
  });
  app.put(`${p}/drive`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "vault");
    const d = z
      .object({
        baseUrl: serviceUrl,
        credentialId: text,
        enabled: z.boolean(),
      })
      .strict()
      .parse(req.body);
    vault.read(a.tenantId, d.credentialId);
    db.run(
      "INSERT INTO integrations VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,kind) DO UPDATE SET base_url=excluded.base_url,credential_id=excluded.credential_id,enabled=excluded.enabled",
      a.tenantId,
      "drive",
      d.baseUrl,
      d.credentialId,
      +d.enabled,
    );
    audit(db, a, "integration.drive.configure");
    return { ok: true };
  });
  for (const endpoint of ["health", "capacity", "files", "logs"] as const)
    app.get(`${p}/drive/${endpoint}`, async (req) => {
      const a = authenticate(db, req);
      requirePermission(a, "read");
      const row = db.get<{ base_url: string; credential_id: string }>(
        "SELECT * FROM integrations WHERE tenant_id=? AND kind='drive' AND enabled=1",
        a.tenantId,
      );
      if (!row) fail(503, "DRIVE_NOT_CONFIGURED", "未配置网盘适配服务");
      const query = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        })
        .parse(req.query);
      const url = new URL(`${row.base_url.replace(/\/$/, "")}/${endpoint}`);
      url.searchParams.set("tenantId", a.tenantId);
      url.searchParams.set("page", String(query.page));
      url.searchParams.set("pageSize", String(query.pageSize));
      return readJson(
        await safeRequest(
          url.toString(),
          {
            method: "GET",
            token: vault.read(a.tenantId, row.credential_id),
            timeout: 15000,
          },
          allowPrivate,
        ),
      );
    });
  app.put(`${p}/drive/capacity`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "identity");
    const d = z
      .object({
        defaultBytes: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        members: z
          .array(
            z.object({
              userId: text,
              bytes: z
                .number()
                .int()
                .nonnegative()
                .max(Number.MAX_SAFE_INTEGER),
            }),
          )
          .max(1000),
      })
      .strict()
      .parse(req.body);
    for (const m of d.members)
      if (
        !db.get(
          "SELECT user_id FROM members WHERE tenant_id=? AND user_id=?",
          a.tenantId,
          m.userId,
        )
      )
        fail(400, "INVALID_MEMBER", "成员不存在");
    const row = db.get<{ base_url: string; credential_id: string }>(
      "SELECT * FROM integrations WHERE tenant_id=? AND kind='drive' AND enabled=1",
      a.tenantId,
    );
    if (!row) fail(503, "DRIVE_NOT_CONFIGURED", "未配置网盘适配服务");
    const result = await readJson(
      await safeRequest(
        `${row.base_url.replace(/\/$/, "")}/capacity`,
        {
          method: "PUT",
          token: vault.read(a.tenantId, row.credential_id),
          body: { tenantId: a.tenantId, ...d },
          timeout: 15000,
        },
        allowPrivate,
      ),
    );
    audit(db, a, "integration.drive.capacity.update");
    return result;
  });
}
