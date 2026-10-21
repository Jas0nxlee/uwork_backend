/** Fresh v11 only: same v16/domain and original AX error observation. No backend/App. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname, extname } from "node:path";
import ts from "typescript";
import {
  deriveActiveQuitFixture,
  ACTIVE_QUIT_PROFILE,
} from "../fixtures/mac-native-active-quit-v16-raw-error-derived.mjs";
import {
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
  loadOwnedPackagedRuntime,
} from "../fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = ACTIVE_QUIT_PROFILE,
  sha = (b) => createHash("sha256").update(b).digest("hex");
for (const base of ["data", "evidence", "data/sandbox-verification"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh case roots required");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const previousPath = join(
    repo,
    "data/sandbox-verification/client-native-packaged-macos-clock-arm64-active-quit-v10-20261021/preparation.json",
  ),
  previousBytes = await readFile(previousPath),
  previous = JSON.parse(previousBytes);
assert.equal(
  sha(previousBytes),
  "4708cbf5e10b6563a9bfe1f35ae41616d0d30da9af61df865dee2a10ff520925",
);
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME),
  manifest = JSON.parse(await readFile(manifestPath));
assert.equal(manifest.sourceCommit, "d14eef850eca3fd5c76c82a5243b4f72d4ffc3e5");
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const approvedChanges = [];
for (const [p, h] of Object.entries(previous.sources)) {
  const now = sha(await readFile(join(repo, p)));
  if (now !== h) {
    assert.ok(p.startsWith("clients/uwork/"));
    assert.equal(
      now,
      manifest.sourceSha256[p.slice("clients/uwork/".length)],
      p,
    );
    approvedChanges.push(p);
  }
}
assert.equal(approvedChanges.length, 0);
const driver = "scripts/tests/mac-native-active-quit-v16-raw-error-probe.py",
  paths = new Set([
    ...Object.keys(previous.sources),
    ...Object.keys(manifest.sourceSha256).map((p) => "clients/uwork/" + p),
    driver,
    "scripts/tests/quit-ax-attribute-error-observer.py",
    "scripts/tests/quit-ax-attribute-error-observer.test.py",
    "scripts/tests/mac-native-active-quit-v16-raw-error.test.py",
    "scripts/tests/mac-native-active-quit-v16-raw-error-prepare.mjs",
    "scripts/fixtures/mac-native-active-quit-v16-raw-error-derived.mjs",
    "docs/client-macos-active-quit-raw-error-observation-scope-2026-10-21.md",
    "scripts/tests/quit-native-confirmation-domain.py",
    "scripts/tests/quit-native-confirmation-domain.test.py",
    "docs/client-macos-active-quit-native-domain-spec-2026-10-21.md",
    "scripts/tests/mac-native-active-quit-v16-native-domain.test.py",
    "scripts/tests/mac-native-active-quit-v16-native-domain-prepare.mjs",
    "scripts/fixtures/mac-native-active-quit-v16-native-domain-derived.mjs",
    "scripts/fixtures/native-packaged-macos-arm64-memory-manifest-runtime.mjs",
    "scripts/tests/native-candidate-bound-observer.py",
    "scripts/tests/native-candidate-bound-observer.test.py",
    "docs/client-macos-active-quit-candidate-readonly-plan-2026-10-21.md",
  ]);
const fixture = deriveActiveQuitFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const seen = new Set();
async function visit(p, override) {
  if (seen.has(p)) return;
  seen.add(p);
  const tree = ts.createSourceFile(
    p,
    override ?? (await readFile(join(repo, p), "utf8")),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const n of tree.statements) {
    if (
      (!ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)) ||
      n.importClause?.isTypeOnly ||
      n.isTypeOnly
    )
      continue;
    const spec = n.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith("."))
      continue;
    const full = resolve(repo, dirname(p), spec.text);
    assert.ok(full.startsWith(repo + "/"));
    const rel = full.slice(repo.length + 1),
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
    assert.ok(found, rel);
    paths.add(found);
    await visit(found);
  }
}
for (const p of [...paths])
  if (p.startsWith("scripts/fixtures/") && p.endsWith(".mjs")) await visit(p);
await visit("scripts/fixtures/client-native-enterprise-derived.mjs", fixture);
const code = `import sys,pathlib,runpy,hashlib,json
sys.path.insert(0,str(pathlib.Path('scripts/tests').resolve()))
seen=[];original=runpy.run_path
def capture(p,*a,**kw):
 seen.append(str(pathlib.Path(p).resolve().relative_to(pathlib.Path.cwd())));return original(p,*a,**kw)
runpy.run_path=capture
m=runpy.run_path('${driver}')
m['validate_profile'](m['PROFILE'])
s=m['deriveActiveQuitProbe'](m['BASE'].read_text());m['verify_globals'](m['actual_clock_namespace'](s))
c=m['deriveV15Controller'](m['PREVIOUS'].read_text())
print(json.dumps({'source':s,'controller':c,'ax':m['AX_DERIVED'],'pythonSources':sorted(set(seen))}))`;
const contract = JSON.parse(
  (
    await promisify(execFile)("python3", ["-c", code], {
      cwd: repo,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    })
  ).stdout,
);
for (const p of contract.pythonSources) paths.add(p);
for (const p of [
  "scripts/tests/mac-native-active-quit-v16-raw-error.test.py",
  "scripts/tests/quit-ax-attribute-error-observer.test.py",
  "scripts/tests/mac-native-active-quit-v16-native-domain.test.py",
  "scripts/tests/quit-native-confirmation-domain.test.py",
])
  await promisify(execFile)("python3", [p], {
    cwd: repo,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
const sources = {};
for (const p of [...paths].sort())
  sources[p] = sha(await readFile(join(repo, p)));
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiledFixturePath = join(directory, "fixture-derived.mjs"),
  compiledProbePath = join(directory, "probe-derived.py"),
  compiledControllerPath = join(directory, "controller-derived.py"),
  compiledAxPath = join(directory, "ax-derived.py");
for (const [p, s] of [
  [compiledFixturePath, fixture],
  [compiledProbePath, contract.source],
  [compiledControllerPath, contract.controller],
  [compiledAxPath, contract.ax],
])
  await writeFile(p, s, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiledFixturePath], {
  cwd: repo,
  timeout: 10000,
});
const path = join(directory, "preparation.json"),
  plan = {
    ...previous,
    status: "prepared-not-run",
    profile,
    sourceCommit: manifest.sourceCommit,
    manifestPath,
    manifestSha256: ARM_MANIFEST_SHA,
    runtime,
    sources,
    driverSha256: sources[driver],
    fixtureDerivedSha256: sha(fixture),
    derivedProbeSha256: sha(contract.source),
    derivedControllerSha256: sha(contract.controller),
    derivedAxSha256: sha(contract.ax),
    compiledFixturePath,
    compiledProbePath,
    compiledControllerPath,
    compiledAxPath,
    previousV10ActualFailedPlanSha256: sha(previousBytes),
    rawErrorObservationOnly: true,
    rawErrorScopeDocument:
      "docs/client-macos-active-quit-raw-error-observation-scope-2026-10-21.md",
    originalRawIoAndAllowedCodesUnchanged: true,
    unknownNativeErrorStillRaisesWithoutRetry: true,
    newReceiptMaxBytes: 4096,
    previousV9SupersededNeverRunPlanSha256:
      "7011718dc8dac27a45c6afa88bff89176719ec79609e13f8d1d3b83a19cc5605",
    applicationRefRegisteredBeforePostGuard: true,
    previous234SourcesUnchanged: approvedChanges,
    nativeConfirmationDomainOnly: true,
    originalCandidateLimits: { seen: 128, depth: 4 },
    zeroCandidatePollingWithinSameDeadlineOnly: true,
    candidateScopeDocument:
      "docs/client-macos-active-quit-candidate-readonly-plan-2026-10-21.md",
    actualConstructorEnvContract: true,
    privateAxNamespace: true,
    guiStarted: false,
    originalSevenAccepted: false,
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
    guiStarted: false,
  }),
);
