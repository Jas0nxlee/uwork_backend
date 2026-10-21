import assert from "node:assert/strict";
import test from "node:test";
import { projectMessageTranscript } from "./mac-message-edit-fork-readonly.mjs";
import {
  EDIT_PROMPT,
  EDIT_REPLY,
  WARM_PREFIX,
  WARM_REPLY,
  CHILD_PROMPT,
  CHILD_REPLY,
} from "./mac-message-edit-fork-oracle.mjs";
const message = (id, role, value) => ({
  info: { id, sessionID: "sess_parent", role, time: { completed: 1 } },
  parts: [{ id: "p_" + id, type: "text", text: value }],
});
const warm = [
  message("m1", "user", WARM_PREFIX),
  message("m2", "assistant", WARM_REPLY),
];
const edited = [
  ...warm,
  message("m3", "user", EDIT_PROMPT),
  message("m4", "assistant", EDIT_REPLY),
];
const session = {
  id: "sess_parent",
  directory: "/owned/packaged-workspace",
  path: "/owned/packaged-workspace",
  revert: {
    targetMessageID: "m1",
    branchCutAfterMessageID: "m2",
    keptMessageIDs: [],
  },
};
test("actual canonical selector omits reverted physical branch, retains edited IDs and completed content", () => {
  const value = projectMessageTranscript(session, edited, "edit");
  assert.deepEqual(
    value.active.map((m) => m.id),
    ["m3", "m4"],
  );
  assert.deepEqual(value.physicalMessageIds, ["m1", "m2", "m3", "m4"]);
  assert.equal(value.active[0].text, EDIT_PROMPT);
});
test("child remapped IDs and fork notice permitted, missing inherited edited semantics rejected", () => {
  const child = {
    ...session,
    id: "sess_child",
    parentID: "sess_parent",
    taskType: "fork",
    revert: undefined,
  };
  const rows = [
    message("c1", "user", EDIT_PROMPT),
    message("c2", "assistant", EDIT_REPLY),
    message("notice", "user", "Forked conversation"),
    message("c3", "user", CHILD_PROMPT),
    message("c4", "assistant", CHILD_REPLY),
  ];
  assert.equal(
    projectMessageTranscript(child, rows, "child").parentId,
    "sess_parent",
  );
  assert.throws(() =>
    projectMessageTranscript(
      child,
      rows.filter((r) => r.info.id !== "c2"),
      "child",
    ),
  );
});
test("actual fixed readonly SELECT + original codecs bind same UI task and do not change SQLite bytes", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { readMessageLifecycle } = await import(
    "./mac-message-edit-fork-readonly.mjs"
  );
  const base = await (
    await import("node:fs/promises")
  ).realpath(await mkdtemp(join(tmpdir(), "message-ro-")));
  try {
    const root = join(
        base,
        "client-native-packaged-macos-clock-arm64-message-edit-fork-v1-20261021",
      ),
      home = join(root, "data"),
      workspacePath = join(root, "packaged-workspace");
    await mkdir(root, { mode: 0o700 });
    await mkdir(home, { mode: 0o700 });
    await mkdir(workspacePath, { mode: 0o700 });
    await mkdir(join(home, ".uwork/cli/db"), { recursive: true });
    await mkdir(join(home, ".uwork/v2"), { recursive: true });
    const dbPath = join(home, ".uwork/cli/db/db.sqlite"),
      ip = join(home, ".uwork/v2/tasks-index.sqlite");
    let db = new DatabaseSync(dbPath),
      index = new DatabaseSync(ip);
    db.exec(
      "CREATE TABLE session(id,project_id,workspace_id,parent_id,task_type,directory,path,title,title_source,revert,time_created,time_updated);CREATE TABLE message(id,session_id,sequence,time_created,data);CREATE TABLE part(id,message_id,session_id,sequence,time_created,data);CREATE TABLE session_entry(id,session_id,type,data);",
    );
    index.exec(
      "CREATE TABLE tasks(workspace_key,workspace_path,workspace_identity,task_id,title,task_status,provider,mode,model,meta_json,deleted);",
    );
    db.prepare("INSERT INTO session VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "sess_a",
      "project",
      null,
      null,
      "interactive",
      workspacePath,
      workspacePath,
      "Owned title",
      "generated",
      null,
      1,
      2,
    );
    index
      .prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        workspacePath,
        workspacePath,
        null,
        "sess_a",
        "Owned title",
        "completed",
        "zcode",
        "build",
        "model",
        "{}",
        0,
      );
    const selection = {
      providerId: "ucas",
      modelId: "model",
      options: { reasoningLevel: "none" },
    };
    for (const [i, role, text] of [
      [0, "user", WARM_PREFIX],
      [1, "assistant", WARM_REPLY],
    ]) {
      db.prepare("INSERT INTO message VALUES(?,?,?,?,?)").run(
        "m" + i,
        "sess_a",
        i,
        i,
        JSON.stringify({
          role,
          time: {
            created: 1,
            ...(role === "assistant" ? { completed: 2 } : {}),
          },
          ...(role === "user" ? { modelSelection: selection } : {}),
        }),
      );
      db.prepare("INSERT INTO part VALUES(?,?,?,?,?,?)").run(
        "p" + i,
        "m" + i,
        "sess_a",
        0,
        1,
        JSON.stringify({ type: "text", text }),
      );
    }
    db.prepare("INSERT INTO session_entry VALUES(?,?,?,?)").run(
      "sess_a:runtime-model-selection",
      "sess_a",
      "runtime/model_selection",
      JSON.stringify({ modelSelection: selection }),
    );
    db.prepare("INSERT INTO session_entry VALUES(?,?,?,?)").run(
      "sess_a:runtime-execution-state",
      "sess_a",
      "runtime/execution_state",
      JSON.stringify({ mode: "build", planEnabled: false }),
    );
    db.close();
    index.close();
    const before = await readFile(dbPath);
    const value = readMessageLifecycle({
      root,
      workspacePath,
      dbPath,
      taskId: "sess_a",
      phase: "warm",
      dom: {
        ok: true,
        taskId: "sess_a",
        sessionId: "sess_a",
        title: "Owned title",
      },
    });
    assert.equal(value.semantic.active.length, 2);
    assert.deepEqual(value.semantic.modelSelection, selection);
    assert.deepEqual(await readFile(dbPath), before);
    assert.throws(() =>
      readMessageLifecycle({
        root,
        workspacePath,
        dbPath,
        taskId: "sess_a",
        phase: "warm",
        dom: {
          ok: true,
          taskId: "sess_other",
          sessionId: "sess_a",
          title: "Owned title",
        },
      }),
    );
    await writeFile(
      join(base, "receipt"),
      JSON.stringify({ scope: "temporary test DB only" }),
    );
  } finally {
    await rm(base, { recursive: true });
  }
});
test("entire original copied prefix role/text/model/types equal; marker-only subset and changed selection fail", async () => {
  const { assertForkCopiedPrefix } = await import(
    "./mac-message-edit-fork-readonly.mjs"
  );
  const p = projectMessageTranscript(session, edited, "edit");
  const rows = edited
    .slice(2)
    .map((m, i) => ({ ...m, info: { ...m.info, id: "child" + i } }));
  const c = projectMessageTranscript(
    {
      ...session,
      id: "sess_child",
      parentID: "sess_parent",
      revert: undefined,
    },
    rows,
    "fork",
  );
  assertForkCopiedPrefix(p, c);
  for (const field of ["role", "text", "modelSelection", "partTypes"]) {
    const bad = structuredClone(c);
    bad.active[0][field] =
      field === "text"
        ? EDIT_PROMPT + " mutated"
        : field === "partTypes"
          ? ["tool"]
          : field === "role"
            ? "assistant"
            : { providerId: "wrong" };
    assert.throws(() => assertForkCopiedPrefix(p, bad));
  }
});
