import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, basename } from "node:path";
import { getProjectPermission } from "../../clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/local-settings.ts";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.match(basename(r.root), /^client-native-prepublish-v\d+-20261021$/);
assert.equal(realpathSync(r.root), r.root);
assert.ok(
  [
    join(r.root, "data/.uwork/cli/db/db.sqlite"),
    join(r.root, "data/.zcode/cli/db/db.sqlite"),
  ].includes(r.cli),
);
assert.match(r.sid, /^sess_[A-Za-z0-9_-]+$/);
const db = new DatabaseSync(r.cli, { readOnly: true });
try {
  const session = db
    .prepare("SELECT project_id FROM session WHERE id=?")
    .get(r.sid);
  assert.ok(session?.project_id);
  console.log(
    JSON.stringify({
      projectId: session.project_id,
      rules: await getProjectPermission(db, session.project_id),
    }),
  );
} finally {
  db.close();
}
