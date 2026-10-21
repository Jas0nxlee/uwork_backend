import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  deriveCrashFixture,
  CRASH_PROFILE,
} from "./mac-arm64-crash-consistency-derived.mjs";
const original = readFileSync(
  new URL("./client-native-enterprise.mjs", import.meta.url),
  "utf8",
);
const derive = () => deriveCrashFixture(original);
function secondary(source) {
  const start = source.indexOf("async function openWorkspace(workspacePath) {");
  return source.slice(
    start,
    source.indexOf("async function stopNative() {", start),
  );
}
test("pure derivation binds v12, original full workspace body and5s crash contract without App", () => {
  const source = derive();
  assert.equal(secondary(source), secondary(original));
  assert.equal(
    createHash("sha256").update(secondary(source)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.ok(
    source.includes("native-packaged-macos-arm64-secondary-exit-runtime.mjs"),
  );
  assert.ok(source.includes("crashOwnedMain({child:electron"));
  assert.ok(!source.includes("macColdSnapshot"));
  assert.ok(!source.includes('method:"original stopNative'));
  assert.equal(
    CRASH_PROFILE,
    "client-native-packaged-macos-clock-arm64-consistency-v4-20261021",
  );
});
test("missing source transformation anchor rejects before any App/HTTP", () => {
  assert.throws(() =>
    deriveCrashFixture(
      original.replace(
        "async function openWorkspace(workspacePath) {",
        "async function other() {",
      ),
    ),
  );
});
