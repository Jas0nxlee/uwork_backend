/** Versioned profile-only entry for the already frozen v9 x64 startup-log fixture. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const BEFORE = "/^client-native-packaged-macos-x64-startup-v[0-9]+-20261020$/";
const AFTER =
  "/^client-native-packaged-macos-clock-x64-startup-v[0-9]+-20261021$/";
export function validateClockStartupProfile(profile) {
  assert.match(
    profile ?? "",
    /^client-native-packaged-macos-clock-x64-startup-v[0-9]+-20261021$/,
  );
  return profile;
}
export function deriveClockStartupFixture(source) {
  assert.equal(typeof source, "string");
  assert.equal(
    source.split(BEFORE).length,
    2,
    "Only one original startup fixture profile guard",
  );
  return source.replace(BEFORE, AFTER);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateClockStartupProfile(process.env.UWORK_NATIVE_FIXTURE_NAME);
  const target = pathToFileURL(
    resolve("scripts/fixtures/macos-x64-startup-derived.mjs"),
  ).href;
  const source = deriveClockStartupFixture(
    readFileSync(fileURLToPath(target), "utf8"),
  );
  let loaded = false;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== target) return result;
      assert.equal(loaded, false);
      loaded = true;
      return { ...result, source };
    },
  });
  await import(target);
}
