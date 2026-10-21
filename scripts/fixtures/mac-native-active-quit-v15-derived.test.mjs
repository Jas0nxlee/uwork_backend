import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "acorn";
import {
  deriveActiveQuitFixture,
  validateActiveQuitV15Profile,
  ACTIVE_QUIT_PROFILE,
} from "./mac-native-active-quit-v15-derived.mjs";
import { deriveActiveQuitFixture as old } from "./mac-native-active-quit-derived.mjs";
const original = readFileSync(
  "scripts/fixtures/client-native-enterprise.mjs",
  "utf8",
);
test("actual fresh v15 source keeps original 1c, menu-only hold/arm handlers, only loader and reviewed devout replacement differ", () => {
  const next = deriveActiveQuitFixture(original);
  parse(next, { ecmaVersion: "latest", sourceType: "module" });
  const body = (s) =>
    s.slice(
      s.indexOf("async function openWorkspace(workspacePath) {"),
      s.indexOf("async function stopNative() {"),
    );
  assert.equal(body(next), body(original));
  assert.equal(
    createHash("sha256").update(body(next)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.ok(
    next.includes("native-packaged-macos-arm64-project-memory-runtime.mjs"),
  );
  assert.ok(
    !next.includes("const outSnapshot = await copyNativeOutSnapshot({"),
  );
  assert.ok(next.includes("PACKAGED_MAIN_READONLY_BEGIN"));
  const before = old(original),
    start = before.indexOf("const outSnapshot = await copyNativeOutSnapshot({"),
    end = before.indexOf(
      'await writeFile(\n  join(appRoot, "env-guard.cjs"),',
      start,
    ),
    newStart = next.indexOf("// PACKAGED_MAIN_READONLY_BEGIN"),
    newEnd = next.indexOf(
      'await writeFile(\n  join(appRoot, "env-guard.cjs"),',
      newStart,
    );
  assert.equal(
    before
      .slice(0, start)
      .replace(
        "./native-packaged-macos-arm64-secondary-exit-runtime.mjs",
        "./native-packaged-macos-arm64-project-memory-runtime.mjs",
      ),
    next.slice(0, newStart),
  );
  assert.equal(before.slice(end), next.slice(newEnd));
});
test("exact fresh profile rejects conflict modes and missing manifest/witness", () => {
  const env = {
    UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
    UWORK_NATIVE_CONFIGURATION_WITNESS: "enabled",
    UWORK_NATIVE_PACKAGED_MANIFEST: "/owned/v15.json",
  };
  validateActiveQuitV15Profile(ACTIVE_QUIT_PROFILE, env);
  for (const override of [
    { UWORK_NATIVE_GATEWAY_USAGE_HOLD: "controlled" },
    { UWORK_NATIVE_CONFIGURATION_WITNESS: undefined },
    { UWORK_NATIVE_PACKAGED_MANIFEST: undefined },
  ])
    assert.throws(() =>
      validateActiveQuitV15Profile(ACTIVE_QUIT_PROFILE, {
        ...env,
        ...override,
      }),
    );
  assert.throws(() =>
    validateActiveQuitV15Profile(
      ACTIVE_QUIT_PROFILE.replace("-v7-", "-v4-"),
      env,
    ),
  );
});
