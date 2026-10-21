/** Prepare only: known transparent HTTP hold, immutable signed app, original UI. */
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
import { deriveMountedFixture } from "../fixtures/mac-gateway-mounted-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-gateway-usage-macos-mounted-v[0-9]+-20261021$/,
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
const driver = "scripts/tests/mac-gateway-mounted-probe.py";
const fixture = "scripts/fixtures/mac-gateway-mounted-derived.mjs";
const original = await readFile(
  join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
const derived = deriveMountedFixture(original);
assert.equal(typeof derived, "string");
const sha = (value) => createHash("sha256").update(value).digest("hex");
await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_text(),str(p),'exec')",
    driver,
  ],
  { cwd: repo, timeout: 10000 },
);
const sources = {};
for (const path of [
  "scripts/tests/mac-gateway-mounted-prepare.mjs",
  driver,
  "scripts/tests/mac-gateway-mounted.test.py",
  fixture,
  "scripts/fixtures/client-native-enterprise.mjs",
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
  "docs/client-macos-mounted-gateway-consistency-spec-2026-10-21.md",
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
  fixtureDerivedSha256: sha(derived),
  compiledFixturePath,
  compiledFixtureSyntaxExitCode: 0,
  actualDriverCompile: true,
  actualOriginalHoldModeGuard: true,
  fixtureEnvironment,
  environmentConversion:
    "Only this owned fixture launch: remove default CONFIGURATION_WITNESS=enabled, add GATEWAY_USAGE_HOLD=controlled; retain explicit manifest and profile. All conflicting modes remain rejected",
  addedCase:
    "Same mounted Gateway: original month HTTP200 held, formal backend logout, original7d401 retires projection, old200 actually finishes with no resurrection",
  transport:
    "Original one-shot exact URL hold, unmodified headers/body/delivery. New strict transport-only test adapter reuses every original artifact check; original loader/mode guards unchanged",
  immutableIdentity:
    "No Main/preload/store injection, local Identity owner replacement, local IdP or real WeCom navigation",
  requestDeadlineMs: 20000,
  successfulLateDelivery:
    "deliveryStarted and downstreamFinished true, no upstreamAborted or transportError; completion within original20s",
  sameMount:
    "Unique DOM backendNodeId remains across baseline/held/401/release and six direct post-release observations, with stable original Main and browser session",
  baseline:
    "Original other member two bootstrap calls/44 Credit retained; current zero. Supplier2/rawPOST2, current and other entire ledger/Trace/gateway sets must remain unchanged",
  cleanup:
    "Exact owned process/port/browser control closure and original OS protocol restoration; failures retained without automatic retry",
  scopeDocument:
    "docs/client-macos-mounted-gateway-consistency-spec-2026-10-21.md",
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
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    actualDriverCompile: true,
    compiledFixtureSyntaxExitCode: 0,
    actualOriginalHoldModeGuard: true,
    guiStarted: false,
  }),
);
