/** Frozen owned ARM64 secondary-exit candidate only; does not relax the shared arm64 fixture loader. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";

export const ARM_MANIFEST_NAME =
  "client-macos-package-v12-arm64-secondary-exit-manifest-20261021.json";
export const ARM_MANIFEST_SHA =
  "ad3971e5cb331f423a166733546d98d1711f4d2b1449fd75f12a6bee22029871";
export const ARM_APP_PATH = join(
  userInfo().homedir,
  "Library/Caches/uwork-backend/client-macos-package-20261021-v12-arm64-secondary-exit/mac-arm64/UWork Preview.app",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PINNED = {
  "app.asar":
    "b078337e6f12bdee343986a5f99155e3f1dd996e5008cb503309ce655a053aa5",
  "glm/zcode.cjs":
    "cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac",
  "config/provider/zcode-builtin.json":
    "4b81a39d7231819703fbcd40ea42d17573342c77be386e251fd88a16008b5341",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node":
    "a6713b526e42216c82e587a236b53d424ceed0d138c0601fb1565dd352736c10",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper":
    "fcffa14af90956e31da8a6fa749a18a0484cb1fb7d95ee1ab330c0fcc2050284",
  "tools/bfs/bfs":
    "82c2c3a539e9971ae694d8168c1bb2d05ebf22be2b59e6f6a727024d1f6a324c",
  "tools/ugrep/ugrep":
    "d6f7836e99a05300c6e903dcef37221fd0c2e176fc399a1168efd3068a8c35ba",
  "tools/ripgrep/rg":
    "7c0ab82213ef8ebfa2467b26d55af9b36b6452f73072acdd4596261b99708f55",
  "macos-window-bounds/zcode-window-bounds":
    "f08de0fa0941f5a3d82e064a8ec19fb54e546b819d4f8faba1f48e83c7e98349",
};
const CORE = [
  "app.asar",
  "glm/zcode.cjs",
  "config/provider/zcode-builtin.json",
  "macos-window-bounds/zcode-window-bounds",
  "app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
];
const STARTUP_SOURCE = {
  "packages/desktop/src/main/index.ts":
    "ee27b495126ef1e47d5f2d3737426f10713e2cac2ceb7eb58040945073aab094",
  "packages/desktop/src/main/desktopSingleInstanceStartupLog.ts":
    "1d0dfc037703ad583b08eb8ae30090ddf4d52861b7a6c13321ab2f571b90e620",
  "packages/desktop/test/desktopSingleInstanceStartupLog.test.ts":
    "1a8f4cc28d212b02f73884e9346e736833d541546ff390a4ae9c3edc00be7cfa",
  "packages/desktop/test/desktopSingleInstanceStartupLog.integration.mjs":
    "eeb8fad9202b8f305ba166f55f7d8500a89e3ab9fd8706af97780d52f62daa01",
  "specs/desktop-single-instance-startup-observability.md":
    "1cb4ad08d778aa58b2fbc02d77521b8c8db5f80f95034df273916c7423d5967c",
};
const OPTIONAL = "macos-window-bounds/zcode-window-bounds";
const EXIT_SPEC_SOURCE = {
  "specs/desktop-secondary-process-exit.md":
    "fdcaa61ef8118d9d49ec9355b0e124deabb2a37ad1209ab47ae9cc671f6ee358",
  "specs/second-instance-native-confirmation.md":
    "e9b1f1409e08fc4f21a40d4cb065df6b1bd0419cac60ce03bd45e6925b9b4ae1",
};

export function packagedManifestInput(input, repo, mode) {
  if (input === undefined) return null;
  assert.equal(mode.experience, "enabled");
  assert.equal(
    mode.otherMode,
    false,
    "No other fixture mode or login interception",
  );
  assert.equal(input, join(repo, "evidence", ARM_MANIFEST_NAME));
  assert.equal(resolve(input), input);
  return input;
}

export function validateArmManifest(manifest) {
  assert.equal(
    manifest.appPath,
    ARM_APP_PATH,
    "Only the frozen owned ARM64 app",
  );
  assert.equal(manifest.target, "darwin-arm64");
  assert.equal(
    manifest.sourceCommit,
    "0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2",
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
  for (const [name, expected] of Object.entries(EXIT_SPEC_SOURCE))
    assert.equal(manifest.sourceSha256[name], expected);
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
      "Required original ARM64 resource: " + name,
    );
    assert.ok(Number.isSafeInteger(resource.bytes) && resource.bytes > 0);
  }
  assert.deepEqual(manifest.coreRuntimeFileNames, CORE);
  assert.deepEqual(Object.keys(manifest.runtimeFiles), Object.keys(PINNED));
  assert.equal(manifest.optionalResources[OPTIONAL].available, true);
  assert.equal(manifest.nativeFiles.length, 12);
  for (const resource of manifest.nativeFiles) {
    assert.equal(resource.architecture, "arm64");
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
    ARM_MANIFEST_SHA,
    "Only the reviewed immutable ARM64 manifest",
  );
  const manifest = validateArmManifest(JSON.parse(raw));
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
        0x0100000c,
        "Actual original Mach-O must be arm64",
      );
    } finally {
      await handle.close();
    }
  }
  const helper = await lstat(join(appPath, "Contents/Resources", OPTIONAL));
  assert.ok(
    helper.isFile() && !helper.isSymbolicLink(),
    "Original ARM helper must be available",
  );
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
    target: "darwin-arm64",
    unavailableOptionalFiles: [],
    physicalRuntimeAcceptance: false,
  };
}
