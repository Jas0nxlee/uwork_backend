import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { selectActiveConversationBranch } from "../../clients/uwork/apps/zcode-cli/packages/contracts/src/rewind/index.ts";
import {
  decodeMessageRow,
  decodePartRow,
  decodeSessionRow,
} from "../../clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const root = resolve(request.root),
  home = join(root, "data");
assert.match(basename(root), /^client-native-prepublish-v\d+-20261021$/);
assert.equal(realpathSync(root), root);
assert.equal(request.workspace, join(root, "prepublish-workspace"));
assert.ok(
  [
    join(home, ".uwork/cli/db/db.sqlite"),
    join(home, ".zcode/cli/db/db.sqlite"),
  ].includes(request.cli),
);
assert.match(request.sid, /^sess_[A-Za-z0-9_-]+$/);
let db, index;
try {
  db = new DatabaseSync(request.cli, { readOnly: true });
  index = new DatabaseSync(join(home, ".uwork/v2/tasks-index.sqlite"), {
    readOnly: true,
  });
  const row = db.prepare("SELECT * FROM session WHERE id=?").get(request.sid);
  assert.ok(row);
  const session = decodeSessionRow(row);
  const rawMessages = db
    .prepare(
      "SELECT * FROM message WHERE session_id=? ORDER BY sequence IS NULL,sequence,time_created,rowid",
    )
    .all(request.sid);
  const rawParts = db
    .prepare(
      "SELECT * FROM part WHERE session_id=? ORDER BY message_id,sequence IS NULL,sequence,time_created,id",
    )
    .all(request.sid);
  const messages = rawMessages.map((value) => ({
    info: decodeMessageRow(value),
    parts: rawParts
      .filter((part) => part.message_id === value.id)
      .map(decodePartRow),
  }));
  const r = session.revert;
  const active = selectActiveConversationBranch(messages, {
    branchCutAfterMessageId: r?.branchCutAfterMessageID,
    rewindCreatedMessageId: r?.createdMessageID,
    rewindKeptMessageIds: r?.keptMessageIDs,
    rewindTargetMessageId: r?.targetMessageID,
  });
  const state = index
    .prepare(
      "SELECT workspace_path,title,archived,deleted,task_status FROM tasks WHERE task_id=?",
    )
    .get(request.sid);
  assert.ok(
    state &&
      state.workspace_path === request.workspace &&
      state.archived === 0 &&
      state.deleted === 0,
  );
  assert.equal(session.directory, request.workspace);
  assert.equal(session.path, request.workspace);
  const semantic = {
    sessionId: session.id,
    parentId: session.parentID ?? null,
    taskType: session.taskType ?? "interactive",
    directory: session.directory,
    path: session.path,
    title: session.title,
    active: active.map((m) => ({
      id: m.info.id,
      role: m.info.role,
      source: m.info.source ?? null,
      visibility: m.info.visibility ?? null,
      modelSelection: m.info.modelSelection ?? null,
      completed:
        m.info.role === "assistant"
          ? Number.isFinite(m.info.time?.completed)
          : null,
      text: m.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      partTypes: m.parts.map((part) => part.type),
    })),
  };
  console.log(
    JSON.stringify({
      semantic,
      index: state,
      physicalMessageIds: rawMessages.map((m) => m.id),
      rawDigest: createHash("sha256")
        .update(JSON.stringify({ row, rawMessages, rawParts }))
        .digest("hex"),
    }),
  );
} finally {
  db?.close();
  index?.close();
}
