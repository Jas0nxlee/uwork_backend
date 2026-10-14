import Fastify from 'fastify';
import { z } from 'zod';
import { Db } from './db.js';
import { ApiError, fail } from './core.js';
import { authenticate, tenantAccess } from './access.js';
import { identityRoutes } from './identity.js';
import { directoryRoutes } from './directory.js';
import { Vault, vaultRoutes } from './vault.js';
import { Entitlements, entitlementRoutes } from './entitlements.js';
import { modelsRoutes } from './models.js';
import { Gateway, gatewayRoutes } from './gateway.js';

export interface AppOptions { database: string; masterKey: Buffer; publicUrl: string; allowPrivateUpstreams?: boolean; logger?: boolean; worker?: boolean }
export async function createApp(options: AppOptions) {
  if (options.masterKey.length !== 32) throw new Error('MASTER_KEY must contain 32 bytes');
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers.set-cookie'] } : false, disableRequestLogging: true, bodyLimit: 2 * 1024 * 1024, requestTimeout: 60000, trustProxy: false });
  const db = new Db(options.database);
  const vault = new Vault(db, options.masterKey);
  const entitlements = new Entitlements(db);
  const gateway = new Gateway(db, vault, entitlements, options.allowPrivateUpstreams ?? false);
  const services = { db, vault, entitlements, gateway };
  app.decorate('services', services);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer').header('cache-control', 'no-store');
    if (options.publicUrl.startsWith('https:')) reply.header('strict-transport-security', 'max-age=31536000');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== new URL(options.publicUrl).origin) fail(403, 'ORIGIN_REJECTED', '请求来源不允许');
      if (req.headers.cookie?.includes('uwork_session=') && !req.headers.authorization && !origin) fail(403, 'ORIGIN_REQUIRED', '会话写入需要来源校验');
    }
    const path = req.url.split('?')[0]!;
    const tenantId = /^\/api\/tenants\/([^/]+)/.exec(path)?.[1];
    if (tenantId) tenantAccess(authenticate(db, req), tenantId);
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: { code: error.code, message: error.message }, requestId: req.id });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: '输入格式不正确', fields: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, requestId: req.id });
    if (typeof error === 'object' && error && 'statusCode' in error && Number(error.statusCode) < 500) return reply.code(Number(error.statusCode)).send({ error: { code: 'BAD_REQUEST', message: '请求无法处理' }, requestId: req.id });
    req.log.error({ requestId: req.id }, 'Unhandled server error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: '服务处理失败' }, requestId: req.id });
  });
  app.get('/health', async () => ({ status: db.get('SELECT 1') ? 'ok' : 'error', version: '0.1.0' }));
  identityRoutes(app, db, options.publicUrl);
  directoryRoutes(app, db);
  vaultRoutes(app, db, vault);
  entitlementRoutes(app, db, entitlements);
  modelsRoutes(app, db, vault, options.allowPrivateUpstreams ?? false);
  gatewayRoutes(app, db, gateway);
  app.addHook('onClose', async () => db.close());
  return app as typeof app & { services: typeof services };
}
