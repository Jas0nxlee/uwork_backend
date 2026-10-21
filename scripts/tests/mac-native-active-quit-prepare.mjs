/** Freeze one active model/native menu Quit case; never starts App, backend, AX or GUI. */
import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import {
  deriveActiveQuitFixture,
  ACTIVE_QUIT_PROFILE,
} from "../fixtures/mac-native-active-quit-derived.mjs";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = ACTIVE_QUIT_PROFILE;
assert(process.argv[2] === undefined || process.argv[2] === profile);
const hash = (b) => createHash("sha256").update(b).digest("hex");
for (const base of ["data", "evidence"]) {
  try {
    await access(join(repo, base, profile));
    assert.fail("Fresh runtime roots required");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const manifestPath = join(repo, "evidence", ARM_MANIFEST_NAME);
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {
  experience: "enabled",
  otherMode: false,
});
const previous = JSON.parse(
  await readFile(
    join(
      repo,
      "data/sandbox-verification/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/preparation.json",
    ),
    "utf8",
  ),
);
const extras = [
  "scripts/fixtures/mac-native-active-quit-runtime.mjs",
  "scripts/fixtures/mac-native-active-quit-runtime.test.mjs",
  "scripts/fixtures/mac-native-active-quit-derived.mjs",
  "scripts/fixtures/mac-native-active-quit-derived.test.mjs",
  "scripts/tests/mac-native-active-quit-ax.py",
  "scripts/tests/mac-native-active-quit-ax.test.py",
  "scripts/tests/mac-native-active-quit-probe.py",
  "scripts/tests/mac-native-active-quit.test.py",
  "scripts/tests/mac-native-active-quit-prepare.mjs",
  "scripts/fixtures/macos-x64-secondary-derived.mjs",
  "scripts/fixtures/native-owned-workspace.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-secondary-exit-runtime.test.mjs",
  "scripts/tests/macos-architecture-warning-dismiss.py",
  "scripts/tests/macos-ax-driver.py",
  "scripts/tests/macos-x64-clock-startup-probe.py",
  "scripts/tests/macos-clock-profile.test.py",
  "clients/uwork/packages/desktop/src/main/index.ts",
  "clients/uwork/packages/desktop/src/main/desktopApplicationMenu.ts",
  "clients/uwork/packages/desktop/src/main/desktopHostProcess.ts",
  "clients/uwork/packages/shared/src/desktopMenu.ts",
  "src/gateway.ts",
  "src/entitlements.ts",
  "docs/client-macos-active-quit-consistency-scope-2026-10-21.md",
];
const sources = {};
for (const name of new Set([...Object.keys(previous.sources), ...extras]))
  sources[name] = hash(await readFile(join(repo, name)));
const contract = JSON.parse(
  (
    await promisify(execFile)(
      "python3",
      [
        "-c",
        "import runpy,pathlib,hashlib,json;m=runpy.run_path('scripts/tests/mac-native-active-quit-probe.py');m['validate_profile'](m['PROFILE']);s=m['deriveActiveQuitProbe'](m['BASE'].read_text());compile(s,'actual-active-quit','exec');print(json.dumps({'derivedProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'actualOriginalProfileGuard':True,'actualDerivedCompile':True}))",
      ],
      { cwd: repo, timeout: 10000 },
    )
  ).stdout,
);
const fixture = deriveActiveQuitFixture(
  await readFile(
    join(repo, "scripts/fixtures/client-native-enterprise.mjs"),
    "utf8",
  ),
);
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const compiled = join(directory, "fixture-derived.mjs");
await writeFile(compiled, fixture, { mode: 0o600, flag: "wx" });
await promisify(execFile)(process.execPath, ["--check", compiled], {
  cwd: repo,
  timeout: 10000,
});
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-arm64",
  sourceCommit: "0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2",
  manifestPath,
  manifestSha256: ARM_MANIFEST_SHA,
  runtime,
  sources,
  ...contract,
  fixtureDerivedSha256: hash(fixture),
  compiledFixturePath: compiled,
  scope:
    "Original native application menu Quit cancel preserves actual held model/task; second Quit allow exits the original Main normally and cancels the same request",
  originalSevenAccepted: false,
  rendererReadinessMs: 30000,
  originalSecondaryDeadlineMs: 10000,
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  caseTotalMs: 180000,
  cleanupReserveMs: 20000,
  ownedAxActionCapMs: 5000,
  allowedExitWaitMs: 15000,
  supplierHoldWatchdogMs: 45000,
  accounting:
    "Warm current2settled44/24input20output; same-task main only +1 reserved while pending; Cancel two immediate samples unchanged; Allow same ledger uncertain amount=held reserved, tokens0/0 and one failed CANCELLED Trace; raw/supplier5 not6; all old/other full rows unchanged",
  originalMenuOnly: true,
  noRendererQuitRuntimeOrIpc: true,
  noTestSignalBeforeActualNativeExit: true,
  noIdentityLogout: true,
  actualChildExit:
    "Retained original spawn EventEmitter code0/signalnull; AXPress is only an attempt, never exit acknowledgement",
  cleanup:
    "Observe old Main/Host/CLI/PTY generation before cleanup; fail residual then original owned cleanup; private BH socket/CDP/backend/supplier/OS guard must close",
  guiStarted: false,
  executionGate:
    "Independent exact plan SHA plus Root exclusive Mac GUI single Go; default prepared only",
  runArgv: [
    "python3",
    "scripts/tests/mac-native-active-quit-probe.py",
    "--preparation",
    join(directory, "preparation.json"),
    "--run",
    "--reviewed-plan-sha256",
    "<Root-reviewed-SHA>",
  ],
};
const path = join(directory, "preparation.json");
await writeFile(path, JSON.stringify(plan, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    planPath: path,
    planSHA: hash(await readFile(path)),
    sourceCount: Object.keys(sources).length,
    fixtureDerivedSha256: hash(fixture),
    ...contract,
    guiStarted: false,
  }),
);
