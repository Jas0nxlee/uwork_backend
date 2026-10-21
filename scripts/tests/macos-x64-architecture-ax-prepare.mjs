/** Prepare only: strict v14 readback and pure compilation; never launch an App or listener. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { promisify } from "node:util";
import { parse } from "acorn";
import {
  X64_MANIFEST_NAME,
  X64_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-x64-asar-integrity-runtime.mjs";
import {
  PROFILE,
  validateArchitectureAXProfile,
  deriveArchitectureAXFixture,
} from "../fixtures/macos-x64-architecture-ax-derived.mjs";
const repo = resolve(import.meta.dirname, "../..");
const manifestPath = join(repo, "evidence", X64_MANIFEST_NAME);
validateArchitectureAXProfile(process.argv[2], {
  UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
  UWORK_NATIVE_CONFIGURATION_WITNESS: "enabled",
  UWORK_NATIVE_PACKAGED_MANIFEST: manifestPath,
});
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, PROFILE));
    assert.fail("Fresh case roots required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fixtureDerived = deriveArchitectureAXFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const driver = "scripts/tests/macos-x64-architecture-ax-probe.py";
const scope =
  "docs/client-macos-x64-architecture-ax-diagnostic-scope-2026-10-21.md";
const oldPlanPath = join(
  repo,
  "data/sandbox-verification/client-native-packaged-macos-clock-x64-asar-integrity-v1-20261021/preparation.json",
);
const oldPlan = JSON.parse(await readFile(oldPlanPath, "utf8"));
const paths = new Set([
  ...Object.keys(oldPlan.sources),
  driver,
  scope,
  "scripts/tests/macos-x64-architecture-ax-prepare.mjs",
  "scripts/tests/macos-x64-architecture-ax-reader.py",
  "scripts/tests/macos-x64-architecture-ax.test.py",
  "scripts/fixtures/macos-x64-architecture-ax-derived.mjs",
  "scripts/tests/macos-x64-secondary-probe.py",
  "scripts/tests/macos-x64-secondary-readiness.py",
  "scripts/tests/macos-x64-secondary-readiness.test.py",
  "scripts/fixtures/macos-x64-secondary-derived.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/tests/macos-architecture-warning-dismiss.py",
  "scripts/tests/macos-ax-driver.py",
]);
// Bind every relative ESM fixture import used by the actual derived Common, not just the new entry.
async function visit(path) {
  const text = await readFile(join(repo, path), "utf8");
  const tree = parse(text, { ecmaVersion: "latest", sourceType: "module" });
  for (const node of tree.body) {
    if (
      ![
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(node.type) ||
      !node.source?.value?.startsWith(".")
    )
      continue;
    const target = resolve(repo, dirname(path), node.source.value);
    if (
      !target.startsWith(join(repo, "scripts/fixtures") + "/") ||
      !target.endsWith(".mjs")
    )
      continue;
    const relative = target.slice(repo.length + 1);
    if (!paths.has(relative)) {
      paths.add(relative);
      await visit(relative);
    }
  }
}
for (const path of [...paths])
  if (path.startsWith("scripts/fixtures/") && path.endsWith(".mjs"))
    await visit(path);
const sources = {};
for (const path of [...paths].sort())
  sources[path] = sha(await readFile(join(repo, path)));
const { stdout } = await promisify(execFile)(
  "python3",
  [
    "-c",
    "import pathlib,runpy,hashlib,json,sys; m=runpy.run_path('scripts/tests/macos-x64-architecture-ax-probe.py');runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](sys.argv[1]);s=m['deriveArchitectureAXProbe'](pathlib.Path('scripts/tests/macos-x64-secondary-probe.py').read_text());compile(s,'actual-AX-readonly-probe','exec');runpy.run_path('scripts/tests/macos-x64-architecture-ax.test.py')['ReadonlyAX']('test_actual_fixture_launch_env_admits_only_original_witness_enabled').test_actual_fixture_launch_env_admits_only_original_witness_enabled(); print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'originalClockGuardPassed':True,'actualFixtureLaunchEnvVerified':True}))",
    PROFILE,
  ],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
const derived = JSON.parse(stdout);
const directory = join(repo, "data/sandbox-verification", PROFILE);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs");
const compiledProbePath = join(directory, "probe-derived.py");
await writeFile(compiledFixturePath, fixtureDerived, {
  mode: 0o600,
  flag: "wx",
});
await writeFile(compiledProbePath, derived.source, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json");
const plan = {
  status: "prepared-not-run",
  profile: PROFILE,
  target: "darwin-x64",
  sourceCommit: "f4cac9136226bc7e94edd9fcf8d2bba38f327803",
  manifestPath,
  manifestSha256: X64_MANIFEST_SHA,
  runtime,
  sources,
  driverSha256: sources[driver],
  fixtureDerivedSha256: sha(fixtureDerived),
  derivedProbeSha256: derived.sha256,
  compiledFixturePath,
  compiledProbePath,
  scopeDocument: scope,
  caseBudgetMs: 90000,
  cleanupReservedMs: 20000,
  primaryDiagnosticMaxMs: 60000,
  axObservationMaxMs: 5000,
  axMessagingTimeoutSeconds: [0.1, 0.75],
  originalThirtySecondsAcceptance: false,
  originalSevenAcceptance: false,
  readOnlyAX: true,
  axActions: false,
  secondaryDispatched: false,
  browserHarnessEnabled: false,
  modelBusinessEnabled: false,
  guiStarted: false,
  actualOriginalClockGuard: derived.originalClockGuardPassed,
  actualDerivedFixtureSyntaxExitCode: 0,
  actualDerivedProbeCompile: true,
  actualFixtureLaunchEnvVerified: derived.actualFixtureLaunchEnvVerified,
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
    planSha256: sha(await readFile(path)),
    sourceCount: Object.keys(sources).length,
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    derivedProbeSha256: plan.derivedProbeSha256,
    guiStarted: false,
  }),
);
