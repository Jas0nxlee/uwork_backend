/** Read-only artifact verification and pure derivation; never launches the fixture. */
import assert from "node:assert/strict";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import {
  deriveCrashFixture,
  CRASH_PROFILE,
} from "../fixtures/mac-arm64-crash-consistency-derived.mjs";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = CRASH_PROFILE;
assert.ok(process.argv[2] === undefined || process.argv[2] === profile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
for (const base of ["data", "evidence"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME);
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const basePlan = JSON.parse(
  await readFile(
    join(
      repo,
      "data/sandbox-verification/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/preparation.json",
    ),
  ),
);
const actualArmPlan = JSON.parse(
  await readFile(
    join(
      repo,
      "data/sandbox-verification/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/preparation.json",
    ),
  ),
);
const extras = [
  "scripts/fixtures/mac-arm64-crash-consistency-derived.mjs",
  "scripts/fixtures/mac-arm64-crash-consistency-derived.test.mjs",
  "scripts/fixtures/mac-arm64-crash-consistency-process.mjs",
  "scripts/fixtures/mac-arm64-crash-consistency-process.test.mjs",
  "scripts/tests/mac-arm64-crash-consistency-probe.py",
  "scripts/tests/mac-arm64-crash-consistency.test.py",
  "scripts/tests/mac-arm64-crash-consistency-prepare.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.test.mjs",
  "docs/client-macos-crash-task-consistency-spec-2026-10-21.md",
];
const sources = {};
for (const path of [
  ...new Set([
    ...Object.keys(basePlan.sources),
    ...Object.keys(actualArmPlan.sources),
    ...extras,
  ]),
])
  sources[path] = hash(await readFile(join(repo, path)));
assert.equal(
  sources["scripts/fixtures/mac-backend-stage-snapshot.mjs"],
  "3ed467f4cef4e3028969a7eb56b0cb4c98618119d5a3823e6c01520aa50ed063",
);
const python =
  "import runpy,pathlib,json,hashlib; m=runpy.run_path('scripts/tests/mac-arm64-crash-consistency-probe.py');m['validate_original_profile'](m['PROFILE']);s=m['deriveCrashProbe'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text());compile(s,'actual-derived-crash-probe','exec');print(json.dumps({'derivedClockSha256':hashlib.sha256(s.encode()).hexdigest(),'actualOriginalProfileGuard':True,'actualDerivedCompile':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 10000,
    })
  ).stdout,
);
const fixture = deriveCrashFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiled = join(directory, "fixture-derived.mjs");
await writeFile(compiled, fixture, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiled], {
  cwd: repo,
  timeout: 10000,
});
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-arm64",
  sourceCommit: "0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2",
  manifestPath,
  manifestSha256: ARM_MANIFEST_SHA,
  runtime,
  sources,
  ...contract,
  fixtureDerivedSha256: hash(fixture),
  compiledFixturePath: compiled,
  scope:
    "first-five-original-warm-controls plus exact Main SIGKILL and5s old-generation observation only",
  originalSevenAccepted: false,
  scopeOmissions: [
    "same-profile recovery",
    "restored old-task semantics",
    "new task after recovery",
    "seat/logout/cold at new-task baseline",
  ],
  originalChildStdio: "ignore",
  originalSecondaryDeadlineMs: 10000,
  rendererReadinessMs: 30000,
  crashSignal: "SIGKILL",
  crashObservationMs: 5000,
  crashGroup:
    "actual child Handle / birth / mapped MH_EXECUTE / PGID==MainPID; full group identity revalidated before signal",
  residualPolicy:
    "First save original failure. Exact captured identity cleanup only. No recovery continuation, no lock/WAL/lease rewrite.",
  backendOracle:
    "Existing Db SELECT helper only; current/other ledger/gateway/Trace full rows, actual raw inference count and supplier full-request digests",
  guiStarted: false,
  executionGate: "Root and independent exact-SHA peer; no run in preparation",
  runArgv: [
    "python3",
    "scripts/tests/mac-arm64-crash-consistency-probe.py",
    "--preparation",
    join(directory, "preparation.json"),
    "--run",
    "--reviewed-plan-sha256",
    "<Root-reviewed-SHA>",
  ],
};
const path = join(directory, "preparation.json");
await writeFile(path, JSON.stringify(plan, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    planPath: path,
    planSHA: hash(await readFile(path)),
    sourceCount: Object.keys(sources).length,
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    ...contract,
    guiStarted: false,
  }),
);
