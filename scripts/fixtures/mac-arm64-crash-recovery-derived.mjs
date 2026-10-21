/** Full recovery adds only readonly snapshots around the already proven crash action. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveCrashFixture } from "./mac-arm64-crash-consistency-derived.mjs";
export const RECOVERY_PROFILE =
  "client-native-packaged-macos-clock-arm64-consistency-v5-20261021";
export const RECOVERY_MARKER = "MACOS_CRASH_RECOVERED_NEW_TASK_20261021";
export function deriveCrashRecoveryFixture(original) {
  let source = deriveCrashFixture(original);
  const phases = '["before-crash","post-crash"].includes(c.phase)';
  assert.equal(source.split(phases).length, 2);
  source = source.replace(
    phases,
    '["before-crash","post-crash","post-recovery","post-new-task"].includes(c.phase)',
  );
  const before =
    '  else {ensure.ok(ownedColdBaseline);assertMacActorAccountingDelta(ownedColdBaseline.snapshot,snapshot,"current",{ledgerRows:0,traceRows:0,gatewayCalls:0,credits:0,inputTokens:0,outputTokens:0});assertMacOtherActorAccountingUnchanged(ownedColdBaseline.snapshot,snapshot,"other");ensure.deepEqual(counters,ownedColdBaseline.counters);}';
  const after = `  else {
    ensure.ok(ownedColdBaseline);
    if(c.phase==="post-recovery"||c.phase==="post-new-task") ensure.ok(electron&&electron!==ownedColdBaseline.child&&electron.exitCode===null&&electron.signalCode===null);
    const added=c.phase==="post-new-task";
    assertMacActorAccountingDelta(ownedColdBaseline.snapshot,snapshot,"current",{ledgerRows:added?2:0,traceRows:added?2:0,gatewayCalls:added?2:0,credits:added?44:0,inputTokens:added?24:0,outputTokens:added?20:0,modelId:model.id,application:"uwork"});
    assertMacOtherActorAccountingUnchanged(ownedColdBaseline.snapshot,snapshot,"other");
    if(added) {
      ensure.equal(counters.supplierCalls,ownedColdBaseline.counters.supplierCalls+2);
      ensure.equal(counters.modelRequests,ownedColdBaseline.counters.modelRequests+2);
      ensure.equal(counters.rawInferencePosts,ownedColdBaseline.counters.rawInferencePosts+2);
      ensure.deepEqual(counters.supplierRequestDigests.slice(0,ownedColdBaseline.counters.modelRequests),ownedColdBaseline.counters.supplierRequestDigests);
    } else ensure.deepEqual(counters,ownedColdBaseline.counters);
  }`;
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, after);
  const facts =
    "  const facts={snapshot,counters,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};";
  assert.equal(source.split(facts).length, 2);
  source = source.replace(
    facts,
    facts +
      `\n  if(c.phase==="post-new-task") facts.supplier=projectCapabilitySupplierRequests(modelRequests,{fromIndex:ownedColdBaseline.counters.modelRequests,workspacePath:join(root,"packaged-workspace"),marker:${JSON.stringify(RECOVERY_MARKER)},expectedTools:32});`,
  );
  const command =
    'else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  assert.equal(source.split(command).length, 2);
  source = source.replace(
    command,
    `else if(c.op === "macRecoveryGeneration" && packagedRuntime) {
    const ensure=(await import("node:assert/strict")).default;ensure.deepEqual(Object.keys(c).sort(),["op","requiredPids"]);
    ensure.ok(ownedColdBaseline&&electron&&electron!==ownedColdBaseline.child);ensure.ok(Array.isArray(c.requiredPids)&&c.requiredPids.length>0&&c.requiredPids.length<=64&&c.requiredPids.every(pid=>Number.isSafeInteger(pid)&&pid>1));
    const facts=await captureCrashGeneration({child:electron,executable:packagedRuntime.executable,requiredPids:c.requiredPids});
    await writeFile(join(evidence,"recovery-current-generation-kernel.json"),JSON.stringify(facts,null,2),{mode:0o600,flag:"wx"});
    console.log(JSON.stringify({op:c.op,status:"done",facts}));return;
  } ` + command,
  );
  return (
    'import {projectCapabilitySupplierRequests} from "./mac-model-capability-stage.mjs";\nimport {captureCrashGeneration} from "./mac-arm64-crash-consistency-process.mjs";\n' +
    source
  );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert.equal(process.env.UWORK_NATIVE_FIXTURE_NAME, RECOVERY_PROFILE);
  assert.equal(process.env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.ok(process.env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const flag of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(process.env[flag], undefined, flag);
  const original = resolve("scripts/fixtures/client-native-enterprise.mjs"),
    url = pathToFileURL(original).href,
    source = deriveCrashRecoveryFixture(readFileSync(original, "utf8"));
  writeFileSync(
    resolve("evidence", RECOVERY_PROFILE, "crash-recovery-derived-source.json"),
    JSON.stringify(
      {
        sha256: createHash("sha256").update(source).digest("hex"),
        originalCrashActionAndHelperUnchanged: true,
        recoveryAndNewTaskOnlyViaOriginalUi: true,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  let loaded = false;
  registerHooks({
    load(current, context, next) {
      const value = next(current, context);
      if (current !== url) return value;
      assert.equal(loaded, false);
      loaded = true;
      return { ...value, source };
    },
  });
  await import(url);
}
