/** Prepare only: original Native plugin installation and same-call Skill body consumption. */
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
import { derivePluginFixture } from "../fixtures/mac-plugin-skill-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021$/,
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
  UWORK_NATIVE_CONFIGURATION_WITNESS: "enabled",
};
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const driver = "scripts/tests/mac-plugin-skill-probe.py";
const fixture = "scripts/fixtures/mac-plugin-skill-derived.mjs";
const original = await readFile(
  join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
const derived = derivePluginFixture(original);
assert.equal(typeof derived, "string");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const { stdout: probeContractText } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,sys,runpy,hashlib,json; p=pathlib.Path(sys.argv[1]); compile(p.read_text(),str(p),'exec'); m=runpy.run_path(str(p)); s=m['derivePluginProbe'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text()); compile(s,'actual-plugin-derived','exec'); g=runpy.run_path('scripts/tests/macos-clock-profile.test.py'); g['check'](sys.argv[2]); print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'actualDerivedProbeCompile':True,'actualOriginalClockProfileGuard':True}))",
    driver,
    profile,
  ],
  { cwd: repo, timeout: 10000 },
);
const probeContract = JSON.parse(probeContractText);
const sources = {};
for (const path of [
  "scripts/tests/mac-plugin-skill-prepare.mjs",
  "scripts/tests/mac-plugin-skill-probe.py",
  "scripts/tests/mac-plugin-skill.test.py",
  fixture,
  "scripts/fixtures/mac-plugin-skill-package.mjs",
  "scripts/fixtures/mac-plugin-skill-package.test.mjs",
  "scripts/fixtures/mac-plugin-skill-oracle.mjs",
  "scripts/fixtures/mac-plugin-skill-oracle.test.mjs",
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/fixtures/native-first-run-ui.py",
  "scripts/tests/native-os-state-guard.swift",
  "docs/client-macos-plugin-skill-body-consistency-spec-2026-10-21.md",
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
  actualOriginalClockProfileGuard: true,
  fixtureEnvironment,
  environmentConversion:
    "Original ordinary experience/configuration-witness inputs; no hold, file-context, primary or identity interception mode",
  addedCase:
    "Original UI User plugin install, original Composer Skill invocation, same-call actual tool body forwarded into successor model request",
  package:
    "Self-owned loopback marketplace uwork-native-bridge-market, plugin uwork-native-bridge-plugin@uwork-native-bridge-market, qualifiedSkill uwork-native-bridge-plugin:bridge. Only manifest and SKILL.md; no MCP/hook/script",
  installation:
    "Original Settings/User Add Source and exact Install input; installed strip and enabled User row. No prewritten install record/cache or RPC substitution",
  originalPermissions:
    "Original published fileSystem/personal.skills/dangerousSkills prerequisites and production SkillPort admission retained",
  taskInput:
    "Original private workspace/new draft/Composer sends RUN marker only; body sentinel exists only in owned SKILL.md",
  supplierOracle:
    "Actual streamed main emits original Skill call with fixed ID and qualified alias; actual successor roletool same call_id must include body sentinel and original baseDirectory attested by readonly canonical current profile cache/SKILL/manifest hashes before final answer",
  accounting:
    "Original other2 calls/44 seed retained. Expected current3 new settled66/input36/output30 and rawPOST/supplier2-5, exact original row/key/model/actor and Trace set aggregates; other all rows unchanged",
  controlledModelContextWindow: 500000,
  noFalseEquivalence:
    "Native install/card alone, parent text alone, Host/CLI-only skill test or title request is not this Native body result. Default market directory reads are not official market acceptance",
  cleanup:
    "Exact owned PID/port/browser/OS closure; failed evidence retained, no automatic retry or reduced assertions",
  scopeDocument:
    "docs/client-macos-plugin-skill-body-consistency-spec-2026-10-21.md",
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
    actualOriginalClockProfileGuard: true,
    guiStarted: false,
  }),
);
