import type { Db } from "./db.js";
import { id, now, type Actor } from "./core.js";
export function audit(
  db: Db,
  actor: Pick<Actor, "tenantId" | "userId">,
  action: string,
  target?: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  db.run(
    "INSERT INTO audit VALUES(?,?,?,?,?,?,?)",
    id(),
    actor.tenantId,
    actor.userId,
    action,
    target ?? null,
    JSON.stringify(metadata),
    now(),
  );
}
export interface RetentionPorts {
  purgeCalls(tenantId: string, before: number): number;
  purgeRuns(tenantId: string, before: number): number;
  purgeIdentity(time: number): void;
}
