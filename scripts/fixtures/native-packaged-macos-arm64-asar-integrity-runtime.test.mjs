import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  packagedManifestInput,
  validateArmManifest,
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
} from "./native-packaged-macos-arm64-asar-integrity-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  path = repo + "/evidence/" + ARM_MANIFEST_NAME,
  manifest = JSON.parse(await readFile(path)),
  mode = { experience: "enabled", otherMode: false };
test("exact ARMv13 manifest and original fixture mode only", () => {
  assert.equal(packagedManifestInput(undefined, repo, {}), null);
  assert.equal(packagedManifestInput(path, repo, mode), path);
  for (const input of [
    path.replace("v13", "v12"),
    repo + "/evidence/../evidence/" + ARM_MANIFEST_NAME,
    "/Applications/UWork.app",
  ])
    assert.throws(() => packagedManifestInput(input, repo, mode));
  assert.throws(() =>
    packagedManifestInput(path, repo, { ...mode, otherMode: true }),
  );
});
test("frozen ARM metadata retains9 actual resources and12 native headers", () => {
  assert.equal(validateArmManifest(manifest), manifest);
  assert.equal(Object.keys(manifest.runtimeFiles).length, 9);
  assert.equal(manifest.nativeFiles.length, 12);
});
test("foreign target source app bundle build or signature is rejected", () => {
  for (const [key, value] of [
    ["target", "darwin-x64"],
    ["sourceCommit", "old"],
    ["appPath", "/Applications/UWork.app"],
    ["bundleIdentifier", "dev.zcode.app"],
    ["builderExitCode", 1],
    ["codesignExitCode", 1],
  ])
    assert.throws(() => validateArmManifest({ ...manifest, [key]: value }));
});
test("every actual resource is pinned, including ARM helper and spawnhelper/search", () => {
  for (const name of Object.keys(manifest.runtimeFiles)) {
    const m = structuredClone(manifest);
    m.runtimeFiles[name].sha256 = "0".repeat(64);
    assert.throws(() => validateArmManifest(m));
    delete m.runtimeFiles[name];
    assert.throws(() => validateArmManifest(m));
  }
});
test("ARM helper cannot be marked unavailable or removed to claim full artifact", () => {
  const m = structuredClone(manifest);
  m.optionalResources["macos-window-bounds/zcode-window-bounds"].available =
    false;
  assert.throws(() => validateArmManifest(m));
});
test("wrong native arch and escaping resource path are rejected", () => {
  for (const [key, value] of [
    ["architecture", "x86_64"],
    ["path", "Contents/../../foreign"],
  ]) {
    const m = structuredClone(manifest);
    m.nativeFiles[0][key] = value;
    assert.throws(() => validateArmManifest(m));
  }
});
test("five startup source snapshots are pinned in both maps", () => {
  for (const name of Object.keys(manifest.startupSourceSha256)) {
    for (const key of ["startupSourceSha256", "sourceSha256"]) {
      const m = structuredClone(manifest);
      m[key][name] = "0".repeat(64);
      assert.throws(() => validateArmManifest(m));
    }
  }
});
test("actual original9 resources/12ARM files and strictsign validate readonly without app", async () => {
  const value = await loadOwnedPackagedRuntime(path, repo, mode);
  assert.equal(value.target, "darwin-arm64");
  assert.equal(value.verifiedRuntimeFiles.length, 9);
  assert.deepEqual(value.unavailableOptionalFiles, []);
  assert.equal(value.physicalRuntimeAcceptance, false);
});

test("both new exit specification and confirmation boundary are pinned", () => {
  for (const name of [
    "specs/desktop-secondary-process-exit.md",
    "specs/second-instance-native-confirmation.md",
  ]) {
    const m = structuredClone(manifest);
    m.sourceSha256[name] = "0".repeat(64);
    assert.throws(() => validateArmManifest(m));
    delete m.sourceSha256[name];
    assert.throws(() => validateArmManifest(m));
  }
});

test("all33 producer sources, final raw header metadata and unchanged fuses are strict", () => {
  for (const name of Object.keys(manifest.sourceSha256)) {
    const changed = structuredClone(manifest);
    changed.sourceSha256[name] = "0".repeat(64);
    assert.throws(() => validateArmManifest(changed));
  }
  for (const key of ["finalAsarHeaderIntegrity", "originalFuseWire"]) {
    const changed = structuredClone(manifest);
    delete changed[key];
    assert.throws(() => validateArmManifest(changed));
  }
});
