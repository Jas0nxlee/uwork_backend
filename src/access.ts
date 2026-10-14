import type { FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { fail, hash, now, type Actor, type Role, type Scope } from './core.js';

export function authenticate(db: Db, request: FastifyRequest): Actor {
  const authorization = request.headers.authorization;
  const cookie = request.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('uwork_session='))?.slice(14);
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : cookie;
  if (!token) fail(401, 'UNAUTHENTICATED', '请先登录');
  const row = db.get<{ user_id: string; tenant_id: string; role: Role; department_id: string | null; seat: number; hash: string; kind: string; scopes: string }>(`SELECT s.*,m.role,m.department_id,m.seat FROM sessions s JOIN members m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE s.hash=? AND s.expires_at>? AND m.status='active'`, hash(token), now());
  if (!row) fail(401, 'SESSION_EXPIRED', '登录已失效');
  return { userId: row.user_id, tenantId: row.tenant_id, role: row.role, departmentId: row.department_id, seat: row.seat === 1, sessionHash: row.hash, kind: row.kind, scopes: JSON.parse(row.scopes) as string[] };
}
export function requirePermission(actor: Actor, permission: 'read' | 'write' | 'identity' | 'execute' | 'vault') {
  if (actor.kind === 'device' && permission !== 'execute') fail(403, 'DEVICE_SCOPE', '终端凭据不能访问管理接口');
  const roles: Record<typeof permission, Role[]> = { read: ['owner', 'admin', 'operator', 'auditor'], write: ['owner', 'admin', 'operator'], identity: ['owner', 'admin'], vault: ['owner', 'admin'], execute: ['owner', 'admin', 'operator', 'auditor', 'member'] };
  if (!roles[permission].includes(actor.role)) fail(403, 'FORBIDDEN', '没有此操作权限');
  if (permission === 'execute' && (!actor.seat || (actor.kind === 'device' && !actor.scopes.includes('execute')))) fail(403, 'NO_SEAT', '未分配席位或凭据范围不足');
}
export function tenantAccess(actor: Actor, tenantId: string) { if (actor.tenantId !== tenantId) fail(403, 'TENANT_MISMATCH', '不能访问其他组织'); }
export function departmentsOf(db: Db, tenantId: string, departmentId: string | null): string[] {
  const result: string[] = []; let current = departmentId;
  while (current && !result.includes(current)) { result.push(current); current = db.get<{ parent_id: string | null }>('SELECT parent_id FROM departments WHERE tenant_id=? AND id=?', tenantId, current)?.parent_id ?? null; }
  return result;
}
export function inScope(db: Db, scope: Scope, actor: Actor) { return scope.all || scope.members.includes(actor.userId) || departmentsOf(db, actor.tenantId, actor.departmentId).some(d => scope.departments.includes(d)); }
