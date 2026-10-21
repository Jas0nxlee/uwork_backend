/** Fresh v12 counterfactual profile only; original fixture business stays unchanged. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACTIVE_QUIT_PROFILE as PREVIOUS_PROFILE,
  deriveActiveQuitFixture,
  validateActiveQuitV16Profile as previousValidate,
} from "./mac-native-active-quit-v16-raw-error-derived.mjs";
export { deriveActiveQuitFixture };
export const ACTIVE_QUIT_PROFILE =
  "client-native-packaged-macos-clock-arm64-active-quit-v12-20261021";
export function validateActiveQuitV16Profile(profile, env) {
  assert.equal(profile, ACTIVE_QUIT_PROFILE);
  previousValidate(PREVIOUS_PROFILE, env);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateActiveQuitV16Profile(
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
