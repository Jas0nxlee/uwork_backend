import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readCompletedTaskSemantics } from "./mac-completed-task-readonly.mjs";
async function fixture(t) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-readonly-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(
      parent,
      "client-native-packaged-macos-clock-arm64-consistency-v1-20261021",
    ),
    home = join(root, "data"),
    workspace = join(root, "packaged-workspace");
  await mkdir(root, { mode: 0o700 });
  for (const path of [
    home,
    workspace,
    join(home, ".zcode/cli/db"),
    join(home, ".uwork/v2"),
  ])
    await mkdir(path, { recursive: true, mode: 0o700 });
  const dbPath = join(home, ".zcode/cli/db/db.sqlite"),
    id = "sess_owned",
    modelId = "owned-model";
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE session(id,project_id,workspace_id,directory,path,title);CREATE TABLE message(id,session_id,sequence,time_created,data);CREATE TABLE part(id,message_id,session_id,sequence,time_created,data);CREATE TABLE session_entry(id,session_id,type,data)",
  );
  db.prepare("INSERT INTO session VALUES(?,?,?,?,?,?)").run(
    id,
    "project",
    null,
    workspace,
    workspace,
    "Stable title",
  );
  for (const [seq, role] of [
    [0, "user"],
    [1, "assistant"],
  ]) {
    const mid = "msg_" + seq;
    db.prepare("INSERT INTO message VALUES(?,?,?,?,?)").run(
      mid,
      id,
      seq,
      10,
      JSON.stringify({
        role,
        modelSelection:
          role === "user"
            ? {
                providerId: "ucas",
                modelId,
                options: { reasoningLevel: "none" },
              }
            : undefined,
        providerId: role === "assistant" ? "ucas" : undefined,
        modelId: role === "assistant" ? modelId : undefined,
        time: { completed: role === "assistant" ? 1 : undefined },
        finish: role === "assistant" ? "stop" : undefined,
      }),
    );
    db.prepare("INSERT INTO part VALUES(?,?,?,?,?,?)").run(
      "part_" + seq,
      mid,
      id,
      0,
      10,
      JSON.stringify({
        type: "text",
        text: role === "user" ? "owned-prompt" : "owned-answer",
      }),
    );
  }
  db.prepare("INSERT INTO session_entry VALUES(?,?,?,?)").run(
    id + ":runtime-model-selection",
    id,
    "runtime/model_selection",
    JSON.stringify({
      modelSelection: {
        providerId: "ucas",
        modelId,
        options: { reasoningLevel: "none" },
      },
    }),
  );
  db.prepare("INSERT INTO session_entry VALUES(?,?,?,?)").run(
    id + ":runtime-execution-state",
    id,
    "runtime/execution_state",
    JSON.stringify({ mode: "build", planEnabled: false }),
  );
  db.close();
  const indexPath = join(home, ".uwork/v2/tasks-index.sqlite"),
    index = new DatabaseSync(indexPath);
  index.exec(
    "CREATE TABLE tasks(workspace_key,workspace_path,workspace_identity,task_id,title,task_status,provider,mode,model,deleted,meta_json)",
  );
  index
    .prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      workspace,
      workspace,
      null,
      id,
      "Stable title",
      "completed",
      "glm",
      "build",
      "ucas/" + modelId,
      0,
      JSON.stringify({ thoughtLevel: "none", updatedAt: 1 }),
    );
  index.close();
  return {
    root,
    workspace,
    dbPath,
    indexPath,
    taskId: id,
    modelId,
    dom: {
      uiTaskOpened: true,
      sessionId: id,
      taskId: id,
      title: "Stable title",
    },
  };
}
const digest = async (p) =>
  createHash("sha256")
    .update(await readFile(p))
    .digest("hex");
test("fixed readonly SELECT snapshot preserves actual semantic fields without any DB mutation", async (t) => {
  const f = await fixture(t),
    before = [await digest(f.dbPath), await digest(f.indexPath)];
  const value = readCompletedTaskSemantics(f);
  assert.equal(value.semantic.taskId, f.taskId);
  assert.equal(value.semantic.index.status, "completed");
  assert.deepEqual(
    value.semantic.messages.map((x) => x.role),
    ["user", "assistant"],
  );
  assert.equal(value.semantic.messages[0].parts[0].text, "owned-prompt");
  assert.equal(value.semantic.modelSelection.options.reasoningLevel, "none");
  assert.deepEqual([await digest(f.dbPath), await digest(f.indexPath)], before);
});
test("UI same-task gate is required before opening local persisted files", async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    readCompletedTaskSemantics({
      ...f,
      dom: { ...f.dom, uiTaskOpened: false },
    }),
  );
  assert.throws(() =>
    readCompletedTaskSemantics({
      ...f,
      dom: { ...f.dom, sessionId: "sess_other" },
    }),
  );
});
test("unknown/external DB or symlink cannot read a different profile", async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    readCompletedTaskSemantics({ ...f, dbPath: "/tmp/foreign.sqlite" }),
  );
  const link = join(f.root, "data/.uwork/cli/db");
  await mkdir(join(f.root, "data/.uwork/cli"), { recursive: true });
  await symlink(join(f.root, "data/.zcode/cli/db"), link);
  assert.throws(() =>
    readCompletedTaskSemantics({ ...f, dbPath: join(link, "db.sqlite") }),
  );
});
test("running/error task, missing session and mismatched workspace are rejected", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.indexPath);
  try {
    for (const status of ["running", "error"]) {
      db.prepare("UPDATE tasks SET task_status=?").run(status);
      assert.throws(() => readCompletedTaskSemantics(f));
    }
    db.prepare("UPDATE tasks SET task_status=?,workspace_path=?").run(
      "completed",
      "/foreign",
    );
    assert.throws(() => readCompletedTaskSemantics(f));
  } finally {
    db.close();
  }
});
test("only stable semantics are compared; viewed timestamps and runtime metadata do not enter digest", async (t) => {
  const f = await fixture(t),
    before = readCompletedTaskSemantics(f),
    db = new DatabaseSync(f.indexPath);
  try {
    db.prepare("UPDATE tasks SET meta_json=?").run(
      JSON.stringify({
        thoughtLevel: "none",
        updatedAt: 999,
        lastViewedAt: 88,
        connectionLease: "new",
      }),
    );
  } finally {
    db.close();
  }
  assert.deepEqual(readCompletedTaskSemantics(f).semantic, before.semantic);
});
test("model null does not fall back to retired flat selection values", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.dbPath);
  try {
    db.prepare("UPDATE session_entry SET data=? WHERE type=?").run(
      JSON.stringify({
        modelSelection: null,
        providerId: "ucas",
        modelId: f.modelId,
      }),
      "runtime/model_selection",
    );
  } finally {
    db.close();
  }
  const value = readCompletedTaskSemantics(f);
  assert.equal(value.semantic.modelSelection, null);
});
