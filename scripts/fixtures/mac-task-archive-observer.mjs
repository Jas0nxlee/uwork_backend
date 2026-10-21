/** Fixed SELECTs on owned private files only; no production Repo/runtime or writes. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve, relative, sep, isAbsolute, basename } from "node:path";
import { MAC_TASK_SELECTS } from "./mac-completed-task-readonly.mjs";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
export const ARCHIVE_PROFILE =
  "client-native-packaged-macos-clock-arm64-task-archive-v1-20261021";
export const ARCHIVE_STAGES = Object.freeze([
  "baseline",
  "confirming",
  "archived",
  "opened",
  "restored",
  "reloaded",
]);
const parse = (s) => {
  assert.equal(typeof s, "string");
  assert.ok(Buffer.byteLength(s) <= 2 * 1024 * 1024);
  return JSON.parse(s);
};
function regular(root, path) {
  const tail = relative(root, path);
  assert.ok(
    tail && !isAbsolute(tail) && tail !== ".." && !tail.startsWith(".." + sep),
  );
  let p = root;
  for (const part of tail.split(sep)) {
    p = join(p, part);
    const st = lstatSync(p);
    assert.ok(
      !st.isSymbolicLink() && (p === path ? st.isFile() : st.isDirectory()),
    );
    assert.equal(realpathSync(p), p);
  }
}
export function captureArchiveTask({
  root: inputRoot,
  workspace: inputWorkspace,
  dbPath,
  taskId,
}) {
  const root = resolve(inputRoot),
    workspace = resolve(inputWorkspace);
  assert.equal(root, inputRoot);
  assert.equal(realpathSync(root), root);
  assert.equal(basename(root), ARCHIVE_PROFILE);
  assert.equal(workspace, join(root, "packaged-workspace"));
  assert.equal(realpathSync(workspace), workspace);
  assert.match(taskId, /^sess_[A-Za-z0-9_-]+$/);
  assert.ok(
    [
      join(root, "data/.zcode/cli/db/db.sqlite"),
      join(root, "data/.uwork/cli/db/db.sqlite"),
    ].includes(dbPath),
  );
  const indexPath = join(root, "data/.uwork/v2/tasks-index.sqlite");
  regular(root, dbPath);
  regular(root, indexPath);
  let index, db;
  try {
    index = new DatabaseSync(indexPath, { readOnly: true });
    db = new DatabaseSync(dbPath, { readOnly: true });
    const indexed = index
      .prepare(
        "SELECT workspace_key,workspace_path,workspace_identity,task_id,title,task_status,provider,mode,model,meta_json,archived,pinned,deleted FROM tasks WHERE task_id=?",
      )
      .all(taskId);
    assert.equal(indexed.length, 1);
    const row = indexed[0];
    assert.equal(row.deleted, 0);
    assert.equal(row.pinned, 0);
    assert.ok([0, 1].includes(row.archived));
    assert.equal(row.task_id, taskId);
    assert.ok(!row.workspace_identity);
    assert.equal(row.workspace_path, workspace);
    assert.equal(row.workspace_key, workspace);
    assert.equal(row.task_status, "completed");
    assert.ok(row.title && row.model && row.provider);
    const sessions = db
      .prepare(
        "SELECT id,project_id,workspace_id,directory,path,title,time_archived FROM session WHERE id=?",
      )
      .all(taskId);
    assert.equal(sessions.length, 1);
    const session = sessions[0];
    assert.ok(!session.workspace_id);
    assert.equal(session.directory, workspace);
    assert.equal(session.path, workspace);
    assert.equal(session.id, taskId);
    const messages = db.prepare(MAC_TASK_SELECTS.messages).all(taskId),
      parts = db.prepare(MAC_TASK_SELECTS.parts).all(taskId),
      entries = db.prepare(MAC_TASK_SELECTS.entries).all(taskId);
    assert.equal(messages.length, 2);
    assert.ok(parts.length > 0 && parts.length <= 128);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      messages.map((m) => parse(m.data).role),
      ["user", "assistant"],
    );
    assert.equal(parse(messages[1].data).error, undefined);
    assert.ok(Number.isFinite(parse(messages[1].data).time?.completed));
    assert.ok(
      parts.every(
        (p) =>
          p.session_id === taskId &&
          messages.some((m) => m.id === p.message_id),
      ),
    );
    assert.ok(
      entries.some((e) => e.type === "runtime/model_selection") &&
        entries.some((e) => e.type === "runtime/execution_state"),
    );
    const meta = parse(row.meta_json),
      semantic = {
        taskId,
        index: {
          workspaceKey: row.workspace_key,
          workspacePath: row.workspace_path,
          workspaceIdentity: row.workspace_identity ?? null,
          title: row.title,
          status: row.task_status,
          provider: row.provider,
          mode: row.mode,
          model: row.model,
          thought: meta.thoughtLevel ?? null,
        },
        session: { ...session },
        messages: messages.map((m) => ({ ...m })),
        parts: parts.map((p) => ({ ...p })),
        entries: entries.map((e) => ({ ...e })),
      };
    return {
      taskId,
      dbPath,
      indexPath,
      archived: row.archived === 1,
      pinned: false,
      deleted: false,
      semantic,
      semanticSha256: macStageDigest(semantic),
      scope:
        "Readonly tasks-index owns archive flag; original CLI history/model/cwd preserved, no time_archived mirror assumed",
    };
  } finally {
    db?.close();
    index?.close();
  }
}
export function assertArchiveTaskUnchanged(baseline, current, archived) {
  assert.equal(current.archived, archived);
  assert.equal(current.deleted, false);
  assert.equal(current.pinned, false);
  assert.equal(current.taskId, baseline.taskId);
  assert.equal(current.dbPath, baseline.dbPath);
  assert.deepEqual(current.semantic, baseline.semantic);
  assert.equal(current.semanticSha256, baseline.semanticSha256);
  return true;
}
