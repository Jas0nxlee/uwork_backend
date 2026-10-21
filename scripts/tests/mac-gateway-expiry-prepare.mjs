/** Prepare only: original issuer60s, original identity timer, original transparent HTTP hold. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-gateway-hold-runtime.mjs";
import { gatewayUsageHoldModeEnabled } from "../fixtures/native-gateway-usage-hold.mjs";
import { deriveExpiryFixture } from "../fixtures/mac-gateway-expiry-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-gateway-usage-macos-mounted-v2-20261021$/,
);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh runtime, evidence and preparation roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME);
const fixtureEnvironment = {
  UWORK_NATIVE_FIXTURE_NAME: profile,
  UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
  UWORK_NATIVE_PACKAGED_MANIFEST: manifestPath,
  UWORK_NATIVE_GATEWAY_USAGE_HOLD: "controlled",
};
assert.equal(
  gatewayUsageHoldModeEnabled("enabled", false, "controlled", profile),
  true,
  "The original hold module must itself admit the exact new profile",
);
const runtime = await loadOwnedPackagedRuntime(
  manifestPath,
  repo,
  { experience: "enabled", otherMode: true },
  fixtureEnvironment,
);
const driver = "scripts/tests/mac-gateway-expiry-probe.py";
const fixture = "scripts/fixtures/mac-gateway-expiry-derived.mjs";
const original = await readFile(
  join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
const derived = deriveExpiryFixture(original);
assert.equal(typeof derived, "string");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const { stdout: probeContractText } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,sys,runpy,hashlib,json; p=pathlib.Path(sys.argv[1]); compile(p.read_text(),str(p),'exec'); m=runpy.run_path(str(p)); s=m['deriveExpiryProbe'](pathlib.Path('scripts/tests/mac-gateway-mounted-probe.py').read_text()); compile(s,'actual-expiry-derived','exec'); print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'actualDerivedProbeCompile':True}))",
    driver,
  ],
  { cwd: repo, timeout: 10000 },
);
const probeContract = JSON.parse(probeContractText);
const sources = {};
for (const path of [
  "scripts/tests/mac-gateway-expiry-prepare.mjs",
  driver,
  "scripts/tests/mac-gateway-expiry.test.py",
  fixture,
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/mac-gateway-expiry-setup.mjs",
  "scripts/fixtures/mac-gateway-expiry-setup.test.mjs",
  "scripts/fixtures/mac-gateway-mounted-derived.mjs",
  "scripts/tests/mac-gateway-mounted-probe.py",
  "scripts/fixtures/native-packaged-macos-gateway-hold-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-gateway-hold-runtime.test.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.test.mjs",
  "scripts/fixtures/native-gateway-usage-hold.mjs",
  "scripts/fixtures/native-gateway-usage-hold.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/fixtures/native-first-run-ui.py",
  "scripts/tests/native-os-state-guard.swift",
  "docs/client-macos-natural-expiry-consistency-spec-2026-10-21.md",
  "src/app.ts",
  "src/gateway.ts",
  "src/db.ts",
  "src/client.ts",
  "src/client-usage.ts",
  "src/identity.ts",
  "src/access.ts",
  "src/directory.ts",
  "src/models.ts",
  "src/policy.ts",
  "src/entitlements.ts",
  "clients/uwork/packages/services/src/enterprise-identity/enterpriseIdentityService.ts",
  "clients/uwork/packages/services/src/enterprise-identity/identitySessionStore.ts",
  "clients/uwork/packages/services/src/enterprise-identity/uworkIdentityAdapter.ts",
  "clients/uwork/packages/services/src/ucas-gateway/gatewayIdentityScope.ts",
  "clients/uwork/packages/services/src/ucas-gateway/uworkGatewayClient.ts",
])
  sources[path] = sha(await readFile(join(repo, path)));
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs");
await writeFile(compiledFixturePath, derived, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json");
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-arm64",
  sourceCommit: "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  manifestPath,
  manifestSha256: ARM_MANIFEST_SHA,
  runtime,
  sources,
  driverSha256: sources[driver],
  ...probeContract,
  fixtureDerivedSha256: sha(derived),
  compiledFixturePath,
  compiledFixtureSyntaxExitCode: 0,
  actualDriverCompile: true,
  actualOriginalHoldModeGuard: true,
  fixtureEnvironment,
  environmentConversion:
    "Only this owned fixture launch: remove default CONFIGURATION_WITNESS=enabled, add GATEWAY_USAGE_HOLD=controlled; retain explicit manifest and profile. All conflicting modes remain rejected",
  addedCase:
    "Original Mac Identity timer expires a real internally issued60s session; original signal aborts held200 and release cannot replay",
  initialSessionSetup:
    "Only a fresh current member test session is issued by original issueSession ttl60000; original GET/me and encrypted bootstrap store carry that real expiresAt. Not a public login TTL setting or original UI authentication test",
  ttlMs: 60000,
  noFakeClockOrRenewal:
    "No existing session mutation, manual expiry/store write, Date/timer replacement, explicit logout/revoke, new owner or silent token reissue",
  transport:
    "Original exact one-shot real month200 hold and original20s deadline; immutable original signed app and all original loader guards retained",
  expiryWindow:
    "Original Gateway ready with real remaining>8s, then real wait to remaining<=6s and>1.2s before original UI refresh; insufficient time fails without reissue",
  expiryOracle:
    "Real expiresAt passes; original UI signs out, original preexisting shared store read shows revision advance and session-null tombstone; backend expired row may remain",
  canceledOldResponse:
    "Original authority signal closes/aborts held response within unchanged20s; releaseRequested true but deliveryStarted/downstreamFinished false",
  uiOracle:
    "Six direct signed-out observations with no prior identity/account/allowance; panel may legitimately unmount. Original model menu, when accessible, has no retired UCAS candidate",
  baseline:
    "Current0, other original bootstrap2/44 retained; inference POST2/supplier2 and both actors all ledger/Trace/gateway rows remain unchanged",
  cleanup:
    "Exact owned process, port, browser control closure and original OS protocol restoration, with failed evidence retained",
  scopeDocument:
    "docs/client-macos-natural-expiry-consistency-spec-2026-10-21.md",
  backendInitializedOnce: true,
  warmInferenceRepeated: false,
  guiStarted: false,
  executionGate:
    "Root and independent peer exactSHA plus exclusive Mac input owner",
  runArgv: [
    "python3",
    driver,
    "--preparation",
    path,
    "--run",
    "--reviewed-plan-sha256",
    "<Root-reviewed-SHA>",
  ],
};
await writeFile(path, JSON.stringify(plan, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    planPath: path,
    planSHA: sha(await readFile(path)),
    sourceCount: Object.keys(sources).length,
    driverSha256: plan.driverSha256,
    ...probeContract,
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    actualDriverCompile: true,
    compiledFixtureSyntaxExitCode: 0,
    actualOriginalHoldModeGuard: true,
    guiStarted: false,
  }),
);
