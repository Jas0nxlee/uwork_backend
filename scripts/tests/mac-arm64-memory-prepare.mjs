/** Freeze one original Native Memory case, syntax and real constructor-env contracts; no App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  PROFILE,
  deriveMemoryFixture,
  validateMemoryProfile,
} from "../fixtures/mac-arm64-memory-derived.mjs";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-arm64-asar-integrity-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.ok(process.argv[2] === undefined || process.argv[2] === PROFILE);
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, PROFILE));
    assert.fail("Fresh case required");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME);
validateMemoryProfile(PROFILE, {
  UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
  UWORK_NATIVE_CONFIGURATION_WITNESS: "enabled",
  UWORK_NATIVE_PACKAGED_MANIFEST: manifestPath,
});
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const previous = JSON.parse(
  await readFile(
    join(
      repo,
      "data/sandbox-verification/client-native-packaged-macos-clock-arm64-asar-integrity-v1-20261021/preparation.json",
    ),
    "utf8",
  ),
);
const scope = "docs/client-macos-native-memory-consistency-spec-2026-10-21.md",
  driver = "scripts/tests/mac-arm64-memory-probe.py";
const paths = new Set([
  ...Object.keys(previous.sources),
  "scripts/tests/native_workspace_evidence.py",
  "clients/uwork/apps/zcode-cli/pnpm-lock.yaml",
  scope,
  driver,
  "scripts/tests/mac-arm64-memory-prepare.mjs",
  "scripts/tests/mac-arm64-memory.test.py",
  "scripts/fixtures/mac-arm64-memory-derived.mjs",
  "scripts/fixtures/mac-arm64-memory-derived.test.mjs",
  "scripts/fixtures/mac-memory-stage.mjs",
  "scripts/fixtures/mac-memory-stage.test.mjs",
  "scripts/tests/mac-arm64-model-capability-probe.py",
  "scripts/tests/mac-arm64-cold-consistency-probe.py",
  "scripts/fixtures/mac-model-capability-stage.mjs",
  "scripts/fixtures/mac-model-capability-stage.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "clients/uwork/packages/ui/src/SettingsPage.tsx",
  "clients/uwork/packages/ui/src/settings/MemorySettingsSection.tsx",
  "clients/uwork/packages/ui/src/settings/MemorySettingsViewer.tsx",
  "clients/uwork/packages/ui/src/settings/PluginScopeMenu.tsx",
  "clients/uwork/packages/services/src/memory/memoryService.ts",
  "clients/uwork/packages/services/src/node.ts",
  "clients/uwork/packages/shared/src/test-ids.ts",
  "clients/uwork/packages/services/src/onboarding/onboardingRecordService.ts",
  "clients/uwork/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts",
  "clients/uwork/apps/zcode-cli/packages/bootstrap/src/app/create-app.ts",
  "clients/uwork/apps/zcode-cli/packages/bootstrap/src/app/runtime-config.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/context.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/turn.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/context/sections/request-user-context.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/helpers/project-memory-extraction.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/helpers/project-memory.ts",
  "clients/uwork/apps/zcode-cli/packages/contracts/src/config/index.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/project-root.ts",
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts",
]);
const visited = new Set();
async function dependencies(path, filter) {
  if (visited.has(path)) return;
  visited.add(path);
  const text = await readFile(join(repo, path), "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
      continue;
    const spec = node.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith("."))
      continue;
    let absolute = resolve(repo, dirname(path), spec.text);
    let relative = absolute.slice(repo.length + 1);
    if (!filter(relative)) continue;
    const candidates = relative.endsWith(".js")
      ? [relative.slice(0, -3) + ".ts", relative]
      : extname(relative)
        ? [relative]
        : [relative + ".ts", relative + "/index.ts"];
    let chosen;
    for (const c of candidates) {
      try {
        await access(join(repo, c));
        chosen = c;
        break;
      } catch {}
    }
    assert.ok(chosen, "Relative source dependency missing: " + relative);
    paths.add(chosen);
    await dependencies(chosen, filter);
  }
}
await dependencies(
  "clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts",
  (p) => p.startsWith("clients/uwork/apps/zcode-cli/"),
);
for (const p of [...paths])
  if (p.startsWith("scripts/fixtures/") && p.endsWith(".mjs"))
    await dependencies(
      p,
      (v) => v.startsWith("scripts/fixtures/") && v.endsWith(".mjs"),
    );
const sources = {};
for (const p of [...paths].sort())
  sources[p] = sha(await readFile(join(repo, p)));
const python =
  "import pathlib,runpy,hashlib,json,sys;sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve())); m=runpy.run_path('scripts/tests/mac-arm64-memory-probe.py');runpy.run_path('scripts/tests/macos-clock-profile.test.py')['check'](m['PROFILE']);s=m['deriveMemoryProbe'](m['BASE'].read_text());compile(s,'actual-native-memory-probe','exec');runpy.run_path('scripts/tests/mac-arm64-memory.test.py')['Contract']('test_actual_fixture_constructor_env_matches_exact_memory_mode_without_spawn').test_actual_fixture_constructor_env_matches_exact_memory_mode_without_spawn(); c=runpy.run_path('scripts/tests/mac-arm64-memory.test.py')['Contract'];c('test_actual_derived_terminal_written_file_hashing_block_has_real_module_bindings').test_actual_derived_terminal_written_file_hashing_block_has_real_module_bindings();c('test_actual_compiled_derived_run_and_nested_code_have_no_unresolved_globals').test_actual_compiled_derived_run_and_nested_code_have_no_unresolved_globals();print(json.dumps({'source':s,'sha256':hashlib.sha256(s.encode()).hexdigest(),'actualFixtureLaunchEnvContract':True,'actualOriginalClockGuard':True,'actualTerminalHashASTContract':True,'actualNestedGlobalsContract':True}))";
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", python], {
      cwd: repo,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout,
);
const fixture = deriveMemoryFixture(
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
const path = join(directory, "preparation.json");
const plan = {
  status: "prepared-not-run",
  profile: PROFILE,
  target: "darwin-arm64",
  sourceCommit: "f4cac9136226bc7e94edd9fcf8d2bba38f327803",
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
  actualFixtureLaunchEnvContract: contract.actualFixtureLaunchEnvContract,
  actualOriginalClockGuard: contract.actualOriginalClockGuard,
  actualDerivedProbeCompile: true,
  actualTerminalHashASTContract: contract.actualTerminalHashASTContract,
  actualNestedGlobalsContract: contract.actualNestedGlobalsContract,
  actualDerivedFixtureSyntaxExitCode: 0,
  originalRendererMs: 30000,
  originalSecondaryMs: 10000,
  caseBudgetMs: 180000,
  workBudgetMs: 160000,
  cleanupReservedMs: 20000,
  checksExpected: 8,
  extractionDisabled: false,
  extractionScope:
    "natural original scheduler short-prose skip; not extract execution acceptance",
  memoryInput:
    "original xterm exclusive file creation in authoritative private storage, exact hash and original runtime root",
  stages: [
    { enabled: false, ownCalls: 4, credits: 88, supplierRaw: 6 },
    { enabled: true, ownCalls: 6, credits: 132, supplierRaw: 8 },
    { enabled: false, ownCalls: 8, credits: 176, supplierRaw: 10 },
  ],
  seatLogoutColdPreserved: true,
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
