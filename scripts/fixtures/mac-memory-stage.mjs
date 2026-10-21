/** Test-only readonly Memory oracle; no runtime sender, settings writer or model call. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { projectCapabilitySupplierRequests } from "./mac-model-capability-stage.mjs";
import { resolveProjectMemoryRoot } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/project-root.ts";
export const MEMORY_BODY = "UWORK_NATIVE_MEMORY_BODY_20261021";
export const MEMORY_STAGES = Object.freeze([
  "warm",
  "off-one",
  "on",
  "off-two",
]);
export const MEMORY_LABELS = Object.freeze([
  "MACOS_CLOCK_LINK_20261020",
  "UWORK_NATIVE_MEMORY_OFF_ONE_20261021",
  "UWORK_NATIVE_MEMORY_ON_20261021",
  "UWORK_NATIVE_MEMORY_OFF_TWO_20261021",
]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
export function ownedMemoryPath(caseRoot, workspacePath) {
  assert.equal(resolve(caseRoot), caseRoot);
  assert.equal(workspacePath, join(caseRoot, "packaged-workspace"));
  return join(
    resolveProjectMemoryRoot({
      cliStorageRoot: join(caseRoot, "data/.uwork/cli"),
      workspacePath,
    }),
    "MEMORY.md",
  );
}
export async function attestMemoryInput(caseRoot, workspacePath) {
  const file = ownedMemoryPath(caseRoot, workspacePath);
  assert.equal(await realpath(caseRoot), caseRoot);
  const tail = relative(caseRoot, file);
  assert.ok(
    tail && !isAbsolute(tail) && tail !== ".." && !tail.startsWith(".." + sep),
  );
  let cursor = caseRoot;
  for (const part of tail.split(sep)) {
    cursor = join(cursor, part);
    const st = await lstat(cursor);
    assert.ok(!st.isSymbolicLink());
    assert.equal(await realpath(cursor), cursor);
    assert.ok(cursor === file ? st.isFile() : st.isDirectory());
  }
  const bytes = await readFile(file);
  assert.equal(bytes.toString("utf8"), MEMORY_BODY + "\n");
  return {
    filePath: file,
    relativeFilePath: tail,
    bytes: bytes.length,
    sha256: sha(bytes),
    regularFile: true,
    noSymlink: true,
  };
}
const text = (m) =>
  typeof m.content === "string"
    ? m.content
    : (m.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
export function projectMemoryStageRequests(
  requests,
  { fromIndex, workspacePath, caseRoot, marker, enabled },
) {
  assert.equal(typeof enabled, "boolean");
  const result = projectCapabilitySupplierRequests(requests, {
    fromIndex,
    workspacePath,
    marker,
    expectedTools: 32,
  });
  const main = requests[result.main.index];
  const heading =
    "Contents of " +
    ownedMemoryPath(caseRoot, workspacePath) +
    " (user's auto-memory, persists across conversations):";
  const bodies = main.messages.map(text);
  const fragments = bodies.filter((value) =>
    value.includes(heading + "\n\n" + MEMORY_BODY),
  );
  if (enabled)
    assert.equal(
      fragments.length,
      1,
      "One actual main memory heading/body fragment required",
    );
  else {
    assert.ok(
      bodies.every(
        (value) => !value.includes(MEMORY_BODY) && !value.includes(heading),
      ),
      "Off main must omit project Memory",
    );
  }
  return {
    ...result,
    memoryEnabled: enabled,
    memoryFragmentMatched: enabled,
    memoryHeadingMatched: enabled,
    memoryBodySha256: sha(MEMORY_BODY + "\n"),
    memorySource:
      "original main meta_user/request context; title is not the witness",
  };
}

export function projectMemoryDurableRows(sessionId, rows, parts) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  assert.equal(rows.length, 2);
  return rows.map((row) => {
    const info = JSON.parse(row.data);
    assert.ok(info.id === undefined || info.id === row.id);
    assert.ok(info.sessionID === undefined || info.sessionID === sessionId);
    return {
      info: { ...info, id: row.id, sessionID: sessionId },
      parts: parts
        .filter((part) => part.message_id === row.id)
        .map((part) => JSON.parse(part.data)),
    };
  });
}

// Actual private CLI storage; fixed readonly SELECTs, never production repositories or migrations.
export async function inspectMemorySession({
  caseRoot,
  workspacePath,
  dbPath,
  sessionId,
  marker,
  enabled,
  modelId,
}) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  assert.ok(
    [
      join(caseRoot, "data/.uwork/cli/db/db.sqlite"),
      join(caseRoot, "data/.zcode/cli/db/db.sqlite"),
    ].includes(dbPath),
  );
  assert.equal(await realpath(dbPath), dbPath);
  assert.ok((await lstat(dbPath)).isFile());
  const { DatabaseSync } = await import("node:sqlite");
  const indexPath = join(caseRoot, "data/.uwork/v2/tasks-index.sqlite");
  assert.equal(await realpath(indexPath), indexPath);
  const index = new DatabaseSync(indexPath, { readOnly: true });
  try {
    const rows = index
      .prepare(
        "SELECT workspace_path,workspace_identity,workspace_key FROM tasks WHERE task_id=? AND deleted=0",
      )
      .all(sessionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].workspace_path, workspacePath);
    assert.ok(!rows[0].workspace_identity);
    assert.equal(rows[0].workspace_key, workspacePath);
  } finally {
    index.close();
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let messages;
  try {
    const sessions = db
      .prepare("SELECT id,workspace_id,directory,path FROM session WHERE id=?")
      .all(sessionId);
    assert.equal(sessions.length, 1);
    const row = sessions[0];
    assert.ok(!row.workspace_id);
    assert.equal(row.directory, workspacePath);
    assert.equal(row.path, workspacePath);
    const rows = db
      .prepare(
        "SELECT id,data FROM message WHERE session_id=? ORDER BY sequence IS NULL,sequence,time_created,rowid",
      )
      .all(sessionId);
    assert.equal(rows.length, 2);
    const parts = db
      .prepare(
        "SELECT message_id,data FROM part WHERE session_id=? ORDER BY message_id,sequence IS NULL,sequence,time_created,id",
      )
      .all(sessionId);
    messages = projectMemoryDurableRows(sessionId, rows, parts);
    assert.deepEqual(messages.map((m) => m.info.role).sort(), [
      "assistant",
      "user",
    ]);
    assert.ok(messages.every((m) => m.parts.length <= 128));
    const user = messages.find((m) => m.info.role === "user");
    assert.ok(
      user.parts.some(
        (p) =>
          p.type === "text" && p.text === marker && !p.synthetic && !p.ignored,
      ),
    );
  } finally {
    db.close();
  }
  const { createMemoryExtractionScheduler } = await import(
    "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts"
  );
  let wouldExecute = 0;
  const scheduler = createMemoryExtractionScheduler(async () => {
    wouldExecute++;
    return "success";
  });
  try {
    scheduler.schedule({
      boundaryMessageId: messages.at(-1).info.id,
      durableMessages: messages,
      memoryRoot: join(ownedMemoryPath(caseRoot, workspacePath), ".."),
      workingDirectory: workspacePath,
      workspaceRoot: workspacePath,
    });
    await scheduler.drain();
    assert.equal(scheduler.getCursor(), messages.at(-1).info.id);
    assert.equal(scheduler.hasPendingWork(), false);
    assert.equal(
      wouldExecute,
      0,
      "Actual durable short prompt must naturally skip extraction",
    );
  } finally {
    scheduler.shutdown();
  }
  const logDir = join(caseRoot, "data/.uwork/cli/log");
  assert.equal(await realpath(logDir), logDir);
  assert.ok(!(await lstat(logDir)).isSymbolicLink());
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(logDir)).filter((n) =>
    /^zcode-[0-9-]+\.jsonl$/.test(n),
  );
  assert.ok(files.length > 0 && files.length <= 8);
  let match;
  for (const name of files) {
    const path = join(logDir, name);
    assert.equal(await realpath(path), path);
    const st = await lstat(path);
    assert.ok(
      st.isFile() && !st.isSymbolicLink() && st.size < 16 * 1024 * 1024,
    );
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        value.event === "bootstrap.app.startup.runtime_config.completed" &&
        value.sessionId === sessionId
      )
        match = value.context;
    }
  }
  assert.ok(match);
  assert.equal(match.workingDirectory, workspacePath);
  assert.equal(match.model, "ucas/" + modelId);
  assert.equal(
    match.memoryRoot,
    join(ownedMemoryPath(caseRoot, workspacePath), ".."),
  );
  assert.equal(match.memoryEnabled, enabled);
  assert.equal(match.memoryUse, true);
  assert.equal(match.memoryExtractionEnabled, true);
  return {
    sessionId,
    workspaceIdentity: null,
    databasePath: dbPath,
    memoryRoot: match.memoryRoot,
    memoryEnabled: match.memoryEnabled,
    memoryUse: true,
    memoryExtractionEnabled: true,
    workingDirectory: match.workingDirectory,
    durableRoles: messages.map((m) => m.info.role),
    userTextPartWordCounts: messages
      .filter((m) => m.info.role === "user")
      .flatMap((m) =>
        m.parts
          .filter((p) => p.type === "text")
          .map((p) => ({
            words: p.text.split(/\s+/u).filter(Boolean).length,
            synthetic: p.synthetic === true,
            ignored: p.ignored === true,
            modelOnly: m.info.visibility === "model-only",
          })),
      ),
    originalSchedulerWouldExecute: 0,
    source:
      "Original UI session ID / actual mapped DB / fixed readonly SELECT / original runtime-config event; scheduler oracle does not run a model",
  };
}
