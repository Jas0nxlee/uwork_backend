/** Exact new artifact profiles only; all original startup fixture behavior is reused. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveSecondaryExitEntry } from "./macos-secondary-exit-derived.mjs";
export function validateAsarIntegrityProfile(profile, arch) {
  assert.ok(["arm64", "x64"].includes(arch));
  assert.equal(
    profile,
    `client-native-packaged-macos-clock-${arch}-asar-integrity-v1-20261021`,
  );
  return profile;
}
export function deriveAsarIntegrityEntry(source, arch) {
  let derived = deriveSecondaryExitEntry(source, arch);
  const changes = [
    [
      `/^client-native-packaged-macos-clock-${arch}-secondary-exit-v[0-9]+-20261021$/`,
      `/^client-native-packaged-macos-clock-${arch}-asar-integrity-v1-20261021$/`,
    ],
    [
      `./native-packaged-macos-${arch}-secondary-exit-runtime.mjs`,
      `./native-packaged-macos-${arch}-asar-integrity-runtime.mjs`,
    ],
  ];
  for (const [before, after] of changes) {
    assert.equal(derived.split(before).length, 2, before);
    derived = derived.replace(before, after);
  }
  return derived;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const profile = process.env.UWORK_NATIVE_FIXTURE_NAME,
    arch = profile?.match(
      /^client-native-packaged-macos-clock-(arm64|x64)-asar-integrity-v1-20261021$/,
    )?.[1];
  validateAsarIntegrityProfile(profile, arch);
  const original = resolve("scripts/fixtures/macos-x64-startup-derived.mjs"),
    url = pathToFileURL(original).href,
    source = deriveAsarIntegrityEntry(readFileSync(original, "utf8"), arch);
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
