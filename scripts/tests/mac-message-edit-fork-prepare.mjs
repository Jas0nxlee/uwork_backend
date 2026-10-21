/** Freeze only one owned message edit/fork plan; strict v15 artifact and offline contracts, no App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  PROFILE,
  deriveMessageFixture,
} from "../fixtures/mac-message-edit-fork-derived.mjs";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-arm64-project-memory-runtime.mjs";
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
  "data/sandbox-verification/client-native-packaged-macos-clock-arm64-memory-filesystem-denied-v4-20261021/preparation.json",
);
const previous = JSON.parse(await readFile(previousPath, "utf8"));
assert.equal(
  sha(await readFile(previousPath)),
  "e12651363729b19bf32d1783aa34fc4bd697e56cd2706718748a2352e9991515",
);
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
    experience: "enabled",
    otherMode: false,
  });
const actualManifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(
  actualManifest.sourceCommit,
  "500914dfe27f96d9db74381c6828244390413281",
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
    currentHash === oldHash || approvedProductSources[path] === currentHash,
    "Historical Memory input drift lacks exact v15 product source approval: " +
      path,
  );
}

const driver = "scripts/tests/mac-message-edit-fork-probe.py",
  scope = "docs/client-macos-message-edit-fork-consistency-spec-2026-10-21.md";
const paths = new Set([
  ...Object.keys(previous.sources),
  ...Object.keys(approvedProductSources),
  driver,
  scope,
  "scripts/tests/mac-message-edit-fork-prepare.mjs",
  "scripts/tests/mac-message-edit-fork.test.py",
  ...[
    "derived",
    "derived.test",
    "readonly",
    "readonly.test",
    "oracle",
    "oracle.test",
  ].map((s) => "scripts/fixtures/mac-message-edit-fork-" + s + ".mjs"),
  "clients/uwork/apps/zcode-cli/tsconfig.test.json",
  "clients/uwork/apps/zcode-cli/pnpm-lock.yaml",
  "clients/uwork/apps/zcode-cli/packages/contracts/src/index.ts",
  "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/session-title.ts",
  "scripts/fixtures/native-packaged-macos-arm64-project-memory-runtime.mjs",
  "scripts/fixtures/mac-message-edit-fork-dom.test.mjs",
  "clients/uwork/packages/ui/src/v4/ConversationTurnGroup.tsx",
  "clients/uwork/packages/ui/src/v4/ConversationRowView.tsx",
  "clients/uwork/packages/ui/src/v4/ConversationTurnRow.tsx",
  "evidence/client-macos-message-edit-fork-preparation-20261021/before-footer-review-input/reviewed-sources/scripts/tests/mac-message-edit-fork-probe.py",
  "evidence/client-macos-message-edit-fork-preparation-20261021/before-fork-wait-review-input/reviewed-sources/scripts/tests/mac-message-edit-fork-probe.py",
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
for (const path of [...paths])
  if (path.startsWith("scripts/fixtures/") && path.endsWith(".mjs"))
    await visit(
      path,
      (p) => p.startsWith("scripts/fixtures/") && p.endsWith(".mjs"),
    );
const cliConfigPath = join(
  repo,
  "clients/uwork/apps/zcode-cli/tsconfig.test.json",
);
const cliConfig = ts.readConfigFile(cliConfigPath, ts.sys.readFile);
assert.equal(cliConfig.error, undefined);
const cliOptions = ts.parseJsonConfigFileContent(
  cliConfig.config,
  ts.sys,
  dirname(cliConfigPath),
).options;
const cliSeen = new Set();
async function visitCli(path) {
  if (cliSeen.has(path)) return;
  cliSeen.add(path);
  paths.add(path);
  const tree = ts.createSourceFile(
    path,
    await readFile(join(repo, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
      continue;
    if (node.importClause?.isTypeOnly === true || node.isTypeOnly === true)
      continue;
    const spec = node.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) continue;
    const found = ts.resolveModuleName(
      spec.text,
      join(repo, path),
      cliOptions,
      ts.sys,
    ).resolvedModule;
    if (!found) continue;
    const absolute = resolve(found.resolvedFileName);
    if (!absolute.startsWith(repo + "/")) continue;
    const relative = absolute.slice(repo.length + 1);
    if (
      relative.startsWith(
        "clients/uwork/apps/zcode-cli/packages/contracts/src/",
      ) ||
      relative.startsWith(
        "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/",
      )
    )
      await visitCli(relative);
  }
}
for (const path of [...paths])
  if (
    path === "clients/uwork/apps/zcode-cli/packages/contracts/src/index.ts" ||
    path.endsWith("/session-store/codecs.ts")
  )
    await visitCli(path);
const sources = {};
for (const path of [...paths].sort())
  sources[path] = sha(await readFile(join(repo, path)));
const python =
  "import pathlib,runpy,hashlib,json,sys;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()));m=runpy.run_path('scripts/tests/mac-message-edit-fork-probe.py');runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](m['PROFILE']);s=m['deriveMessageProbe'](m['BASE'].read_text());ns=m['createMessageNamespace'](s,m['M']['MemoryCaseBudget']());c=runpy.run_path('scripts/tests/mac-message-edit-fork.test.py')['Contract'];[c(name).__getattribute__(name)() for name in ['test_actual_namespace_recursive_globals_and_original_seat_logout_tail','test_actual_fixture_retarget_injects_only_tsx_config_and_owned_new_entry','test_actual_stage_gate_refreshes_ui_waits_readonly_stability_then_one_observer','test_original_budget_expired_callback_blocks_and_cleanup_has_twenty','test_actual_stage_slow_positive_returns_after_local_deadline_before_any_next_io','test_actual_original_fixture_constructor_env_and_retarget_pass_exact_new_validator']];print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'actualNamespaceNoMissingGlobals':True,'actualFixtureRetargetContract':True,'actualFixtureEnvContract':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout,
);
await promisify(execFile)(
  process.execPath,
  ["--test", "scripts/fixtures/mac-message-edit-fork-dom.test.mjs"],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
const fixture = deriveMessageFixture(
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
    sourceCommit: "500914dfe27f96d9db74381c6828244390413281",
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
    inherited165SourceFenceUnchanged: true,
    changedProductSourcesApprovedOnlyByV15Manifest: true,
    inheritedPlanSha256: sha(await readFile(previousPath)),
    actualNamespaceNoMissingGlobals: contract.actualNamespaceNoMissingGlobals,
    actualFixtureRetargetContract: contract.actualFixtureRetargetContract,
    actualFixtureEnvContract: contract.actualFixtureEnvContract,
    actualFooterDomContract: true,
    previousMessageV1NativeFailurePreserved: true,
    previousMessageV2NativeFailurePreserved: true,
    actualDerivedFixtureSyntaxExitCode: 0,
    actualDerivedProbeCompile: true,
    caseBudgetMs: 180000,
    workBudgetMs: 160000,
    cleanupReservedMs: 20000,
    originalRendererMs: 30000,
    originalSecondaryMs: 10000,
    originalWarmChecks: 5,
    checksExpected: 8,
    originalFinallyPreserved: true,
    expectedCounts: { warm: 4, edit: 5, fork: 5, child: 6, reload: 6 },
    expectedFinal: {
      ownRows: 4,
      credits: 88,
      inputTokens: 48,
      outputTokens: 40,
      rawSupplierCalls: 6,
      otherRows: 2,
      otherCredits: 44,
    },
    noDevelopmentOutCopied: true,
    packagedMainFromStrictVerifiedAsar: true,
    originalUiActionsOnly: true,
    noInternalBusinessRpc: true,
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
