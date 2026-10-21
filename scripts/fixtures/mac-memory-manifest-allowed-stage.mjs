/** Test-only original prompt builder and bounded own-case SDK log receipt; no sender/drain. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { buildMemoryExtractionPrompt } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts";
import {
  MANIFEST_MARKER,
  TOPIC_NAME,
  TOPIC_TEXT,
} from "./mac-memory-manifest-v16-denied-derived.mjs";
export { assertManifestAdmissionStage } from "./mac-memory-manifest-admission-stage.mjs";
export async function expectedAllowedManifestPrompt({ caseRoot, file }) {
  assert.equal(await realpath(caseRoot), caseRoot);
  assert.equal(resolve(file.filePath), file.filePath);
  assert(
    file.filePath.startsWith(
      join(caseRoot, "data/.uwork/cli/memories/projects") + "/",
    ),
  );
  assert.equal(basename(file.filePath), TOPIC_NAME);
  assert.deepEqual((await readdir(dirname(file.filePath))).sort(), [
    TOPIC_NAME,
  ]);
  const st = await lstat(file.filePath);
  assert(st.isFile() && !st.isSymbolicLink());
  assert.equal(await realpath(file.filePath), file.filePath);
  assert.equal(await readFile(file.filePath, "utf8"), TOPIC_TEXT);
  const manifest = [
    {
      description: MANIFEST_MARKER,
      filePath: file.filePath,
      filename: TOPIC_NAME,
      mtimeMs: st.mtimeMs,
      type: "project",
    },
  ];
  return {
    prompt: buildMemoryExtractionPrompt({ manifest, messageCount: 2 }),
    mtimeMs: st.mtimeMs,
    manifestCount: 1,
    messageCount: 2,
  };
}
export function projectAllowedSdkStop(rows, { sessionId, modelId }) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  const completed = rows.filter(
    (v) =>
      v.sessionId === sessionId &&
      v.event === "model.sdk.generate.completed" &&
      v.context?.querySource === "project_memory_extract",
  );
  assert.equal(
    completed.length,
    1,
    "Exactly one same-session extraction SDK completion required",
  );
  const c = completed[0].context;
  assert.equal(c.providerId, "ucas");
  assert.equal(c.modelId, modelId);
  assert.equal(c.finishReason, "stop");
  assert.equal(c.toolCallCount, 0);
  assert.equal(typeof c.requestId, "string");
  assert(c.requestId.length > 0);
  return {
    sessionId,
    providerId: c.providerId,
    modelId: c.modelId,
    querySource: c.querySource,
    finishReason: c.finishReason,
    toolCallCount: c.toolCallCount,
    requestIdDigest: createHash("sha256").update(c.requestId).digest("hex"),
  };
}
export async function readAllowedSdkStop({
  caseRoot,
  sessionId,
  modelId,
  allowPending = false,
}) {
  const dir = join(caseRoot, "data/.uwork/cli/log");
  assert.equal(await realpath(dir), dir);
  assert(!(await lstat(dir)).isSymbolicLink());
  const names = (await readdir(dir)).filter((n) =>
    /^zcode-[0-9-]+\.jsonl$/.test(n),
  );
  assert(names.length > 0 && names.length <= 8);
  const rows = [];
  for (const name of names) {
    const path = join(dir, name),
      st = await lstat(path);
    assert(st.isFile() && !st.isSymbolicLink() && st.size < 16 * 1024 * 1024);
    assert.equal(await realpath(path), path);
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      try {
        const row = JSON.parse(line);
        if (
          row.sessionId === sessionId &&
          row.event === "model.sdk.generate.completed"
        )
          rows.push(row);
      } catch {}
    }
  }
  if (
    allowPending &&
    rows.filter((v) => v.context?.querySource === "project_memory_extract")
      .length === 0
  )
    return null;
  return projectAllowedSdkStop(rows, { sessionId, modelId });
}
