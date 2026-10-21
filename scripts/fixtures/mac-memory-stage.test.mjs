import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryExtractionScheduler } from "../../clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts";
import {
  MEMORY_BODY,
  MEMORY_LABELS,
  attestMemoryInput,
  ownedMemoryPath,
  projectMemoryStageRequests,
  projectMemoryDurableRows,
} from "./mac-memory-stage.mjs";
test("actual scheduler skips single-word durable UI user text and synthetic context; prose positive control runs", async () => {
  for (const label of MEMORY_LABELS.slice(1)) {
    let calls = 0;
    const scheduler = createMemoryExtractionScheduler(async () => {
      calls++;
      return "success";
    });
    const messages = [
      {
        info: { id: "meta", role: "user", visibility: "model-only" },
        parts: [{ type: "text", text: "three synthetic context words" }],
      },
      {
        info: { id: "user", role: "user" },
        parts: [
          { type: "text", text: label },
          {
            type: "text",
            text: "other synthetic context words",
            synthetic: true,
          },
          { type: "text", text: "ignored context words", ignored: true },
        ],
      },
      {
        info: { id: "assistant", role: "assistant" },
        parts: [{ type: "text", text: "原生企业资产联动完成。" }],
      },
    ];
    scheduler.schedule({
      boundaryMessageId: "assistant",
      durableMessages: messages,
      memoryRoot: "/owned/memory",
      workingDirectory: "/owned/work",
      workspaceRoot: "/owned/work",
    });
    await scheduler.drain();
    assert.equal(calls, 0);
    assert.equal(scheduler.getCursor(), "assistant");
    assert.equal(scheduler.hasPendingWork(), false);
    scheduler.shutdown();
    messages[1].parts[0].text = "three actual words";
    const control = createMemoryExtractionScheduler(async () => {
      calls++;
      return "success";
    });
    control.schedule({
      boundaryMessageId: "assistant",
      durableMessages: messages,
      memoryRoot: "/owned/memory",
      workingDirectory: "/owned/work",
      workspaceRoot: "/owned/work",
    });
    await control.drain();
    assert.equal(calls, 1);
    control.shutdown();
  }
});
test("canonical private memory input exact bytes and symlink rejection", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-memory-owned-")),
  );
  try {
    const file = ownedMemoryPath(root, join(root, "packaged-workspace"));
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, MEMORY_BODY + "\n", { flag: "wx" });
    const proof = await attestMemoryInput(
      root,
      join(root, "packaged-workspace"),
    );
    assert.equal(proof.regularFile, true);
    await rm(file);
    await symlink("/dev/null", file);
    await assert.rejects(() =>
      attestMemoryInput(root, join(root, "packaged-workspace")),
    );
    assert.throws(() => ownedMemoryPath(root, "/other/workspace"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const workspacePath = "/owned/packaged-workspace",
  caseRoot = "/owned",
  marker = "SINGLE_STAGE";
const titleSystem = readFileSync(
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts",
  "utf8",
).match(/const SESSION_TITLE_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
function pair(memoryText) {
  return [
    {
      model: "controlled",
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "Original system\n- Primary working directory: " +
            workspacePath +
            "\n",
        },
        ...(memoryText ? [{ role: "user", content: memoryText }] : []),
        { role: "user", content: marker },
      ],
      tools: Array.from({ length: 32 }, (_, i) => ({
        type: "function",
        function: { name: "tool" + i },
      })),
      tool_choice: "auto",
    },
    {
      model: "controlled",
      stream: false,
      messages: [
        { role: "system", content: titleSystem },
        { role: "user", content: marker },
      ],
    },
  ];
}
const heading =
  "Contents of " +
  ownedMemoryPath(caseRoot, workspacePath) +
  " (user's auto-memory, persists across conversations):";
const options = { fromIndex: 0, workspacePath, caseRoot, marker };
test("actual-shaped main Memory continuous fragment on and no fragment off succeed", () => {
  const on = projectMemoryStageRequests(pair(heading + "\n\n" + MEMORY_BODY), {
    ...options,
    enabled: true,
  });
  assert.equal(on.memoryFragmentMatched, true);
  assert.equal(on.main.toolCount, 32);
  assert.equal(on.main.stream, true);
  const off = projectMemoryStageRequests(pair(), {
    ...options,
    enabled: false,
  });
  assert.equal(off.memoryFragmentMatched, false);
  assert.equal(off.title.stream, false);
  assert(!JSON.stringify(on).includes(heading));
});
test("title-only/foreign heading/noncontinuous body/extra extraction and off leakage all reject", () => {
  const titleOnly = pair();
  titleOnly[1].messages[1].content += " " + heading + "\n\n" + MEMORY_BODY;
  for (const rows of [
    titleOnly,
    pair(heading.replace("/owned/", "/foreign/") + "\n\n" + MEMORY_BODY),
    pair(heading + "\nnot-contiguous\n" + MEMORY_BODY),
    [...pair(heading + "\n\n" + MEMORY_BODY), structuredClone(pair()[0])],
  ])
    assert.throws(() =>
      projectMemoryStageRequests(rows, { ...options, enabled: true }),
    );
  assert.throws(() =>
    projectMemoryStageRequests(pair(heading + "\n\n" + MEMORY_BODY), {
      ...options,
      enabled: false,
    }),
  );
});

test("original SQLite data without info.id projects authoritative row IDs into real scheduler contract", async () => {
  const sid = "sess_owned";
  const rows = [
    { id: "usr", data: JSON.stringify({ role: "user", time: { created: 1 } }) },
    {
      id: "asst",
      data: JSON.stringify({
        role: "assistant",
        time: { created: 2, completed: 3 },
      }),
    },
  ];
  const parts = [
    {
      message_id: "usr",
      data: JSON.stringify({ type: "text", text: MEMORY_LABELS[2] }),
    },
    {
      message_id: "asst",
      data: JSON.stringify({ type: "text", text: "原生企业资产联动完成。" }),
    },
  ];
  const messages = projectMemoryDurableRows(sid, rows, parts);
  assert.equal(messages[0].info.id, "usr");
  assert.equal(messages[1].info.id, "asst");
  assert(messages.every((m) => m.info.sessionID === sid));
  let calls = 0;
  const scheduler = createMemoryExtractionScheduler(async () => {
    calls++;
    return "success";
  });
  scheduler.schedule({
    boundaryMessageId: "asst",
    durableMessages: messages,
    memoryRoot: "/owned/memory",
    workingDirectory: "/owned/work",
    workspaceRoot: "/owned/work",
  });
  await scheduler.drain();
  assert.equal(calls, 0);
  assert.equal(scheduler.getCursor(), "asst");
  assert.equal(scheduler.hasPendingWork(), false);
  scheduler.shutdown();
  assert.throws(() =>
    projectMemoryDurableRows(
      sid,
      [
        { ...rows[0], data: JSON.stringify({ role: "user", id: "foreign" }) },
        rows[1],
      ],
      parts,
    ),
  );
});
