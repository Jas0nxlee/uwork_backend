/** Freeze fresh active Quit v5 only; all checks are artifact reads or pure contracts. */
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname, extname } from "node:path";
import ts from "typescript";
import {
  deriveActiveQuitFixture,
  ACTIVE_QUIT_PROFILE,
} from "../fixtures/mac-native-active-quit-v15-derived.mjs";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-project-memory-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = ACTIVE_QUIT_PROFILE,
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.ok(process.argv[2] === undefined || process.argv[2] === profile);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const oldPlanPath = join(
    repo,
    "data/sandbox-verification/client-native-packaged-macos-clock-arm64-active-quit-v4-20261021/preparation.json",
  ),
  oldPlanBytes = await readFile(oldPlanPath),
  oldPlan = JSON.parse(oldPlanBytes);
assert.equal(
  sha(oldPlanBytes),
  "92afce0f60d44305203d40a81063b1f5e87be8a6ca54db3d0c91d5949a3a253b",
);
for (const [p, h] of Object.entries(oldPlan.sources))
  assert.equal(sha(await readFile(join(repo, p))), h, p);
const rejectedV5Root = join(
  repo,
  "evidence/client-macos-active-quit-v15-preparation-20261021/before-safe-cleanup-review",
);
const rejectedV5 = JSON.parse(
  await readFile(join(rejectedV5Root, "preparation/preparation.json"), "utf8"),
);
assert.equal(
  sha(await readFile(join(rejectedV5Root, "preparation/preparation.json"))),
  "b21941a468c12c051d8f32a4981e351dcac9c35e2e7076c64dfb9e8e871e7b63",
);
assert.equal(
  sha(
    await readFile(
      join(
        repo,
        "data/sandbox-verification/client-native-packaged-macos-clock-arm64-active-quit-v5-20261021/preparation.json",
      ),
    ),
  ),
  "b21941a468c12c051d8f32a4981e351dcac9c35e2e7076c64dfb9e8e871e7b63",
);
for (const [p, h] of Object.entries(rejectedV5.sources))
  assert.equal(
    sha(await readFile(join(rejectedV5Root, "reviewed-sources", p))),
    h,
    p,
  );
const previousV6Root = join(
  repo,
  "evidence/client-macos-active-quit-v15-preparation-20261021/before-traceback-review",
);
const previousV6 = JSON.parse(
  await readFile(join(previousV6Root, "preparation/preparation.json"), "utf8"),
);
assert.equal(
  sha(await readFile(join(previousV6Root, "preparation/preparation.json"))),
  "c9a6eb12eef9b07fcb1bf9560a0f1ba1fdb55ef2c2a57aba8fd5b6c732e636d5",
);
for (const [p, h] of Object.entries(previousV6.sources))
  assert.equal(
    sha(await readFile(join(previousV6Root, "reviewed-sources", p))),
    h,
    p,
  );
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
    experience: "enabled",
    otherMode: false,
  }),
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.sourceCommit, "500914dfe27f96d9db74381c6828244390413281");
const driver = "scripts/tests/mac-native-active-quit-v15-probe.py",
  scope = "docs/client-macos-active-quit-v15-prepare-scope-2026-10-21.md";
const paths = new Set([
  ...Object.keys(oldPlan.sources),
  ...Object.keys(manifest.sourceSha256).map((p) => "clients/uwork/" + p),
  driver,
  scope,
  "scripts/tests/mac-native-active-quit-v15-prepare.mjs",
  "scripts/tests/mac-native-active-quit-v15.test.py",
  "scripts/tests/mac-native-active-quit-diagnostics.test.py",
  "evidence/client-macos-active-quit-v15-preparation-20261021/before-traceback-review/preparation/probe-derived.py",
  "scripts/tests/native-safe-cleanup.py",
  "scripts/tests/native-safe-cleanup.test.py",
  "evidence/client-macos-active-quit-v15-preparation-20261021/before-safe-cleanup-review/preparation/probe-derived.py",
  "scripts/fixtures/mac-native-active-quit-v15-derived.mjs",
  "scripts/fixtures/mac-native-active-quit-v15-derived.test.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-project-memory-runtime.mjs",
  "scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs",
  "scripts/tests/mac-arm64-memory-probe.py",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "scripts/tests/native_workspace_evidence.py",
  "package.json",
  "package-lock.json",
  "clients/uwork/pnpm-lock.yaml",
  "clients/uwork/apps/zcode-cli/pnpm-lock.yaml",
  "evidence/client-macos-goal-continuation-audit-20261021/current-session-after-memory-policy-fix.json",
]);
const session = JSON.parse(
  await readFile(
    join(
      repo,
      "evidence/client-macos-goal-continuation-audit-20261021/current-session-after-memory-policy-fix.json",
    ),
    "utf8",
  ),
);
assert.equal(session.kCGSSessionOnConsoleKey, true);
assert.equal(session.kCGSessionLoginDoneKey, true);
assert.equal(session.CGSSessionScreenIsLocked, null);
const seen = new Set();
async function visit(path, sourceOverride) {
  if (seen.has(path)) return;
  seen.add(path);
  const tree = ts.createSourceFile(
    path,
    sourceOverride ?? (await readFile(join(repo, path), "utf8")),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const n of tree.statements) {
    if (
      (!ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)) ||
      n.importClause?.isTypeOnly === true ||
      n.isTypeOnly === true
    )
      continue;
    const spec = n.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith("."))
      continue;
    const absolute = resolve(repo, dirname(path), spec.text);
    assert.ok(absolute.startsWith(repo + "/"));
    const rel = absolute.slice(repo.length + 1),
      choices = rel.endsWith(".js")
        ? [rel.slice(0, -3) + ".ts", rel]
        : extname(rel)
          ? [rel]
          : [rel + ".ts", rel + "/index.ts"];
    let found;
    for (const c of choices) {
      try {
        await access(join(repo, c));
        found = c;
        break;
      } catch {}
    }
    assert.ok(found, "Missing runtime relative source " + rel);
    paths.add(found);
    await visit(found);
  }
}
const fixture = deriveActiveQuitFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
for (const p of [...paths])
  if (p.endsWith(".mjs") && p.startsWith("scripts/fixtures/")) await visit(p);
await visit("scripts/fixtures/client-native-enterprise-derived.mjs", fixture);
const python =
  "import sys,pathlib,runpy,hashlib,json;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()));seen=[];original=runpy.run_path;defn='def capture(path,*a,**kw):\\n p=pathlib.Path(path).resolve();seen.append(str(p.relative_to(pathlib.Path.cwd())))\\n return original(path,*a,**kw)';exec(defn);runpy.run_path=capture;m=runpy.run_path('scripts/tests/mac-native-active-quit-v15-probe.py');m['validate_profile'](m['PROFILE']);s=m['deriveActiveQuitProbe'](m['BASE'].read_text());m['verify_globals'](m['actual_clock_namespace'](s));controller=m['deriveV15Controller'](m['PREVIOUS'].read_text());compile(controller,'actual-v15-controller','exec');print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'controller':controller,'controllerSha256':hashlib.sha256(controller.encode()).hexdigest(),'pythonSources':sorted(set(seen)),'actualNamespace':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout,
);
for (const p of contract.pythonSources) paths.add(p);
await promisify(execFile)(
  "python3",
  ["scripts/tests/mac-native-active-quit-v15.test.py"],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
await promisify(execFile)(
  "python3",
  ["scripts/tests/native-safe-cleanup.test.py"],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
await promisify(execFile)(
  "python3",
  ["scripts/tests/mac-native-active-quit-diagnostics.test.py"],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
const sources = {};
for (const p of [...paths].sort())
  sources[p] = sha(await readFile(join(repo, p)));
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs"),
  compiledProbePath = join(directory, "probe-derived.py"),
  compiledControllerPath = join(directory, "controller-derived.py");
for (const [p, data] of [
  [compiledFixturePath, fixture],
  [compiledProbePath, contract.source],
  [compiledControllerPath, contract.controller],
])
  await writeFile(p, data, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json"),
  plan = {
    status: "prepared-not-run",
    profile,
    target: "darwin-arm64",
    sourceCommit: manifest.sourceCommit,
    manifestPath,
    manifestSha256: ARM_MANIFEST_SHA,
    runtime,
    sources,
    driverSha256: sources[driver],
    derivedProbeSha256: contract.sha256,
    derivedControllerSha256: contract.controllerSha256,
    fixtureDerivedSha256: sha(fixture),
    compiledFixturePath,
    compiledProbePath,
    compiledControllerPath,
    scopeDocument: scope,
    originalScopeDocument:
      "docs/client-macos-active-quit-consistency-scope-2026-10-21.md",
    old54SourcesUnchanged: true,
    previousV5NoGoPreserved: true,
    previousV5NoGoPlanSha256:
      "b21941a468c12c051d8f32a4981e351dcac9c35e2e7076c64dfb9e8e871e7b63",
    previousV5Reviewed206Verified: true,
    previousV6ActualFailedPlanSha256:
      "c9a6eb12eef9b07fcb1bf9560a0f1ba1fdb55ef2c2a57aba8fd5b6c732e636d5",
    previousV6Reviewed209Verified: true,
    failureDiagnosticLocationsOnly: true,
    beforeCatchBusinessEqualV6: true,
    noNewAxActionsOrWaits: true,
    safeCleanupActualFinallyAstContract: true,
    originalOsRestorePriority: true,
    budgetExhaustionNeverMeansRestored: true,
    previousV4PlanSha256: sha(oldPlanBytes),
    currentConsoleFacts: session,
    screenUnlockedNotProven: true,
    actualNamespaceNoMissingGlobals: true,
    actualDerivedCompile: true,
    caseTotalMs: 180000,
    workBudgetMs: 160000,
    cleanupReserveMs: 20000,
    ownedAxActionCapMs: 5000,
    rendererReadinessMs: 30000,
    originalSecondaryDeadlineMs: 10000,
    originalHostExitBarrierMs: 9000,
    allowedExitWaitMs: 15000,
    supplierHoldWatchdogMs: 45000,
    originalMenuOnly: true,
    foregroundSingleSetNoFallback: true,
    noRendererQuitRuntimeOrIpc: true,
    noTestSignalBeforeActualNativeExit: true,
    packagedMainOnly: true,
    originalSevenAccepted: false,
    checksExpected: 7,
    expectedAccounting:
      "warm2settled44 then exactly one pending main; Cancel unchanged; Allow same reservation uncertain/amount=reserved/tokens0/0/CANCELLED; all old/current and other full rows preserved",
    guiStarted: false,
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
    planSha256: sha(await readFile(path)),
    sourceCount: Object.keys(sources).length,
    derivedProbeSha256: contract.sha256,
    derivedControllerSha256: contract.controllerSha256,
    fixtureDerivedSha256: sha(fixture),
    guiStarted: false,
  }),
);
