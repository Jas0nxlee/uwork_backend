import Fastify, { LogController } from "fastify";
import { z } from "zod";
import { Db } from "./db.js";
import { ApiError, fail, id } from "./core.js";
import { authenticate, tenantAccess, requirePermission } from "./access.js";
import { identityRoutes, purgeIdentity } from "./identity.js";
import { directoryRoutes } from "./directory.js";
import { Vault, vaultRoutes } from "./vault.js";
import { Entitlements, entitlementRoutes } from "./entitlements.js";
import { modelsRoutes } from "./models.js";
import { Gateway, gatewayRoutes } from "./gateway.js";
import { assetRoutes } from "./assets.js";
import { policyRoutes, ipAllowed } from "./policy.js";
import { clientRoutes } from "./client.js";
import { Runtime, runtimeRoutes } from "./runtime.js";
import { AutomationWorker, automationRoutes } from "./automation.js";
import { EvaluationWorker, evaluationRoutes } from "./evaluation.js";
import { wecomRoutes, type WecomProvider } from "./wecom.js";
import { telemetryRoutes } from "./telemetry.js";
import { integrationRoutes } from "./integrations.js";
import { connectorRoutes } from "./connectors.js";
import { staticRoutes } from "./static.js";
import { openApi } from "./openapi.js";
import { clientUsageRoutes } from "./client-usage.js";
import { SandboxService } from "./sandbox/service.js";
import { sandboxRoutes } from "./sandbox/routes.js";
import { DockerSandboxDriver } from "./sandbox/docker.js";
import type { SandboxDriver } from "./sandbox/contract.js";

export interface AppOptions {
  database: string;
  masterKey: Buffer;
  publicUrl: string;
  allowPrivateUpstreams?: boolean;
  logger?: boolean;
  worker?: boolean;
  wecomProvider?: WecomProvider;
  sandboxDriver?: SandboxDriver;
  sandboxSocket?: string;
  sandboxImage?: string;
}
export async function createApp(options: AppOptions) {
  if (options.masterKey.length !== 32)
    throw new Error("MASTER_KEY must contain 32 bytes");
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body",
            "res.headers.set-cookie",
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 60000,
    trustProxy: false,
  });
  const instanceOwner = id();
  const db = new Db(
    options.database,
    options.database !== ":memory:" ? instanceOwner : undefined,
  );
  openApi(app, options.publicUrl);
  const vault = new Vault(db, options.masterKey);
  const entitlements = new Entitlements(db);
  entitlements.recoverPending();
  const gateway = new Gateway(
    db,
    vault,
    entitlements,
    options.allowPrivateUpstreams ?? false,
  );
  const runtime = new Runtime(db, gateway, vault);
  const automation = new AutomationWorker(
    db,
    runtime,
    vault,
    options.allowPrivateUpstreams ?? false,
  );
  const evaluation = new EvaluationWorker(db, runtime, vault);
  const sandboxDriver =
    options.sandboxDriver ??
    (options.sandboxSocket
      ? new DockerSandboxDriver(
          options.sandboxSocket,
          options.sandboxImage ?? "uwork-sandbox:local",
        )
      : undefined);
  const sandbox = new SandboxService(db, vault, sandboxDriver, (actor) => {
    requirePermission(actor, "execute");
    entitlements.subscription(actor.tenantId);
  });
  let workerHealthy = true;
  let leaseLost = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let delivery: Promise<void> | undefined;
  const stopWorkers = () =>
    Promise.allSettled([runtime.stop(), sandbox.stop(), automation.stop()]);
  const heartbeat =
    options.database !== ":memory:"
      ? setInterval(() => {
          try {
            db.renewInstance(instanceOwner);
          } catch {
            leaseLost = true;
            workerHealthy = false;
            clearInterval(interval);
            clearInterval(heartbeat);
            void stopWorkers();
            app.log.error(
              { code: "INSTANCE_LEASE_LOST" },
              "Database lease lost; workers stopped",
            );
          }
        }, 15000)
      : undefined;
  heartbeat?.unref();
  app.addHook("onClose", async () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    const result = await stopWorkers();
    if (result.some((item) => item.status === "rejected"))
      app.log.error(
        { code: "WORKER_SHUTDOWN_FAILURE" },
        "One or more workers failed during shutdown",
      );
    db.close();
  });
  try {
    await sandbox.recover();
    db.assertInstance();
  } catch (error) {
    await app.close();
    throw error;
  }
  const services = {
    db,
    vault,
    entitlements,
    gateway,
    runtime,
    automation,
    evaluation,
    sandbox,
  };
  app.decorate("services", services);
  const decorated = app as typeof app & { services: typeof services };
  app.addHook("onRequest", async (req, reply) => {
    try {
      if (leaseLost) throw new Error("Lease lost");
      db.assertInstance();
    } catch {
      fail(503, "INSTANCE_LEASE_LOST", "数据库实例所有权已失效，请重启服务");
    }
    reply
      .header("x-content-type-options", "nosniff")
      .header("x-frame-options", "DENY")
      .header("referrer-policy", "no-referrer")
      .header("cache-control", "no-store");
    if (options.publicUrl.startsWith("https:"))
      reply.header("strict-transport-security", "max-age=31536000");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== new URL(options.publicUrl).origin)
        fail(403, "ORIGIN_REJECTED", "请求来源不允许");
      if (
        req.headers.cookie?.includes("uwork_session=") &&
        !req.headers.authorization &&
        !origin
      )
        fail(403, "ORIGIN_REQUIRED", "会话写入需要来源校验");
    }
    const path = req.url.split("?")[0]!;
    const tenantId = /^\/api\/tenants\/([^/]+)/.exec(path)?.[1];
    if (tenantId) tenantAccess(authenticate(db, req), tenantId);
    if (path.startsWith("/api/client/") || path.startsWith("/v1/")) {
      const a = authenticate(db, req);
      if (!ipAllowed(db, a, req.ip))
        fail(403, "IP_DENIED", "企业 IP 白名单拒绝访问");
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message },
        requestId: req.id,
      });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: "输入格式不正确",
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        requestId: req.id,
      });
    if (
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      Number(error.statusCode) < 500
    )
      return reply.code(Number(error.statusCode)).send({
        error: { code: "BAD_REQUEST", message: "请求无法处理" },
        requestId: req.id,
      });
    req.log.error({ requestId: req.id }, "Unhandled server error");
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "服务处理失败" },
      requestId: req.id,
    });
  });
  app.get("/health", async (_req, reply) => {
    const healthy = workerHealthy && !sandbox.failure && !!db.get("SELECT 1");
    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? "ok" : "degraded", version: "0.1.0" });
  });
  identityRoutes(app, db, options.publicUrl);
  directoryRoutes(app, db);
  vaultRoutes(app, db, vault);
  entitlementRoutes(app, db);
  modelsRoutes(app, db, vault, options.allowPrivateUpstreams ?? false);
  gatewayRoutes(app, db, gateway);
  assetRoutes(app, db);
  policyRoutes(app, db);
  clientRoutes(app, db);
  clientUsageRoutes(app, db);
  sandboxRoutes(app, db, sandbox);
  runtimeRoutes(
    app,
    db,
    runtime,
    async () => (await sandbox.health()).available,
  );
  automationRoutes(app, db, runtime, vault);
  evaluationRoutes(app, db, runtime, vault, evaluation);
  wecomRoutes(app, db, vault, options.publicUrl, options.wecomProvider);
  telemetryRoutes(app, db, {
    purgeCalls: (tenant, before) => gateway.purgeCalls(tenant, before),
    purgeRuns: (tenant, before) => runtime.purgeFinished(tenant, before),
    purgeSandbox: (tenant, before) => sandbox.purgeFinished(tenant, before),
    purgeIdentity: (time) => purgeIdentity(db, time),
  });
  integrationRoutes(
    app,
    db,
    vault,
    options.allowPrivateUpstreams ?? false,
    async () => (await sandbox.health()).available,
  );
  connectorRoutes(app, db, vault, options.allowPrivateUpstreams ?? false);
  staticRoutes(app);
  if (options.worker)
    interval = setInterval(() => {
      try {
        db.assertInstance();
        workerHealthy = true;
        automation.tick();
        runtime.pump();
        sandbox.pump();
        evaluation.tick();
        if (!delivery)
          delivery = automation
            .deliver()
            .catch(() => {
              workerHealthy = false;
              app.log.error(
                { code: "DELIVERY_WORKER_FAILURE" },
                "Delivery worker failed",
              );
            })
            .finally(() => {
              delivery = undefined;
            });
      } catch {
        workerHealthy = false;
        app.log.error({ code: "SCHEDULER_FAILURE" }, "Scheduler failed");
      }
    }, 1000);
  // Fastify's thenable signature otherwise erases decorated types when awaited.
  return decorated as Omit<typeof decorated, "then">;
}
