import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packagedManifestInput as armInput } from "./native-packaged-runtime.mjs";
import {
  packagedManifestInput,
  validateX64Manifest,
  loadOwnedPackagedRuntime,
  X64_MANIFEST_NAME,
} from "./native-packaged-macos-x64-secondary-exit-runtime.mjs";
const repo = resolve(import.meta.dirname, "../..");
const path = repo + "/evidence/" + X64_MANIFEST_NAME;
const manifest = JSON.parse(await readFile(path));
const mode = { experience: "enabled", otherMode: false };
test("only exact reviewed x64 manifest and fixture mode are admitted", () => {
  assert.equal(packagedManifestInput(undefined, repo, {}), null);
  assert.equal(packagedManifestInput(path, repo, mode), path);
  for (const bad of [
    "/Applications/UWork.app",
    path.replace("v11-x64-secondary-exit", "v9-x64-startup-log"),
    repo + "/evidence/../evidence/" + X64_MANIFEST_NAME,
  ])
    assert.throws(() => packagedManifestInput(bad, repo, mode));
  assert.throws(() =>
    packagedManifestInput(path, repo, { ...mode, otherMode: true }),
  );
  assert.throws(() =>
    packagedManifestInput(path, repo, { ...mode, experience: undefined }),
  );
  assert.throws(
    () => armInput(path, repo, mode),
    "Original shared arm64 guard remains strict",
  );
});
test("valid frozen metadata retains all five actual core resources", () =>
  assert.equal(validateX64Manifest(manifest), manifest));
test("foreign app, target, bundle, source, failed build or signature are rejected", () => {
  for (const [key, value] of [
    ["appPath", "/Applications/UWork Preview.app"],
    ["target", "darwin-arm64"],
    ["bundleIdentifier", "dev.zcode.app"],
    ["sourceCommit", "old"],
    ["builderExitCode", 1],
    ["codesignExitCode", 1],
  ])
    assert.throws(() => validateX64Manifest({ ...manifest, [key]: value }));
});
test("missing or wrong original x64 NAPI/Agent resource hash is rejected", () => {
  for (const name of manifest.coreRuntimeFileNames) {
    const value = structuredClone(manifest);
    value.runtimeFiles[name].sha256 = "0".repeat(64);
    assert.throws(() => validateX64Manifest(value));
    delete value.runtimeFiles[name];
    assert.throws(() => validateX64Manifest(value));
  }
});
test("optional helper cannot be invented or advertised verified", () => {
  const p = "macos-window-bounds/zcode-window-bounds";
  const a = structuredClone(manifest);
  a.optionalResources[p].available = true;
  assert.throws(() => validateX64Manifest(a));
  const b = structuredClone(manifest);
  b.runtimeFiles[p] = { bytes: 1, sha256: "0".repeat(64) };
  assert.throws(() => validateX64Manifest(b));
});
test("wrong native architecture or escaping resource path is rejected", () => {
  for (const [key, value] of [
    ["architecture", "arm64"],
    ["path", "Contents/../../foreign"],
  ]) {
    const a = structuredClone(manifest);
    a.nativeFiles[0][key] = value;
    assert.throws(() => validateX64Manifest(a));
  }
});
test("actual frozen x64 candidate verifies read-only without any Electron launch", async () => {
  const value = await loadOwnedPackagedRuntime(path, repo, mode);
  assert.equal(value.target, "darwin-x64");
  assert.equal(value.translatedRuntimeAcceptance, false);
  assert.equal(value.verifiedRuntimeFiles.length, 8);
  assert.deepEqual(value.unavailableOptionalFiles, [
    "macos-window-bounds/zcode-window-bounds",
  ]);
});

test("startup Main/helper/spec/test snapshot is pinned in both source maps", () => {
  for (const name of Object.keys(manifest.startupSourceSha256)) {
    for (const key of ["startupSourceSha256", "sourceSha256"]) {
      const changed = structuredClone(manifest);
      changed[key][name] = "0".repeat(64);
      assert.throws(() => validateX64Manifest(changed));
    }
  }
});
test("historical v9 immutable manifest is never admitted as the new exit product", async () => {
  const old = JSON.parse(
    await readFile(
      repo +
        "/evidence/client-macos-package-v9-x64-startup-log-manifest-20261020.json",
    ),
  );
  assert.throws(() => validateX64Manifest(old));
});

test("new secondary exit spec must be present and exact without changing fixture modes", () => {
  for (const value of [undefined, "0".repeat(64)]) {
    const changed = structuredClone(manifest);
    changed.sourceSha256["specs/desktop-secondary-process-exit.md"] = value;
    assert.throws(() => validateX64Manifest(changed));
  }
});
