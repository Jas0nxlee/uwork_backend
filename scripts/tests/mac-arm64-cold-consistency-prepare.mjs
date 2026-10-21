/** Prepare only: exact normal ARM artifact and original-control derivation, never executes the run. */
import assert from "node:assert/strict";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadOwnedPackagedRuntime,
  ARM_MANIFEST_NAME,
  ARM_MANIFEST_SHA,
} from "../fixtures/native-packaged-macos-arm64-consistency-runtime.mjs";
const repo = resolve(import.meta.dirname, "../.."),
  profile = process.argv[2];
assert.match(
  profile ?? "",
  /^client-native-packaged-macos-clock-arm64-consistency-v[0-9]+-20261021$/,
);
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
const python =
  "import runpy,pathlib,hashlib,json,sys; m=runpy.run_path('scripts/tests/mac-arm64-cold-consistency-probe.py'); s=m['derive_clock'](pathlib.Path('scripts/tests/macos-clock-probe.py').read_text()); compile(s,'reviewed-original-clock','exec'); g=runpy.run_path('scripts/tests/macos-clock-profile.test.py'); g['check'](sys.argv[1]); print(json.dumps({'derivedClockSha256':hashlib.sha256(s.encode()).hexdigest(),'actualDerivedCompile':True,'actualOriginalProfileGuard':True}))";
const { stdout } = await promisify(execFile)(
  "python3",
  ["-c", python, profile],
  { cwd: repo, timeout: 10000 },
);
const contract = JSON.parse(stdout);
const sources = {};
for (const path of [
  "scripts/fixtures/client-native-enterprise.mjs",
  "scripts/fixtures/macos-clock-derived.mjs",
  "scripts/fixtures/mac-arm64-cold-consistency-derived.mjs",
  "scripts/fixtures/mac-arm64-cold-consistency-derived.test.mjs",
  "scripts/fixtures/native-packaged-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.mjs",
  "scripts/fixtures/native-packaged-macos-arm64-consistency-runtime.test.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.mjs",
  "scripts/fixtures/mac-backend-stage-snapshot.test.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.mjs",
  "scripts/fixtures/mac-cold-ingress-observer.test.mjs",
  "scripts/fixtures/mac-completed-task-readonly.mjs",
  "scripts/fixtures/mac-completed-task-readonly.test.mjs",
  "scripts/tests/macos-clock-probe.py",
  "scripts/tests/mac-arm64-cold-consistency-probe.py",
  "scripts/tests/mac-arm64-cold-consistency.test.py",
  "scripts/tests/macos-clock-profile.test.py",
  "scripts/tests/macos-x64-readiness.py",
  "scripts/tests/macos-x64-readiness.test.py",
  "scripts/tests/native-packaged-runtime-probe.py",
  "scripts/tests/native-g04k-cdp-probe.py",
  "scripts/tests/native-harness-bridge.py",
  "scripts/fixtures/native-first-run-ui.py",
  "scripts/tests/native-os-state-guard.swift",
  "scripts/tests/mac-arm64-cold-consistency-prepare.mjs",
  "clients/uwork/apps/zcode-cli/packages/contracts/src/config/index.ts",
  "clients/uwork/apps/zcode-cli/packages/bootstrap/src/app/session-store.ts",
  "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts",
  "clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/messages.ts",
  "clients/uwork/packages/services/src/session/tasksDatabase/schema-v1.ts",
  "clients/uwork/packages/services/src/paths.ts",
])
  sources[path] = createHash("sha256")
    .update(await readFile(join(repo, path)))
    .digest("hex");
assert.equal(
  sources["scripts/fixtures/mac-backend-stage-snapshot.mjs"],
  "3ed467f4cef4e3028969a7eb56b0cb4c98618119d5a3823e6c01520aa50ed063",
);
const plan = {
  status: "prepared-not-run",
  profile,
  target: "darwin-arm64",
  sourceCommit: "d0a5f374faec815cb5b8bfb73fe7b3b0743345c0",
  manifestPath,
  manifestSha256: ARM_MANIFEST_SHA,
  runtime,
  sources,
  ...contract,
  originalSevenChecksRetained: true,
  addedCase:
    "Still-logged-in completed same task controlled-stop cold reopen before original seat/logout checks",
  originalSecondaryFunctionSha256:
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  originalChildStdio: "ignore",
  originalSecondaryDeadlineMs: 10000,
  stop: "Original owned-group SIGTERM; original10s KILL fallback is observed and fails this normal-stop slice; record child exit/signal and old generation/BH closure",
  oracle:
    "UI task/session/title and original composer data-config first; kernel owned-project-CLI database FD binds fixed private readOnly SELECT; persisted message IDs/role/text/status/model/reasoning/workspace/cwd; no runtime getter, resume/prompt/send observer",
  settlement:
    "UI/current HostIndex completed title and Session semantics settle twice; baseline exact2 settled44/24input20output,2succeededTrace,2gatewayresult and same model/app/current+other",
  zeroReplay:
    "Original proof equality + raw request listener POST path count + supplier call count and full request digests + exact ledger/Trace/gateway row sets; credential freshness/lease/lastViewed allowed",
  workspaceUi:
    "Original aria-label is workspaceLabel project/branch, not absolute path; absolute workspace from stored session and actual executed CLI/supplier cwd",
  historyFreshness:
    "Final original logout-cold launcher excludes every prior observed Main PID, not only first",
  controlledModelContextWindow: 500000,
  backendInitializedOnce: true,
  externalSampler: false,
  secondScenarioMemberDisabled: false,
  guiStarted: false,
  executionGate: "Root+peer exactSHA and exclusive Mac GUI window",
  runArgv: [
    "python3",
    "scripts/tests/mac-arm64-cold-consistency-probe.py",
    "--preparation",
    "<this-exact-preparation.json>",
    "--run",
    "--reviewed-plan-sha256",
    "<Root-reviewed-SHA>",
  ],
};
const directory = join(repo, "data/sandbox-verification", profile);
await mkdir(directory, { mode: 0o700 });
const path = join(directory, "preparation.json");
await writeFile(path, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 });
console.log(
  JSON.stringify({
    planPath: path,
    planSHA: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    sourceCount: Object.keys(sources).length,
    ...contract,
    guiStarted: false,
  }),
);
