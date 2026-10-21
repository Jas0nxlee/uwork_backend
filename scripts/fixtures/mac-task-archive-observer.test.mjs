import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  realpath,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureArchiveTask,
  assertArchiveTaskUnchanged,
  ARCHIVE_PROFILE,
} from "./mac-task-archive-observer.mjs";
async function owned(t) {
  const folder = await realpath(
      await mkdtemp(join(tmpdir(), "uw-task-archive-")),
    ),
    root = join(folder, ARCHIVE_PROFILE),
    workspace = join(root, "packaged-workspace");
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const indexPath = join(root, "data/.uwork/v2/tasks-index.sqlite"),
    dbPath = join(root, "data/.zcode/cli/db/db.sqlite");
  await mkdir(join(root, "data/.uwork/v2"), { recursive: true });
  await mkdir(join(root, "data/.zcode/cli/db"), { recursive: true });
  const index = new DatabaseSync(indexPath),
    db = new DatabaseSync(dbPath),
    id = "sess_owned";
  index.exec(
    "CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,provider TEXT,mode TEXT,model TEXT,meta_json TEXT,archived INTEGER,pinned INTEGER,deleted INTEGER)",
  );
  index
    .prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      workspace,
      workspace,
      null,
      id,
      "Controlled title",
      "completed",
      "ucas",
      "yolo",
      "model",
      '{"thoughtLevel":"none"}',
      0,
      0,
      0,
    );
  db.exec(
    "CREATE TABLE session(id TEXT,project_id TEXT,workspace_id TEXT,directory TEXT,path TEXT,title TEXT,time_archived INTEGER);CREATE TABLE message(id TEXT,session_id TEXT,sequence INTEGER,time_created INTEGER,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,sequence INTEGER,time_created INTEGER,data TEXT);CREATE TABLE session_entry(id TEXT,session_id TEXT,type TEXT,data TEXT)",
  );
  db.prepare("INSERT INTO session VALUES(?,?,?,?,?,?,?)").run(
    id,
    "project",
    null,
    workspace,
    workspace,
    "Controlled title",
    null,
  );
  for (const [i, role] of ["user", "assistant"].entries()) {
    const mid = "msg" + i,
      data = {
        role,
        ...(role === "assistant" ? { time: { completed: 123 } } : {}),
      };
    db.prepare("INSERT INTO message VALUES(?,?,?,?,?)").run(
      mid,
      id,
      i,
      100 + i,
      JSON.stringify(data),
    );
    db.prepare("INSERT INTO part VALUES(?,?,?,?,?,?)").run(
      "part" + i,
      mid,
      id,
      i,
      100 + i,
      JSON.stringify({
        type: "text",
        text:
          role === "user"
            ? "MACOS_CLOCK_LINK_20261020 请简短回复，不调用工具。"
            : "原生企业资产联动完成。",
      }),
    );
  }
  for (const [type, suffix, data] of [
    [
      "runtime/model_selection",
      ":runtime-model-selection",
      { modelSelection: { providerId: "ucas", modelId: "model" } },
    ],
    [
      "runtime/execution_state",
      ":runtime-execution-state",
      { mode: "yolo", planEnabled: false },
    ],
  ])
    db.prepare("INSERT INTO session_entry VALUES(?,?,?,?)").run(
      id + suffix,
      id,
      type,
      JSON.stringify(data),
    );
  t.after(async () => {
    index.close();
    db.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { root, workspace, dbPath, taskId: id, index, db };
}
test("actual readonly SQLite observer sees first-confirm unchanged and host archive0/1/0 without CLI mirror", async (t) => {
  const f = await owned(t),
    a = captureArchiveTask(f);
  assert.equal(a.archived, false);
  assert.equal(a.semantic.session.time_archived, null);
  assertArchiveTaskUnchanged(a, captureArchiveTask(f), false);
  f.index.exec("UPDATE tasks SET archived=1");
  const b = captureArchiveTask(f);
  assertArchiveTaskUnchanged(a, b, true);
  f.index.exec("UPDATE tasks SET archived=0");
  assertArchiveTaskUnchanged(a, captureArchiveTask(f), false);
  assert.equal(
    f.db.prepare("SELECT time_archived FROM session").get().time_archived,
    null,
  );
});
test("wrong model/cwd or mutated durable text cannot pass lifecycle identity", async (t) => {
  const f = await owned(t),
    a = captureArchiveTask(f);
  f.index.exec("UPDATE tasks SET model='foreign'");
  assert.throws(() =>
    assertArchiveTaskUnchanged(a, captureArchiveTask(f), false),
  );
  f.index.exec("UPDATE tasks SET model='model'");
  f.db.exec("UPDATE session SET directory='/foreign'");
  assert.throws(() => captureArchiveTask(f));
  f.db.prepare("UPDATE session SET directory=?").run(f.workspace);
  f.db.exec("UPDATE part SET data='{}'");
  assert.throws(() =>
    assertArchiveTaskUnchanged(a, captureArchiveTask(f), false),
  );
});
test("deleted, foreign workspace and wrong task ID reject instead of observing other task", async (t) => {
  const f = await owned(t);
  assert.throws(() => captureArchiveTask({ ...f, taskId: "sess_foreign" }));
  f.index.exec("UPDATE tasks SET deleted=1");
  assert.throws(() => captureArchiveTask(f));
  f.index.exec("UPDATE tasks SET deleted=0,workspace_path='/foreign'");
  assert.throws(() => captureArchiveTask(f));
});
test("observer never migrates a missing database and only accepts mapped case-private candidates", async (t) => {
  const f = await owned(t);
  const missingPrivateCandidate = join(f.root, "data/.uwork/cli/db/db.sqlite");
  assert.throws(() =>
    captureArchiveTask({ ...f, dbPath: missingPrivateCandidate }),
  );
  await assert.rejects(() => access(missingPrivateCandidate));
  const path = join(f.root, "missing.sqlite");
  assert.throws(() => captureArchiveTask({ ...f, dbPath: path }));
  await writeFile(path, "controlled");
  assert.throws(() => captureArchiveTask({ ...f, dbPath: path }));
});
