import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Db {
  private connection: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'local', settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS departments(id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, parent_id TEXT, source TEXT NOT NULL DEFAULT 'local', external_id TEXT, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,external_id));
      CREATE TABLE IF NOT EXISTS members(tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, department_id TEXT, status TEXT NOT NULL DEFAULT 'active', seat INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'local', external_id TEXT, PRIMARY KEY(tenant_id,user_id), UNIQUE(tenant_id,external_id));
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), expires_at INTEGER NOT NULL, kind TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id,tenant_id);
      CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), state_hash TEXT UNIQUE NOT NULL, proof_hash TEXT NOT NULL, status TEXT NOT NULL, user_id TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, ciphertext TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), seats INTEGER NOT NULL, credits INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, metering TEXT NOT NULL DEFAULT 'calendar');
      CREATE TABLE IF NOT EXISTS limits(tenant_id TEXT NOT NULL REFERENCES tenants(id), subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(tenant_id,subject_type,subject_id));
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), request_key TEXT NOT NULL, user_id TEXT NOT NULL, department_id TEXT, application TEXT NOT NULL, model_id TEXT NOT NULL, period TEXT NOT NULL, amount INTEGER NOT NULL, reserved INTEGER NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE(tenant_id,request_key));
      CREATE INDEX IF NOT EXISTS ledger_period ON ledger(tenant_id,period,status);
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, scope TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1, published_version INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS resources_kind ON resources(tenant_id,kind);
      CREATE TABLE IF NOT EXISTS resource_versions(resource_id TEXT NOT NULL REFERENCES resources(id), version INTEGER NOT NULL, data TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(resource_id,version));
      CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(tenant_id,kind,name));
      CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), family TEXT NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL, data TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS policies_family ON policies(tenant_id,family);
      CREATE TABLE IF NOT EXISTS configurations(tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, draft TEXT NOT NULL, published TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,kind));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, target TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,created_at);
      CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, application TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, error_code TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS gateway_calls(tenant_id TEXT NOT NULL, request_key TEXT NOT NULL, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,request_key));
      CREATE TABLE IF NOT EXISTS client_events(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, event_key TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(tenant_id,user_id,event_key));
      CREATE TABLE IF NOT EXISTS runtime_sessions(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_version INTEGER NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, output TEXT, error_code TEXT, timeout_ms INTEGER NOT NULL, trigger_key TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, UNIQUE(tenant_id,trigger_key));
      CREATE INDEX IF NOT EXISTS runs_queue ON runs(status,created_at);
      CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, agent_id TEXT NOT NULL, input TEXT NOT NULL, schedule TEXT NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_at INTEGER, ends_at INTEGER, webhook_credential_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, credential_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, error_code TEXT, UNIQUE(run_id,credential_id));
      CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, cases TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, dataset_id TEXT NOT NULL, status TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER);
      INSERT OR IGNORE INTO schema_version VALUES(1,unixepoch()*1000);
    `);
  }
  run(sql: string, ...params: SQLInputValue[]) { return this.connection.prepare(sql).run(...params); }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined { return this.connection.prepare(sql).get(...params) as T | undefined; }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.connection.prepare(sql).all(...params) as T[]; }
  transaction<T>(fn: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.connection.exec('COMMIT'); return result; }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() { this.connection.close(); }
}
