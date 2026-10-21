/** Freeze one Native PDF sharing case; never starts App, fixture, HTTP or GUI. */
import assert from "node:assert/strict";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import {
  deriveShareArtifactFixture,
  SHARE_PROFILE,
} from "../fixtures/mac-native-share-artifact-derived.mjs";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile =
  "client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021";
assert.equal(SHARE_PROFILE, profile);
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
const previous = await Promise.all(
  [
    "data/sandbox-verification/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/preparation.json",
    "data/sandbox-verification/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/preparation.json",
    "evidence/client-macos-native-share-artifact-readonly-20261021/facts.json",
  ].map(async (path) => JSON.parse(await readFile(join(repo, path), "utf8"))),
);
const extras = [
  "scripts/fixtures/mac-native-share-artifact-pdf.mjs",
  "scripts/fixtures/mac-native-share-artifact-pdf.test.mjs",
  "scripts/fixtures/mac-native-share-artifact-https.mjs",
  "scripts/fixtures/mac-native-share-artifact-https.test.mjs",
  "scripts/fixtures/mac-native-share-artifact-derived.mjs",
  "scripts/fixtures/mac-native-share-artifact-derived.test.mjs",
  "scripts/fixtures/macos-x64-secondary-derived.mjs",
  "scripts/tests/mac-native-share-artifact-probe.py",
  "scripts/tests/mac-native-share-artifact.test.py",
  "scripts/tests/mac-native-share-artifact-prepare.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.test.mjs",
  "docs/client-macos-native-share-artifact-readonly-scope-2026-10-21.md",
];
const sources = {};
for (const path of new Set([
  ...previous.flatMap((plan) => Object.keys(plan.sources)),
  ...extras,
])) {
  sources[path] = hash(await readFile(join(repo, path)));
}
assert.equal(
  sources["scripts/fixtures/mac-backend-stage-snapshot.mjs"],
  "3ed467f4cef4e3028969a7eb56b0cb4c98618119d5a3823e6c01520aa50ed063",
);
const python =
  "import runpy,pathlib,json,hashlib; m=runpy.run_path('scripts/tests/mac-native-share-artifact-probe.py');m['validate_original_profile'](m['PROFILE']);s=m['deriveShareArtifactProbe'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text());compile(s,'actual-derived-share-artifact-probe','exec');print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'actualOriginalProfileGuard':True,'actualDerivedCompile':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 10000,
    })
  ).stdout,
);
const fixture = deriveShareArtifactFixture(
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
    "Original Native xterm creates one valid PDF; real Composer response preview; original Native Share publishes exactly one PDF; original authenticated HTTP download and four-way SHA verification",
  originalSevenAccepted: false,
  privateElectronUserData:
    "Primary uses only this fresh case root/userdata via inherited owned secondary diagnostic derivation; original secondary function and 10s budget unchanged",
  rendererReadinessMs: 30000,
  originalSecondaryDeadlineMs: 10000,
  expectedModelAccounting: {
    currentRows: 2,
    settled: 2,
    credits: 44,
    inputTokens: 24,
    outputTokens: 20,
  },
  sharingAccounting:
    "raw inference POST, full supplier digests and current/other full ledger/Trace/gateway rows unchanged from pre-share baseline",
  fileOracle:
    "Valid original workspace PDF bytes; source/upload/DB BLOB/authenticated download bytes/SHA/length match; original manifest artifact_count=1, pdf type and application/pdf MIME",
  inputPolicy:
    "Original Admin revision-safe GET/PUT/publish/readback for organization sharing/files and allowFilesystem, preserve other fields; no store/descriptor injection",
  cleanup:
    "Original DELETE revokes only this case share, then exact owned Native/BH/PID/TCP/UNIX/OS restoration; no default browser or clipboard",
  guiStarted: false,
  executionGate:
    "Root and independent exact-SHA review; one exclusive Mac GUI case",
  runArgv: [
    "python3",
    "scripts/tests/mac-native-share-artifact-probe.py",
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
