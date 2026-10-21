import assert from "node:assert/strict";
import test from "node:test";
import { resolve, join } from "node:path";
import {
  gatewayHoldManifestInput,
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
} from "./native-packaged-macos-gateway-hold-runtime.mjs";
import { packagedManifestInput as originalInput } from "./native-packaged-macos-arm64-consistency-runtime.mjs";
const repo = resolve(import.meta.dirname, "../..");
const path = join(repo, "evidence", ARM_MANIFEST_NAME);
const mode = { experience: "enabled", otherMode: true };
const env = {
  UWORK_NATIVE_FIXTURE_NAME:
    "client-native-gateway-usage-macos-mounted-v1-20261021",
  UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
  UWORK_NATIVE_GATEWAY_USAGE_HOLD: "controlled",
  UWORK_NATIVE_PACKAGED_MANIFEST: path,
};
test("only the explicit owned transport hold maps to original strict artifact verification", () => {
  assert.equal(gatewayHoldManifestInput(path, repo, mode, env), path);
  assert.throws(() => originalInput(path, repo, mode));
  assert.equal(
    originalInput(path, repo, { experience: "enabled", otherMode: false }),
    path,
  );
});
for (const flag of [
  "UWORK_NATIVE_PRIMARY_LOGIN",
  "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
  "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
  "UWORK_NATIVE_VIEWER_AUTH",
  "UWORK_NATIVE_FILE_CONTEXT",
  "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
  "UWORK_NATIVE_CONFIGURATION_WITNESS",
])
  test(`rejects mixed ${flag} before artifact loading`, async () => {
    const mixed = { ...env, [flag]: "controlled" };
    assert.throws(() => gatewayHoldManifestInput(path, repo, mode, mixed));
    await assert.rejects(loadOwnedPackagedRuntime(path, repo, mode, mixed));
  });
test("wrong profile, absent hold, wrong experience and arbitrary other-mode declarations are rejected", () => {
  for (const changed of [
    { UWORK_NATIVE_FIXTURE_NAME: "client-native-gateway-usage-foreign" },
    { UWORK_NATIVE_GATEWAY_USAGE_HOLD: undefined },
    { UWORK_NATIVE_GATEWAY_USAGE_HOLD: "true" },
    { UWORK_NATIVE_CLIENT_EXPERIENCE: undefined },
  ])
    assert.throws(() =>
      gatewayHoldManifestInput(path, repo, mode, { ...env, ...changed }),
    );
  for (const changed of [
    { otherMode: false },
    { experience: "disabled" },
    { otherMode: true, unreviewed: true },
  ])
    assert.throws(() =>
      gatewayHoldManifestInput(path, repo, { ...mode, ...changed }, env),
    );
});
test("missing, foreign and noncanonical manifest cannot fall back to unpackaged launch", async () => {
  for (const input of [
    undefined,
    path.replace("v10", "v9"),
    repo + "/evidence/../evidence/" + ARM_MANIFEST_NAME,
    "/Applications/UWork.app",
  ]) {
    assert.throws(() => gatewayHoldManifestInput(input, repo, mode, env));
    await assert.rejects(loadOwnedPackagedRuntime(input, repo, mode, env));
  }
  assert.throws(() =>
    gatewayHoldManifestInput(path, repo, mode, {
      ...env,
      UWORK_NATIVE_PACKAGED_MANIFEST: path + ".other",
    }),
  );
});
test("guard validation does not mutate caller mode or environment", () => {
  const before = structuredClone({ mode, env });
  gatewayHoldManifestInput(path, repo, mode, env);
  assert.deepEqual({ mode, env }, before);
});
