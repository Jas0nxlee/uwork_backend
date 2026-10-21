/** Freeze normal native regression inputs; no application or GUI is started. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
import { promisify } from "node:util";
import {
  deriveSecondaryExitEntry,
  validateSecondaryExitProfile,
} from "../fixtures/macos-secondary-exit-derived.mjs";

const repo = resolve(import.meta.dirname, "../..");
const arch = process.argv[2];
const profile = validateSecondaryExitProfile(process.argv[3], arch);
assert.equal(
  profile,
  `client-native-packaged-macos-clock-${arch}-secondary-exit-v1-20261021`,
);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const loaderPath = `scripts/fixtures/native-packaged-macos-${arch}-secondary-exit-runtime.mjs`;
const loader = await import(pathToFileURL(join(repo, loaderPath)).href);
const manifestName =
  arch === "x64" ? loader.X64_MANIFEST_NAME : loader.ARM_MANIFEST_NAME;
const manifestSha =
  arch === "x64" ? loader.X64_MANIFEST_SHA : loader.ARM_MANIFEST_SHA;
const manifestPath = join(repo, "evidence", manifestName);
const runtime = await loader.loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const original = await readFile(
  join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
  "utf8",
);
const entry = deriveSecondaryExitEntry(
  await readFile(
    join(repo, "scripts/fixtures/macos-x64-startup-derived.mjs"),
    "utf8",
  ),
  arch,
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
      "globalThis.prepared={derivedSource};",
    ),
).runInContext(scope, { timeout: 1000 });
assert.equal(typeof scope.prepared.derivedSource, "string");
const { stdout } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,runpy,sys,hashlib,json; m=runpy.run_path('scripts/tests/macos-secondary-exit-probe.py'); m['validate_secondary_exit_guards'](sys.argv[1],sys.argv[2]); s=m['deriveSecondaryExitProbe'](pathlib.Path('scripts/tests/macos-x64-startup-probe.py').read_text(),sys.argv[2]); compile(s,'actual-secondary-exit-original-seven','exec'); p=runpy.run_path('scripts/tests/macos-secondary-exit-log.py'); r=p['deriveSecondaryExitLog'](pathlib.Path('scripts/tests/macos-x64-startup-log.py').read_text()); compile(r,'actual-secondary-exit-log','exec'); print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'readerDerivedSha256':hashlib.sha256(r.encode()).hexdigest(),'actualOriginalClockAndVariantGuards':True,'actualDerivedProbeCompile':True}))",
    profile,
    arch,
  ],
  { cwd: repo, timeout: 15000 },
);
const contracts = JSON.parse(stdout);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const sources = {};
for (const path of [
  "scripts/tests/macos-secondary-exit-prepare.mjs",
  "scripts/fixtures/macos-secondary-exit-derived.mjs",
  "scripts/tests/macos-secondary-exit-probe.py",
  "scripts/tests/macos-secondary-exit-log.py",
  "scripts/tests/macos-secondary-exit.test.py",
  loaderPath,
  loaderPath.replace(/\.mjs$/, ".test.mjs"),
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.mjs",
  "scripts/fixtures/macos-x64-startup-derived.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/macos-x64-clock-startup-probe.py",
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
  ...(arch === "x64"
    ? [
        "scripts/tests/macos-architecture-warning-dismiss.py",
        "scripts/tests/macos-architecture-warning-dismiss.test.py",
        "scripts/tests/macos-ax-driver.py",
        "clients/uwork/packages/desktop/src/main/desktopArchitectureGuard.ts",
      ]
    : []),
  "clients/uwork/specs/desktop-secondary-process-exit.md",
])
  sources[path] = sha(await readFile(join(repo, path)));
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs");
await writeFile(compiledFixturePath, scope.prepared.derivedSource, {
  mode: 0o600,
  flag: "wx",
});
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json");
const plan = {
  status: "prepared-not-run",
  profile,
  target: `darwin-${arch}`,
  arch,
  sourceCommit: "0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2",
  manifestPath,
  manifestSha256: manifestSha,
  runtime,
  sources,
  ...contracts,
  fixtureEntryDerivedSha256: sha(entry),
  fixtureDerivedSha256: sha(scope.prepared.derivedSource),
  compiledFixturePath,
  actualTransformedFixtureGuardExecuted: true,
  actualDerivedEsmSyntaxExit: 0,
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  originalSecondaryDeadlineMs: 10000,
  originalSecondaryStdio: "ignore",
  rendererReadinessMs: 30000,
  originalSevenAssertionsUnchanged: true,
  physicalIntelAccepted: false,
  architectureWarning:
    "Only owned x64 Main original warning may be cancelled using its exact original cancel button; no download, no other dialog, no global input",
  guiStarted: false,
  executionGate:
    "Root+independent exactSHA review; one Mac input owner; no retry",
  runArgv: [
    "python3",
    "scripts/tests/macos-secondary-exit-probe.py",
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
    target: plan.target,
    ...contracts,
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    guiStarted: false,
  }),
);
