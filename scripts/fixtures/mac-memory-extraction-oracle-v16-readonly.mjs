/** Controlled supplier oracle only. It never writes a memory file or invokes a product tool. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import { join, dirname, relative, sep, isAbsolute } from "node:path";
import { ownedMemoryPath } from "./mac-memory-stage-v16-readonly.mjs";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
import { buildMemoryExtractionPrompt } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts";
import { stampMemoryOriginSessionId } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/origin-session.ts";
import {
  readSessionModelWitness,
  bindStartupModelWitness,
} from "./mac-session-model-witness-v16-readonly.mjs";
export const AUTO_BODY = "UWORK_NATIVE_AUTO_MEMORY_BODY_20261021";
export const AUTO_PROMPT =
  "UWORK_NATIVE_AUTO_MEMORY_CREATE_20261021 remember owned preference " + AUTO_BODY;
export const AUTO_LABEL = "UWORK_NATIVE_AUTO_MEMORY_RECALL_20261021";
export const AUTO_INDEX = "- [Owned preference](owned-preference.md) — " + AUTO_BODY + "\n";
export const AUTO_TOPIC =
  "---\nname: owned-preference\ndescription: Controlled local acceptance preference\nmetadata:\n  type: project\n---\nPreferred acceptance code: " +
  AUTO_BODY +
  "\n\n**Why:** Explicitly requested for this isolated test.\n**How to apply:** Use this code for its local acceptance only.\n";
export const AUTO_IDS = Object.freeze([
  "native-auto-memory-index-20261021",
  "native-auto-memory-topic-20261021",
  "native-auto-memory-denied-20261021",
]);
const TITLE_SHA = "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383";
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
export function autoMemoryPaths(caseRoot, workspacePath) {
  const index = ownedMemoryPath(caseRoot, workspacePath);
  return {
    index,
    topic: join(dirname(index), "owned-preference.md"),
    outside: join(caseRoot, "owned-outside-memory.md"),
    root: dirname(index),
  };
}
async function regularFile(caseRoot, path, readBytes = true) {
  assert.equal(await realpath(caseRoot), caseRoot);
  const tail = relative(caseRoot, path);
  assert.ok(tail && !isAbsolute(tail) && tail !== ".." && !tail.startsWith(".." + sep));
  let cursor = caseRoot;
  for (const part of tail.split(sep)) {
    cursor = join(cursor, part);
    const st = await lstat(cursor);
    assert.ok(!st.isSymbolicLink() && (cursor === path ? st.isFile() : st.isDirectory()));
    assert.equal(await realpath(cursor), cursor);
  }
  if (readBytes) assert.ok((await lstat(path)).size <= 16 * 1024 * 1024);
  return readBytes ? readFile(path) : undefined;
}
export async function assertAutoFilesAbsent(caseRoot, workspacePath) {
  const paths = autoMemoryPaths(caseRoot, workspacePath);
  for (const path of [paths.index, paths.topic, paths.outside]) {
    try {
      await lstat(path);
      assert.fail("Automatic Memory must start with absent owned file");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { indexAbsent: true, topicAbsent: true, outsideAbsent: true, paths };
}
export async function attestAutoMemoryFiles(caseRoot, workspacePath, sessionId) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  const paths = autoMemoryPaths(caseRoot, workspacePath);
  const index = await regularFile(caseRoot, paths.index),
    topic = await regularFile(caseRoot, paths.topic);
  const expectedTopic = stampMemoryOriginSessionId({
    content: AUTO_TOPIC,
    filePath: paths.topic,
    memoryRoot: paths.root,
    sessionId,
  });
  assert.equal(index.toString(), AUTO_INDEX);
  assert.equal(topic.toString(), expectedTopic);
  try {
    await lstat(paths.outside);
    assert.fail("Memory-root external write happened");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    index: {
      path: paths.index,
      bytes: index.length,
      sha256: digest(index.toString()),
    },
    topic: {
      path: paths.topic,
      bytes: topic.length,
      sha256: digest(topic.toString()),
      originSessionId: sessionId,
    },
    outsideAbsent: true,
    plainOwnedFiles: true,
  };
}
export function createMemoryExtractionOracle({ caseRoot, workspacePath }) {
  const paths = autoMemoryPaths(caseRoot, workspacePath),
    prompt = buildMemoryExtractionPrompt({ manifest: [], messageCount: 2 });
  let mainA = 0,
    mainB = 0,
    sidecar = 0,
    titleA = 0,
    titleB = 0,
    mainTools;
  let observerFailed = false;
  const receipts = [];
  const summary = (body, phase) => {
    const row = {
      phase,
      stream: body.stream === true,
      requestSha256: digest(body),
      systemSha256: digest(text(body.messages.find((m) => m.role === "system"))),
      roles: body.messages.map((m) => m.role),
      tools: body.tools?.length ?? 0,
    };
    receipts.push(row);
    return row;
  };
  return {
    observeResponse(res) {
      const row = receipts.at(-1);
      if (!row) return;
      try {
        res.once("finish", () => {
          try {
            row.httpFinished = true;
            row.statusCode = res.statusCode;
            row.writableFinished = res.writableFinished === true;
          } catch {
            observerFailed = true;
          }
        });
        res.once("close", () => {
          try {
            row.httpAborted = res.writableFinished !== true;
          } catch {
            observerFailed = true;
          }
        });
      } catch {
        observerFailed = true;
      }
    },
    reply(body) {
      assert.ok(Array.isArray(body.messages));
      const system = text(body.messages.find((m) => m.role === "system")),
        users = body.messages.filter((m) => m.role === "user"),
        last = text(users.at(-1));
      const systemSha = digest(system);
      const isTitle = systemSha === TITLE_SHA;
      if (isTitle && (last.includes(AUTO_PROMPT) || last.includes(AUTO_LABEL))) {
        assert.equal(body.stream, false);
        assert.equal(Buffer.byteLength(system), 997);
        assert.ok(!Object.hasOwn(body, "tools"));
        const a = last.includes(AUTO_PROMPT);
        if (a) {
          assert.equal(titleA++, 0);
        } else {
          assert.equal(titleB++, 0);
        }
        summary(body, a ? "title-A" : "title-B");
        return { text: "自动记忆验收" };
      }
      if (last === AUTO_PROMPT || last === AUTO_LABEL) {
        assert.equal(body.stream, true);
        assert.equal(body.model, "controlled");
        assert.deepEqual(
          [...system.matchAll(/^- Primary working directory: ([^\r\n]+)$/gm)].map((m) => m[1]),
          [workspacePath],
        );
        assert.equal(body.tools?.length, 32);
        assert.equal(body.tool_choice, "auto");
        if (last === AUTO_PROMPT) {
          assert.equal(mainA++, 0);
          mainTools = {
            sha256: macStageDigest(body.tools),
            names: body.tools.map((t) => t.function.name),
          };
          summary(body, "main-A");
        } else {
          assert.equal(sidecar, 2);
          assert.equal(mainB++, 0);
          const heading =
            "Contents of " + paths.index + " (user's auto-memory, persists across conversations):";
          assert.ok(
            body.messages.some((m) => text(m).includes(heading + "\n\n" + AUTO_INDEX.trim())),
            "New B must consume actual index fragment",
          );
          summary(body, "main-B");
        }
        return { text: "原生企业资产联动完成。" };
      }
      if (last === prompt) {
        assert.equal(mainA, 1);
        assert.equal(body.stream, false);
        assert.equal(body.model, "controlled");
        assert.notEqual(systemSha, TITLE_SHA);
        assert.deepEqual(
          [...system.matchAll(/^- Primary working directory: ([^\r\n]+)$/gm)].map((m) => m[1]),
          [workspacePath],
        );
        assert.ok(users.some((m) => text(m) === AUTO_PROMPT));
        assert.equal(body.tools?.length, 32);
        assert.equal(macStageDigest(body.tools), mainTools.sha256);
        assert.deepEqual(
          body.tools.map((t) => t.function.name),
          mainTools.names,
        );
        const writes = body.tools?.filter((t) => t.function?.name === "Write");
        assert.equal(writes?.length, 1);
        assert.equal(writes[0].function.parameters.properties.file_path.type, "string");
        assert.equal(writes[0].function.parameters.properties.content.type, "string");
        assert.equal(sidecar < 2, true);
        if (sidecar++ === 0) {
          assert.ok(
            !body.messages.some((m) => m.role === "tool" && AUTO_IDS.includes(m.tool_call_id)),
          );
          summary(body, "extract-plan");
          return {
            toolCalls: [
              [paths.index, AUTO_INDEX],
              [paths.topic, AUTO_TOPIC],
              [paths.outside, "Forbidden owned-case memory-root write\n"],
            ].map(([file_path, content], i) => ({
              id: AUTO_IDS[i],
              type: "function",
              function: {
                name: "Write",
                arguments: JSON.stringify({ file_path, content }),
              },
            })),
          };
        }
        const priorCalls = body.messages.filter(
          (m) => m.role === "assistant" && m.tool_calls?.some((c) => AUTO_IDS.includes(c.id)),
        );
        assert.equal(priorCalls.length, 1);
        assert.deepEqual(priorCalls[0].tool_calls.map((c) => c.id).sort(), [...AUTO_IDS].sort());
        priorCalls[0].tool_calls.forEach((c) => {
          const i = AUTO_IDS.indexOf(c.id);
          assert.equal(c.function.name, "Write");
          assert.deepEqual(JSON.parse(c.function.arguments), {
            file_path: [paths.index, paths.topic, paths.outside][i],
            content: [AUTO_INDEX, AUTO_TOPIC, "Forbidden owned-case memory-root write\n"][i],
          });
        });
        const tools = body.messages.filter((m) => m.role === "tool");
        assert.equal(tools.length, 3);
        assert.equal(new Set(tools.map((m) => m.tool_call_id)).size, 3);
        for (let i = 0; i < 2; i++)
          assert.ok(
            text(tools.find((m) => m.tool_call_id === AUTO_IDS[i])).includes(
              "File created successfully at: " + [paths.index, paths.topic][i],
            ),
          );
        const denial =
          "only Read, Grep, Glob, read-only Bash, and Edit/Write within " +
          paths.root +
          " are allowed";
        assert.ok(text(tools.find((m) => m.tool_call_id === AUTO_IDS[2])).includes(denial));
        summary(body, "extract-followup");
        return { text: "Owned Memory extraction complete." };
      }
      assert.ok(
        !last.startsWith("You are now acting as the memory extraction subagent."),
        "Extraction prompt must match the original source exactly",
      );
      return null;
    },
    safeStatus() {
      assert.equal(observerFailed, false, "Passive supplier receipt unavailable");
      return {
        mainA,
        mainB,
        sidecar,
        titleA,
        titleB,
        mainTools,
        receipts: structuredClone(receipts),
        promptSha256: digest(prompt),
        calls: [...AUTO_IDS],
        expectedSidecarTurns: 2,
        originalMaxTurns: 5,
        source: "Original natural extraction and tool executor; no fixture FS writes",
      };
    },
  };
}

/** Original UI ID + kernel-mapped private DB; no repository, migration, runtime getter or model send. */
export async function readAutoMemorySession({
  caseRoot,
  workspacePath,
  dbPath,
  sessionId,
  modelId,
  marker,
  enabled,
  expectedGate,
}) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  assert.ok(
    [
      join(caseRoot, "data/.zcode/cli/db/db.sqlite"),
      join(caseRoot, "data/.uwork/cli/db/db.sqlite"),
    ].includes(dbPath),
  );
  await regularFile(caseRoot, dbPath, false);
  const indexPath = join(caseRoot, "data/.uwork/v2/tasks-index.sqlite");
  await regularFile(caseRoot, indexPath, false);
  const { DatabaseSync } = await import("node:sqlite");
  const { MAC_TASK_SELECTS } = await import("./mac-completed-task-readonly.mjs");
  const { projectMemoryDurableRows } = await import("./mac-memory-stage-v16-readonly.mjs");
  let index, db, messages, modelWitness;
  try {
    index = new DatabaseSync(indexPath, { readOnly: true });
    const rows = index.prepare(MAC_TASK_SELECTS.index).all(sessionId);
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].workspace_identity);
    assert.equal(rows[0].workspace_path, workspacePath);
    assert.equal(rows[0].workspace_key, workspacePath);
    db = new DatabaseSync(dbPath, { readOnly: true });
    const sessions = db.prepare(MAC_TASK_SELECTS.session).all(sessionId);
    assert.equal(sessions.length, 1);
    assert.ok(!sessions[0].workspace_id);
    assert.equal(sessions[0].directory, workspacePath);
    assert.equal(sessions[0].path, workspacePath);
    messages = projectMemoryDurableRows(
      sessionId,
      db.prepare(MAC_TASK_SELECTS.messages).all(sessionId),
      db.prepare(MAC_TASK_SELECTS.parts).all(sessionId),
    );
    modelWitness = readSessionModelWitness({ db, sessionId, modelId, messages });
  } finally {
    db?.close();
    index?.close();
  }
  const user = messages.filter(
    (m) => m.info.role === "user" && !m.info.synthetic && m.info.visibility !== "model-only",
  );
  assert.equal(user.length, 1);
  const eligible = user[0].parts.filter((p) => p.type === "text" && !p.ignored && !p.synthetic);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].text, marker);
  const { createMemoryExtractionScheduler } =
    await import("../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts");
  let wouldRun = 0;
  const scheduler = createMemoryExtractionScheduler(async () => {
    wouldRun++;
    return "success";
  });
  try {
    scheduler.schedule({
      boundaryMessageId: messages.at(-1).info.id,
      durableMessages: messages,
      memoryRoot: autoMemoryPaths(caseRoot, workspacePath).root,
      workingDirectory: workspacePath,
      workspaceRoot: workspacePath,
    });
    await scheduler.drain();
    assert.equal(wouldRun, expectedGate);
    assert.equal(scheduler.getCursor(), messages.at(-1).info.id);
    assert.equal(scheduler.hasPendingWork(), false);
  } finally {
    scheduler.shutdown();
  }
  const { readdir } = await import("node:fs/promises");
  const logDir = join(caseRoot, "data/.uwork/cli/log");
  assert.equal(await realpath(logDir), logDir);
  const names = (await readdir(logDir)).filter((n) => /^zcode-[0-9-]+\.jsonl$/.test(n));
  assert.ok(names.length <= 8);
  let found;
  for (const n of names) {
    const path = join(logDir, n),
      st = await lstat(path);
    assert.ok(st.size < 16 * 1024 * 1024);
    for (const line of (await regularFile(caseRoot, path)).toString().split("\n")) {
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
        found = value.context;
    }
  }
  assert.ok(found);
  assert.equal(found.workingDirectory, workspacePath);
  assert.equal(found.memoryRoot, autoMemoryPaths(caseRoot, workspacePath).root);
  assert.equal(found.memoryEnabled, enabled);
  assert.equal(found.memoryUse, true);
  assert.equal(found.memoryExtractionEnabled, true);
  modelWitness = bindStartupModelWitness(found, modelWitness);
  return {
    sessionId,
    workspaceIdentity: null,
    modelWitness,
    memoryRoot: found.memoryRoot,
    memoryEnabled: enabled,
    memoryUse: true,
    memoryExtractionEnabled: true,
    gateOracleWouldExecute: expectedGate,
    durableRoles: messages.map((m) => m.info.role),
    userPromptWordCount: marker.split(/\s+/u).length,
    userPromptSha256: digest(marker),
    userPromptExact: true,
    databasePath: dbPath,
    source:
      "Fixed readonly original UI/session/log facts; pure gate oracle is distinct from actual sidecar HTTP execution",
  };
}
