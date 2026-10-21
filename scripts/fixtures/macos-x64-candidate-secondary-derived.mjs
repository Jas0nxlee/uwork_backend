/** Exact new x64 candidate replay of the sealed secondary diagnostic. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveSecondaryFixture as deriveOriginalSecondaryFixture } from "./macos-x64-secondary-derived.mjs";
export function validateSecondaryProfile(profile) {
  assert.equal(
    profile,
    "client-native-packaged-macos-clock-x64-startup-v7-20261021",
  );
  return profile;
}
export function deriveSecondaryFixture(original) {
  const source = deriveOriginalSecondaryFixture(original);
  const before = "./native-packaged-macos-x64-startup-runtime.mjs";
  assert.equal(source.split(before).length, 2);
  return source.replace(
    before,
    "./native-packaged-macos-x64-secondary-exit-runtime.mjs",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateSecondaryProfile(process.env.UWORK_NATIVE_FIXTURE_NAME);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveSecondaryFixture(
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
