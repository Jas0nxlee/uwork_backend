/** Read-only frozen package verification plus finite fresh plan; never starts a fixture or GUI. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { instrumentOwnedWorkspaceChild } from "../fixtures/native-macos-x64-secondary-logs.mjs";
import {
  loadOwnedPackagedRuntime,
  X64_MANIFEST_NAME,
  X64_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-x64-runtime.mjs";
const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-packaged-macos-clock-x64-v[0-9]+-20261020$/,
);
const manifestPath = join(repo, "evidence", X64_MANIFEST_NAME);
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
for (const base of ["data", "evidence"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh run roots required");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const originalPath = "scripts/fixtures/client-native-enterprise.mjs";
const original = await readFile(join(repo, originalPath), "utf8");
const secondaryDerivation = instrumentOwnedWorkspaceChild(original);
const loaderAnchor =
  'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";';
assert.equal(original.split(loaderAnchor).length, 2);
const derived = await readFile(
  join(repo, "scripts/fixtures/macos-x64-derived.mjs"),
  "utf8",
);
assert.ok(derived.includes('"./native-packaged-macos-x64-runtime.mjs"'));
const sources = {};
for (const path of [
  originalPath,
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/fixtures/macos-x64-derived.mjs",
  "scripts/fixtures/native-macos-x64-secondary-logs.mjs",
  "scripts/fixtures/native-macos-x64-secondary-logs.test.mjs",
  "scripts/fixtures/native-macos-x64-secondary-sample.mjs",
  "scripts/fixtures/native-macos-x64-secondary-sample.test.mjs",
  "scripts/fixtures/native-packaged-macos-x64-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-x64-runtime.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-x64-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/macos-x64-secondary-evidence.test.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/tests/macos-x64-prepare.mjs",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-os-state-guard.swift",
  "scripts/fixtures/native-first-run-ui.py",
]) {
  sources[path] = createHash("sha256")
    .update(await readFile(join(repo, path)))
    .digest("hex");
}
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-x64",
  sourceCommit: "1bd1ec7b9949353ae11390e020a58b0fe7719c3e",
  manifestPath,
  manifestSha256: X64_MANIFEST_SHA,
  runtime,
  sources,
  originalSharedFixtureUnchanged: true,
  originalSecondaryFunctionSha256: secondaryDerivation.originalFunctionSha256,
  secondaryLogs:
    "Only original child stdout/stderr direct wx0600 FDs; finally closes parent handles; bounded lifecycle summary, no env capture",
  secondarySample:
    "Passive spawn+8s /usr/bin/sample 1s only original child with handle/PID/birth/exact exe guards before/after; precreated wx0600 output; no env; bounded exact sampler reap; false closure is failure; original10s remains",
  fixtureDerivation:
    "Exact single runtime-loader import replacement plus previously approved lawful controlled model500000 metadata and passive byte receipts; original Main/Host/CLI behavior retained",
  diagnostic:
    "Only Fixture.command finally snapshots original workspace-secondary-started/exit rows; one bounded readonly startup projection after original command; original 10s secondary/launch/business order unchanged; only exact owned secondary function stdio uses wx0600 direct FDs with finally close and monotonic command/spawn/exit timing, no env capture",
  uiChecks:
    "Original seven macos-clock checks unchanged; additional live owned Main/CLI x64 Mach-O mapping and loaded exact NAPI addon mapping",
  executionGate:
    "No GUI until Root and independent peer review this exact plan SHA and assign exclusive Mac window",
  controlledModelContextWindow: 500000,
  helperAvailability:
    "unavailable; strict absence; original producer warning/fallback; not a verified core resource",
  physicalIntelAccepted: false,
  guiStarted: false,
  runArgv: [
    "python3",
    "scripts/tests/macos-x64-probe.py",
    "--preparation",
    "<this-exact-preparation.json>",
    "--run",
    "--reviewed-plan-sha256",
    "<Root-reviewed-SHA>",
  ],
  hardStops: [
    "Frozen source/resource/signature mismatch",
    "Cannot bind exact owned PID to original x64 runtime",
    "x64 NAPI addon not mapped during actual PTY",
    "Any original seven assertion or cleanup failure",
    "AX/OS permission prompt; no global OS keyboard/mouse/clipboard",
  ],
  excluded: [
    "Physical Intel acceptance",
    "Missing Swift helper functional acceptance",
    "WeCom browser OAuth",
    "External MCP",
    "Cloud drive",
    "Other platform aggregate acceptance",
  ],
};
assert.equal(
  await readFile(join(repo, originalPath), "utf8"),
  original,
  "Original shared fixture changed during prepare",
);
const root = join(repo, "data/sandbox-verification", profile);
await mkdir(root, { mode: 0o700 });
await writeFile(
  join(root, "preparation.json"),
  JSON.stringify(plan, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    planPath: join(root, "preparation.json"),
    planSha256: createHash("sha256")
      .update(await readFile(join(root, "preparation.json")))
      .digest("hex"),
    guiStarted: false,
  }),
);
