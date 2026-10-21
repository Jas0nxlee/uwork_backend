/** Test-only controlled supplier and readonly request projection. No runtime sender or store mutation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
export const WARM_PREFIX = "MACOS_CLOCK_LINK_20261020";
export const WARM_REPLY =
  "原生企业资产联动完成。 UWORK_MESSAGE_WARM_REPLY_20261021";
export const EDIT_PROMPT = "UWORK_NATIVE_MESSAGE_EDIT_QUERY_20261021";
export const EDIT_REPLY =
  "原生企业资产联动完成。 UWORK_MESSAGE_EDIT_REPLY_20261021";
export const CHILD_PROMPT = "UWORK_NATIVE_MESSAGE_CHILD_QUERY_20261021";
export const CHILD_REPLY =
  "原生企业资产联动完成。 UWORK_MESSAGE_CHILD_REPLY_20261021";
const TITLE_SHA =
  "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
function mainRequest(body, workspacePath, marker) {
  assert.equal(body.model, "controlled");
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.messages));
  const systems = body.messages.filter((m) => m.role === "system");
  assert.equal(systems.length, 1);
  const system = text(systems[0]);
  assert.notEqual(sha(system), TITLE_SHA);
  assert.deepEqual(
    [...system.matchAll(/^- Primary working directory: ([^\r\n]+)$/gm)].map(
      (m) => m[1],
    ),
    [workspacePath],
  );
  assert.ok(
    body.messages
      .filter((m) => m.role === "user")
      .some((m) => text(m).includes(marker)),
    "Original stage user intent required",
  );
  assert.equal(body.tools?.length, 32);
  assert.equal(body.tool_choice, "auto");
  return {
    requestSha256: macStageDigest(body),
    systemSha256: sha(system),
    stream: true,
    toolCount: 32,
    cwdMatches: true,
  };
}
export function projectMessageLifecycleStage(
  requests,
  { phase, fromIndex, workspacePath },
) {
  assert.ok(["edit", "fork", "child"].includes(phase));
  assert.ok(Number.isSafeInteger(fromIndex) && fromIndex >= 0);
  assert.ok(
    typeof workspacePath === "string" &&
      workspacePath.startsWith("/") &&
      !/[\r\n]/.test(workspacePath),
  );
  assert.ok(Array.isArray(requests));
  const newRequests = phase === "fork" ? 0 : 1;
  assert.equal(
    requests.length,
    fromIndex + newRequests,
    "Unexpected title/replay/extra request in lifecycle stage",
  );
  if (phase === "fork")
    return {
      phase,
      fromIndex,
      toIndex: requests.length,
      newRequests: 0,
      inferenceUnchanged: true,
    };
  const body = requests[fromIndex];
  const marker = phase === "edit" ? EDIT_PROMPT : CHILD_PROMPT;
  const safe = mainRequest(body, workspacePath, marker);
  const all = body.messages.map(text);
  assert.ok(
    all.every(
      (value) => !value.includes(WARM_PREFIX) && !value.includes(WARM_REPLY),
    ),
    "Reverted warm branch must not re-enter active provider context",
  );
  if (phase === "edit")
    assert.ok(
      all.every(
        (value) => !value.includes(EDIT_REPLY) && !value.includes(CHILD_PROMPT),
      ),
      "New edit response must not already be in request history",
    );
  else {
    assert.ok(
      body.messages.some(
        (m) => m.role === "user" && text(m).includes(EDIT_PROMPT),
      ),
      "Child must inherit edited user intent",
    );
    assert.ok(
      body.messages.some(
        (m) => m.role === "assistant" && text(m).includes(EDIT_REPLY),
      ),
      "Child must inherit edited assistant result",
    );
  }
  return {
    phase,
    fromIndex,
    toIndex: requests.length,
    newRequests: 1,
    ...safe,
    activeEditedHistoryInherited: phase === "child",
  };
}
export function createMessageLifecycleSupplier() {
  const counts = { warm: 0, edit: 0, child: 0 };
  const receipts = [];
  return {
    reply(body) {
      if (body.stream !== true) return null;
      const last = text(body.messages?.filter((m) => m.role === "user").at(-1));
      const stage = last.includes(CHILD_PROMPT)
        ? "child"
        : last.includes(EDIT_PROMPT)
          ? "edit"
          : last.includes(WARM_PREFIX)
            ? "warm"
            : null;
      if (!stage) return null;
      counts[stage]++;
      receipts.push({
        stage,
        requestSha256: macStageDigest(body),
        stream: true,
      });
      return {
        text:
          stage === "warm"
            ? WARM_REPLY
            : stage === "edit"
              ? EDIT_REPLY
              : CHILD_REPLY,
      };
    },
    safeStatus() {
      return {
        counts: { ...counts },
        receipts: structuredClone(receipts),
        scope:
          "Controlled response text only; stage assertions use complete original supplier request collection",
      };
    },
  };
}
