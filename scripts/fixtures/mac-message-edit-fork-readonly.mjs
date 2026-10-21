/** Fixed readonly SELECTs and original codecs/active branch; never restores or creates runtime. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { selectActiveConversationBranch } from "@zcode/contracts";
import {
  decodeMessageRow,
  decodePartRow,
  decodeSessionRow,
} from "../../clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts";
import { MAC_TASK_SELECTS } from "./mac-completed-task-readonly.mjs";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
import {
  EDIT_PROMPT,
  EDIT_REPLY,
  WARM_PREFIX,
  WARM_REPLY,
  CHILD_PROMPT,
  CHILD_REPLY,
} from "./mac-message-edit-fork-oracle.mjs";
export function projectMessageTranscript(session, messages, phase) {
  assert.ok(["warm", "edit", "fork", "child", "reload"].includes(phase));
  assert.ok(messages.length > 0 && messages.length <= 64);
  const r = session.revert;
  const active = selectActiveConversationBranch(messages, {
    branchCutAfterMessageId: r?.branchCutAfterMessageID,
    rewindCreatedMessageId: r?.createdMessageID,
    rewindKeptMessageIds: r?.keptMessageIDs,
    rewindTargetMessageId: r?.targetMessageID,
  }).map((m) => ({
    id: m.info.id,
    role: m.info.role,
    modelSelection: m.info.modelSelection ?? null,
    completed:
      m.info.role === "assistant"
        ? Number.isFinite(m.info.time?.completed)
        : null,
    text: m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n"),
    partIds: m.parts.map((p) => p.id),
    partTypes: m.parts.map((p) => p.type),
  }));
  assert.ok(active.every((m) => m.role !== "assistant" || m.completed));
  const has = (role, marker) =>
    active.filter((m) => m.role === role && m.text.includes(marker)).length ===
    1;
  if (phase === "warm") {
    assert.ok(has("user", WARM_PREFIX) && has("assistant", WARM_REPLY));
  } else {
    assert.ok(has("user", EDIT_PROMPT) && has("assistant", EDIT_REPLY));
    assert.ok(
      active.every(
        (m) => !m.text.includes(WARM_PREFIX) && !m.text.includes(WARM_REPLY),
      ),
    );
  }
  if (phase === "child" || phase === "reload")
    assert.ok(has("user", CHILD_PROMPT) && has("assistant", CHILD_REPLY));
  return {
    sessionId: session.id,
    parentId: session.parentID ?? null,
    taskType: session.taskType ?? "interactive",
    directory: session.directory,
    path: session.path ?? null,
    physicalMessageIds: messages.map((m) => m.info.id),
    active,
  };
}
export function assertForkCopiedPrefix(parent, child) {
  assert.equal(child.parentId, parent.sessionId);
  assert.notEqual(child.sessionId, parent.sessionId);
  const project = (m) => ({
    role: m.role,
    text: m.text,
    modelSelection: m.modelSelection,
    completed: m.completed,
    partTypes: m.partTypes,
  });
  assert.deepEqual(
    child.active.slice(0, parent.active.length).map(project),
    parent.active.map(project),
    "Entire copied parent active prefix must be preserved semantically",
  );
  const parentIds = new Set(parent.active.map((m) => m.id));
  assert.ok(child.active.every((m) => !parentIds.has(m.id)));
}
function regular(path) {
  assert.equal(realpathSync(path), path);
  const st = lstatSync(path);
  assert.ok(st.isFile() && !st.isSymbolicLink());
}
export function readMessageLifecycle({
  root: inputRoot,
  workspacePath,
  dbPath,
  taskId,
  phase,
  dom,
}) {
  const root = resolve(inputRoot),
    home = join(root, "data");
  assert.match(
    basename(root),
    /^client-native-packaged-macos-clock-arm64-message-edit-fork-v[0-9]+-20261021$/,
  );
  for (const p of [root, home]) {
    assert.equal(realpathSync(p), p);
    assert.equal(lstatSync(p).mode & 0o777, 0o700);
  }
  assert.equal(workspacePath, join(root, "packaged-workspace"));
  assert.equal(realpathSync(workspacePath), workspacePath);
  assert.ok(dom?.ok && dom.taskId === taskId && dom.sessionId === taskId);
  assert.match(taskId, /^sess_[A-Za-z0-9_-]+$/);
  assert.ok(
    [
      join(home, ".uwork/cli/db/db.sqlite"),
      join(home, ".zcode/cli/db/db.sqlite"),
    ].includes(dbPath),
  );
  const indexPath = join(home, ".uwork/v2/tasks-index.sqlite");
  regular(dbPath);
  regular(indexPath);
  let db, index;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    index = new DatabaseSync(indexPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT id,project_id,workspace_id,parent_id,task_type,directory,path,title,title_source,revert,time_created,time_updated FROM session WHERE id=?",
      )
      .all(taskId);
    assert.equal(rows.length, 1);
    const session = decodeSessionRow(rows[0]);
    const ir = index.prepare(MAC_TASK_SELECTS.index).all(taskId);
    assert.equal(ir.length, 1);
    assert.equal(ir[0].workspace_path, workspacePath);
    assert.equal(
      ir[0].workspace_key,
      ir[0].workspace_identity?.trim() || workspacePath,
    );
    if (phase === "fork")
      assert.ok(!["running", "failed", "error"].includes(ir[0].task_status));
    else assert.equal(ir[0].task_status, "completed");
    assert.equal(ir[0].title, dom.title);
    const messages = db
      .prepare(MAC_TASK_SELECTS.messages)
      .all(taskId)
      .map((row) => ({ info: decodeMessageRow(row), parts: [] }));
    const parts = db.prepare(MAC_TASK_SELECTS.parts).all(taskId);
    assert.ok(parts.length <= 256);
    for (const row of parts) {
      const m = messages.find((m) => m.info.id === row.message_id);
      assert.ok(m);
      m.parts.push(decodePartRow(row));
    }
    const semantic = projectMessageTranscript(session, messages, phase);
    assert.equal(semantic.directory, workspacePath);
    assert.equal(semantic.path, workspacePath);
    const entries = db.prepare(MAC_TASK_SELECTS.entries).all(taskId);
    assert.equal(entries.length, 2);
    const parsed = Object.fromEntries(
      entries.map((e) => [e.type, JSON.parse(e.data)]),
    );
    assert.ok(parsed["runtime/model_selection"]?.modelSelection);
    semantic.modelSelection = parsed["runtime/model_selection"].modelSelection;
    semantic.executionState = parsed["runtime/execution_state"];
    semantic.title = ir[0].title;
    semantic.workspaceIdentity = ir[0].workspace_identity ?? null;
    semantic.workspaceKey = ir[0].workspace_key;
    semantic.indexStatus = ir[0].task_status;
    return {
      semantic,
      semanticSha256: macStageDigest(semantic),
      dbPath,
      indexPath,
      authority:
        "UI-first fixed SELECT readonly original codecs and canonical branch",
    };
  } finally {
    db?.close();
    index?.close();
  }
}
