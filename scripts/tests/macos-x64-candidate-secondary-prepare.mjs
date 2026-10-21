/** Prepare one original secondary-process diagnostic; never starts the app. */
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
} from "../fixtures/native-packaged-macos-x64-secondary-exit-runtime.mjs";
import {
  deriveSecondaryFixture,
  validateSecondaryProfile,
} from "../fixtures/macos-x64-candidate-secondary-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = validateSecondaryProfile(process.argv[2]);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
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
const driver = "scripts/tests/macos-x64-candidate-secondary-probe.py";
const fixture = "scripts/fixtures/macos-x64-candidate-secondary-derived.mjs";
const derived = deriveSecondaryFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const { stdout } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,runpy,sys,json,hashlib; p=pathlib.Path(sys.argv[1]); compile(p.read_text(),str(p),'exec'); runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](sys.argv[2]); c=runpy.run_path('scripts/tests/macos-x64-candidate-secondary-probe.py'); d=c['deriveCandidateSecondaryProbe'](pathlib.Path('scripts/tests/macos-x64-secondary-probe.py').read_text()); compile(d,'actual-candidate-secondary-probe','exec'); m=runpy.run_path('scripts/tests/macos-x64-secondary-readiness.py'); s=m['deriveSecondaryReadiness'](pathlib.Path('scripts/tests/macos-x64-readiness.py').read_text()); compile(s,'actual-secondary-readiness-derived','exec'); print(json.dumps({'actualDriverCompile':True,'actualOriginalClockProfileGuard':True,'derivedProbeSha256':hashlib.sha256(d.encode()).hexdigest(),'derivedReadinessSha256':hashlib.sha256(s.encode()).hexdigest(),'actualDerivedReadinessCompile':True}))",
    driver,
    profile,
  ],
  { cwd: repo, timeout: 15000 },
);
const contracts = JSON.parse(stdout);
assert.equal(contracts.actualDerivedReadinessCompile, true);
const sources = {};
for (const path of [
  "scripts/tests/macos-x64-candidate-secondary-prepare.mjs",
  driver,
  fixture,
  "scripts/tests/macos-x64-candidate-secondary.test.py",
  "scripts/fixtures/macos-x64-secondary-derived.mjs",
  "scripts/tests/macos-x64-secondary-probe.py",
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/native-packaged-macos-x64-secondary-exit-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-x64-secondary-exit-runtime.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/macos-x64-clock-startup-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/macos-x64-secondary-readiness.py",
  "scripts/tests/macos-x64-secondary-readiness.test.py",
  "scripts/tests/macos-x64-clock-startup-log.py",
  "scripts/tests/macos-x64-startup-log.py",
  "scripts/tests/macos-x64-startup-log.test.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/tests/native-os-state-guard.swift",
  "scripts/fixtures/native-first-run-ui.py",
  "docs/client-macos-x64-secondary-exit-diagnostic-scope-2026-10-21.md",
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
  sourceCommit: "0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2",
  manifestPath,
  manifestSha256: X64_MANIFEST_SHA,
  runtime,
  sources,
  driverSha256: sources[driver],
  ...contracts,
  fixtureDerivedSha256: sha(derived),
  compiledFixturePath,
  actualDriverCompile: true,
  actualOriginalClockProfileGuard: true,
  compiledFixtureSyntaxExitCode: 0,
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  caseBudgetMs: 120000,
  cleanupReservedMs: 20000,
  primaryDiagnosticMaxMs: 60000,
  originalSecondaryDeadlineMs: 10000,
  originalSecondaryStdio: "ignore",
  diagnosticOnly: true,
  originalSevenAcceptance: false,
  physicalIntelAccepted: false,
  nodeInspectorEnabled: false,
  samplerEnabled: false,
  browserHarnessEnabled: false,
  scopeDocument:
    "docs/client-macos-x64-secondary-exit-diagnostic-scope-2026-10-21.md",
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
