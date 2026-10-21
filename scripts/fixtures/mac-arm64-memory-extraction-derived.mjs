/** Own fixture only: original natural Memory executor and standard supplier JSON tool-call batches. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { derivePackagedMainReadonly } from "./mac-arm64-memory-filesystem-denied-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021";
export function validateAutoMemoryProfile(name, env) {
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
}
export function deriveAutoMemoryFixture(original) {
  let source = original;
  const once = (a, b) => {
    assert.equal(source.split(a).length, 2, a);
    source = source.replace(a, b);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    `import{loadOwnedPackagedRuntime}from'./native-packaged-macos-arm64-project-memory-runtime.mjs';
import{createMemoryExtractionOracle,AUTO_PROMPT,AUTO_LABEL,assertAutoFilesAbsent,attestAutoMemoryFiles,readAutoMemorySession}from'./mac-memory-extraction-oracle.mjs';
import{captureMacBackendStage,assertMacActorAccountingDelta,assertMacOtherActorAccountingUnchanged}from'./mac-backend-stage-snapshot.mjs';
import{installMacColdIngressObserver}from'./mac-cold-ingress-observer.mjs';`,
  );
  once(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  );
  once(
    "const upstream = httpServer(async (req, res) => {",
    `const autoMemoryOracle=createMemoryExtractionOracle({caseRoot:root,workspacePath:join(root,'packaged-workspace')});let autoMemoryPrevious,autoMemoryRejected;
const upstream = httpServer(async (req, res) => {`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    `  if (!fileContext) modelRequests.push(body);
  if(!fileContext){try{fileReply=autoMemoryOracle.reply(body);if(fileReply)autoMemoryOracle.observeResponse(res);}catch(error){autoMemoryRejected??={code:'AUTO_MEMORY_SUPPLIER_REJECTED',errorType:error instanceof Error?'Error':typeof error};res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'AUTO_MEMORY_SUPPLIER_REJECTED'}));return;}}`,
  );
  once(
    "    ? !!fileReply.toolCall",
    "    ? (!!fileReply.toolCall || Array.isArray(fileReply.toolCalls))",
  );
  once(
    '? { role: "assistant", content: null, tool_calls: [call] }',
    '? { role: "assistant", content: null, tool_calls: fileReply?.toolCalls ?? [call] }',
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    `const autoMemoryIngress=installMacColdIngressObserver(app.server);
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });`,
  );
  once(
    'console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));',
    `await configure('security',{allowFilesystem:true});const autoSecurity=await api(p+'/configurations/security');if(autoSecurity.published.allowFilesystem!==true)throw Error('AUTO_MEMORY_FILESYSTEM_NOT_PUBLISHED');const autoModel=(await api(p+'/models')).find(row=>row.id===model.id);if(autoModel.data.contextWindow!==500000||autoModel.data.supportsTools!==true||autoModel.data.maxOutputTokens!==1024)throw Error('AUTO_MEMORY_MODEL_PREREQUISITE');
console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='autoMemoryStatus'&&packagedRuntime){const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c),['op']);check.ok(!autoMemoryRejected,autoMemoryRejected?.code);console.log(JSON.stringify({op:c.op,status:'done',facts:{available:true,oracle:autoMemoryOracle.safeStatus()}}));return;
} else if(c.op==='autoMemoryProof'&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.ok(!autoMemoryRejected,autoMemoryRejected?.code);check.deepEqual(Object.keys(c).sort(),['dbPath','op','sessionId','stage']);const phases=['warm','after-A','after-B'];const ordinal=phases.indexOf(c.stage);check.ok(ordinal>=0);check.equal(autoMemoryPrevious?.stage,ordinal?phases[ordinal-1]:undefined);
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');check.equal(others.length,1);check.notEqual(others[0].id,member.id);
 const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:['warm','after-a','after-b'][ordinal],sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});const total=[4,8,10][ordinal];const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:autoMemoryIngress.read()};check.deepEqual(counters,{supplierCalls:total,modelRequests:total,rawInferencePosts:total});
 const security=await api(p+'/configurations/security');check.equal(security.published.allowFilesystem,true);const session=await readAutoMemorySession({caseRoot:root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,sessionId:c.sessionId,modelId:model.id,marker:ordinal===0?'MACOS_CLOCK_LINK_20261020 请简短回复，不调用工具。':ordinal===1?AUTO_PROMPT:AUTO_LABEL,enabled:ordinal>0,expectedGate:ordinal===1?1:0});
 const oracle=autoMemoryOracle.safeStatus();if(ordinal){check.deepEqual([oracle.mainA,oracle.sidecar,oracle.titleA,oracle.mainB,oracle.titleB],[1,2,1,ordinal===2?1:0,ordinal===2?1:0]);check.equal(oracle.receipts.length,ordinal===1?4:6);check.ok(oracle.receipts.every(r=>r.httpFinished===true&&r.writableFinished===true&&r.httpAborted===false&&r.statusCode===200));}
 const files=ordinal?await attestAutoMemoryFiles(root,join(root,'packaged-workspace'),ordinal===1?c.sessionId:autoMemoryPrevious.files.topic.originSessionId):await assertAutoFilesAbsent(root,join(root,'packaged-workspace'));
 if(autoMemoryPrevious){const calls=ordinal===1?4:2;assertMacActorAccountingDelta(autoMemoryPrevious.snapshot,snapshot,'current',{ledgerRows:calls,traceRows:calls,gatewayCalls:calls,credits:22*calls,inputTokens:12*calls,outputTokens:10*calls,modelId:model.id,application:'uwork'});assertMacOtherActorAccountingUnchanged(autoMemoryPrevious.snapshot,snapshot,'other');}
 const facts={stage:c.stage,snapshot,counters,session,oracle,files,permissions:{allowFilesystem:true,securityVersion:security.version},bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id},naturalEndEvidence:'No-tool final sidecar reply real HTTP finish/noabort + all accepted calls settled; source loopbreak, no runtime drain invoked'};autoMemoryPrevious=facts;await writeFile(join(evidence,'auto-memory-'+c.stage+'-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  return derivePackagedMainReadonly(source);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateAutoMemoryProfile(process.env.UWORK_NATIVE_FIXTURE_NAME, process.env);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveAutoMemoryFixture(
    readFileSync(fileURLToPath(url), "utf8"),
  );
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
