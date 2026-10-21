/** Prepare a finite Main CPU diagnostic; never starts the application. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import {
  X64_MANIFEST_NAME,
  X64_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-x64-startup-runtime.mjs";
import {
  deriveMainCpuFixture,
  validateMainCpuProfile,
} from "../fixtures/macos-x64-cpu-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = validateMainCpuProfile(process.argv[2]);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh runtime, evidence and preparation roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestPath = join(repo, "evidence", X64_MANIFEST_NAME);
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const driver = "scripts/tests/macos-x64-cpu-probe.py";
const fixture = "scripts/fixtures/macos-x64-cpu-derived.mjs";
const derived = deriveMainCpuFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const { stdout } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,runpy,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_text(),str(p),'exec'); g=runpy.run_path('scripts/tests/macos-clock-profile.test.py'); g['check'](sys.argv[2]); print('actual-driver-compile-and-original-clock-profile-guard-passed')",
    driver,
    profile,
  ],
  { cwd: repo, timeout: 15000 },
);
assert.equal(
  stdout.trim(),
  "actual-driver-compile-and-original-clock-profile-guard-passed",
);
const sources = {};
for (const path of [
  "scripts/tests/macos-x64-cpu-prepare.mjs",
  driver,
  "scripts/tests/macos-x64-cpu.test.py",
  fixture,
  "scripts/fixtures/macos-x64-cpu-runtime.mjs",
  "scripts/fixtures/macos-x64-cpu-module-graph.test.mjs",
  "scripts/fixtures/macos-x64-cpu-handler.test.mjs",
  "data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v4-20261021/fixture-derived.mjs",
  "data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v3-20261021/fixture-derived.mjs",
  "scripts/fixtures/owned-main-cpu-profiler.mjs",
  "scripts/fixtures/owned-main-cpu-profiler.test.mjs",
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/macos-x64-clock-startup-probe.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/tests/native-os-state-guard.swift",
  "scripts/fixtures/native-first-run-ui.py",
  "docs/client-macos-x64-cpu-diagnostic-scope-2026-10-21.md",
  "src/app.ts",
  "src/models.ts",
  "src/gateway.ts",
  "src/db.ts",
  "src/client.ts",
  "src/client-usage.ts",
  "src/identity.ts",
  "src/access.ts",
  "src/directory.ts",
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
  target: "darwin-x64",
  sourceCommit: "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  manifestPath,
  manifestSha256: X64_MANIFEST_SHA,
  runtime,
  sources,
  driverSha256: sources[driver],
  fixtureDerivedSha256: sha(derived),
  compiledFixturePath,
  actualDriverCompile: true,
  actualOriginalClockProfileGuard: true,
  compiledFixtureSyntaxExitCode: 0,
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  diagnosticOnly: true,
  originalSevenAcceptance: false,
  physicalIntelAccepted: false,
  originalSecondaryExecuted: false,
  caseBudgetMs: 90000,
  cleanupReservedMs: 20000,
  discoveryMaxMs: 40000,
  cpuDurationMs: 30000,
  helperMaxTotalMs: 45000,
  rpcMaxMs: 15000,
  actorGuardMaxMs: 3000,
  scopeDocument: "docs/client-macos-x64-cpu-diagnostic-scope-2026-10-21.md",
  guiStarted: false,
  runArgv: [
    "python3",
    driver,
    "--preparation",
    path,
    "--run",
    "--reviewed-plan-sha256",
    "<exact-reviewed-SHA>",
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
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    guiStarted: false,
  }),
);
