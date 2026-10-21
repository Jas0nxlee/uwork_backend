/** Fresh v15 retarget only. Original menu AX/hold/quit logic remains in reviewed helpers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveActiveQuitFixture as previous } from "./mac-native-active-quit-derived.mjs";
import { derivePackagedMainReadonly } from "./mac-arm64-memory-filesystem-denied-derived.mjs";
export const ACTIVE_QUIT_PROFILE =
  "client-native-packaged-macos-clock-arm64-active-quit-v7-20261021";
export function deriveActiveQuitFixture(source) {
  const old = previous(source);
  const anchor = "./native-packaged-macos-arm64-secondary-exit-runtime.mjs";
  assert.equal(old.split(anchor).length, 2);
  return derivePackagedMainReadonly(
    old.replace(
      anchor,
      "./native-packaged-macos-arm64-project-memory-runtime.mjs",
    ),
  );
}
export function validateActiveQuitV15Profile(profile, env) {
  assert.equal(profile, ACTIVE_QUIT_PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const name of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(env[name], undefined, name);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateActiveQuitV15Profile(
    process.env.UWORK_NATIVE_FIXTURE_NAME,
    process.env,
  );
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveActiveQuitFixture(
    readFileSync(fileURLToPath(url), "utf8"),
  );
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const value = next(target, context);
      if (target !== url) return value;
      assert.equal(loaded, false);
      loaded = true;
      return { ...value, source };
    },
  });
  await import(url);
}
