import type { Db } from "./db.js";
import { fail, id, now, parseJson, type Scope } from "./core.js";

export interface Resource<T = Record<string, unknown>> {
  id: string;
  tenant_id: string;
  kind: string;
  name: string;
  data: T;
  scope: Scope;
  enabled: boolean;
  status: string;
  revision: number;
  published_version: number | null;
  created_at: number;
  updated_at: number;
}
type Stored = Omit<Resource, "data" | "scope" | "enabled"> & {
  data: string;
  scope: string;
  enabled: number;
};
export function decodeResource<T>(row: Stored): Resource<T> {
  return {
    ...row,
    data: parseJson<T>(row.data),
    scope: parseJson<Scope>(row.scope),
    enabled: !!row.enabled,
  };
}
export function getResource<T>(
  db: Db,
  tenantId: string,
  kind: string,
  resourceId: string,
): Resource<T> {
  const row = db.get<Stored>(
    "SELECT * FROM resources WHERE tenant_id=? AND kind=? AND id=?",
    tenantId,
    kind,
    resourceId,
  );
  if (!row) fail(404, "NOT_FOUND", "资源不存在");
  return decodeResource<T>(row);
}
export function listResources<T>(db: Db, tenantId: string, kind: string) {
  return db
    .all<Stored>(
      "SELECT * FROM resources WHERE tenant_id=? AND kind=? ORDER BY updated_at DESC,id",
      tenantId,
      kind,
    )
    .map(decodeResource<T>);
}
export function createResource(
  db: Db,
  tenantId: string,
  kind: string,
  name: string,
  data: unknown,
  scope: Scope,
  enabled = true,
  status = "draft",
) {
  const resourceId = id();
  db.run(
    "INSERT INTO resources(id,tenant_id,kind,name,data,scope,enabled,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    resourceId,
    tenantId,
    kind,
    name,
    JSON.stringify(data),
    JSON.stringify(scope),
    +enabled,
    status,
    now(),
    now(),
  );
  return resourceId;
}
export function updateResource(
  db: Db,
  resource: Resource<unknown>,
  name: string,
  data: unknown,
  scope: Scope,
  enabled: boolean,
  revision: number,
) {
  if (
    !db.run(
      "UPDATE resources SET name=?,data=?,scope=?,enabled=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND id=? AND revision=?",
      name,
      JSON.stringify(data),
      JSON.stringify(scope),
      +enabled,
      now(),
      resource.tenant_id,
      resource.id,
      revision,
    ).changes
  )
    fail(409, "REVISION_CONFLICT", "资源已被修改，请刷新");
}
