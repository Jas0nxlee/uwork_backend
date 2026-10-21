/** Owned test entry, pure derivation on import. No business RPC or install/state injection. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { derivePackagedMainReadonly } from "./mac-arm64-memory-filesystem-denied-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021";
export function validateMessageProfile(name, env) {
  assert.equal(name, PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const k of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(env[k], undefined, k);
}
export function deriveMessageFixture(original) {
  let s = original;
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    `import{loadOwnedPackagedRuntime}from'./native-packaged-macos-arm64-project-memory-runtime.mjs';
import{createMessageLifecycleSupplier,projectMessageLifecycleStage}from'./mac-message-edit-fork-oracle.mjs';
import{readMessageLifecycle,assertForkCopiedPrefix}from'./mac-message-edit-fork-readonly.mjs';
import{captureMacBackendStage,assertMacActorAccountingDelta,assertMacOtherActorAccountingUnchanged,macStageDigest}from'./mac-backend-stage-snapshot.mjs';
import{installMacColdIngressObserver}from'./mac-cold-ingress-observer.mjs';
const messageSupplier=createMessageLifecycleSupplier();let messagePrevious;`,
  );
  once(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    `const messageIngress=installMacColdIngressObserver(app.server);
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    "  if (!fileContext) modelRequests.push(body);\n  fileReply=messageSupplier.reply(body)??fileReply;",
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='messageLifecycleProof'&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c).sort(),['dbPath','dom','op','phase','taskId']);
 const phases=['warm','edit','fork','child','reload'],ordinal=phases.indexOf(c.phase);check.ok(ordinal>=0);check.equal(messagePrevious?.phase,ordinal?phases[ordinal-1]:undefined);
 const count=[4,5,5,6,6][ordinal];check.equal(modelCalls,count);check.equal(modelRequests.length,count);check.equal(messageIngress.read(),count);
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');check.equal(others.length,1);check.notEqual(others[0].id,member.id);
 const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:'message-'+c.phase,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});
 const local=readMessageLifecycle({root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,taskId:c.taskId,phase:c.phase,dom:c.dom});
 check.equal(local.semantic.modelSelection.providerId,'ucas');check.equal(local.semantic.modelSelection.modelId,model.id);check.equal(local.semantic.modelSelection.options?.reasoningLevel,'none');
 if(ordinal===1)check.equal(c.taskId,messagePrevious.local.semantic.sessionId);
 if(ordinal===2){check.notEqual(c.taskId,messagePrevious.local.semantic.sessionId);check.equal(local.semantic.parentId,messagePrevious.local.semantic.sessionId);check.equal(local.semantic.taskType,'fork');assertForkCopiedPrefix(messagePrevious.local.semantic,local.semantic);}
 if(ordinal>=3)check.equal(c.taskId,messagePrevious.local.semantic.sessionId);
 if(ordinal===4)check.deepEqual(local,messagePrevious.local);
 const supplier=ordinal&&ordinal<4?projectMessageLifecycleStage(modelRequests,{phase:c.phase,fromIndex:messagePrevious.counters.modelRequests,workspacePath:join(root,'packaged-workspace')}):null;
 if(messagePrevious){const n=ordinal===1||ordinal===3?1:0;assertMacActorAccountingDelta(messagePrevious.snapshot,snapshot,'current',{ledgerRows:n,traceRows:n,gatewayCalls:n,credits:n*22,inputTokens:n*12,outputTokens:n*10,modelId:model.id,application:'uwork'});assertMacOtherActorAccountingUnchanged(messagePrevious.snapshot,snapshot,'other');}
 const responses=traffic.filter(row=>row.method==='POST'&&row.pathname==='/v1/chat/completions').map(row=>row.status);check.equal(responses.length,count);check.ok(responses.every(status=>status===200));
 const facts={phase:c.phase,local,snapshot,supplier,counters:{supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:messageIngress.read()},requestDigests:modelRequests.map(macStageDigest),responses,supplierStatus:messageSupplier.safeStatus(),bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};
 check.equal(me.user.id,member.id);check.equal(me.tenant.id,owner.tenantId);messagePrevious=facts;
 await writeFile(join(evidence,'message-'+c.phase+'-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  const body = (text) =>
    text.slice(
      text.indexOf("async function openWorkspace(workspacePath) {"),
      text.indexOf("async function stopNative() {"),
    );
  assert.equal(body(s), body(original));
  return derivePackagedMainReadonly(s);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateMessageProfile(process.env.UWORK_NATIVE_FIXTURE_NAME, process.env);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveMessageFixture(readFileSync(fileURLToPath(url), "utf8"));
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const value = next(target, context);
      if (target !== url) return value;
      assert.equal(loaded, false);
      loaded = true;
      return { ...value, source };
    },
  });
  await import(url);
}
