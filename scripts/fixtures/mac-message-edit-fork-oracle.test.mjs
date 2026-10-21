import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRootTraceContext } from "@zcode/contracts";
import { maybeStartDeferredSessionTitleGeneration } from "../../clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/session-title.ts";
import {
  EDIT_PROMPT,
  EDIT_REPLY,
  CHILD_PROMPT,
  WARM_PREFIX,
  WARM_REPLY,
  createMessageLifecycleSupplier,
  projectMessageLifecycleStage,
} from "./mac-message-edit-fork-oracle.mjs";
const workspacePath = "/owned/packaged-workspace";
function main(query, history = []) {
  return {
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
      ...history,
      { role: "user", content: query },
    ],
    tools: Array.from({ length: 32 }, (_, i) => ({
      type: "function",
      function: { name: "owned" + i },
    })),
    tool_choice: "auto",
  };
}
const options = { fromIndex: 4, workspacePath };
test("edit emits one main; fork none; child emits one main with only active edited history", () => {
  const edited = projectMessageLifecycleStage(
    [{}, {}, {}, {}, main(EDIT_PROMPT)],
    { ...options, phase: "edit" },
  );
  assert.equal(edited.newRequests, 1);
  const fork = projectMessageLifecycleStage([{}, {}, {}, {}, {}], {
    ...options,
    fromIndex: 5,
    phase: "fork",
  });
  assert.equal(fork.newRequests, 0);
  const child = main(CHILD_PROMPT, [
    { role: "user", content: EDIT_PROMPT },
    { role: "assistant", content: EDIT_REPLY },
  ]);
  assert.equal(
    projectMessageLifecycleStage([{}, {}, {}, {}, {}, child], {
      ...options,
      fromIndex: 5,
      phase: "child",
    }).activeEditedHistoryInherited,
    true,
  );
});
test("extra title/replayed request, old warm branch, wrong cwd, missing child history reject", () => {
  for (const rows of [
    [main(EDIT_PROMPT), main(EDIT_PROMPT)],
    [{ ...main(EDIT_PROMPT), stream: false }],
    [main(EDIT_PROMPT, [{ role: "assistant", content: WARM_REPLY }])],
    [main(EDIT_PROMPT, [{ role: "user", content: WARM_PREFIX }])],
    [main(EDIT_PROMPT.replace("EDIT", "OTHER"))],
    [
      {
        ...main(EDIT_PROMPT),
        messages: [
          { role: "system", content: "- Primary working directory: /foreign" },
          { role: "user", content: EDIT_PROMPT },
        ],
      },
    ],
  ])
    assert.throws(() =>
      projectMessageLifecycleStage([{}, {}, {}, {}, ...rows], {
        ...options,
        phase: "edit",
      }),
    );
  assert.throws(() =>
    projectMessageLifecycleStage([{}, {}, {}, {}, main(CHILD_PROMPT)], {
      ...options,
      phase: "child",
    }),
  );
  assert.throws(() =>
    projectMessageLifecycleStage([{}, {}, {}, {}, main(EDIT_PROMPT)], {
      ...options,
      phase: "fork",
    }),
  );
});
test("controlled supplier returns ordinary text, delegates seed/title and records safe digests only", () => {
  const supplier = createMessageLifecycleSupplier();
  assert.equal(
    supplier.reply({
      stream: false,
      messages: [{ role: "user", content: "other-user-test" }],
    }),
    null,
  );
  assert.equal(
    supplier.reply(main(WARM_PREFIX + " 请简短回复，不调用工具。")).text,
    WARM_REPLY,
  );
  assert.equal(supplier.reply(main(EDIT_PROMPT)).text, EDIT_REPLY);
  assert.ok(
    supplier.reply(main(CHILD_PROMPT)).text.includes("原生企业资产联动完成。"),
  );
  const status = supplier.safeStatus();
  assert.deepEqual(status.counts, { warm: 1, edit: 1, child: 1 });
  assert.ok(!JSON.stringify(status).includes(workspacePath));
  assert.ok(!JSON.stringify(status).includes(EDIT_PROMPT));
});
test("actual original title guard skips edited live parent and fork child; eligible parent positive control schedules", async () => {
  const trace = createRootTraceContext();
  const check = async (overrides) => {
    const pending = [];
    let reads = 0;
    const runtime = {
      sessionTitleGenerationAttempted: false,
      turnNumber: 0,
      config: { titleGeneration: { enabled: true } },
      sessionStore: {
        getSession: async () => {
          reads++;
          return null;
        },
      },
      agentTelemetry: { captureCausation: () => undefined },
      trackResidencyBlockingWork: (p) => {
        pending.push(p);
        return p;
      },
      ...overrides,
    };
    const started = maybeStartDeferredSessionTitleGeneration.call(
      runtime,
      EDIT_PROMPT,
      "owned-message",
      trace,
    );
    await Promise.all(pending);
    return { started, reads, scheduled: pending.length };
  };
  assert.deepEqual(await check({ sessionTitleGenerationAttempted: true }), {
    started: false,
    reads: 0,
    scheduled: 0,
  });
  assert.deepEqual(
    await check({
      config: { titleGeneration: { enabled: true }, parentSessionId: "parent" },
    }),
    { started: false, reads: 0, scheduled: 0 },
  );
  assert.deepEqual(
    await check({
      config: { titleGeneration: { enabled: true }, taskType: "fork" },
    }),
    { started: false, reads: 0, scheduled: 0 },
  );
  assert.deepEqual(await check({}), { started: true, reads: 1, scheduled: 1 });
  const rewind = readFileSync(
    "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/rewind-message.ts",
    "utf8",
  );
  assert.ok(!rewind.includes("sessionTitleGenerationAttempted"));
});
