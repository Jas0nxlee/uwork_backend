/** Frozen owned x64 candidate only; does not relax the shared arm64 fixture loader. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";

export const X64_MANIFEST_NAME =
  "client-macos-package-v9-x64-startup-log-manifest-20261020.json";
export const X64_MANIFEST_SHA =
  "767ad9e77e3c8afb755d31d041c61d6baa5543e11545b2e0090c0e9a87494468";
export const X64_APP_PATH = join(
  userInfo().homedir,
  "Library/Caches/uwork-backend/client-macos-package-20261020-v9-x64-startup-log/mac/UWork Preview.app",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PINNED = {
  "app.asar":
    "7bc704e555b0d92493e75e395561b11f5d84577c8160792d9d0371ba49c0ba81",
  "glm/zcode.cjs":
    "cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac",
  "config/provider/zcode-builtin.json":
    "4b81a39d7231819703fbcd40ea42d17573342c77be386e251fd88a16008b5341",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/pty.node":
    "44d1891e89724f21b4f55b4311749520a5c809176a3f44ced36487bbc75f00c2",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper":
    "6bed2c3455debcf3e391afa7069ab94cb26766967456b0c473fced42f6de1efd",
};
const STARTUP_SOURCE = {
  "packages/desktop/src/main/index.ts":
    "ab3365d6db1e2b2fc8432e069f61bfaa7e660853e56142bf97a3556bd324d7a8",
  "packages/desktop/src/main/desktopSingleInstanceStartupLog.ts":
    "1d0dfc037703ad583b08eb8ae30090ddf4d52861b7a6c13321ab2f571b90e620",
  "packages/desktop/test/desktopSingleInstanceStartupLog.test.ts":
    "1a8f4cc28d212b02f73884e9346e736833d541546ff390a4ae9c3edc00be7cfa",
  "packages/desktop/test/desktopSingleInstanceStartupLog.integration.mjs":
    "d70910358e8d1a57b73b0bde67aefcba00cfd9c6978c56cde2ad8ef40167e237",
  "specs/desktop-single-instance-startup-observability.md":
    "5d3115b691c7fcf0aa7c2494d71f951e2e474b2645bbf53143f16a98775c8d3f",
};
const OPTIONAL = "macos-window-bounds/zcode-window-bounds";

export function packagedManifestInput(input, repo, mode) {
  if (input === undefined) return null;
  assert.equal(mode.experience, "enabled");
  assert.equal(
    mode.otherMode,
    false,
    "No other fixture mode or login interception",
  );
  assert.equal(input, join(repo, "evidence", X64_MANIFEST_NAME));
  assert.equal(resolve(input), input);
  return input;
}

export function validateX64Manifest(manifest) {
  assert.equal(manifest.appPath, X64_APP_PATH, "Only the frozen owned x64 app");
  assert.equal(manifest.target, "darwin-x64");
  assert.equal(
    manifest.sourceCommit,
    "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  );
  assert.equal(manifest.bundleIdentifier, "dev.zcode.app.preview");
  assert.deepEqual(
    Object.keys(manifest.startupSourceSha256),
    Object.keys(STARTUP_SOURCE),
  );
  for (const [name, expected] of Object.entries(STARTUP_SOURCE)) {
    assert.equal(manifest.startupSourceSha256[name], expected);
    assert.equal(manifest.sourceSha256[name], expected);
  }
  assert.equal(manifest.builderExitCode, 0);
  assert.equal(manifest.codesignExitCode, 0);
  assert.equal(
    manifest.sourceSha256["packages/desktop/src/main/desktopDeepLinkUrl.ts"],
    "619377c7458d678d1f1c585981cc8daf34996618dcd7a75970b51025dfab3100",
  );
  for (const [name, expected] of Object.entries(PINNED)) {
    const resource = manifest.runtimeFiles[name];
    assert.equal(
      resource?.sha256,
      expected,
      "Required original x64 resource: " + name,
    );
    assert.ok(Number.isSafeInteger(resource.bytes) && resource.bytes > 0);
  }
  assert.deepEqual(manifest.coreRuntimeFileNames, Object.keys(PINNED));
  assert.equal(manifest.optionalResources[OPTIONAL].available, false);
  assert.equal(
    manifest.runtimeFiles[OPTIONAL],
    undefined,
    "Missing optional helper is not a verified resource",
  );
  assert.equal(manifest.nativeFiles.length, 11);
  for (const resource of manifest.nativeFiles) {
    assert.equal(resource.architecture, "x86_64");
    assert.ok(
      resource.path.startsWith("Contents/") &&
        !resource.path.split("/").includes(".."),
    );
  }
  return manifest;
}

async function verifyFile(path, expected, app) {
  assert.ok(
    (await realpath(path)).startsWith(app + "/"),
    "Resource symlink must remain inside owned app",
  );
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  assert.equal(bytes, expected.bytes);
  assert.equal(
    digest.digest("hex"),
    expected.sha256,
    "Frozen packaged resource changed",
  );
}

export async function loadOwnedPackagedRuntime(input, repo, mode) {
  const path = packagedManifestInput(input, repo, mode);
  if (!path) return null;
  assert.equal(await realpath(path), path);
  const raw = await readFile(path);
  assert.equal(
    sha(raw),
    X64_MANIFEST_SHA,
    "Only the reviewed immutable x64 manifest",
  );
  const manifest = validateX64Manifest(JSON.parse(raw));
  const appPath = manifest.appPath;
  assert.equal(await realpath(appPath), appPath);
  for (const [name, expected] of Object.entries(manifest.sourceSha256)) {
    assert.ok(!name.split("/").includes(".."));
    assert.equal(
      sha(await readFile(join(repo, "clients/uwork", name))),
      expected,
      "Frozen producer source changed: " + name,
    );
  }
  for (const [name, expected] of Object.entries(manifest.runtimeFiles)) {
    await verifyFile(
      join(appPath, "Contents/Resources", name),
      expected,
      appPath,
    );
  }
  for (const expected of manifest.nativeFiles) {
    const file = join(appPath, expected.path);
    await verifyFile(file, expected, appPath);
    const handle = await open(file, "r");
    try {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, 16, 0);
      assert.equal(header.readUInt32LE(0), 0xfeedfacf);
      assert.equal(
        header.readUInt32LE(4),
        0x01000007,
        "Actual original Mach-O must be x86_64",
      );
    } finally {
      await handle.close();
    }
  }
  try {
    await lstat(join(appPath, "Contents/Resources", OPTIONAL));
    assert.fail("Optional helper must remain truly absent");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { stdout: bundleId } = await promisify(execFile)(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", join(appPath, "Contents/Info.plist")],
    { timeout: 10000 },
  );
  assert.equal(
    bundleId.trim(),
    "dev.zcode.app.preview",
    "Actual app bundle ID must match",
  );
  await promisify(execFile)(
    "codesign",
    ["--verify", "--deep", "--strict", appPath],
    { timeout: 30000 },
  );
  return {
    appPath,
    executable: join(appPath, "Contents/MacOS/UWork Preview"),
    manifestPath: path,
    verifiedRuntimeFiles: Object.keys(manifest.runtimeFiles),
    target: "darwin-x64",
    unavailableOptionalFiles: [OPTIONAL],
    translatedRuntimeAcceptance: false,
  };
}
