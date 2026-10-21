/** Original signed v15 and UI only; archive state is observed through owned readonly DBs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ARCHIVE_PROFILE } from "./mac-task-archive-observer.mjs";
import { derivePackagedMainReadonly } from "./mac-arm64-memory-filesystem-denied-derived.mjs";
export const PROFILE = ARCHIVE_PROFILE;
export function validateArchiveProfile(name, env) {
  assert.equal(name, PROFILE);
  assert.equal(env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  assert.equal(env.UWORK_NATIVE_CONFIGURATION_WITNESS, "enabled");
  assert.ok(env.UWORK_NATIVE_PACKAGED_MANIFEST);
  for (const key of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
    "UWORK_NATIVE_GATEWAY_USAGE_HOLD",
  ])
    assert.equal(env[key], undefined, key);
}
export function deriveArchiveFixture(original) {
  let source = original;
  const once = (a, b) => {
    assert.equal(source.split(a).length, 2, a);
    source = source.replace(a, b);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    `import{loadOwnedPackagedRuntime}from'./native-packaged-macos-arm64-project-memory-runtime.mjs';
import{captureArchiveTask,assertArchiveTaskUnchanged,ARCHIVE_STAGES}from'./mac-task-archive-observer.mjs';
import{captureMacBackendStage,macStageDigest}from'./mac-backend-stage-snapshot.mjs';
import{installMacColdIngressObserver}from'./mac-cold-ingress-observer.mjs';`,
  );
  once(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    `const archiveIngress=installMacColdIngressObserver(app.server);let archiveBaseline,archivePrevious;
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='archiveStage'&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c).sort(),['dbPath','dom','op','stage','taskId']);const ordinal=ARCHIVE_STAGES.indexOf(c.stage);check.ok(ordinal>=0);check.equal(archivePrevious?.stage,ordinal?ARCHIVE_STAGES[ordinal-1]:undefined);check.equal(c.dom.stage,c.stage);check.equal(c.dom.taskId,c.taskId);check.equal(c.dom.ok,true);
 const archived=['archived','opened'].includes(c.stage);const task=captureArchiveTask({root,workspace:join(root,'packaged-workspace'),dbPath:c.dbPath,taskId:c.taskId});check.equal(task.archived,archived);check.equal(c.dom.identity,'企业用户甲');check.equal(c.dom.title,task.semantic.index.title);if(['baseline','confirming','opened','restored','reloaded'].includes(c.stage)){check.equal(c.dom.sessionId,c.taskId);check.equal(c.dom.userVisible,true);check.equal(c.dom.assistantVisible,true);check.equal(c.dom.model,model.id);check.equal(c.dom.thought,'none');}
 if(c.stage==='confirming')check.equal(c.dom.confirming,true);if(c.stage==='opened')check.equal(c.dom.archivedRows,1);if(c.stage==='reloaded')check.equal(c.dom.normalRows,1);
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(x=>x.email==='journey-b@example.test');check.equal(others.length,1);const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:'archive-'+c.stage,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:archiveIngress.read()};check.deepEqual(counters,{supplierCalls:4,modelRequests:4,rawInferencePosts:4});const rawRequestsDigest=macStageDigest(modelRequests);
 if(archiveBaseline){assertArchiveTaskUnchanged(archiveBaseline.task,task,archived);check.equal(rawRequestsDigest,archiveBaseline.rawRequestsDigest);for(const label of['current','other']){check.deepEqual(snapshot.actors[label].accounting,archiveBaseline.snapshot.actors[label].accounting);check.deepEqual(snapshot.actors[label].identity,archiveBaseline.snapshot.actors[label].identity);}}
 const facts={stage:c.stage,task,dom:c.dom,snapshot,counters,rawRequestsDigest,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id},noModelReplay:true,noCliTimeArchivedMirrorRequired:true};if(!archiveBaseline)archiveBaseline=facts;archivePrevious=facts;await writeFile(join(evidence,'task-archive-'+c.stage+'-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  return derivePackagedMainReadonly(source);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateArchiveProfile(process.env.UWORK_NATIVE_FIXTURE_NAME, process.env);
  const url = pathToFileURL(
      resolve("scripts/fixtures/client-native-enterprise.mjs"),
    ).href,
    source = deriveArchiveFixture(readFileSync(fileURLToPath(url), "utf8"));
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
