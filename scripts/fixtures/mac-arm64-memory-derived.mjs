/** New local Memory test only; original signed Main/Host/CLI/Memory implementation unchanged. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-memory-v2-20261021";
export function deriveMemoryFixture(original) {
  let s = original;
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    `import{loadOwnedPackagedRuntime}from'./native-packaged-macos-arm64-asar-integrity-runtime.mjs';
import{captureMacBackendStage,assertMacActorAccountingDelta,assertMacOtherActorAccountingUnchanged}from'./mac-backend-stage-snapshot.mjs';
import{installMacColdIngressObserver}from'./mac-cold-ingress-observer.mjs';
import{MEMORY_LABELS,MEMORY_STAGES,ownedMemoryPath,attestMemoryInput,inspectMemorySession,projectMemoryStageRequests}from'./mac-memory-stage.mjs';`,
  );
  once(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    `const memoryIngress=installMacColdIngressObserver(app.server);let memoryPrevious;
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });`,
  );
  once(
    'const dA = await api(p + "/departments", "POST", { name: "业务一部" }),',
    `const memoryModel=(await api(p+'/models')).find(row=>row.id===model.id);if(memoryModel?.data.contextWindow!==500000||memoryModel.data.supportsTools!==true||memoryModel.data.maxOutputTokens!==1024)throw Error('MEMORY_MODEL_PREREQUISITE');
const dA = await api(p + "/departments", "POST", { name: "业务一部" }),`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='memoryProof'&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c).sort(),['dbPath','op','sessionId','stage']);const ordinal=MEMORY_STAGES.indexOf(c.stage);check.ok(ordinal>=0);check.equal(memoryPrevious?.stage,ordinal?MEMORY_STAGES[ordinal-1]:undefined);const enabled=ordinal===2;
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');check.equal(others.length,1);check.notEqual(others[0].id,member.id);
 const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.stage,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});
 const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:memoryIngress.read()};check.deepEqual(counters,{supplierCalls:4+ordinal*2,modelRequests:4+ordinal*2,rawInferencePosts:4+ordinal*2});
 const marker=MEMORY_LABELS[ordinal]+(ordinal===0?" 请简短回复，不调用工具。":"");const supplier=ordinal?projectMemoryStageRequests(modelRequests,{fromIndex:2+ordinal*2,workspacePath:join(root,'packaged-workspace'),caseRoot:root,marker,enabled}):null;
 const session=await inspectMemorySession({caseRoot:root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,sessionId:c.sessionId,marker,enabled,modelId:model.id});
 const file=ordinal?await attestMemoryInput(root,join(root,'packaged-workspace')):{filePath:ownedMemoryPath(root,join(root,'packaged-workspace'))};
 if(memoryPrevious){assertMacActorAccountingDelta(memoryPrevious.snapshot,snapshot,'current',{ledgerRows:2,traceRows:2,gatewayCalls:2,credits:44,inputTokens:24,outputTokens:20,modelId:model.id,application:'uwork'});assertMacOtherActorAccountingUnchanged(memoryPrevious.snapshot,snapshot,'other');}
 const responses=traffic.filter(row=>row.method==='POST'&&row.pathname==='/v1/chat/completions').map(row=>row.status);check.equal(responses.length,4+ordinal*2);check.ok(responses.every(code=>code===200));check.ok(snapshot.actors.current.accounting.gatewayCalls.every(row=>row.has_result));
 const facts={stage:c.stage,snapshot,counters,responses,supplier,session,file,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};check.equal(me.user.id,member.id);check.equal(me.tenant.id,owner.tenantId);memoryPrevious=facts;
 await writeFile(join(evidence,'memory-'+c.stage+'-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  return s;
}
export function validateMemoryProfile(name, env) {
  assert.equal(name, PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const flag of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(env[flag], undefined, flag);
  return name;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateMemoryProfile(process.env.UWORK_NATIVE_FIXTURE_NAME, process.env);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveMemoryFixture(readFileSync(fileURLToPath(url), "utf8"));
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const result = next(target, context);
      if (target !== url) return result;
      assert.equal(loaded, false);
      loaded = true;
      return { ...result, source };
    },
  });
  await import(url);
}
