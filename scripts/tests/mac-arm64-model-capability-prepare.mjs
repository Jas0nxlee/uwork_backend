/** Prepare only: bind the original ARM64 app and the finite tools capability round trip. */
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
} from "../fixtures/native-packaged-macos-arm64-consistency-runtime.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-packaged-macos-clock-arm64-capability-v[0-9]+-20261021$/,
);
for (const base of ["data", "evidence"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh runtime and evidence roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME);
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const python = [
  "import runpy,pathlib,hashlib,json,sys",
  "m=runpy.run_path('scripts/tests/mac-arm64-model-capability-probe.py')",
  "s=m['derive_clock'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text())",
  "compile(s,'reviewed-original-clock','exec')",
  "g=runpy.run_path('scripts/tests/macos-clock-profile.test.py')",
  "g['check'](sys.argv[1])",
  "print(json.dumps({'derivedClockSha256':hashlib.sha256(s.encode()).hexdigest(),'actualDerivedCompile':True,'actualOriginalProfileGuard':True}))",
].join("; ");
const { stdout } = await promisify(execFile)(
  "python3",
  ["-c", python, profile],
  { cwd: repo, timeout: 10000 },
);
const contract = JSON.parse(stdout);
const sources = {};
for (const path of [
  "scripts/tests/mac-arm64-model-capability-prepare.mjs",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "scripts/tests/mac-arm64-model-capability.test.py",
  "scripts/fixtures/mac-arm64-model-capability-derived.mjs",
  "scripts/fixtures/mac-model-capability-stage.mjs",
  "scripts/fixtures/mac-model-capability-stage.test.mjs",
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/fixtures/native-first-run-ui.py",
  "scripts/tests/native-os-state-guard.swift",
  "src/app.ts",
  "src/models.ts",
  "src/gateway.ts",
  "src/db.ts",
  "src/client.ts",
  "src/client-usage.ts",
  "src/identity.ts",
  "src/directory.ts",
  "src/access.ts",
  "src/policy.ts",
  "src/entitlements.ts",
]) {
  sources[path] = createHash("sha256")
    .update(await readFile(join(repo, path)))
    .digest("hex");
}
assert.equal(
  sources["scripts/fixtures/mac-backend-stage-snapshot.mjs"],
  "3ed467f4cef4e3028969a7eb56b0cb4c98618119d5a3823e6c01520aa50ed063",
);
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-arm64",
  sourceCommit: "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  manifestPath,
  manifestSha256: ARM_MANIFEST_SHA,
  runtime,
  sources,
  ...contract,
  originalSevenChecksRetained: true,
  addedCase:
    "Same model ID tools capability true-false-true; original UI manual sync and two fresh tasks",
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  originalChildStdio: "ignore",
  originalSecondaryDeadlineMs: 10000,
  mutation:
    "Owned real Admin GET, full PUT with current revision and GET readback; only supportsTools and its revision change; restore true before original seat/logout checks",
  input:
    "Original identity manual sync, enterprise chat menu, draft then Composer send; same workspace and model, distinct task/session IDs",
  supplierOracle:
    "Two added requests per phase: stream main with exact cwd and user marker; separate original title system/hash and nonstream sidecar. Main tools32 then both tools/tool_choice absent then tools32",
  accounting:
    "Current ledger rows2-4-6, settled credits44-88-132, input24-48-72/output20-40-60; original records immutable; distinct other actor all business columns unchanged; Trace real sets/aggregate only, no request-key FK",
  rawInferencePosts:
    "4-6-8; no inference due solely to Admin change or UI sync",
  originalLaterZeroChecks:
    "Original initial2/44 assertions retained. Only after new task costs are independently settled and verified is delivered rebound to final6/132 for original seat/logout zero-delta checks",
  backendInitializedOnce: true,
  controlledModelContextWindow: 500000,
  noColdRecoverySliceRepeated: true,
  externalSampler: false,
  guiStarted: false,
  executionGate:
    "Root and independent peer exact plan SHA; exclusive Mac input owner",
};
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const path = join(directory, "preparation.json");
plan.runArgv = [
  "python3",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "--preparation",
  path,
  "--run",
  "--reviewed-plan-sha256",
  "<Root-reviewed-SHA>",
];
await writeFile(path, JSON.stringify(plan, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    planPath: path,
    planSHA: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    sourceCount: Object.keys(sources).length,
    ...contract,
    guiStarted: false,
  }),
);
