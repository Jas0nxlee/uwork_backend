import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { authenticate, requirePermission } from './access.js';
import { audit } from './identity.js';
import { fail, id, now, text } from './core.js';

export class Vault {
  constructor(private db: Db, private key: Buffer) {}
  seal(value: string, context: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
  }
  open(value: string, context: string) {
    const [iv, tag, content] = value.split('.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv!, 'base64')); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(content!, 'base64')), cipher.final()]).toString('utf8');
  }
  read(tenantId: string, credentialId: string) {
    const row = this.db.get<{ ciphertext: string }>('SELECT ciphertext FROM credentials WHERE tenant_id=? AND id=? AND revoked=0', tenantId, credentialId);
    if (!row) fail(409, 'CREDENTIAL_UNAVAILABLE', '凭据不存在或已吊销');
    try { return this.open(row.ciphertext, `${tenantId}:${credentialId}`); } catch { fail(503, 'VAULT_UNAVAILABLE', '凭据无法解密，请检查主密钥'); }
  }
  create(tenantId: string, name: string, value: string) { const credentialId = id(); this.db.run('INSERT INTO credentials VALUES(?,?,?,?,1,0,?,?)', credentialId, tenantId, name, this.seal(value, `${tenantId}:${credentialId}`), now(), now()); return credentialId; }
}
export function vaultRoutes(app: FastifyInstance, db: Db, vault: Vault) {
  const path = '/api/tenants/:tenantId/credentials';
  app.get(path, async req => { const a = authenticate(db, req); requirePermission(a, 'vault'); return db.all('SELECT id,name,revision,revoked,created_at,updated_at FROM credentials WHERE tenant_id=? ORDER BY created_at DESC', a.tenantId); });
  app.post(path, async (req, reply) => { const a = authenticate(db, req); requirePermission(a, 'vault'); const d = z.object({ name: text, value: z.string().min(1).max(65536) }).strict().parse(req.body); const credentialId = vault.create(a.tenantId, d.name, d.value); audit(db, a, 'vault.create', credentialId); reply.code(201); return { id: credentialId }; });
  app.put(`${path}/:id`, async req => { const a = authenticate(db, req); requirePermission(a, 'vault'); const { id } = req.params as { id: string }; const d = z.object({ value: z.string().min(1).max(65536) }).strict().parse(req.body); if (!db.run('UPDATE credentials SET ciphertext=?,revision=revision+1,revoked=0,updated_at=? WHERE tenant_id=? AND id=?', vault.seal(d.value, `${a.tenantId}:${id}`), now(), a.tenantId, id).changes) fail(404, 'NOT_FOUND', '凭据不存在'); audit(db, a, 'vault.rotate', id); return { ok: true }; });
  app.delete(`${path}/:id`, async (req, reply) => { const a = authenticate(db, req); requirePermission(a, 'vault'); const { id } = req.params as { id: string }; if (!db.run("UPDATE credentials SET revoked=1,ciphertext='',updated_at=? WHERE tenant_id=? AND id=?", now(), a.tenantId, id).changes) fail(404, 'NOT_FOUND', '凭据不存在'); audit(db, a, 'vault.revoke', id); reply.code(204); });
}
