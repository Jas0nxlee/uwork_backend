/** Exact fresh recovery plan only; no fixture/App execution. */
import assert from "node:assert/strict";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import {
  deriveCrashRecoveryFixture,
  RECOVERY_PROFILE,
} from "../fixtures/mac-arm64-crash-recovery-derived.mjs";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = RECOVERY_PROFILE,
  hash = (value) => createHash("sha256").update(value).digest("hex");
assert.ok(process.argv[2] === undefined || process.argv[2] === profile);
for (const base of ["data", "evidence"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
    experience: "enabled",
    otherMode: false,
  });
const previous = JSON.parse(
  await readFile(
    join(
      repo,
      "data/sandbox-verification/client-native-packaged-macos-clock-arm64-consistency-v4-20261021/preparation.json",
    ),
  ),
);
const sources = {};
for (const name of [
  ...new Set([
    ...Object.keys(previous.sources),
    "scripts/fixtures/mac-arm64-crash-recovery-derived.mjs",
    "scripts/fixtures/mac-arm64-crash-recovery-derived.test.mjs",
    "scripts/tests/mac-arm64-crash-recovery-probe.py",
    "scripts/tests/mac-arm64-crash-recovery.test.py",
    "scripts/tests/mac-arm64-crash-recovery-prepare.mjs",
    "scripts/tests/mac-arm64-model-capability-probe.py",
    "scripts/fixtures/mac-model-capability-stage.mjs",
    "scripts/fixtures/mac-model-capability-stage.test.mjs",
  ]),
])
  sources[name] = hash(await readFile(join(repo, name)));
for (const [name, digest] of Object.entries(previous.sources))
  assert.equal(sources[name], digest, "Frozen v4 input changed: " + name);
const python =
  "import runpy,pathlib,json,hashlib; m=runpy.run_path('scripts/tests/mac-arm64-crash-recovery-probe.py');m['validate_original_profile'](m['PROFILE']);s=m['deriveCrashRecoveryProbe'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text());compile(s,'actual-derived-recovery-probe','exec');print(json.dumps({'derivedClockSha256':hashlib.sha256(s.encode()).hexdigest(),'actualOriginalProfileGuard':True,'actualDerivedCompile':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 10000,
    })
  ).stdout,
);
const fixture = deriveCrashRecoveryFixture(
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
    "Original7 retained plus actual SIGKILL completed-task recovery zero replay and distinct UI task B",
  checksExpected: 9,
  originalSecondaryDeadlineMs: 10000,
  originalChildStdio: "ignore",
  rendererReadinessMs: 30000,
  crashObservationMs: 5000,
  originalCrashAction:
    "Exact v4 helper and Main child Handle/PGID SIGKILL; residual first FAILED then exact cleanup, no recovery continuation",
  recovery:
    "Original launch same controller/profile, UI opens same completed A, fixed readonly database semantics equal; full dual actor rows/raw/supplier digests zero increment",
  newTask:
    "Original enterprise-menu-chat and Composer B new session, actual main+title marker/cwd/tool classification; current exact +2settled44/24input20output; new CLI actual kernel MH_EXECUTE/ancestry/cwd/DBFD; A unchanged",
  postSendBaseline: {
    own: {
      count: 4,
      settled: 4,
      amount: 88,
      inputTokens: 48,
      outputTokens: 40,
    },
    totalSupplierCalls: 6,
    other: "full baseline rows unchanged",
  },
  seatLogoutCold:
    "Original assertions retained with delivered reset to post-B baseline; all earlier Main generations excluded for logout cold",
  v4All55SourcesStillFrozen: true,
  noDirectRuntimeSendResume: true,
  noStoreLockLeaseWalRewrite: true,
  guiStarted: false,
  executionGate:
    "Root plus independent exact-SHA peer and exclusive Mac GUI; preparation never executes run",
  runArgv: [
    "python3",
    "scripts/tests/mac-arm64-crash-recovery-probe.py",
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
