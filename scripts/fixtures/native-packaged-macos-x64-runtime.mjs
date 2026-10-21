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
  "client-macos-package-v8-x64-manifest-20261020.json";
export const X64_MANIFEST_SHA =
  "f5f19c86b02a9e0a81e75cea4382da7acc492f84eb4e6873074ea6b39678ce24";
export const X64_APP_PATH = join(
  userInfo().homedir,
  "Library/Caches/uwork-backend/client-macos-package-20261020-v8-x64/mac/UWork Preview.app",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PINNED = {
  "app.asar":
    "f817f2229eb725510d6d483f6ed4b2b7134da99c69b7faae294b86b4f8dbdacd",
  "glm/zcode.cjs":
    "cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac",
  "config/provider/zcode-builtin.json":
    "4b81a39d7231819703fbcd40ea42d17573342c77be386e251fd88a16008b5341",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/pty.node":
    "44d1891e89724f21b4f55b4311749520a5c809176a3f44ced36487bbc75f00c2",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper":
    "6bed2c3455debcf3e391afa7069ab94cb26766967456b0c473fced42f6de1efd",
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
    "1bd1ec7b9949353ae11390e020a58b0fe7719c3e",
  );
  assert.equal(manifest.bundleIdentifier, "dev.zcode.app.preview");
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
