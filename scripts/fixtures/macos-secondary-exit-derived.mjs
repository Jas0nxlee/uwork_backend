/** New committed candidate only; old startup entry and original fixture remain byte-exact. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateSecondaryExitProfile(profile, arch) {
  assert.ok(arch === "x64" || arch === "arm64");
  assert.match(
    profile,
    new RegExp(
      `^client-native-packaged-macos-clock-${arch}-secondary-exit-v[0-9]+-20261021$`,
    ),
  );
  return profile;
}
export function deriveSecondaryExitEntry(source, arch) {
  assert.ok(arch === "x64" || arch === "arm64");
  const replacements = [
    [
      "/^client-native-packaged-macos-x64-startup-v[0-9]+-20261020$/",
      `/^client-native-packaged-macos-clock-${arch}-secondary-exit-v[0-9]+-20261021$/`,
    ],
    [
      "./native-packaged-macos-x64-startup-runtime.mjs",
      `./native-packaged-macos-${arch}-secondary-exit-runtime.mjs`,
    ],
  ];
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length, 2, before);
    source = source.replace(before, after);
  }
  if (arch === "arm64") {
    assert.equal(source.split("owned x64 loader import only;").length, 2);
    source = source.replace(
      "owned x64 loader import only;",
      "owned arm64 loader import only;",
    );
  }
  return source;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const profile = process.env.UWORK_NATIVE_FIXTURE_NAME;
  const arch = profile?.match(
    /^client-native-packaged-macos-clock-(x64|arm64)-secondary-exit-v[0-9]+-20261021$/,
  )?.[1];
  validateSecondaryExitProfile(profile, arch);
  const original = resolve("scripts/fixtures/macos-x64-startup-derived.mjs");
  const originalUrl = pathToFileURL(original).href;
  const source = deriveSecondaryExitEntry(readFileSync(original, "utf8"), arch);
  let loaded = false;
  registerHooks({
    load(url, context, nextLoad) {
      const value = nextLoad(url, context);
      if (url !== originalUrl) return value;
      assert.equal(loaded, false);
      loaded = true;
      return { ...value, source };
    },
  });
  await import(originalUrl);
}
