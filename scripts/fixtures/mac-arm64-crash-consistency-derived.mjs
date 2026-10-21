/** Explicit crash-observation fixture. Reuses frozen cold derivation, not its TERM conclusion. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script, createContext } from "node:vm";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export const CRASH_PROFILE =
  "client-native-packaged-macos-clock-arm64-consistency-v4-20261021";
const repo = resolve(import.meta.dirname, "../..");
const oldEntryPath = resolve(
  repo,
  "scripts/fixtures/mac-arm64-cold-consistency-derived.mjs",
);
export function deriveCrashFixture(originalSource) {
  const old = readFileSync(oldEntryPath, "utf8");
  assert.equal(old.split("await import(originalUrl);").length, 2);
  const context = createContext({
    assert,
    createHash,
    resolve,
    pathToFileURL,
    process: {
      env: {
        UWORK_NATIVE_FIXTURE_NAME: CRASH_PROFILE,
        UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
        UWORK_NATIVE_PACKAGED_MANIFEST: "owned-reviewed",
      },
    },
    readFileSync: () => originalSource,
    writeFileSync() {},
    registerHooks() {},
  });
  // Executes only the existing source transformer with inert IO/hook boundaries; Common body is never run here.
  new Script(
    old
      .replace(/^import .*;\n/gm, "")
      .replace(
        "await import(originalUrl);",
        "globalThis.derived = derivedSource;",
      ),
  ).runInContext(context, { timeout: 1000 });
  let source = context.derived;
  const loader = "./native-packaged-macos-arm64-consistency-runtime.mjs";
  assert.equal(source.split(loader).length, 2);
  source = source.replace(
    loader,
    "./native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  );
  const start = source.indexOf('else if (c.op === "macColdSnapshot"');
  const finish = source.indexOf(
    'else if (c.op === "packagedRuntimeProof" && packagedRuntime)',
    start,
  );
  assert.ok(start > 0 && finish > start);
  const branch = `else if (c.op === "macCrashSnapshot" && packagedRuntime) {
  const ensure=(await import("node:assert/strict")).default;
  ensure.deepEqual(Object.keys(c).sort(),["op","phase"]);ensure.ok(["before-crash","post-crash"].includes(c.phase));
  const others=(await api(p+"/members?q="+encodeURIComponent("journey-b@example.test"))).items.filter(row=>row.email==="journey-b@example.test");
  ensure.equal(others.length,1);ensure.notEqual(others[0].id,member.id);
  const snapshot=captureMacBackendStage(app.services.db,{authority:"owned-fixture-existing-db",phase:c.phase,sampledAt:Date.now(),actors:[{label:"current",tenantId:owner.tenantId,userId:member.id},{label:"other",tenantId:owner.tenantId,userId:others[0].id}]});
  const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:ownedColdIngress.read(),supplierRequestDigests:modelRequests.map(value=>macStageDigest(value))};
  if(c.phase==="before-crash") {ensure.ok(!ownedColdBaseline);ensure.ok(electron&&electron.exitCode===null&&electron.signalCode===null);ownedColdBaseline={snapshot,counters,child:electron};}
  else {ensure.ok(ownedColdBaseline);assertMacActorAccountingDelta(ownedColdBaseline.snapshot,snapshot,"current",{ledgerRows:0,traceRows:0,gatewayCalls:0,credits:0,inputTokens:0,outputTokens:0});assertMacOtherActorAccountingUnchanged(ownedColdBaseline.snapshot,snapshot,"other");ensure.deepEqual(counters,ownedColdBaseline.counters);}
  const facts={snapshot,counters,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};
  await writeFile(join(evidence,"crash-"+c.phase+"-backend.json"),JSON.stringify(facts,null,2),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({op:c.op,status:"done",facts}));return;
} else if (c.op === "macCrashMain" && packagedRuntime) {
  const ensure=(await import("node:assert/strict")).default;
  ensure.deepEqual(Object.keys(c).sort(),["op","requiredPids"]);ensure.ok(ownedColdBaseline&&ownedColdBaseline.child===electron);
  ensure.ok(Array.isArray(c.requiredPids)&&c.requiredPids.length<=64&&c.requiredPids.every(pid=>Number.isSafeInteger(pid)&&pid>1));
  const result=await crashOwnedMain({child:electron,executable:packagedRuntime.executable,requiredPids:c.requiredPids,onCaptured:async capture=>{
    ownedCrashCapture=capture;await writeFile(join(evidence,"crash-owned-generation-before.json"),JSON.stringify(capture,null,2),{mode:0o600,flag:"wx"});
  }});
  await writeFile(join(evidence,"crash-signal-exit.json"),JSON.stringify(result,null,2),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({op:c.op,status:"done",facts:result}));return;
} else if (c.op === "macCrashCleanup" && packagedRuntime) {
  const ensure=(await import("node:assert/strict")).default;ensure.deepEqual(Object.keys(c).sort(),["op"]);ensure.ok(ownedCrashCapture);
  const facts=await cleanupCapturedCrashGeneration(ownedCrashCapture);
  await writeFile(join(evidence,"crash-exact-residual-cleanup.json"),JSON.stringify(facts,null,2),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({op:c.op,status:"done",facts}));return;
} `;
  source = source.slice(0, start) + branch + source.slice(finish);
  const declaration = "let ownedColdBaseline;";
  assert.equal(source.split(declaration).length, 2);
  source = source.replace(
    declaration,
    declaration + "\nlet ownedCrashCapture;",
  );
  return (
    'import {crashOwnedMain,cleanupCapturedCrashGeneration} from "./mac-arm64-crash-consistency-process.mjs";\n' +
    source
  );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  assert.equal(process.env.UWORK_NATIVE_FIXTURE_NAME, CRASH_PROFILE);
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
  const original = resolve(
      repo,
      "scripts/fixtures/client-native-enterprise.mjs",
    ),
    url = pathToFileURL(original).href;
  const source = deriveCrashFixture(readFileSync(original, "utf8"));
  writeFileSync(
    resolve(repo, "evidence", CRASH_PROFILE, "crash-derived-source.json"),
    JSON.stringify(
      {
        sha256: createHash("sha256").update(source).digest("hex"),
        scope:
          "explicit SIGKILL observation only; recovery/new-task/seat/logout pending; original Common/TERM path unchanged",
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
