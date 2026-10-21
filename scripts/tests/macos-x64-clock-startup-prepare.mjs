/** Exact profile-only continuation; original x64 package, seven checks and10s stay unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
import { promisify } from "node:util";
import {
  X64_MANIFEST_NAME,
  X64_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-x64-startup-runtime.mjs";
import {
  deriveClockStartupFixture,
  validateClockStartupProfile,
} from "../fixtures/macos-x64-clock-startup-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const profile = process.argv[2];
assert.equal(
  profile,
  "client-native-packaged-macos-clock-x64-startup-v2-20261021",
);
validateClockStartupProfile(profile);
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
const original = await readFile(
  join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
const entry = deriveClockStartupFixture(
  await readFile(
    join(repo, "scripts/fixtures/macos-x64-startup-derived.mjs"),
    "utf8",
  ),
);
assert.equal(entry.split("await import(originalUrl);").length, 2);
const scope = createContext({
  assert,
  createHash,
  resolve,
  pathToFileURL,
  process: {
    cwd: () => repo,
    env: {
      UWORK_NATIVE_FIXTURE_NAME: profile,
      UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
      UWORK_NATIVE_PACKAGED_MANIFEST: manifestPath,
    },
  },
  readFileSync: () => original,
  writeFileSync: () => {},
  registerHooks: () => {},
});
new Script(
  entry
    .replace(/^import .*;\n/gm, "")
    .replace(
      "await import(originalUrl);",
      "globalThis.prepared = {derivedSource};",
    ),
).runInContext(scope, { timeout: 1000 });
assert.equal(typeof scope.prepared.derivedSource, "string");
const python = [
  "import runpy,pathlib,hashlib,json,sys",
  "m=runpy.run_path('scripts/tests/macos-x64-clock-startup-probe.py')",
  "m['validate_variant_guards'](sys.argv[1])",
  "s=m['deriveClockStartupProbe'](pathlib.Path('scripts/tests/macos-x64-startup-probe.py').read_text())",
  "compile(s,'actual-x64-clock-startup-derived','exec')",
  "p=runpy.run_path('scripts/tests/macos-x64-clock-startup-log.py')",
  "r=p['deriveClockStartupLog'](pathlib.Path('scripts/tests/macos-x64-startup-log.py').read_text())",
  "compile(r,'actual-x64-clock-startup-log','exec')",
  "print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'readerDerivedSha256':hashlib.sha256(r.encode()).hexdigest(),'actualOriginalClockAndBothVariantGuards':True,'actualDerivedProbeCompile':True}))",
].join("; ");
const { stdout } = await promisify(execFile)(
  "python3",
  ["-c", python, profile],
  { cwd: repo, timeout: 15000 },
);
const contracts = JSON.parse(stdout),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = {};
for (const path of [
  "scripts/tests/macos-x64-clock-startup-prepare.mjs",
  "scripts/fixtures/macos-x64-clock-startup-derived.mjs",
  "scripts/tests/macos-x64-clock-startup-probe.py",
  "scripts/tests/macos-x64-clock-startup-log.py",
  "scripts/tests/macos-x64-clock-startup.test.py",
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.test.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-x64-startup-runtime.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/macos-x64-startup-probe.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/macos-x64-startup-observer.test.py",
  "scripts/tests/macos-x64-startup-log.py",
  "scripts/tests/macos-x64-startup-log.test.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-os-state-guard.swift",
  "scripts/fixtures/native-first-run-ui.py",
])
  sources[path] = sha(await readFile(join(repo, path)));
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiledPath = join(directory, "fixture-derived.mjs");
await writeFile(compiledPath, scope.prepared.derivedSource, {
  mode: 0o600,
  flag: "wx",
});
await promisify(execFile)(process.execPath, ["--check", compiledPath], {
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
  ...contracts,
  fixtureEntryDerivedSha256: sha(entry),
  fixtureDerivedSha256: sha(scope.prepared.derivedSource),
  actualTransformedFixtureGuardExecuted: true,
  actualDerivedEsmSyntaxExit: 0,
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  originalSecondaryBodyPreserved: true,
  originalSecondaryDeadlineMs: 10000,
  originalSecondaryStdio: "ignore",
  externalSamplerEnabled: false,
  uiChecks:
    "Original seven macos-clock assertions and original finally unchanged, plus original x64 Main/CLI/addon mappings",
  inputFixOnly:
    "New entry one profile literal, reader one PROFILE literal, probe two module paths; every old source/guard/input retained",
  diagnostic:
    "Original fixed private Main file four phases from original secondary PID pair; existing observer finally cannot replace original result or exception. No missing-log inference, timers, new stdio or sampler",
  helperAvailability:
    "Original producer unavailable optional Swift helper remains absent; no physical Intel acceptance",
  physicalIntelAccepted: false,
  guiStarted: false,
  executionGate:
    "Root and independent peer exact plan SHA; exclusive Mac input owner",
  runArgv: [
    "python3",
    "scripts/tests/macos-x64-clock-startup-probe.py",
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
    ...contracts,
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    actualTransformedFixtureGuardExecuted: true,
    guiStarted: false,
  }),
);
