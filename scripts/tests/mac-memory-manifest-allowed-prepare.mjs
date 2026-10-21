/** Prepare a fresh single filesystem-allowed existing-topic case, never start its backend/App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  PROFILE,
  deriveAllowedManifestFixture as deriveManifestFixture,
} from "../fixtures/mac-memory-manifest-allowed-derived.mjs";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.ok(process.argv[2] === undefined || process.argv[2] === PROFILE);
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
  "data/sandbox-verification/client-native-packaged-macos-clock-arm64-memory-manifest-fixed-denied-v2-20261021/preparation.json",
);
const previous = JSON.parse(await readFile(previousPath, "utf8"));
assert.equal(
  sha(await readFile(previousPath)),
  "29dd3cd7197d1c543d49f17e642f3bb31714ae4ca1a9c17a421566d706e383e9",
);
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
    experience: "enabled",
    otherMode: false,
  });
const actualManifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(
  actualManifest.sourceCommit,
  "d14eef850eca3fd5c76c82a5243b4f72d4ffc3e5",
);
const approvedProductSources = Object.fromEntries(
  Object.entries(actualManifest.sourceSha256).map(([path, hash]) => [
    "clients/uwork/" + path,
    hash,
  ]),
);
for (const [path, oldHash] of Object.entries(previous.sources)) {
  const currentHash = sha(await readFile(join(repo, path)));
  assert.ok(
    currentHash === oldHash || currentHash === approvedProductSources[path],
    "Historical Memory input drift lacks exact v15 product source approval: " +
      path,
  );
}

const driver = "scripts/tests/mac-memory-manifest-allowed-probe.py",
  scope = "docs/client-macos-memory-manifest-allowed-spec-2026-10-21.md";
const paths = new Set([
  "scripts/fixtures/mac-memory-manifest-allowed-stage.mjs",
  "scripts/fixtures/mac-memory-manifest-allowed-stage.test.mjs",
  "scripts/fixtures/mac-memory-manifest-allowed-derived.test.mjs",
  "scripts/fixtures/mac-memory-manifest-admission-stage.mjs",
  "scripts/fixtures/mac-memory-manifest-admission-stage.test.mjs",
  "scripts/fixtures/mac-session-model-witness-v16-readonly.mjs",
  "scripts/fixtures/mac-session-model-witness-v16-readonly.test.mjs",
  "scripts/fixtures/mac-memory-stage-v16-readonly.mjs",
  "scripts/fixtures/mac-memory-extraction-oracle-v16-readonly.mjs",
  "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts",
  ...Object.keys(previous.sources),
  ...Object.keys(approvedProductSources),
  "scripts/fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs",
  driver,
  scope,
  "scripts/fixtures/mac-memory-manifest-allowed-derived.mjs",
  "scripts/tests/mac-memory-manifest-allowed.test.py",
  "scripts/tests/mac-memory-manifest-allowed-prepare.mjs",
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
  sha(
    await readFile(
      join(
        repo,
        "clients/uwork/specs/enterprise-project-memory-manifest-admission.md",
      ),
    ),
  ),
  "cd91eef02ebc58bfcf2232a627eaa6b48ee38ea5a23b0a36899226a709e4fa63",
);
assert.equal(
  sha(await readFile(join(repo, "scripts/tests/native-safe-cleanup.py"))),
  "450f3811cb8da52ba1222f04a392816b9ad3d7a9b9b412be5ae63ced337e19c2",
);
for (const path of [
  "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts",
  "clients/uwork/apps/zcode-cli/packages/contracts/src/index.ts",
]) {
  paths.add(path);
  await visit(path, (p) => p.startsWith("clients/uwork/apps/zcode-cli/"));
}
const sources = {};
for (const path of [...paths].sort())
  sources[path] = sha(await readFile(join(repo, path)));
const python =
  "import pathlib,runpy,hashlib,json,sys;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()));m=runpy.run_path('scripts/tests/mac-memory-manifest-allowed-probe.py');runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](m['PROFILE']);s=m['deriveAllowedManifestProbe'](m['BASE'].read_text());ns=m['create_allowed_namespace'](s,m['MemoryCaseBudget']());m['verify_globals'](ns);c=runpy.run_path('scripts/tests/mac-memory-manifest-allowed.test.py')['Contract'];[c(name).__getattribute__(name)()for name in ['test_actual_namespace_budget_seed_and_single_allowed_stage','test_actual_constructor_env_derive_and_original_reply_unchanged','test_original_actual_seed_hash_and_bounded_safe_finally_contracts']];print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'actualNamespaceNoMissingGlobals':True,'actualFixtureEnvContract':True,'actualTerminalHashASTContract':True,'actualAllowedSupplierAndSdkContract':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout,
);
const fixture = deriveManifestFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
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
    sourceCommit: "d14eef850eca3fd5c76c82a5243b4f72d4ffc3e5",
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
    frozenFalse586OnlyExactV16ProductChangesApproved: true,
    changedProductSourcesApprovedOnlyByV16Manifest: true,
    previousFrozenFalsePlanSha256: sha(await readFile(previousPath)),
    actualNamespaceNoMissingGlobals: contract.actualNamespaceNoMissingGlobals,
    actualFixtureEnvContract: contract.actualFixtureEnvContract,
    actualTerminalHashASTContract: contract.actualTerminalHashASTContract,
    actualAllowedSupplierAndSdkContract:
      contract.actualAllowedSupplierAndSdkContract,
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
      publishedFilesystemAllowed: true,
      effectiveFilesystemAllowed: true,
      executionAllowed: true,
    },
    normalAllowedSidecarExpected: 1,
    expectedFinalOnFixedBuild: {
      ownCalls: 5,
      credits: 110,
      inputTokens: 60,
      outputTokens: 50,
      supplierRawCalls: 7,
    },
    originalFourWordPrompt: true,
    inputTopicOnlyAndIndexAbsent: true,
    markerOnlyInFrontmatterDescription: true,
    supplierReplyUnchangedNoTools: true,
    noFixtureRuntimeDrainOrSender: true,
    sdkProjectMemoryExtractStopZeroRequired: true,
    originalBuilderFromSoleActualTopicMtimeRequired: true,
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
