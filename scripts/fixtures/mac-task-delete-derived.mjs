/** Pure owned fixture derivation; original UI is the sole fork/archive/delete writer. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveArchiveFixture } from "./mac-arm64-task-archive-derived.mjs";
import { DELETE_PROFILE } from "./mac-task-delete-readonly.mjs";
export const PROFILE = DELETE_PROFILE;
export function validateDeleteProfile(name, env) {
  assert.equal(name, PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const key of ["UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE", "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN", "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION", "UWORK_NATIVE_PRIMARY_LOGIN", "UWORK_NATIVE_FILE_CONTEXT", "UWORK_NATIVE_VIEWER_AUTH", "UWORK_NATIVE_GATEWAY_USAGE_HOLD"]) assert.equal(env[key], undefined);
}
export function deriveDeleteFixture(original) {
  let s = deriveArchiveFixture(original);
  const once = (a,b) => { assert.equal(s.split(a).length,2,a); s=s.replace(a,b); };
  once("from'./native-packaged-macos-arm64-project-memory-runtime.mjs';", "from'./native-packaged-macos-arm64-memory-manifest-runtime.mjs';");
  once("import{captureArchiveTask,assertArchiveTaskUnchanged,ARCHIVE_STAGES}from'./mac-task-archive-observer.mjs';", "import{captureTaskDelete,assertDeletePreserved,DELETE_STAGES}from'./mac-task-delete-readonly.mjs';");
  once("let archiveBaseline,archivePrevious;", "let deleteBaseline,deletePrevious,deleteForkBaseline;");
  const start=s.indexOf("    else if(c.op==='archiveStage'&&packagedRuntime){");
  const end=s.indexOf('    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {',start);
  assert.ok(start>0&&end>start);
  s=s.slice(0,start)+`    else if(c.op==='taskDeleteStage'&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c).sort(),['childId','dbPath','dom','op','parentId','stage']);const ordinal=DELETE_STAGES.indexOf(c.stage);check.ok(ordinal>=0);check.equal(deletePrevious?.stage,ordinal?DELETE_STAGES[ordinal-1]:undefined);check.equal(c.dom.ok,true);check.equal(c.dom.stage,c.stage);check.equal(c.dom.parentId,c.parentId);check.equal(c.dom.childId,c.childId);check.equal(c.dom.identity,'企业用户甲');
 const local=captureTaskDelete({root,workspace:join(root,'packaged-workspace'),dbPath:c.dbPath,parentId:c.parentId,childId:c.childId,modelId:model.id,stage:c.stage});
 if(c.stage==='baseline'){check.equal(c.dom.sessionId,c.parentId);deleteBaseline={local};}else{check.equal(c.parentId,deleteBaseline.local.parent.taskId);check.notEqual(c.childId,c.parentId);if(c.stage==='forked')deleteForkBaseline={local};else check.equal(c.childId,deleteForkBaseline.local.child.taskId);assertDeletePreserved(deleteBaseline.local,local,deleteForkBaseline.local);}
 if(['cancel-dialog','delete-dialog'].includes(c.stage))check.equal(c.dom.dialogCount,1);else check.equal(c.dom.dialogCount,0);if(['archived','cancelled'].includes(c.stage))check.equal(c.dom.archivedChildRows,1);if(['deleted','reloaded'].includes(c.stage)){check.equal(c.dom.archivedChildRows,0);check.equal(c.dom.normalChildRows,0);}if(c.stage==='reloaded'){check.equal(c.dom.sessionId,c.parentId);check.equal(c.dom.parentVisible,true);}
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(x=>x.email==='journey-b@example.test');check.equal(others.length,1);const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:'task-delete-'+c.stage,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:archiveIngress.read()};check.deepEqual(counters,{supplierCalls:4,modelRequests:4,rawInferencePosts:4});const rawRequestsDigest=macStageDigest(modelRequests);
 if(deletePrevious){check.equal(rawRequestsDigest,deletePrevious.rawRequestsDigest);for(const label of['current','other']){check.deepEqual(snapshot.actors[label].accounting,deletePrevious.snapshot.actors[label].accounting);check.deepEqual(snapshot.actors[label].identity,deletePrevious.snapshot.actors[label].identity);}}
 const facts={stage:c.stage,local,dom:c.dom,snapshot,counters,rawRequestsDigest,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id},noModelReplay:true,cliHistoryRetained:true};deletePrevious=facts;await writeFile(join(evidence,'task-delete-'+c.stage+'-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} `+s.slice(end);
  return s;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  validateDeleteProfile(process.env.UWORK_NATIVE_FIXTURE_NAME,process.env);
  const url=pathToFileURL(resolve("scripts/fixtures/client-native-enterprise.mjs")).href;
  const source=deriveDeleteFixture(readFileSync(fileURLToPath(url),"utf8"));let loaded=false;
  registerHooks({load(target,context,next){const value=next(target,context);if(target!==url)return value;assert.equal(loaded,false);loaded=true;return{...value,source};}});
  await import(url);
}
