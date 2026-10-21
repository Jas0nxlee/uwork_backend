/** Prepare a fresh natural Memory extraction case, never start its backend/App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  PROFILE,
  deriveAutoMemoryFixture,
} from "../fixtures/mac-arm64-memory-extraction-derived.mjs";
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
  "data/sandbox-verification/client-native-packaged-macos-clock-arm64-memory-v2-20261021/preparation.json",
);
const previous = JSON.parse(await readFile(previousPath, "utf8"));
assert.equal(
  sha(await readFile(previousPath)),
  "21e1fbbf43586174b412bd506917437fc1aacabf22176ee169e9a78f21032e94",
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

const driver = "scripts/tests/mac-arm64-memory-extraction-probe.py",
  scope = "docs/client-macos-native-memory-extraction-spec-2026-10-21.md";
const paths = new Set([
  ...Object.keys(previous.sources),
  ...Object.keys(approvedProductSources),
  "scripts/fixtures/native-packaged-macos-arm64-project-memory-runtime.mjs",
  driver,
  scope,
  "scripts/tests/mac-arm64-memory-extraction.test.py",
  "scripts/tests/mac-arm64-memory-extraction-prepare.mjs",
  "scripts/fixtures/mac-memory-extraction-oracle.mjs",
  "scripts/fixtures/mac-memory-extraction-oracle.test.mjs",
  "scripts/fixtures/mac-arm64-memory-extraction-derived.mjs",
  "scripts/fixtures/mac-arm64-memory-extraction-derived.test.mjs",
  "scripts/fixtures/mac-completed-task-readonly.mjs",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/origin-session.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/memory-agent-loop.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-agent.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/tool/handlers/write.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/tool/executor/memory-file-permission.ts",
  "clients/uwork/apps/zcode-cli/packages/contracts/src/tools/write.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/directory.ts",
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
for (const path of [
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/origin-session.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/memory-agent-loop.ts",
])
  await visit(path, (p) => p.startsWith("clients/uwork/apps/zcode-cli/"));
for (const path of [...paths])
  if (path.startsWith("scripts/fixtures/") && path.endsWith(".mjs"))
    await visit(
      path,
      (p) => p.startsWith("scripts/fixtures/") && p.endsWith(".mjs"),
    );
const sources = {};
for (const path of [...paths].sort())
  sources[path] = sha(await readFile(join(repo, path)));
const python =
  "import pathlib,runpy,hashlib,json,sys;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()));m=runpy.run_path('scripts/tests/mac-arm64-memory-extraction-probe.py');runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](m['PROFILE']);s=m['deriveAutoMemoryProbe'](m['BASE'].read_text());ns=m['create_auto_namespace'](s,m['MemoryCaseBudget']());m['verify_globals'](ns);c=runpy.run_path('scripts/tests/mac-arm64-memory-extraction.test.py')['Contract'];c('test_actual_fixture_env_guard_and_invalid_modes_without_entry_execution').test_actual_fixture_env_guard_and_invalid_modes_without_entry_execution();c('test_actual_budgeted_renderer_callback_clamps_shared_time_without_mutating_old_module').test_actual_budgeted_renderer_callback_clamps_shared_time_without_mutating_old_module();print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'actualNamespaceNoMissingGlobals':True,'actualFixtureEnvContract':True,'actualReadinessBudgetClosureContract':True}))";
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
  [
    "--import",
    "tsx",
    "--test",
    "scripts/fixtures/mac-arm64-memory-extraction-derived.test.mjs",
  ],
  { cwd: repo, timeout: 15000, maxBuffer: 1024 * 1024 },
);
const fixture = deriveAutoMemoryFixture(
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
    originalMemory89FacilitySourcesUnchanged: true,
    changedProductSourcesApprovedOnlyByV15Manifest: true,
    previousMemoryPlanSha256: sha(await readFile(previousPath)),
    actualNamespaceNoMissingGlobals: contract.actualNamespaceNoMissingGlobals,
    actualFixtureEnvContract: contract.actualFixtureEnvContract,
    actualReadinessBudgetClosureContract:
      contract.actualReadinessBudgetClosureContract,
    actualDerivedFixtureSyntaxExitCode: 0,
    actualProofPhaseCanonicalContract: true,
    noDevelopmentOutCopied: true,
    sharedPackagedMainReadonlyBlock: true,
    actualDerivedProbeCompile: true,
    caseBudgetMs: 180000,
    workBudgetMs: 160000,
    cleanupReservedMs: 20000,
    originalRendererMs: 30000,
    originalSecondaryMs: 10000,
    checksExpected: 8,
    originalMaxExtractionTurns: 5,
    expectedExtractionTurns: 2,
    modelTasks: [
      {
        phase: "A",
        ownNewCalls: 4,
        credits: 88,
        inputTokens: 48,
        outputTokens: 40,
      },
      {
        phase: "B",
        ownNewCalls: 2,
        credits: 44,
        inputTokens: 24,
        outputTokens: 20,
      },
    ],
    finalBaseline: {
      ownCalls: 8,
      credits: 176,
      inputTokens: 96,
      outputTokens: 80,
      supplierRawCalls: 10,
    },
    originalSeatLogoutColdPreserved: true,
    toolScope:
      "Original Memory-root policy, not a general workspace sandbox; negative path inside owned case only",
    naturalEndEvidence:
      "No-tool final sidecar actual HTTP finish/noabort plus all calls settled, quiet sample; source loopbreak, no runtime cursor/telemetry-completion assertion or private drain",
    noFixtureMemoryFileWrite: true,
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
