import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryExtractionOracle,
  AUTO_PROMPT,
  AUTO_BODY,
  AUTO_LABEL,
  AUTO_INDEX,
  AUTO_TOPIC,
  AUTO_IDS,
  autoMemoryPaths,
  attestAutoMemoryFiles,
  assertAutoFilesAbsent,
} from "./mac-memory-extraction-oracle.mjs";
import { buildMemoryExtractionPrompt } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts";
import { stampMemoryOriginSessionId } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/origin-session.ts";
const root = "/owned",
  workspace = join(root, "packaged-workspace");
const tools = Array.from({ length: 32 }, (_, i) => ({
  type: "function",
  function: {
    name: i ? "tool" + i : "Write",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content: { type: "string" },
      },
    },
  },
}));
const system =
  "Original system\n- Primary working directory: " + workspace + "\n";
const main = (prompt) => ({
  model: "controlled",
  stream: true,
  messages: [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ],
  tools,
  tool_choice: "auto",
});
const titleSystem = readFileSync(
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts",
  "utf8",
).match(/const SESSION_TITLE_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
const title = (prompt) => ({
  model: "controlled",
  stream: false,
  messages: [
    { role: "system", content: titleSystem },
    { role: "user", content: prompt },
  ],
});
function setup() {
  const oracle = createMemoryExtractionOracle({
    caseRoot: root,
    workspacePath: workspace,
  });
  oracle.reply(main(AUTO_PROMPT));
  const first = {
    ...main(AUTO_PROMPT),
    stream: false,
    messages: [
      ...main(AUTO_PROMPT).messages,
      { role: "assistant", content: "原生企业资产联动完成。" },
      {
        role: "user",
        content: buildMemoryExtractionPrompt({ manifest: [], messageCount: 2 }),
      },
    ],
  };
  const reply = oracle.reply(first);
  const paths = autoMemoryPaths(root, workspace);
  const outputs = [
    "File created successfully at: " + paths.index,
    "File created successfully at: " + paths.topic,
    "only Read, Grep, Glob, read-only Bash, and Edit/Write within " +
      paths.root +
      " are allowed",
  ];
  const second = {
    ...first,
    messages: [
      ...first.messages,
      { role: "assistant", content: null, tool_calls: reply.toolCalls },
      ...AUTO_IDS.map((id, i) => ({
        role: "tool",
        tool_call_id: id,
        content: outputs[i],
      })),
    ],
  };
  return { oracle, reply, first, second, paths };
}
test("exact main/title, original extraction prompt and same-id three toolresults naturally end two turns", () => {
  const { oracle, reply, second, paths } = setup();
  assert.equal(reply.toolCalls.length, 3);
  assert.deepEqual(
    reply.toolCalls.map((c) => c.function.name),
    ["Write", "Write", "Write"],
  );
  assert.equal(
    JSON.parse(reply.toolCalls[2].function.arguments).file_path,
    join(root, "owned-outside-memory.md"),
  );
  assert.equal(oracle.reply(second).text, "Owned Memory extraction complete.");
  oracle.reply(title(AUTO_PROMPT));
  const b = main(AUTO_LABEL);
  b.messages.splice(1, 0, {
    role: "user",
    content:
      "Contents of " +
      paths.index +
      " (user's auto-memory, persists across conversations):\n\n" +
      AUTO_INDEX.trim(),
  });
  oracle.reply(b);
  oracle.reply(title(AUTO_LABEL));
  const status = oracle.safeStatus();
  assert.deepEqual(
    [status.mainA, status.mainB, status.sidecar, status.titleA, status.titleB],
    [1, 1, 2, 1, 1],
  );
  assert.equal(status.receipts.length, 6);
  assert(!JSON.stringify(status).includes(AUTO_BODY));
  assert.throws(() => oracle.reply(second));
});
test("wrong call id, false write success, missing denial, wrong prompt or title substitute cannot complete", () => {
  for (const change of [
    (s) => (s.messages.at(-1).tool_call_id = "foreign"),
    (s) => (s.messages.at(-3).content = "fake success"),
    (s) => (s.messages.at(-1).content = "File created successfully"),
    (s) => (s.messages.findLast((m) => m.role === "user").content += " extra"),
  ]) {
    const { oracle, second } = setup();
    change(second);
    assert.throws(() => oracle.reply(second));
  }
  const { oracle } = setup();
  oracle.reply(title(AUTO_LABEL));
  assert.throws(() => oracle.reply(main(AUTO_LABEL)));
  assert.throws(() =>
    oracle.reply({
      ...main(AUTO_PROMPT),
      messages: [
        { role: "system", content: system.replace(workspace, "/foreign") },
        { role: "user", content: AUTO_PROMPT },
      ],
    }),
  );
});
test("regular actual private files attest stamped original session and forbidden file absence", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-auto-memory-")),
    ),
    workspace = join(root, "packaged-workspace"),
    paths = autoMemoryPaths(root, workspace),
    sid = "sess_owned";
  try {
    await assertAutoFilesAbsent(root, workspace);
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.index, AUTO_INDEX);
    await writeFile(
      paths.topic,
      stampMemoryOriginSessionId({
        content: AUTO_TOPIC,
        filePath: paths.topic,
        memoryRoot: paths.root,
        sessionId: sid,
      }),
    );
    const files = await attestAutoMemoryFiles(root, workspace, sid);
    assert.equal(files.topic.originSessionId, sid);
    assert.equal(files.outsideAbsent, true);
    await assert.rejects(() =>
      attestAutoMemoryFiles(root, workspace, "sess_foreign"),
    );
    await writeFile(paths.outside, "unexpected");
    await assert.rejects(() => attestAutoMemoryFiles(root, workspace, sid));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual original Memory loop permits two roots, blocks external Write before executor and stops after no-tool result", async () => {
  const { runMemoryAgentLoop } = await import(
    "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/memory-agent-loop.ts"
  );
  const { reply, first, paths } = setup();
  let requests = 0;
  const executions = [];
  const model = {
    properties: { inputFormat: ["text"] },
    optionSpecs: {
      reasoningLevel: { values: ["none"] },
      maxOutputTokens: { max: 1024 },
    },
    async generateText(request) {
      requests++;
      assert.equal(request.tools.length, 32);
      if (requests === 1)
        return {
          text: "",
          toolCalls: reply.toolCalls.map((c) => ({
            id: c.id,
            name: c.function.name,
            input: JSON.parse(c.function.arguments),
          })),
        };
      const results = request.messages.filter((m) => m.role === "tool");
      assert.equal(results.length, 3);
      assert.equal(
        results.find((m) => m.toolCallId === AUTO_IDS[2]).isError,
        true,
      );
      return { text: "done", toolCalls: [] };
    },
  };
  const result = await runMemoryAgentLoop({
    maxTurns: 5,
    messages: first.messages,
    model,
    rootDir: paths.root,
    workingDirectory: workspace,
    workspaceRoot: workspace,
    tools: tools.map((t) => ({
      name: t.function.name,
      inputSchema: t.function.parameters,
      description: "owned",
      sideEffectScope: "workspace",
    })),
    executeTool: async (call) => {
      executions.push(call.id);
      return {
        success: true,
        toolName: call.name,
        toolCallId: call.id,
        modelContent: "File created successfully at: " + call.input.file_path,
      };
    },
  });
  assert.equal(requests, 2);
  assert.equal(result.turns, 2);
  assert.deepEqual(executions, AUTO_IDS.slice(0, 2));
});
test("sidecar must retain original full tool catalog; passive receipt errors cannot break HTTP observer callbacks", async () => {
  const { oracle, first } = setup();
  const changed = structuredClone(first);
  changed.tools[2].function.parameters.properties.content.type = "number";
  assert.throws(() => oracle.reply(changed));
  const { EventEmitter } = await import("node:events");
  const o = createMemoryExtractionOracle({
    caseRoot: root,
    workspacePath: workspace,
  });
  o.reply(main(AUTO_PROMPT));
  const response = new EventEmitter();
  Object.defineProperty(response, "statusCode", {
    get() {
      throw Error("observer-only");
    },
  });
  o.observeResponse(response);
  assert.doesNotThrow(() => response.emit("finish"));
  assert.throws(() => o.safeStatus(), /Passive supplier/);
});
