/** Owned test-only fixed SELECTs and original codecs; no Repo, migration or mutation. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  decodeSessionRow,
  decodeMessageRow,
  decodePartRow,
  decodeSessionEntryRow,
} from "../../clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
export const DELETE_PROFILE =
  "client-native-packaged-macos-clock-arm64-task-delete-v1-20261021";
export const DELETE_STAGES = Object.freeze([
  "baseline",
  "forked",
  "archived",
  "cancel-dialog",
  "cancelled",
  "delete-dialog",
  "deleted",
  "reloaded",
]);
export const DELETE_SELECTS = Object.freeze({
  index:
    "SELECT workspace_key,workspace_path,workspace_identity,task_id,title,task_status,provider,mode,model,meta_json,archived,pinned,deleted FROM tasks WHERE task_id=?",
  active:
    "SELECT task_id FROM tasks WHERE workspace_key=? AND deleted=0 AND archived=0 ORDER BY task_id",
  archived:
    "SELECT task_id FROM tasks WHERE workspace_key=? AND deleted=0 AND archived=1 ORDER BY task_id",
  session: "SELECT * FROM session WHERE id=?",
  messages:
    "SELECT * FROM message WHERE session_id=? ORDER BY sequence IS NULL,sequence,time_created,rowid",
  parts:
    "SELECT * FROM part WHERE session_id=? ORDER BY message_id,sequence IS NULL,sequence,time_created,id",
  entries:
    "SELECT * FROM session_entry WHERE session_id=? AND type IN ('runtime/model_selection','runtime/execution_state') ORDER BY id",
});
const parse = (value) => {
  assert.equal(typeof value, "string");
  assert.ok(Buffer.byteLength(value) <= 2 * 1024 * 1024);
  return JSON.parse(value);
};
function regular(root, path) {
  const tail = relative(root, path);
  assert.ok(tail && tail !== ".." && !tail.startsWith(".." + sep));
  let current = root;
  for (const part of tail.split(sep)) {
    current = join(current, part);
    const st = lstatSync(current);
    assert.ok(!st.isSymbolicLink());
    assert.equal(realpathSync(current), current);
    assert.ok(current === path ? st.isFile() : st.isDirectory());
  }
}
function captureOne(index, db, taskId, workspace, modelId) {
  assert.match(taskId, /^sess_[A-Za-z0-9_-]+$/);
  const ir = index.prepare(DELETE_SELECTS.index).all(taskId),
    sr = db.prepare(DELETE_SELECTS.session).all(taskId);
  assert.equal(ir.length, 1);
  assert.equal(sr.length, 1);
  const row = ir[0];
  assert.equal(row.task_id, taskId);
  assert.ok(!row.workspace_identity);
  assert.equal(row.workspace_path, workspace);
  assert.equal(row.workspace_key, workspace);
  assert.equal(row.pinned, 0);
  for (const key of ["archived", "deleted"])
    assert.ok([0, 1].includes(row[key]));
  assert.equal(row.model, modelId);
  assert.ok(row.title);
  const session = decodeSessionRow(sr[0]);
  assert.equal(session.id, taskId);
  assert.equal(session.directory, workspace);
  assert.equal(session.path, workspace);
  assert.equal(session.workspaceID, undefined);
  const rawMessages = db.prepare(DELETE_SELECTS.messages).all(taskId),
    rawParts = db.prepare(DELETE_SELECTS.parts).all(taskId),
    rawEntries = db.prepare(DELETE_SELECTS.entries).all(taskId);
  assert.equal(rawMessages.length, 2);
  assert.ok(rawParts.length > 0 && rawParts.length <= 128);
  assert.equal(rawEntries.length, 2);
  assert.ok(
    [...rawMessages, ...rawParts, ...rawEntries].every(
      (r) => r.session_id === taskId,
    ),
  );
  const messages = rawMessages.map((r) => ({
    info: decodeMessageRow(r),
    parts: rawParts.filter((p) => p.message_id === r.id).map(decodePartRow),
  }));
  assert.deepEqual(
    messages.map((m) => m.info.role),
    ["user", "assistant"],
  );
  assert.equal(messages[1].info.error, undefined);
  assert.ok(Number.isFinite(messages[1].info.time?.completed));
  assert.equal(messages[0].info.modelSelection?.providerId, "ucas");
  assert.equal(messages[0].info.modelSelection?.modelId, modelId);
  assert.equal(messages[1].info.providerId, "ucas");
  assert.equal(messages[1].info.modelId, modelId);
  const entries = rawEntries.map(decodeSessionEntryRow);
  assert.equal(new Set(entries.map((x) => x.type)).size, 2);
  const selection = entries.filter((x) => x.type === "runtime/model_selection");
  assert.equal(selection.length, 1);
  assert.equal(selection[0].data.providerId, "ucas");
  assert.equal(selection[0].data.modelId, modelId);
  const semantic = {
    taskId,
    index: {
      title: row.title,
      model: row.model,
      provider: row.provider,
      mode: row.mode,
      thought: parse(row.meta_json).thoughtLevel ?? null,
    },
    session: Object.fromEntries(
      [
        "id",
        "project_id",
        "workspace_id",
        "parent_id",
        "task_type",
        "directory",
        "path",
        "title",
        "time_archived",
      ].map((k) => [k, sr[0][k] ?? null]),
    ),
    messages: rawMessages.map((x) => ({ ...x })),
    parts: rawParts.map((x) => ({ ...x })),
    entries: rawEntries.map(({ id, type, data }) => ({ id, type, data })),
  };
  return {
    taskId,
    archived: row.archived === 1,
    deleted: row.deleted === 1,
    semantic,
    semanticSha256: macStageDigest(semantic),
    decoded: { session, messages, entries },
  };
}
export function assertOwnedFork(parent, child) {
  assert.notEqual(parent.taskId, child.taskId);
  assert.equal(child.decoded.session.parentID, parent.taskId);
  assert.equal(child.decoded.session.taskType, "fork");
  const projection = (m) => ({
    role: m.info.role,
    model: m.info.modelSelection ?? null,
    providerId: m.info.providerId ?? null,
    modelId: m.info.modelId ?? null,
    completed:
      m.info.role === "assistant"
        ? Number.isFinite(m.info.time?.completed)
        : null,
    parts: m.parts.map((p) => ({
      type: p.type,
      ...(p.type === "text" ? { text: p.text } : {}),
    })),
  });
  assert.deepEqual(
    child.decoded.messages.map(projection),
    parent.decoded.messages.map(projection),
  );
  assert.ok(
    child.decoded.messages.every(
      (m) => !parent.decoded.messages.some((p) => p.info.id === m.info.id),
    ),
  );
}
export function captureTaskDelete({
  root,
  workspace,
  dbPath,
  parentId,
  childId = null,
  modelId,
  stage,
}) {
  assert.equal(resolve(root), root);
  assert.equal(realpathSync(root), root);
  assert.equal(basename(root), DELETE_PROFILE);
  assert.equal(workspace, join(root, "packaged-workspace"));
  assert.equal(realpathSync(workspace), workspace);
  assert.ok(DELETE_STAGES.includes(stage));
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
    const parent = captureOne(index, db, parentId, workspace, modelId);
    assert.equal(parent.archived, false);
    assert.equal(parent.deleted, false);
    let child = null;
    if (stage === "baseline") assert.equal(childId, null);
    else {
      assert.ok(childId);
      child = captureOne(index, db, childId, workspace, modelId);
      assertOwnedFork(parent, child);
      assert.equal(child.archived, stage !== "forked");
      assert.equal(child.deleted, ["deleted", "reloaded"].includes(stage));
    }
    const membership = {
      active: index
        .prepare(DELETE_SELECTS.active)
        .all(workspace)
        .map((x) => x.task_id),
      archived: index
        .prepare(DELETE_SELECTS.archived)
        .all(workspace)
        .map((x) => x.task_id),
    };
    assert.ok(membership.active.includes(parentId));
    if (child) {
      assert.equal(membership.active.includes(childId), stage === "forked");
      assert.equal(
        membership.archived.includes(childId),
        !["forked", "deleted", "reloaded"].includes(stage),
      );
    }
    return {
      stage,
      parent,
      child,
      membership,
      dbPath,
      indexPath,
      authority:
        "owned readonly fixed SELECT + original SessionStore codecs; CLI retained after list tombstone",
    };
  } finally {
    db?.close();
    index?.close();
  }
}
export function assertDeletePreserved(baseline, current, forkBaseline) {
  assert.deepEqual(current.parent.semantic, baseline.parent.semantic);
  assert.equal(current.parent.semanticSha256, baseline.parent.semanticSha256);
  if (current.child && forkBaseline) {
    assert.deepEqual(current.child.semantic, forkBaseline.child.semantic);
    assert.equal(
      current.child.semanticSha256,
      forkBaseline.child.semanticSha256,
    );
  }
  return true;
}
