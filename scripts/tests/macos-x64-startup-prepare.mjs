/** Read-only frozen package verification plus finite fresh plan; never starts a fixture or GUI. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  loadOwnedPackagedRuntime,
  X64_MANIFEST_NAME,
  X64_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-x64-startup-runtime.mjs";
const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-packaged-macos-x64-startup-v[0-9]+-20261020$/,
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
const marker = "async function openWorkspace(workspacePath) {";
const stop = "async function stopNative() {";
assert.equal(original.split(marker).length, 2);
assert.equal(original.split(stop).length, 2);
const originalBody = original.slice(
  original.indexOf(marker),
  original.indexOf(stop, original.indexOf(marker)),
);
const bodySha = createHash("sha256").update(originalBody).digest("hex");
assert.equal(
  bodySha,
  "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
);
const loaderAnchor =
  'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";';
assert.equal(original.split(loaderAnchor).length, 2);
const derived = await readFile(
  join(repo, "scripts/fixtures/macos-x64-startup-derived.mjs"),
  "utf8",
);
assert.ok(
  derived.includes('"./native-packaged-macos-x64-startup-runtime.mjs"'),
);
const sources = {};
for (const path of [
  originalPath,
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.test.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-x64-startup-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/macos-x64-startup-observer.test.py",
  "scripts/tests/macos-x64-startup-log.py",
  "scripts/tests/macos-x64-startup-log.test.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/tests/macos-x64-startup-prepare.mjs",
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
  sourceCommit: "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  manifestPath,
  manifestSha256: X64_MANIFEST_SHA,
  runtime,
  sources,
  originalSharedFixtureUnchanged: true,
  originalSecondaryFunctionSha256: bodySha,
  originalSecondaryBodyPreserved: true,
  originalSecondaryStdio: "original ignore; no FD or timing injection",
  externalSamplerEnabled: false,
  fixedPhaseProjection:
    "Read only original Main private file under fresh own0700 ancestors, original event.started/exit pair PID correlation; allowed phase/acquired/finiteelapsed/time only; summary0600, originalfile644 not claimed0600",
  fixtureDerivation:
    "Exact single runtime-loader import replacement plus previously approved lawful controlled model500000 metadata and passive byte receipts; original Main/Host/CLI behavior retained",
  diagnostic:
    "Original started/exit event rows and one bounded readonly startup projection after originalcommand; fixed private Main file phases by same PIDpair; entire observer errors isolated from originalresult/exception; original7chain10s/order preserved; no sampler/stdioderivation",
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
    "scripts/tests/macos-x64-startup-probe.py",
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
