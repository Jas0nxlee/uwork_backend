/** Pure derivation for one owned, readonly architecture-AX diagnostic; never dispatches a secondary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { deriveSecondaryFixture } from "./macos-x64-secondary-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-x64-startup-v10-20261021";
export function validateArchitectureAXProfile(name, env) {
  assert.equal(name, PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  for (const flag of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(env[flag], undefined, flag);
  return name;
}
export function deriveArchitectureAXFixture(original) {
  const source = deriveSecondaryFixture(original);
  const from = "./native-packaged-macos-x64-startup-runtime.mjs";
  assert.equal(source.split(from).length, 2);
  return source.replace(
    from,
    "./native-packaged-macos-x64-asar-integrity-runtime.mjs",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateArchitectureAXProfile(
    process.env.UWORK_NATIVE_FIXTURE_NAME,
    process.env,
  );
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveArchitectureAXFixture(
    readFileSync(fileURLToPath(url), "utf8"),
  );
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const result = next(target, context);
      if (target !== url) return result;
      assert.equal(loaded, false);
      loaded = true;
      return { ...result, source };
    },
  });
  await import(url);
}
