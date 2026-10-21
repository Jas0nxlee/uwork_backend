/** Prepare a fresh explicit filesystem-denied Memory case, never start its backend/App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  PROFILES,
  deriveAdmissionFixture,
} from "../fixtures/mac-memory-manifest-admission-derived.mjs";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs";
const mode = process.argv[2];
assert.ok(Object.hasOwn(PROFILES,mode), "Explicit deny or allow mode required");
const PROFILE=PROFILES[mode];
const repo = resolve(import.meta.dirname, "../.."),
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(process.argv[3],undefined);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, PROFILE));
    assert.fail("Fresh case required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const previousPath = join(
  repo,
  "data/sandbox-verification/client-native-packaged-macos-clock-arm64-memory-manifest-filesystem-denied-v2-20261021/preparation.json",
);
const previous = JSON.parse(await readFile(previousPath, "utf8"));
assert.equal(
  sha(await readFile(previousPath)),
  "005b19ccb41ed0401a57dcb195fd18dfff1e46fca9a9c791ca10bed7df98a9a4",
);
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
    experience: "enabled",
    otherMode: false,
  });
const actualManifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.ok(/^[a-f0-9]{40}$/.test(actualManifest.sourceCommit));
assert.notEqual(actualManifest.sourceCommit,"500914dfe27f96d9db74381c6828244390413281");
assert.equal(actualManifest.target,"darwin-arm64");
const approvedProductSources = Object.fromEntries(
  Object.entries(actualManifest.sourceSha256).map(([path, hash]) => [
    "clients/uwork/" + path,
    hash,
  ]),
);
const sourceChanges=[];
for (const [path, oldHash] of Object.entries(previous.sources)) {
  const currentHash = sha(await readFile(join(repo, path)));
  assert.ok(
    currentHash === oldHash || approvedProductSources[path] === currentHash,
    "Historical Memory input drift lacks exact v15 product source approval: " +
      path,
  );
  if(currentHash!==oldHash)sourceChanges.push({path,oldSha256:oldHash,newSha256:currentHash});
}

const driver = "scripts/tests/mac-memory-manifest-admission-probe.py",
  scope =
    "docs/client-macos-native-memory-manifest-v16-regression-plan-2026-10-21.md";
const paths = new Set([
  ...Object.keys(previous.sources),
  ...Object.keys(approvedProductSources),
  "scripts/fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs",
  driver,
  scope,
  "scripts/fixtures/mac-memory-manifest-admission-stage.mjs",
  "scripts/fixtures/mac-memory-manifest-admission-stage.test.mjs",
  "scripts/fixtures/mac-memory-manifest-admission-derived.mjs",
  "scripts/tests/mac-memory-manifest-admission.test.py",
  "scripts/tests/mac-memory-manifest-admission-prepare.mjs",
  "scripts/tests/mac-arm64-memory-extraction-probe.py",
  "scripts/tests/mac-arm64-memory-filesystem-denied-probe.py",
  "scripts/tests/native-safe-cleanup.py",
  "scripts/tests/native-safe-cleanup.test.py",
  "clients/uwork/specs/enterprise-project-memory-manifest-admission.md",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/recall/manifest.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/recall/types.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/recall/index.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-extraction.ts",
  "src/client.ts",
  "src/policy.ts",
  "clients/uwork/specs/enterprise-project-memory-context.md",
]);
const visited = new Set();
async function visit(path, allowed) {
  if (visited.has(path)) return;
  visited.add(path);
  const tree = ts.createSourceFile(
    path,
    await readFile(join(repo, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
      continue;
    const spec = node.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith("."))
      continue;
    const relative = resolve(repo, dirname(path), spec.text).slice(
      repo.length + 1,
    );
    if (!allowed(relative)) continue;
    const choices = relative.endsWith(".js")
      ? [relative.slice(0, -3) + ".ts", relative]
      : extname(relative)
        ? [relative]
        : [relative + ".ts", relative + "/index.ts"];
    let selected;
    for (const c of choices) {
      try {
        await access(join(repo, c));
        selected = c;
        break;
      } catch {}
    }
    assert.ok(selected, "Missing actual dependency " + relative);
    paths.add(selected);
    if (node.importClause?.isTypeOnly !== true && node.isTypeOnly !== true)
      await visit(selected, allowed);
  }
}
await visit(
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/recall/manifest.ts",
  (p) => p.startsWith("clients/uwork/apps/zcode-cli/"),
);
for (const path of [...paths])
  if (path.startsWith("scripts/fixtures/") && path.endsWith(".mjs"))
    await visit(
      path,
      (p) => p.startsWith("scripts/fixtures/") && p.endsWith(".mjs"),
    );
for (const path of [
  "apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-extraction.ts",
  "apps/zcode-cli/packages/core/src/memory/recall/manifest.ts",
]) {
  const working = await readFile(join(repo, "clients/uwork", path));
  const committed = await promisify(execFile)(
    "git",
    ["show", actualManifest.sourceCommit + ":clients/uwork/" + path],
    { cwd: repo, encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  assert.deepEqual(
    working,
    committed.stdout,
    "Consumer must match actual v15 code",
  );
}
assert.equal(
  sha(await readFile(join(repo, "scripts/tests/native-safe-cleanup.py"))),
  "450f3811cb8da52ba1222f04a392816b9ad3d7a9b9b412be5ae63ced337e19c2",
);
const sources = {};
for (const path of [...paths].sort())
  sources[path] = sha(await readFile(join(repo, path)));
const python = "import pathlib,runpy,hashlib,json,sys;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()));m=runpy.run_path('scripts/tests/mac-memory-manifest-admission-probe.py');mode=sys.argv[1];runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](m['PROFILES'][mode]);s=m['deriveAdmissionProbe'](m['BASE'].read_text(),mode);ns=m['create_admission_namespace'](s,m['N']['MemoryCaseBudget']());m['N']['verify_globals'](ns);c=runpy.run_path('scripts/tests/mac-memory-manifest-admission.test.py')['Contract'];[getattr(c(n),n)()for n in ['test_actual_both_variants_namespace_budget_and_preserved_seed_cleanup','test_actual_fixture_env_and_derived_common_preserve_original_supplier','test_existing_actual_terminal_seed_and_finally_contracts_are_still_executed']];print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest()}))";
const contract=JSON.parse((await promisify(execFile)("python3",["-c",python,mode],{cwd:repo,timeout:15000,maxBuffer:1024*1024})).stdout);
await promisify(execFile)(process.execPath,["--test","scripts/fixtures/mac-memory-manifest-admission-stage.test.mjs"],{cwd:repo,timeout:10000});
const fixture = deriveAdmissionFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
  {mode},
);
const directory = join(repo, "data/sandbox-verification", PROFILE);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs"),
  compiledProbePath = join(directory, "probe-derived.py");
await writeFile(compiledFixturePath, fixture, { mode: 0o600, flag: "wx" });
await writeFile(compiledProbePath, contract.source, {
  mode: 0o600,
  flag: "wx",
});
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json"),
  plan = {
    status: "prepared-not-run",
    profile: PROFILE,
    target: "darwin-arm64",
    mode,
    sourceCommit: actualManifest.sourceCommit,
    sourceChangesSinceV15Red:sourceChanges,
    manifestPath,
    manifestSha256: ARM_MANIFEST_SHA,
    runtime,
    sources,
    driverSha256: sources[driver],
    fixtureDerivedSha256: sha(fixture),
    derivedProbeSha256: contract.sha256,
    compiledFixturePath,
    compiledProbePath,
    scopeDocument: scope,
    oldV15InputsArchivedAndNewProductChangesExactlyManifestApproved:true,
    changedProductSourcesApprovedOnlyByActualV16Manifest: true,
    previousFrozenV15RedPlanSha256: sha(await readFile(previousPath)),
    actualNamespaceNoMissingGlobals:true,
    actualBothVariantContracts:true,
    actualTerminalAndSafeFinallyContracts:true,
    actualRequestOracleContracts:6,
    actualDerivedFixtureSyntaxExitCode: 0,
    actualDerivedProbeCompile: true,
    caseBudgetMs: 180000,
    workBudgetMs: 160000,
    cleanupReservedMs: 20000,
    originalRendererMs: 30000,
    originalSecondaryMs: 10000,
    originalWarmChecks: 5,
    checksExpectedOnFixedBuild: 6,
    notOriginalSevenAcceptance: true,
    seatLogoutColdNotRun: true,
    expectedBeforeLaunch: {
      publishedFilesystemAllowed: mode==="allow",
      effectiveFilesystemAllowed: mode==="allow",
      executionAllowed: true,
    },
    expectedLeakFailureCode:
      "MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE",
    expectedFinalOnFixedBuild: {
      ownCalls: mode==="allow"?5:4,
      credits: mode==="allow"?110:88,
      inputTokens: mode==="allow"?60:48,
      outputTokens: mode==="allow"?50:40,
      supplierRawCalls: mode==="allow"?7:6,
    },
    negativePromptAtLeastThreeWords: true,
    inputTopicOnlyAndIndexAbsent: true,
    markerOnlyInFrontmatterDescription: true,
    supplierReplyUnchangedNoTools: true,
    noFixtureRuntimeDrainOrSender: true,
    ordinaryInferenceMayBill: true,
    originalFinallyReplacedOnlyByReviewedBoundedSafeCleanup: true,
    actualSafeCleanupBudgetContract: true,
    actualOriginalProseEligibilityAndManifestFormatter: true,
    original180EscapeReproducedOnActualManifestFinally: true,
    fixed160And180FinallyExecuted: true,
    postMainNaturalExtractionQuietSeconds: 3,
    noDevelopmentOutCopied: true,
    packagedMainFromStrictVerifiedAsar: true,
    sharedPackagedMainReadonlyBlockReviewed: true,
    actualStatusBranchAndOriginalCapturePhaseContract: true,
    noControllerDirectCaseFileWrite: true,
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
    fixtureDerivedSha256: plan.fixtureDerivedSha256,
    derivedProbeSha256: plan.derivedProbeSha256,
    guiStarted: false,
  }),
);
