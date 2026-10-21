/** Explicit owned transport-only test adapter; the original signed app is unchanged. */
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  ARM_MANIFEST_NAME,
  packagedManifestInput as originalManifestInput,
  loadOwnedPackagedRuntime as loadOriginalRuntime,
} from "./native-packaged-macos-arm64-consistency-runtime.mjs";
export {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  ARM_APP_PATH,
  validateArmManifest,
} from "./native-packaged-macos-arm64-consistency-runtime.mjs";
const CONFLICTS = [
  "UWORK_NATIVE_PRIMARY_LOGIN",
  "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
  "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
  "UWORK_NATIVE_VIEWER_AUTH",
  "UWORK_NATIVE_FILE_CONTEXT",
  "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
  "UWORK_NATIVE_CONFIGURATION_WITNESS",
];
const ORIGINAL_ARTIFACT_MODE = Object.freeze({
  experience: "enabled",
  otherMode: false,
});
/** Admit this exact new fixture mode, never an arbitrary otherMode or missing manifest. */
export function gatewayHoldManifestInput(
  input,
  repo,
  mode,
  environment = process.env,
) {
  assert.deepEqual(Object.keys(mode).sort(), ["experience", "otherMode"]);
  assert.equal(mode.experience, "enabled");
  assert.equal(
    mode.otherMode,
    true,
    "Only the explicitly declared HTTP hold mode is admitted",
  );
  assert.match(
    environment.UWORK_NATIVE_FIXTURE_NAME ?? "",
    /^client-native-gateway-usage-macos-mounted-v[0-9]+-20261021$/,
  );
  assert.equal(environment.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(environment.UWORK_NATIVE_GATEWAY_USAGE_HOLD, "controlled");
  for (const flag of CONFLICTS)
    assert.equal(environment[flag], undefined, flag);
  assert.equal(
    typeof input,
    "string",
    "Packaged manifest is mandatory; no unpackaged fallback",
  );
  assert.equal(input, join(repo, "evidence", ARM_MANIFEST_NAME));
  assert.equal(environment.UWORK_NATIVE_PACKAGED_MANIFEST, input);
  // This normalization is permitted only after the complete transport-only scope above.
  // No Electron Session/auth interception, Main/preload/store override or new identity owner.
  return originalManifestInput(input, repo, ORIGINAL_ARTIFACT_MODE);
}
export async function loadOwnedPackagedRuntime(
  input,
  repo,
  mode,
  environment = process.env,
) {
  const path = gatewayHoldManifestInput(input, repo, mode, environment);
  // Reuse every original manifest SHA, producer source, resource, native Mach-O,
  // executable/helper permission, bundle identity and strict codesign check unchanged.
  return loadOriginalRuntime(path, repo, ORIGINAL_ARTIFACT_MODE);
}
