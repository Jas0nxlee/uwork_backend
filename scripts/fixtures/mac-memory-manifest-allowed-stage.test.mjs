import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expectedAllowedManifestPrompt,
  projectAllowedSdkStop,
} from "./mac-memory-manifest-allowed-stage.mjs";
import {
  TOPIC_TEXT,
  MANIFEST_MARKER,
} from "./mac-memory-manifest-v16-denied-derived.mjs";
import { buildMemoryExtractionPrompt } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts";
const event = () => ({
  sessionId: "sess_owned",
  event: "model.sdk.generate.completed",
  context: {
    querySource: "project_memory_extract",
    providerId: "ucas",
    modelId: "owned",
    requestId: "owned-request",
    finishReason: "stop",
    toolCallCount: 0,
  },
});
test("real sole154B topic metadata/mtime goes through original prompt builder; no index", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "owned-allowed-manifest-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "data/.uwork/cli/memories/projects/owned/memory");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "owned-manifest-topic.md");
  await writeFile(path, TOPIC_TEXT, { flag: "wx", mode: 0o600 });
  assert.equal(Buffer.byteLength(TOPIC_TEXT), 154);
  const out = await expectedAllowedManifestPrompt({
    caseRoot: root,
    file: { filePath: path },
  });
  assert.equal(
    out.prompt,
    buildMemoryExtractionPrompt({
      manifest: [
        {
          description: MANIFEST_MARKER,
          filePath: path,
          filename: "owned-manifest-topic.md",
          mtimeMs: out.mtimeMs,
          type: "project",
        },
      ],
      messageCount: 2,
    }),
  );
  assert.equal(out.manifestCount, 1);
  assert.equal(out.messageCount, 2);
  await writeFile(join(dir, "MEMORY.md"), "forbidden index");
  await assert.rejects(
    expectedAllowedManifestPrompt({ caseRoot: root, file: { filePath: path } }),
  );
});
test("exact SDK source/session/model stop0 safe receipt excludes body/env", () => {
  const out = projectAllowedSdkStop(
    [
      event(),
      {
        ...event(),
        context: { ...event().context, querySource: "session_title" },
      },
    ],
    { sessionId: "sess_owned", modelId: "owned" },
  );
  assert.equal(out.finishReason, "stop");
  assert.equal(out.toolCallCount, 0);
  assert(!JSON.stringify(out).includes("owned-request"));
});
for (const mutation of [
  "missing",
  "duplicate",
  "wrong-source",
  "wrong-model",
  "wrong-provider",
  "tool",
  "not-stop",
])
  test("SDK receipt rejects " + mutation, () => {
    const e = event();
    let rows = [e];
    if (mutation === "missing") rows = [];
    if (mutation === "duplicate") rows.push(event());
    if (mutation === "wrong-source") e.context.querySource = "session_title";
    if (mutation === "wrong-model") e.context.modelId = "other";
    if (mutation === "wrong-provider") e.context.providerId = "other";
    if (mutation === "tool") e.context.toolCallCount = 1;
    if (mutation === "not-stop") e.context.finishReason = "length";
    assert.throws(() =>
      projectAllowedSdkStop(rows, {
        sessionId: "sess_owned",
        modelId: "owned",
      }),
    );
  });
