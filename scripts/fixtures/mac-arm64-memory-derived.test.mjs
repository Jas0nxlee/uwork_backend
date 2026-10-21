import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deriveMemoryFixture } from "./mac-arm64-memory-derived.mjs";
test("actual derivation preserves original secondary, supplier and configuration; only new readonly proof and model prerequisite", () => {
  const old = readFileSync(
      "scripts/fixtures/client-native-enterprise.mjs",
      "utf8",
    ),
    s = deriveMemoryFixture(old);
  const body = (x) =>
    x.slice(
      x.indexOf("async function openWorkspace(workspacePath) {"),
      x.indexOf("async function stopNative() {"),
    );
  assert.equal(body(old), body(s));
  assert.equal(
    createHash("sha256").update(body(s)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  const supplier = (x) =>
    x.slice(
      x.indexOf("const upstream = httpServer(async (req, res) => {"),
      x.indexOf("await new Promise((r) => upstream.listen"),
    );
  assert.equal(supplier(s), supplier(old));
  assert(!s.includes("extractionEnabled:false"));
  assert(s.includes("native-packaged-macos-arm64-asar-integrity-runtime"));
  assert.throws(() => deriveMemoryFixture(old + old));
  assert(s.includes("rawInferencePosts:memoryIngress.read()"));
  assert(s.includes("assertMacOtherActorAccountingUnchanged"));
});
