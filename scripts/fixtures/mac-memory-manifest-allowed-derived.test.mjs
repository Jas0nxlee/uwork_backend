/** Execute actual derived command branch with bounded data-only collaborators; no Common entry. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "acorn";
import { deriveAllowedManifestFixture } from "./mac-memory-manifest-allowed-derived.mjs";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
import { assertManifestAdmissionStage } from "./mac-memory-manifest-admission-stage.mjs";
const source = deriveAllowedManifestFixture(
  readFileSync("scripts/fixtures/client-native-enterprise.mjs", "utf8"),
);
const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
let found;
function walk(n) {
  if (!n || typeof n !== "object") return;
  if (
    n.type === "IfStatement" &&
    source
      .slice(n.test.start, n.test.end)
      .includes("c.op==='allowedManifestStatus'")
  ) {
    assert(!found);
    found = n;
  }
  for (const v of Object.values(n))
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") walk(v);
}
walk(tree);
assert(found);
const body = source.slice(found.consequent.start + 1, found.consequent.end - 1),
  AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const old =
  "evidence/client-native-packaged-macos-clock-arm64-memory-manifest-filesystem-denied-v2-20261021/";
const requests = JSON.parse(
  readFileSync(old + "final-experience-proof.json"),
).modelRequests;
const warm = JSON.parse(readFileSync(old + "memory-warm-proof.json")),
  workspace = warm.session.workingDirectory,
  root = workspace.slice(0, -"/packaged-workspace".length);
test("actual Complete handler uses canonical phase, strict trio/full delta, SDK/HTTP finish and one receipt", async () => {
  const calls = [],
    oldrow = { id: "old" },
    before = {
      actors: {
        current: {
          accounting: {
            ledger: [oldrow],
            traces: [oldrow],
            gatewayCalls: [oldrow],
          },
        },
        other: { identity: { user_id: "other" } },
      },
    },
    snapshot = structuredClone(before);
  const bindings = {
    c: {
      op: "allowedManifestComplete",
      sessionId: "sess_owned",
      dbPath: "/own/db",
    },
    memoryPrevious: { stage: "warm", snapshot: before },
    manifestObserverFailed: false,
    manifestResponseObserverFailed: false,
    api: async (path, method, body) => {
      if (path.endsWith("/security")) {
        assert.equal(method, undefined);
        assert.equal(body, undefined);
        return {
          published: { allowFilesystem: true },
          revision: 2,
          version: 1,
        };
      }
      assert.equal(method, "POST");
      assert.ok(["filesystem", "execution"].includes(body.action));
      return {
        allowed: true,
        security: { allowFilesystem: true },
        tenantId: "tenant",
      };
    },
    p: "/own",
    identity: "not-output",
    owner: { tenantId: "tenant" },
    app: { services: { db: {} } },
    captureMacBackendStage: (db, request) => {
      assert.match(request.phase, /^[a-z]+(?:-[a-z]+)*$/);
      calls.push("snapshot");
      return snapshot;
    },
    member: { id: "member" },
    assertMacOtherActorAccountingUnchanged: () => calls.push("other-rows"),
    macStageDigest,
    attestManifestTopic: async () => ({
      filePath: join(
        root,
        "data/.uwork/cli/memories/projects/packaged-workspace-e03a80f6b3ae5400/memory/owned-manifest-topic.md",
      ),
      sha256: "same",
    }),
    root,
    ownedMemoryPath: () => join(root, "MEMORY.md"),
    join,
    modelCalls: 7,
    modelRequests: requests,
    memoryIngress: { read: () => 7 },
    manifestResponses: [4, 5, 6].map((index) => ({
      index,
      finished: true,
      upstreamAborted: false,
    })),
    manifestExposure: { observed: true },
    assertMacActorAccountingDelta: (a, b, label, delta) => {
      assert.deepEqual(delta, {
        ledgerRows: 3,
        traceRows: 3,
        gatewayCalls: 3,
        credits: 66,
        inputTokens: 36,
        outputTokens: 30,
        modelId: "owned",
        application: "uwork",
      });
      calls.push("delta");
    },
    model: { id: "owned" },
    expectedAllowedManifestPrompt: async () => ({
      prompt: requests[6].messages.at(-1).content,
      mtimeMs: 1,
      manifestCount: 1,
      messageCount: 2,
    }),
    assertManifestAdmissionStage,
    MANIFEST_PROMPT:
      "UWORK_NATIVE_MEMORY_MANIFEST_QUERY_20261021 retain project preference",
    MANIFEST_MARKER: "UWORK_NATIVE_MEMORY_MANIFEST_DESCRIPTION_20261021",
    readAutoMemorySession: async (input) => {
      assert.equal(input.sessionId, "sess_owned");
      assert.equal(input.expectedGate, 1);
      return { sessionId: input.sessionId };
    },
    readAllowedSdkStop: async () => ({
      finishReason: "stop",
      toolCallCount: 0,
    }),
    writeFile: async (path, text, options) => {
      assert.equal(options.flag, "wx");
      assert.equal(options.mode, 0o600);
      const facts = JSON.parse(text);
      assert.equal(facts.supplier.sidecarCount, 1);
      assert.equal(facts.sdk.toolCallCount, 0);
      calls.push("write");
    },
    evidence: "/own/evidence",
    console: { log: () => calls.push("done") },
  };
  await new AsyncFunction(...Object.keys(bindings), body)(
    ...Object.values(bindings),
  );
  assert.equal(calls.filter((x) => x === "write").length, 1);
  assert.equal(calls.at(-1), "done");
  assert(calls.includes("delta"));
});
