import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertManifestAdmissionStage } from "./mac-memory-manifest-admission-stage.mjs";
const dir =
  "evidence/client-native-packaged-macos-clock-arm64-memory-manifest-filesystem-denied-v2-20261021/";
const evidence = JSON.parse(readFileSync(dir + "final-experience-proof.json"));
const requests = evidence.modelRequests;
const options = {
  fromCount: 4,
  filesystemAllowed: true,
  workspacePath: JSON.parse(readFileSync(dir + "memory-warm-proof.json"))
    .session.workingDirectory,
  prompt:
    "UWORK_NATIVE_MEMORY_MANIFEST_QUERY_20261021 retain project preference",
  description: "UWORK_NATIVE_MEMORY_MANIFEST_DESCRIPTION_20261021",
  expectedExtractionPrompt: requests[6].messages.at(-1).content,
  expectedMainReply: readFileSync(
    "scripts/fixtures/client-native-enterprise.mjs",
    "utf8",
  ).match(/: "(原生企业资产联动完成。)"\);/)[1],
};
test("actual Native leaked request has allow-stage main/title/natural sidecar structure", () => {
  const out = assertManifestAdmissionStage(requests, options);
  assert.equal(out.sidecarCount, 1);
  assert.equal(out.newRequestCount, 3);
  assert.equal(out.sidecarToolCount, 32);
  assert(!JSON.stringify(out).includes(options.description));
});
test("filesystem-denied stage rejects actual Native leak and accepts only unchanged ordinary main/title", () => {
  assert.throws(
    () =>
      assertManifestAdmissionStage(requests, {
        ...options,
        filesystemAllowed: false,
      }),
    /sidecar|request/i,
  );
  const out = assertManifestAdmissionStage(requests.slice(0, 6), {
    ...options,
    filesystemAllowed: false,
  });
  assert.equal(out.sidecarCount, 0);
  assert.equal(out.newRequestCount, 2);
});
test("description in ordinary main or title cannot stand in for a permitted sidecar", () => {
  for (const idx of [4, 5]) {
    const rows = structuredClone(requests);
    rows[idx].messages.at(-1).content += options.description;
    assert.throws(() => assertManifestAdmissionStage(rows, options));
  }
});
test("sidecar requires exact extraction prompt, full original catalog, original main prefix and no extra request", () => {
  for (const edit of [
    (q) => q.tools.pop(),
    (q) => (q.messages.at(-1).content += "extra"),
    (q) => (q.messages[0].content += "foreign"),
    (q) => (q.messages[2].content = "foreign"),
  ]) {
    const rows = structuredClone(requests);
    edit(rows[6]);
    assert.throws(() => assertManifestAdmissionStage(rows, options));
  }
  assert.throws(() =>
    assertManifestAdmissionStage([...requests, requests[6]], options),
  );
});
test("title can interleave with natural extraction without changing classification", () => {
  const rows = [...requests.slice(0, 5), requests[6], requests[5]];
  const out = assertManifestAdmissionStage(rows, options);
  assert.equal(out.sidecarCount, 1);
  assert.equal(out.main.index, 4);
  assert.equal(out.title.index, 6);
});

test("sidecar rejects a different completed assistant reply and any tool call", () => {
  for (const edit of [
    (q) => {
      q.messages.at(-2).content = "different reply";
    },
    (q) => {
      q.messages.at(-2).tool_calls = [{ id: "foreign" }];
    },
  ]) {
    const rows = structuredClone(requests);
    edit(rows[6]);
    assert.throws(() => assertManifestAdmissionStage(rows, options));
  }
});
