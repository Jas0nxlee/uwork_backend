import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
const repo = resolve(import.meta.dirname, "../..");
const sourcePath = resolve(
  repo,
  "scripts/fixtures/mac-arm64-cold-consistency-derived.mjs",
);
const source = readFileSync(sourcePath, "utf8");
const original = readFileSync(
  resolve(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
function replay(input = original) {
  let receipt, hook;
  assert.equal(source.split("await import(originalUrl);").length, 2);
  const script = source
    .replace(/^import .*;\n/gm, "")
    .replace(
      "await import(originalUrl);",
      "globalThis.result = {derivedSource, originalSource};",
    );
  const context = createContext({
    assert,
    createHash,
    resolve,
    pathToFileURL,
    process: {
      cwd: () => repo,
      env: {
        UWORK_NATIVE_FIXTURE_NAME:
          "client-native-packaged-macos-clock-arm64-consistency-v1-20261021",
        UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
        UWORK_NATIVE_PACKAGED_MANIFEST: "frozen",
      },
    },
    readFileSync: () => input,
    writeFileSync: (_path, text) => {
      receipt = JSON.parse(text);
    },
    registerHooks: (value) => {
      hook = value;
    },
  });
  new Script(script).runInContext(context, { timeout: 1000 });
  return { ...context.result, receipt, hook };
}
function secondary(text) {
  const start = text.indexOf("async function openWorkspace(workspacePath) {");
  return text.slice(
    start,
    text.indexOf("async function stopNative() {", start),
  );
}
test("actual scoped derivation retains byte-exact original workspace body, flags and10s", () => {
  const value = replay();
  assert.equal(secondary(value.derivedSource), secondary(original));
  assert.equal(
    createHash("sha256").update(secondary(value.derivedSource)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.equal(value.receipt.originalSecondaryBodyPreserved, true);
  assert.equal(value.receipt.coldSnapshotCommandAnchors, 1);
  assert.ok(
    value.derivedSource.includes(
      'from "./native-packaged-macos-arm64-consistency-runtime.mjs";',
    ),
  );
  for (const forbidden of [
    "native-macos-x64-secondary",
    "scheduleOwnedSecondarySample",
    "openOwnedWorkspaceLog",
  ])
    assert.equal(value.derivedSource.includes(forbidden), false);
  assert.ok(secondary(value.derivedSource).includes('stdio: "ignore"'));
});
test("body mutation is rejected rather than silently inheriting a new child contract", () => {
  assert.throws(() =>
    replay(
      original.replace(
        "async function openWorkspace(workspacePath) {",
        "async function openWorkspace(workspacePath) {\n // changed body",
      ),
    ),
  );
});
test("actual load hook derives only exact shared fixture and cannot redirect other modules", () => {
  const value = replay();
  const unrelated = { source: "unchanged" };
  assert.equal(
    value.hook.load("file:///unrelated.mjs", {}, () => unrelated),
    unrelated,
  );
  const url = pathToFileURL(
    resolve(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const result = value.hook.load(url, {}, () => ({
    source: original,
    format: "module",
  }));
  assert.equal(result.source, value.derivedSource);
  assert.throws(() => value.hook.load(url, {}, () => ({ source: original })));
});
