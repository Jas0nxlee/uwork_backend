/** Readonly observation only: never imports production Db/Repo/runtime or sends a command. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
export const MAC_TASK_SELECTS = Object.freeze({
  index:
    "SELECT workspace_key,workspace_path,workspace_identity,task_id,title,task_status,provider,mode,model,meta_json FROM tasks WHERE task_id=? AND deleted=0",
  session:
    "SELECT id,project_id,workspace_id,directory,path,title FROM session WHERE id=?",
  messages:
    "SELECT id,session_id,sequence,data FROM message WHERE session_id=? ORDER BY sequence IS NULL,sequence,time_created,rowid",
  parts:
    "SELECT id,message_id,session_id,sequence,data FROM part WHERE session_id=? ORDER BY message_id,sequence IS NULL,sequence,time_created,id",
  entries:
    "SELECT id,type,data FROM session_entry WHERE session_id=? AND type IN ('runtime/model_selection','runtime/execution_state') ORDER BY id",
});
const parse = (text) => {
  assert.equal(typeof text, "string");
  assert.ok(Buffer.byteLength(text) <= 2 * 1024 * 1024);
  return JSON.parse(text);
};
function selection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    typeof value.providerId !== "string" ||
    !value.providerId ||
    typeof value.modelId !== "string" ||
    !value.modelId
  )
    return null;
  const level = value.options?.reasoningLevel;
  return {
    providerId: value.providerId,
    modelId: value.modelId,
    ...(typeof level === "string"
      ? { options: { reasoningLevel: level } }
      : {}),
  };
}
function regular(path) {
  assert.equal(realpathSync(path), path);
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink());
}
export function readCompletedTaskSemantics({
  root: profileRoot,
  workspace: workspacePath,
  dbPath,
  taskId,
  dom,
}) {
  assert.ok(
    dom?.uiTaskOpened === true &&
      dom.sessionId === taskId &&
      dom.taskId === taskId,
    "Original UI must already display the same task/session",
  );
  const root = resolve(profileRoot),
    home = join(root, "data"),
    workspace = resolve(workspacePath);
  assert.match(
    basename(root),
    /^client-native-packaged-macos-clock-arm64-consistency-v[0-9]+-[0-9]{8}$/,
  );
  for (const path of [root, home]) {
    assert.equal(realpathSync(path), path);
    const info = lstatSync(path);
    assert.ok(info.isDirectory() && (info.mode & 0o777) === 0o700);
  }
  assert.equal(workspace, join(root, "packaged-workspace"));
  assert.equal(realpathSync(workspace), workspace);
  assert.match(taskId, /^sess_[A-Za-z0-9_-]+$/);
  const allowed = [
    join(home, ".zcode/cli/db/db.sqlite"),
    join(home, ".uwork/cli/db/db.sqlite"),
  ];
  assert.ok(
    allowed.includes(dbPath),
    "Only actual mapped private candidate databases, no external path",
  );
  regular(dbPath);
  const indexPath = join(home, ".uwork/v2/tasks-index.sqlite");
  regular(indexPath);
  let index, session;
  try {
    index = new DatabaseSync(indexPath, { readOnly: true });
    session = new DatabaseSync(dbPath, { readOnly: true });
    const indexed = index.prepare(MAC_TASK_SELECTS.index).all(taskId);
    assert.equal(indexed.length, 1);
    const row = indexed[0],
      meta = parse(row.meta_json);
    assert.equal(row.workspace_path, workspace);
    assert.equal(
      row.workspace_key,
      row.workspace_identity?.trim() || workspace,
    );
    assert.equal(row.task_status, "completed");
    assert.ok(row.title && row.title === dom.title);
    const sessions = session.prepare(MAC_TASK_SELECTS.session).all(taskId);
    assert.equal(sessions.length, 1);
    const stored = sessions[0];
    assert.equal(stored.id, taskId);
    assert.equal(stored.directory, workspace);
    assert.equal(stored.path, workspace);
    assert.ok(stored.title);
    const messages = session.prepare(MAC_TASK_SELECTS.messages).all(taskId),
      parts = session.prepare(MAC_TASK_SELECTS.parts).all(taskId),
      entries = session.prepare(MAC_TASK_SELECTS.entries).all(taskId);
    assert.equal(
      messages.length,
      2,
      "Owned completed single prompt has user/assistant only",
    );
    assert.ok(parts.length <= 128);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map((entry) => entry.type)).size, 2);
    for (const entry of entries)
      assert.equal(
        entry.id,
        taskId +
          (entry.type === "runtime/model_selection"
            ? ":runtime-model-selection"
            : ":runtime-execution-state"),
      );
    const decoded = messages.map((message) => {
      assert.equal(message.session_id, taskId);
      const data = parse(message.data);
      assert.ok(["user", "assistant"].includes(data.role));
      const ownedParts = parts
        .filter((part) => part.message_id === message.id)
        .map((part) => {
          assert.equal(part.session_id, taskId);
          const value = parse(part.data);
          assert.equal(typeof value.type, "string");
          if (typeof value.text === "string")
            assert.ok(Buffer.byteLength(value.text) <= 131072);
          return {
            id: part.id,
            messageId: part.message_id,
            sequence: part.sequence,
            type: value.type,
            ...(typeof value.text === "string" ? { text: value.text } : {}),
            ...(value.type === "step-finish"
              ? { reason: value.reason ?? null }
              : {}),
          };
        });
      if (data.role === "assistant") {
        assert.equal(data.error, undefined);
        assert.ok(
          Number.isFinite(data.time?.completed),
          "Assistant must be completed before baseline",
        );
      }
      return {
        id: message.id,
        sessionId: message.session_id,
        sequence: message.sequence,
        role: data.role,
        status: data.status ?? null,
        finish: data.finish ?? null,
        errorPresent: data.error !== undefined,
        modelSelection:
          data.role === "user" ? selection(data.modelSelection) : null,
        assistantModel:
          data.role === "assistant"
            ? {
                providerId: data.providerId ?? null,
                modelId: data.modelId ?? null,
              }
            : null,
        parts: ownedParts,
      };
    });
    assert.deepEqual(
      decoded.map((row) => row.role),
      ["user", "assistant"],
    );
    const entryValues = Object.fromEntries(
      entries.map((entry) => [entry.type, parse(entry.data)]),
    );
    const semantic = {
      taskId,
      sessionId: stored.id,
      index: {
        title: row.title,
        status: row.task_status,
        provider: row.provider,
        mode: row.mode,
        model: row.model,
        thoughtLevel: meta.thoughtLevel ?? null,
        workspacePath: row.workspace_path,
        workspaceIdentity: row.workspace_identity ?? null,
        workspaceKey: row.workspace_key,
      },
      session: {
        id: stored.id,
        projectId: stored.project_id,
        workspaceId: stored.workspace_id,
        directory: stored.directory,
        path: stored.path,
        title: stored.title,
      },
      modelSelection: selection(
        entryValues["runtime/model_selection"]?.modelSelection,
      ),
      executionState: entryValues["runtime/execution_state"]
        ? {
            mode: entryValues["runtime/execution_state"].mode,
            planEnabled: entryValues["runtime/execution_state"].planEnabled,
          }
        : null,
      messages: decoded,
    };
    return {
      scope:
        "Pure readonly fixed SELECT after original UI opened task; persisted semantics, not runtime API or model reexecution",
      dbPath,
      indexPath,
      semantic,
      semanticSha256: createHash("sha256")
        .update(JSON.stringify(semantic))
        .digest("hex"),
    };
  } finally {
    session?.close();
    index?.close();
  }
}
