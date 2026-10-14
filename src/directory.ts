import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { authenticate, departmentsOf, requirePermission, tenantAccess } from './access.js';
import { audit, passwordHash } from './identity.js';
import { fail, id, now, pageSchema, role, text } from './core.js';

export function directoryRoutes(app: FastifyInstance, db: Db) {
  const prefix = '/api/tenants/:tenantId';
  app.get(prefix, async req => { const a = authenticate(db, req); tenantAccess(a, (req.params as { tenantId: string }).tenantId); requirePermission(a, 'read'); return db.get('SELECT id,name,source,settings FROM tenants WHERE id=?', a.tenantId); });
  app.patch(prefix, async req => { const a = authenticate(db, req); requirePermission(a, 'identity'); const data = z.object({ name: text, contact: z.string().max(200).optional() }).strict().parse(req.body); db.run('UPDATE tenants SET name=?,settings=? WHERE id=?', data.name, JSON.stringify({ contact: data.contact }), a.tenantId); audit(db, a, 'directory.enterprise.update'); return { ok: true }; });
  app.get(`${prefix}/roles`, async req => { const a = authenticate(db, req); requirePermission(a, 'read'); return { roles: role.options, permissions: { owner: ['read', 'write', 'identity', 'vault', 'execute'], admin: ['read', 'write', 'identity', 'vault', 'execute'], operator: ['read', 'write', 'execute'], auditor: ['read', 'execute'], member: ['execute'] } }; });
  app.get(`${prefix}/members`, async req => {
    const a = authenticate(db, req); requirePermission(a, 'read'); const p = pageSchema.parse(req.query);
    const where = 'FROM members m JOIN users u ON m.user_id=u.id WHERE m.tenant_id=? AND (u.name LIKE ? OR u.email LIKE ?)'; const q = `%${p.q}%`;
    return { items: db.all(`SELECT u.id,u.email,u.name,m.role,m.department_id,m.status,m.seat,m.source,m.external_id ${where} ORDER BY u.name,u.id LIMIT ? OFFSET ?`, a.tenantId, q, q, p.pageSize, (p.page-1)*p.pageSize), total: db.get<{ count: number }>(`SELECT count(*) as count ${where}`, a.tenantId, q, q)!.count, ...p };
  });
  app.post(`${prefix}/members`, async (req, reply) => {
    const a = authenticate(db, req); requirePermission(a, 'identity');
    const d = z.object({ email: z.email().toLowerCase(), name: text, password: z.string().min(14).max(200), role: role.default('member'), departmentId: text.nullable().default(null), seat: z.boolean().default(false) }).strict().parse(req.body);
    if (d.role === 'owner' && a.role !== 'owner') fail(403, 'FORBIDDEN', '仅所有者可指定所有者');
    if (d.departmentId && !db.get('SELECT id FROM departments WHERE tenant_id=? AND id=?', a.tenantId, d.departmentId)) fail(400, 'INVALID_DEPARTMENT', '部门不存在');
    const digest = await passwordHash(d.password); const userId = id();
    db.transaction(() => {
      if (db.get('SELECT id FROM users WHERE email=?', d.email)) fail(409, 'EMAIL_EXISTS', '账号已存在，请通过企业身份同步加入');
      checkSeats(db, a.tenantId, d.seat ? 1 : 0);
      db.run('INSERT INTO users VALUES(?,?,?,?,?)', userId, d.email, d.name, digest, now());
      db.run('INSERT INTO members(tenant_id,user_id,role,department_id,seat) VALUES(?,?,?,?,?)', a.tenantId, userId, d.role, d.departmentId, +d.seat);
      audit(db, a, 'directory.member.create', userId);
    }); reply.code(201); return { id: userId };
  });
  app.patch(`${prefix}/members/:id`, async req => {
    const a = authenticate(db, req); requirePermission(a, 'identity'); const { id } = req.params as { id: string };
    const d = z.object({ role: role.optional(), departmentId: text.nullable().optional(), status: z.enum(['active', 'disabled']).optional(), seat: z.boolean().optional() }).strict().parse(req.body);
    db.transaction(() => {
      const m = db.get<{ role: string; status: string; seat: number; department_id: string | null }>('SELECT * FROM members WHERE tenant_id=? AND user_id=?', a.tenantId, id);
      if (!m) fail(404, 'NOT_FOUND', '成员不存在');
      if ((m.role === 'owner' || d.role === 'owner') && a.role !== 'owner') fail(403, 'FORBIDDEN', '仅所有者可修改所有者');
      if (m.role === 'owner' && m.status === 'active' && ((d.role && d.role !== 'owner') || d.status === 'disabled') && db.get<{ count: number }>("SELECT count(*) as count FROM members WHERE tenant_id=? AND role='owner' AND status='active'", a.tenantId)!.count <= 1) fail(409, 'LAST_OWNER', '必须保留一名有效所有者');
      if (d.departmentId && !db.get('SELECT id FROM departments WHERE tenant_id=? AND id=?', a.tenantId, d.departmentId)) fail(400, 'INVALID_DEPARTMENT', '部门不存在');
      checkSeats(db, a.tenantId, d.seat === true && !m.seat ? 1 : 0);
      db.run('UPDATE members SET role=?,department_id=?,status=?,seat=? WHERE tenant_id=? AND user_id=?', d.role ?? m.role, d.departmentId === undefined ? m.department_id : d.departmentId, d.status ?? m.status, d.seat === undefined ? m.seat : +d.seat, a.tenantId, id);
      if (d.status === 'disabled') db.run('DELETE FROM sessions WHERE tenant_id=? AND user_id=?', a.tenantId, id);
      audit(db, a, 'directory.member.update', id);
    }); return { ok: true };
  });
  app.get(`${prefix}/departments`, async req => { const a = authenticate(db, req); requirePermission(a, 'read'); return db.all('SELECT * FROM departments WHERE tenant_id=? ORDER BY name', a.tenantId); });
  app.post(`${prefix}/departments`, async (req, reply) => { const a = authenticate(db, req); requirePermission(a, 'identity'); const d = z.object({ name: text, parentId: text.nullable().default(null) }).strict().parse(req.body); if (d.parentId && !db.get('SELECT id FROM departments WHERE tenant_id=? AND id=?', a.tenantId, d.parentId)) fail(400, 'INVALID_PARENT', '上级部门不存在'); const departmentId = id(); db.run('INSERT INTO departments(id,tenant_id,name,parent_id) VALUES(?,?,?,?)', departmentId, a.tenantId, d.name, d.parentId); audit(db, a, 'directory.department.create', departmentId); reply.code(201); return { id: departmentId }; });
  app.patch(`${prefix}/departments/:id`, async req => { const a = authenticate(db, req); requirePermission(a, 'identity'); const { id } = req.params as { id: string }; const d = z.object({ name: text, parentId: text.nullable() }).strict().parse(req.body); const old = db.get<{ source: string }>('SELECT source FROM departments WHERE tenant_id=? AND id=?', a.tenantId, id); if (!old) fail(404, 'NOT_FOUND', '部门不存在'); if (old.source !== 'local') fail(409, 'SOURCE_MANAGED', '企微部门由同步管理'); if (d.parentId && (!db.get('SELECT id FROM departments WHERE tenant_id=? AND id=?', a.tenantId, d.parentId) || departmentsOf(db, a.tenantId, d.parentId).includes(id))) fail(400, 'INVALID_PARENT', '上级部门不存在或形成环'); db.run('UPDATE departments SET name=?,parent_id=? WHERE tenant_id=? AND id=?', d.name, d.parentId, a.tenantId, id); audit(db, a, 'directory.department.update', id); return { ok: true }; });
  app.delete(`${prefix}/departments/:id`, async (req, reply) => { const a = authenticate(db, req); requirePermission(a, 'identity'); const { id } = req.params as { id: string }; if (db.get('SELECT user_id FROM members WHERE tenant_id=? AND department_id=? UNION SELECT id FROM departments WHERE tenant_id=? AND parent_id=?', a.tenantId, id, a.tenantId, id)) fail(409, 'DEPARTMENT_IN_USE', '部门仍有成员或子部门'); if (!db.run("DELETE FROM departments WHERE tenant_id=? AND id=? AND source='local'", a.tenantId, id).changes) fail(404, 'NOT_FOUND', '本地部门不存在'); audit(db, a, 'directory.department.delete', id); reply.code(204); });
}
export function checkSeats(db: Db, tenantId: string, additional: number) {
  const seats = db.get<{ seats: number }>('SELECT seats FROM subscriptions WHERE tenant_id=?', tenantId)?.seats ?? 0;
  const used = db.get<{ count: number }>('SELECT count(*) as count FROM members WHERE tenant_id=? AND seat=1', tenantId)!.count;
  if (used + additional > seats) fail(409, 'SEATS_EXCEEDED', '席位不足');
}
