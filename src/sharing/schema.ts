/** 分享存储只由 Db 初始化事务安装；附件从不使用用户文件名落盘。 */
export const SHARING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversation_shares (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    creator_user_id TEXT NOT NULL REFERENCES users(id),
    client_request_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    access_mode TEXT NOT NULL CHECK(access_mode='organization'),
    payload_sha256 TEXT NOT NULL,
    artifact_count INTEGER NOT NULL CHECK(artifact_count BETWEEN 0 AND 8),
    status TEXT NOT NULL CHECK(status IN ('preparing','confirmed','revoked','expired')),
    share_code TEXT UNIQUE,
    confirmed_json TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    expires_at INTEGER NOT NULL,
    UNIQUE(tenant_id,creator_user_id,client_request_id),
    UNIQUE(tenant_id,id)
  )`,
  `CREATE INDEX IF NOT EXISTS conversation_shares_expiry ON conversation_shares(status,expires_at)`,
  `CREATE TABLE IF NOT EXISTS conversation_share_artifacts (
    tenant_id TEXT NOT NULL,
    preparation_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    descriptor TEXT NOT NULL,
    content BLOB NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 0 AND 524288),
    sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(tenant_id,preparation_id,artifact_id),
    FOREIGN KEY(tenant_id,preparation_id) REFERENCES conversation_shares(tenant_id,id) ON DELETE CASCADE,
    CHECK(length(content)=size_bytes)
  )`,
] as const;
