/** Frozen owned x64 candidate only; does not relax the shared arm64 fixture loader. */
import assert from "node:assert/strict";
import { verifyMacAsarHeaderAndFuses } from "./native-packaged-macos-asar-integrity.mjs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";

export const X64_MANIFEST_NAME =
  "client-macos-package-v14-x64-asar-integrity-manifest-20261021.json";
export const X64_MANIFEST_SHA =
  "4fb0ae63377480fba47ccb41c47125fd16df109f2fe45a83812aaaa8c49b8cd9";
export const X64_APP_PATH = join(
  userInfo().homedir,
  "Library/Caches/uwork-backend/client-macos-package-20261021-v14-x64-asar-integrity/mac/UWork Preview.app",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PINNED = {
  "app.asar":
    "3816d64028e4633d05a4e5d6d5206cbe90757b25804a4b529309c8a891baa314",
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
const PRODUCER_SOURCE = {
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
  "packages/desktop/src/main/desktopDeepLinkUrl.ts":
    "619377c7458d678d1f1c585981cc8daf34996618dcd7a75970b51025dfab3100",
  "packages/desktop/test/desktopSingleInstanceWire.test.ts":
    "7794eaff97ee0262a828ed45a0baf77f6c4a9c260514ff0b757c0e843c240468",
  "packages/desktop/test/externalWorkspaceConfirmation.fixture.mjs":
    "d29b8d0fe8e82e01b0b384819b124d54e32aec6ae8c8426ac7fd29a0a8ce4e10",
  "packages/desktop/test/externalWorkspaceConfirmation.integration.mjs":
    "4a4921bba0ee8d06d1a6fd21c6f1e8ede16298816a4f177ebf28aaa18d9755a9",
  "specs/second-instance-native-confirmation.md":
    "e9b1f1409e08fc4f21a40d4cb065df6b1bd0419cac60ce03bd45e6925b9b4ae1",
  "packages/ui/src/root/useRootPlatformEffects.ts":
    "93db5b44f1ebd99eb5d373375541e478ebe865eec18b268227afc63f90836866",
  "packages/desktop/electron-builder.config.js":
    "993e61fe3df54f8b71ae21f7dd3adae49380af85c67330237d1f691514301885",
  "packages/desktop/scripts/build-macos-window-bounds.mjs":
    "1cd87af63e4b409956f79946f9fbbd0b42ed13f712200ad428042930ae594713",
  "packages/server/package.json":
    "c999480d4c74449f3ef04aa214533daeecc16fc43ecc23c8260457eb634f728a",
  "packages/desktop/scripts/node-pty-package-assets.mjs":
    "0364c85cee2835cb4eb5cea29944b1e13e29751d4b1db4591a37a91d638b1860",
  "packages/desktop/test/nodePtyPackageVersion.test.mjs":
    "12fd009137260dd25c432df5ae532e95dd9cece6dd98de4e0c3f1bcdabd6568c",
  "packages/zcode-server-cli/src/packaging/stage.ts":
    "e867e435d26c274a0c2ed4a74cc5385843ed069983541c1b3ebd856ba9c29b85",
  "scripts/zcode-distribution/assets.mjs":
    "8c27ebeeee795240b10ea3f4100272f890815847b7f08f1c9ffd5736a3b1445b",
  "scripts/prepare-prebuilds.mjs":
    "dab9ef11ced5fc4e099bcede82bb12be79b0e098a9f8ea1d2aa5b629680c2c86",
  "scripts/node-pty-prebuild-assets.mjs":
    "640f4324b468a1cfac2c27d6c51fad5bfd69fdfc27d82d70e6e43178986d87c5",
  "scripts/node-pty-prebuild-assets.d.mts":
    "ba841a217ddffa6e4eb1c558223fc82284bfb1165b834ae74b78d2615d1ac308",
  "scripts/test/server-node-pty-assets.test.mjs":
    "aebfbb1dd4bf837a4df761a21123af14509cac105c56c18bbab2489c5627d1d2",
  "specs/server-node-pty-native-compatibility.md":
    "72a22156e53b382541369fb9e999df98cb0862e0214943c0eb3b2e32cb612924",
  "specs/node-pty-native-compatibility.md":
    "153f0ba7a09d311f8c03e0adbddc8e5b0e45b3cce1932505e03c88f34d4535be",
  "pnpm-lock.yaml":
    "02b16bfbfdc405a4465108a97dc0796757b2249960c42fdc1876082104981d09",
  "packages/desktop/native/macos-window-bounds/main.swift":
    "d0eb18e8fc42d4ab935d49e0823aa53ae14670237e51d3b058a021b661d4029a",
  "packages/desktop/scripts/target-platform.mjs":
    "9d685d42ba88fe84f5dccc56a32749b0ea3c50344d47ebf231dbb2d403b99e4e",
  "scripts/native-search-tools-config.mjs":
    "281d368464f61363fa2d8ab74f416962fe730dd0a0572db5564475f876bb65aa",
  "specs/desktop-secondary-process-exit.md":
    "fdcaa61ef8118d9d49ec9355b0e124deabb2a37ad1209ab47ae9cc671f6ee358",
  "specs/desktop-macos-asar-integrity-metadata.md":
    "99bb4731c8bc80b6382436a8aa8d9a219dbb5644a9193420a091f65bdfbc53d1",
  "packages/desktop/scripts/macos-asar-integrity-metadata.mjs":
    "08f3b769d078a218632c49e5c274fa217cc41ec1416bae326222b8842a654239",
  "packages/desktop/test/macosAsarIntegrityMetadataHelper.test.mjs":
    "460676bab33f0a9b6c37ba82027773a829f14edb780142485774b06ce05f5bf4",
  "packages/desktop/test/macosAsarIntegrityMetadata.integration.mjs":
    "ccd1a70dce84431963c99c58abc4ae496acf579f643255eb340a21aa390592d6",
};
const HEADER_INTEGRITY = {
  algorithm:
    "SHA256 of original UTF8 JSON string bytes from Pickle ReadString; not envelope/padding/normalized JSON",
  headerUtf8Bytes: 6366102,
  pickleBytes: 6366112,
  sha256: "11746f3ec705855710e8b7125919c61e02b363ac75e1ce456ef055e4532527a6",
  declaredHashMatches: true,
  twoInstalledReadersMatch: true,
};
const ORIGINAL_FUSES = {
  0: 49,
  1: 48,
  2: 49,
  3: 49,
  4: 48,
  5: 48,
  6: 48,
  7: 49,
  8: 49,
  version: "1",
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
    "f4cac9136226bc7e94edd9fcf8d2bba38f327803",
  );
  assert.equal(manifest.bundleIdentifier, "dev.zcode.app.preview");
  assert.deepEqual(manifest.sourceSha256, PRODUCER_SOURCE);
  assert.equal(Object.keys(manifest.sourceSha256).length, 33);
  assert.deepEqual(manifest.finalAsarHeaderIntegrity, HEADER_INTEGRITY);
  assert.deepEqual(manifest.originalFuseWire, ORIGINAL_FUSES);
  assert.equal(
    manifest.sourceSha256["specs/desktop-secondary-process-exit.md"],
    "fdcaa61ef8118d9d49ec9355b0e124deabb2a37ad1209ab47ae9cc671f6ee358",
    "Secondary exit and prewarm ownership spec is pinned",
  );
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
  const finalAsarHeaderIntegrity = await verifyMacAsarHeaderAndFuses(
    appPath,
    HEADER_INTEGRITY,
    ORIGINAL_FUSES,
  );
  return {
    appPath,
    executable: join(appPath, "Contents/MacOS/UWork Preview"),
    manifestPath: path,
    finalAsarHeaderIntegrity,
    verifiedRuntimeFiles: Object.keys(manifest.runtimeFiles),
    target: "darwin-x64",
    unavailableOptionalFiles: [OPTIONAL],
    translatedRuntimeAcceptance: false,
  };
}
