/** Frozen owned ARM64 memory manifest admission fix only; does not relax the shared arm64 fixture loader. */
import assert from "node:assert/strict";
import { verifyMacAsarHeaderAndFuses } from "./native-packaged-macos-asar-integrity.mjs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";

export const ARM_MANIFEST_NAME =
  "client-macos-package-v16-arm64-memory-manifest-manifest-20261021.json";
export const ARM_MANIFEST_SHA =
  "aca34443c6adcd0ad203508edef1cc8bdc85e65df6b561ad880755dd50921118";
export const ARM_APP_PATH = join(
  userInfo().homedir,
  "Library/Caches/uwork-backend/client-macos-package-20261021-v16-arm64-memory-manifest/mac-arm64/UWork Preview.app",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PINNED = {
  "app.asar":
    "bf94f23401a00a73fbcc2b1d016de29d85ae7d9c5eb8a77b4a914ffac7c8fb40",
  "glm/zcode.cjs":
    "334df1b5c817915b9a6f9eb7f2d694a97fe9ff343d8ef1544dc3f208e40622df",
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
    "25ef3fa7e9833d7e18695ae8d973c622500f666f3c5c0f324916411911a52832",
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
const PRODUCER_SOURCE = {
  ".gitignore":
    "70b72acb40b1f76a260c5f21f453785c586695ca2073b67203e404f1c276d552",
  "apps/zcode-cli/package.json":
    "6c48017b05d8a7215c5bf7dea12f50edd1487bf5b8b22e11c21703d32e8f7742",
  "apps/zcode-cli/packages/cli/scripts/build.mjs":
    "9d2f9e4f5455eb2829fd7e514b416a8b5f402efa1f8bb95d4aaa6067296481b5",
  "apps/zcode-cli/packages/core/src/memory/directory.ts":
    "120da3008011611ec8da290a9e4f5af232f1d1e7e42011b674473c945cb1d0b0",
  "apps/zcode-cli/packages/core/src/runtime/helpers/attachment-authorization.ts":
    "8a0aba92069a3b4a0297432166044b25d9b6a10b3563c35d4e2060c12203ec4f",
  "apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-extraction.ts":
    "a56feb17988682be122a2876c65bd26bea1b5d925a290f531f8e87edb89a036f",
  "apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-index.ts":
    "0cce48059d874fd377b7c18d86b73607ed96a69a0a81c5dbe127ddd5d6496ebb",
  "apps/zcode-cli/packages/core/src/runtime/internal-methods.ts":
    "5628349d23b2cd9323084aae2be83463759bc37c27b48f2a667c3f98d1f52929",
  "apps/zcode-cli/packages/core/src/runtime/methods/context.ts":
    "8629f84140b5be06d4778f735588aa71dae135be74fecd69859acddbf83076a3",
  "apps/zcode-cli/packages/core/src/runtime/methods/turn.ts":
    "caef31aed9e735908080e17a8b309fffdb27ccc20af4ffc842cc26cc8e718c35",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-context.test.ts":
    "67d2509dc583c987a19050fcce89d22253d8b73d636088bb150f6363b09b6339",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-manifest-boundary.test.ts":
    "e46bf082389232539f3c9b31d188da07aa547b1d186bb4a552a347ebab638428",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-manifest-config.test.ts":
    "4835164e097f60ca55ee0ce9812100583ba115de7386c1459b3b05925787f085",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-manifest.fixture.ts":
    "4a768e491e0c21d9d62de93e31f4dfbd66e096733448fee1164ad2a81069de4a",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-manifest.test.ts":
    "a13969a4bc52f27507f2e685a19836b85a021c9920fcdc4414339251818056a6",
  "apps/zcode-cli/packages/core/test/enterprise-project-memory-runtime.fixture.ts":
    "db4df4f72ae901701a9089b70679abd065f13c4631ba11c37a6b2964a4ebb02c",
  "apps/zcode-cli/pnpm-lock.yaml":
    "335fd413718d3f631024d608f29cbe32caffebfd816308a34b536d40c59f0477",
  "package.json":
    "ac7a3186e711969be096a8e5f49fa8f3be4be90aaed05bd9962d511fa2a93e20",
  "packages/desktop/electron-builder.config.js":
    "993e61fe3df54f8b71ae21f7dd3adae49380af85c67330237d1f691514301885",
  "packages/desktop/native/macos-window-bounds/main.swift":
    "d0eb18e8fc42d4ab935d49e0823aa53ae14670237e51d3b058a021b661d4029a",
  "packages/desktop/scripts/build-macos-window-bounds.mjs":
    "1cd87af63e4b409956f79946f9fbbd0b42ed13f712200ad428042930ae594713",
  "packages/desktop/scripts/macos-asar-integrity-metadata.mjs":
    "08f3b769d078a218632c49e5c274fa217cc41ec1416bae326222b8842a654239",
  "packages/desktop/scripts/node-pty-package-assets.mjs":
    "0364c85cee2835cb4eb5cea29944b1e13e29751d4b1db4591a37a91d638b1860",
  "packages/desktop/scripts/prepare-runtime-assets.mjs":
    "5db7c14a25decf94d256e809364ddf2f40446c317e16b23fcd87bd8e6dd1996a",
  "packages/desktop/scripts/stage-agent-bundle.mjs":
    "45d486d1f27e468f804341b4e82ed34576e1e1b7331f248e3df213fa91fa5644",
  "packages/desktop/scripts/target-platform.mjs":
    "9d685d42ba88fe84f5dccc56a32749b0ea3c50344d47ebf231dbb2d403b99e4e",
  "packages/desktop/src/main/desktopDeepLinkUrl.ts":
    "619377c7458d678d1f1c585981cc8daf34996618dcd7a75970b51025dfab3100",
  "packages/desktop/src/main/desktopSingleInstanceStartupLog.ts":
    "1d0dfc037703ad583b08eb8ae30090ddf4d52861b7a6c13321ab2f571b90e620",
  "packages/desktop/src/main/index.ts":
    "ee27b495126ef1e47d5f2d3737426f10713e2cac2ceb7eb58040945073aab094",
  "packages/desktop/test/desktopSingleInstanceStartupLog.integration.mjs":
    "eeb8fad9202b8f305ba166f55f7d8500a89e3ab9fd8706af97780d52f62daa01",
  "packages/desktop/test/desktopSingleInstanceStartupLog.test.ts":
    "1a8f4cc28d212b02f73884e9346e736833d541546ff390a4ae9c3edc00be7cfa",
  "packages/desktop/test/desktopSingleInstanceWire.test.ts":
    "7794eaff97ee0262a828ed45a0baf77f6c4a9c260514ff0b757c0e843c240468",
  "packages/desktop/test/externalWorkspaceConfirmation.fixture.mjs":
    "d29b8d0fe8e82e01b0b384819b124d54e32aec6ae8c8426ac7fd29a0a8ce4e10",
  "packages/desktop/test/externalWorkspaceConfirmation.integration.mjs":
    "4a4921bba0ee8d06d1a6fd21c6f1e8ede16298816a4f177ebf28aaa18d9755a9",
  "packages/desktop/test/macosAsarIntegrityMetadata.integration.mjs":
    "ccd1a70dce84431963c99c58abc4ae496acf579f643255eb340a21aa390592d6",
  "packages/desktop/test/macosAsarIntegrityMetadataHelper.test.mjs":
    "460676bab33f0a9b6c37ba82027773a829f14edb780142485774b06ce05f5bf4",
  "packages/desktop/test/nodePtyPackageVersion.test.mjs":
    "12fd009137260dd25c432df5ae532e95dd9cece6dd98de4e0c3f1bcdabd6568c",
  "packages/provider/src/config-service.ts":
    "0c7626b69145feae4e8a436810748543c2946e73e01473ff3061d9a7cf658205",
  "packages/server/package.json":
    "c999480d4c74449f3ef04aa214533daeecc16fc43ecc23c8260457eb634f728a",
  "packages/services/src/enterprise-identity/uworkToolAuthorization.ts":
    "55f83c9676898c28af7b50b2c21fe2256867215e0e5466a00e84ae71e519b6a6",
  "packages/services/src/model-provider/gatewayModelSelectionSource.ts":
    "e93289ef2f78dd6262d76b17911ebcc83f4522a77e6dac1943be53412c0aeaf9",
  "packages/services/src/model-provider/gatewayProviderProvisioning.ts":
    "4892e098a271fa2b44a0972acb917bae7396b1135defd8120e4532e4ad5790a8",
  "packages/services/src/model-provider/providerFacadeServices.ts":
    "c983230f181c149513ae713c061ff4a3e85bbdf9f7f7dde3b667615437ecf024",
  "packages/services/src/model-provider/providerRuntime.ts":
    "fa5c2cbd21a56243660f696e41238199ee5ae382d5c596ad1a186a409d308dbb",
  "packages/services/src/node.ts":
    "b9e7f64ac8d07f6d0b925e9bbef0d7d151bdd1365bc3fe4468834181d475ce8a",
  "packages/services/src/ucas-gateway/CONTRACT.md":
    "106514ff6797c716880f7ca3f7fdae8b3dd1dedf0e472eabddd51c8ddd704583",
  "packages/services/src/ucas-gateway/contract.ts":
    "3b5b0571d52f7c1e99c0e11bf4ec4890921c0e2a2af6388eaa9d8f158da9f2d3",
  "packages/services/src/ucas-gateway/gatewayCatalogLifecycle.ts":
    "5f762202cb184fa3c9c266459497a4002e8064e3192f4ea07565d3cb82fdb03e",
  "packages/services/src/ucas-gateway/gatewayIdentityScope.ts":
    "ccc71b3aefd32e1cc785b744d9655a223c1c433778159a5e6c2789fa98a9ef7c",
  "packages/services/src/ucas-gateway/gatewayProjectionAdmission.ts":
    "394d2c55f1eaf826436fdac118fa6ca3d99c9d9281e95baef48337e9f5f6d03f",
  "packages/services/src/ucas-gateway/ucasGatewayService.ts":
    "9156e3b155dabeae4f2aca64587c46bc4957a51787d53fd7d4ff280f512a63fb",
  "packages/services/test/enterpriseGatewayCatalog.fixture.ts":
    "48b90bf05f37623fa5b17175e8795413cf5a4573afacb88f6952cec9e3994f1d",
  "packages/services/test/enterpriseGatewayLogoutCatalog.test.ts":
    "4bd6212c7d1e27e13b789902db4e63bfdfccb372622ddb42d1fa85f7183c9d5b",
  "packages/services/test/enterpriseProjectMemoryManifestAuthorization.test.ts":
    "3442f151dcdddb0f06e08a669a3beae99b4d3d7c4bae1c81aaac9347af33be45",
  "packages/services/test/uworkToolAuthorization.test.ts":
    "6676fb90431ea8f3db31c35f9fc302d5a18224b0130503b551480659d8351e78",
  "packages/services/tsconfig.enterprise-gateway-catalog-test.json":
    "bd1effdb3cee6b0b4aac01e16da46d40a34531e2d30f3d3f8b6a79c137714b1d",
  "packages/shared/src/zcode-protocol/index.ts":
    "914132116cf6aed072854d42f03b061b56aa306efeca0bdb9e203dcdd029c885",
  "packages/shared/test/enterpriseProjectMemoryAuthorization.test.ts":
    "04b5314d7f3e1dd052606399598699b2b79bd86382652f4814bb28a8784072c2",
  "packages/shared/test/enterpriseProjectMemoryManifestAuthorization.test.ts":
    "699644eaf9770fd8a36778edd9ae3a01e0ebccc9dd53a1088aca28744f2c95d9",
  "packages/ui/src/hooks/useModelSelectionView.ts":
    "e79f1e66d9907547cfc452408e1006cd52bcc293a6f1be11244caf32cf557026",
  "packages/ui/src/root/useRootPlatformEffects.ts":
    "93db5b44f1ebd99eb5d373375541e478ebe865eec18b268227afc63f90836866",
  "packages/ui/test/modelCatalogInvalidation.test.mjs":
    "04595069051870cd4df498f054f743636510333dabf9af5f324347f6ea0b9736",
  "packages/zcode-server-cli/src/packaging/stage.ts":
    "e867e435d26c274a0c2ed4a74cc5385843ed069983541c1b3ebd856ba9c29b85",
  "pnpm-lock.yaml":
    "02b16bfbfdc405a4465108a97dc0796757b2249960c42fdc1876082104981d09",
  "scripts/build-desktop-agent-cli.mjs":
    "38151c65c8a399a4218350768f56d288eeee10cd3c8717a4bec25cc30ad9658f",
  "scripts/builtin-provider-config.mjs":
    "f9f8900d3081dfb70ebc44f92f6c789928a73663d57d2be3ee257c7ab74fbbf2",
  "scripts/native-search-tools-config.mjs":
    "281d368464f61363fa2d8ab74f416962fe730dd0a0572db5564475f876bb65aa",
  "scripts/node-pty-prebuild-assets.d.mts":
    "ba841a217ddffa6e4eb1c558223fc82284bfb1165b834ae74b78d2615d1ac308",
  "scripts/node-pty-prebuild-assets.mjs":
    "640f4324b468a1cfac2c27d6c51fad5bfd69fdfc27d82d70e6e43178986d87c5",
  "scripts/prepare-prebuilds.mjs":
    "dab9ef11ced5fc4e099bcede82bb12be79b0e098a9f8ea1d2aa5b629680c2c86",
  "scripts/spawn-command.mjs":
    "efa07620ef0b683244e3827a8e8d8ebd369180881be4b1f7b599296feb266e38",
  "scripts/test/server-node-pty-assets.test.mjs":
    "aebfbb1dd4bf837a4df761a21123af14509cac105c56c18bbab2489c5627d1d2",
  "scripts/zcode-distribution/assets.mjs":
    "8c27ebeeee795240b10ea3f4100272f890815847b7f08f1c9ffd5736a3b1445b",
  "specs/desktop-macos-asar-integrity-metadata.md":
    "99bb4731c8bc80b6382436a8aa8d9a219dbb5644a9193420a091f65bdfbc53d1",
  "specs/desktop-secondary-process-exit.md":
    "fdcaa61ef8118d9d49ec9355b0e124deabb2a37ad1209ab47ae9cc671f6ee358",
  "specs/desktop-single-instance-startup-observability.md":
    "1cb4ad08d778aa58b2fbc02d77521b8c8db5f80f95034df273916c7423d5967c",
  "specs/enterprise-model-catalog-projection.md":
    "aebf646092c163bc34f5cf76508dac36de90bedda569576ab3d90fee464af68a",
  "specs/enterprise-project-memory-context.md":
    "b436712e1556b88c8b3cd8fe9f62795f912218545ba0ceed6f81ee73a23e5bfb",
  "specs/enterprise-project-memory-manifest-admission.md":
    "cd91eef02ebc58bfcf2232a627eaa6b48ee38ea5a23b0a36899226a709e4fa63",
  "specs/enterprise-settings-sync-skills.md":
    "e2d943596080f994b1470be203a32b5dc9e67b1a8283486e0d43a5d94f724c05",
  "specs/linux-rpm-uninstall.md":
    "b72c081e06e0c206c0d9baadbf74e0d2d65d761aef0957d381b7e6ae0bdbac22",
  "specs/node-pty-native-compatibility.md":
    "153f0ba7a09d311f8c03e0adbddc8e5b0e45b3cce1932505e03c88f34d4535be",
  "specs/second-instance-native-confirmation.md":
    "e9b1f1409e08fc4f21a40d4cb065df6b1bd0419cac60ce03bd45e6925b9b4ae1",
  "specs/server-node-pty-native-compatibility.md":
    "72a22156e53b382541369fb9e999df98cb0862e0214943c0eb3b2e32cb612924",
};
const HEADER_INTEGRITY = {
  algorithm:
    "SHA256 of original UTF8 JSON string bytes from Pickle ReadString; not envelope/padding/normalized JSON",
  headerUtf8Bytes: 6369261,
  pickleBytes: 6369272,
  sha256: "ccab3518bd0f5e202d6aa714c909387f2ad843bb417ab8226f7495edb1c72be1",
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
    "d14eef850eca3fd5c76c82a5243b4f72d4ffc3e5",
  );
  assert.equal(manifest.bundleIdentifier, "dev.zcode.app.preview");
  assert.equal(manifest.cliSourceRebuilt, true);
  assert.equal(manifest.cliTripleEquality.sha256, PINNED["glm/zcode.cjs"]);
  assert.equal(manifest.cliTripleEquality.bytes, 16582840);
  assert.deepEqual(manifest.sourceSha256, PRODUCER_SOURCE);
  assert.equal(Object.keys(manifest.sourceSha256).length, 84);
  assert.deepEqual(manifest.finalAsarHeaderIntegrity, HEADER_INTEGRITY);
  assert.deepEqual(manifest.originalFuseWire, ORIGINAL_FUSES);
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
    target: "darwin-arm64",
    unavailableOptionalFiles: [],
    physicalRuntimeAcceptance: false,
  };
}
