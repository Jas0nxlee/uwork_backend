/** Readonly future Native stage assertions; no issuer, sender, runtime drain or fixture entry. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { projectCapabilitySupplierRequests } from "./mac-model-capability-stage.mjs";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const TITLE_SHA =
  "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383";
const content = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
export function assertManifestAdmissionStage(
  requests,
  {
    fromCount,
    filesystemAllowed,
    workspacePath,
    prompt,
    description,
    expectedExtractionPrompt,
    expectedMainReply,
  },
) {
  assert(Array.isArray(requests));
  assert(Number.isSafeInteger(fromCount) && fromCount >= 0);
  assert.equal(typeof filesystemAllowed, "boolean");
  assert(typeof prompt === "string" && prompt.trim().split(/\s+/).length >= 3);
  assert(
    typeof description === "string" &&
      description.length > 0 &&
      !prompt.includes(description),
  );
  assert(
    typeof expectedExtractionPrompt === "string" &&
      expectedExtractionPrompt.includes(description) &&
      expectedExtractionPrompt.startsWith(
        "You are now acting as the memory extraction subagent.",
      ),
  );
  assert(typeof expectedMainReply === "string" && expectedMainReply.length > 0);
  const stage = requests.slice(fromCount);
  assert.equal(
    stage.length,
    filesystemAllowed ? 3 : 2,
    "Exact ordinary pair and allowed sidecar request count",
  );
  const indexed = stage.map((q, i) => ({ q, index: fromCount + i }));
  const titles = indexed.filter(
    ({ q }) =>
      q.stream === false &&
      sha(content(q.messages?.find((m) => m.role === "system"))) === TITLE_SHA,
  );
  const mains = indexed.filter(({ q }) => q.stream === true);
  assert.equal(titles.length, 1);
  assert.equal(mains.length, 1);
  const main = mains[0],
    title = titles[0];
  for (const { q } of [main, title]) {
    assert(
      !JSON.stringify(q).includes(description),
      "Description must not reach ordinary main/title",
    );
    assert(
      q.messages.some((m) => m.role === "user" && content(m) === prompt),
      "Exact original user prompt required",
    );
  }
  const pair = projectCapabilitySupplierRequests([main.q, title.q], {
    fromIndex: 0,
    workspacePath,
    marker: prompt,
    expectedTools: 32,
  });
  const sides = indexed.filter((x) => x !== main && x !== title);
  let sidecar;
  if (filesystemAllowed) {
    assert.equal(sides.length, 1);
    sidecar = sides[0].q;
    assert.equal(sidecar.stream, false);
    assert.equal(sidecar.model, main.q.model);
    assert.equal(sidecar.tools?.length, 32);
    assert.equal(macStageDigest(sidecar.tools), macStageDigest(main.q.tools));
    assert.equal(sidecar.tool_choice, main.q.tool_choice);
    assert.equal(sidecar.messages.length, main.q.messages.length + 2);
    assert.deepEqual(
      sidecar.messages.slice(0, main.q.messages.length),
      main.q.messages,
    );
    const reply = sidecar.messages.at(-2);
    assert.equal(reply.role, "assistant");
    assert.equal(
      content(reply),
      expectedMainReply,
      "Original completed main reply required",
    );
    assert(
      !Object.hasOwn(reply, "tool_calls") ||
        (Array.isArray(reply.tool_calls) && reply.tool_calls.length === 0),
      "Normal main reply cannot contain tool calls",
    );
    assert.equal(sidecar.messages.at(-1).role, "user");
    assert.equal(content(sidecar.messages.at(-1)), expectedExtractionPrompt);
    assert.equal(
      sidecar.messages.filter((m) => content(m).includes(description)).length,
      1,
    );
  } else {
    assert.equal(sides.length, 0);
    assert(
      stage.every((q) => !JSON.stringify(q).includes(description)),
      "No local description may reach any denied stage payload",
    );
  }
  return {
    filesystemAllowed,
    newRequestCount: stage.length,
    main: { index: main.index, requestDigest: macStageDigest(main.q) },
    title: { index: title.index, requestDigest: macStageDigest(title.q) },
    ordinaryPair: pair,
    sidecarCount: sides.length,
    sidecarToolCount: sidecar?.tools.length ?? 0,
    sidecarRequestDigest: sidecar ? macStageDigest(sidecar) : null,
    expectedExtractionPromptSha256: sha(expectedExtractionPrompt),
  };
}
