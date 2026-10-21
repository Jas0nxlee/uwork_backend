/** One filesystem-allowed topic only. Pure derivation until the explicit fixture entry. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deriveManifestFixture as previous,
  validateManifestProfile,
  PROFILE as PREVIOUS_PROFILE,
} from "./mac-memory-manifest-v16-denied-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-memory-manifest-allowed-v1-20261021";
export function validateAllowedManifestProfile(name, env) {
  assert.equal(name, PROFILE);
  validateManifestProfile(PREVIOUS_PROFILE, env);
}
export function deriveAllowedManifestFixture(original) {
  let s = previous(original);
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  once(
    "let manifestExposure=null,manifestObserverFailed=false;",
    `let manifestExposure=null,manifestObserverFailed=false,manifestResponseObserverFailed=false;const manifestResponses=[];
import{assertManifestAdmissionStage,expectedAllowedManifestPrompt,readAllowedSdkStop}from'./mac-memory-manifest-allowed-stage.mjs';`,
  );
  const push = "  if (!fileContext) modelRequests.push(body);";
  once(
    push,
    push +
      `\ntry{const index=modelRequests.length-1;res.once('finish',()=>{try{manifestResponses.push({index,finished:true,upstreamAborted:!!req.aborted});}catch{manifestResponseObserverFailed=true;}});}catch{manifestResponseObserverFailed=true;}`,
  );
  const start =
      "    else if((c.op==='manifestMemoryStatus'||c.op==='manifestMemoryComplete')&&packagedRuntime){",
    end = '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  const a = s.indexOf(start),
    b = s.indexOf(end, a);
  assert(a >= 0 && b > a && s.indexOf(start, a + 1) === -1);
  s =
    s.slice(0, a) +
    `    else if((c.op==='allowedManifestStatus'||c.op==='allowedManifestReady'||c.op==='allowedManifestComplete')&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.equal(memoryPrevious?.stage,'warm');check.equal(manifestObserverFailed,false,'ALLOWED_MANIFEST_OBSERVER_FAILED');check.equal(manifestResponseObserverFailed,false,'ALLOWED_MANIFEST_RESPONSE_UNAVAILABLE');
 const admin=await api(p+'/configurations/security'),authorization=await api('/api/client/authorize','POST',{channel:'local',action:'filesystem'},identity),execution=await api('/api/client/authorize','POST',{channel:'local',action:'execution'},identity);check.equal(admin.published.allowFilesystem,true);check.equal(authorization.allowed,true);check.equal(authorization.security.allowFilesystem,true);check.equal(execution.allowed,true);check.equal(authorization.tenantId,owner.tenantId);
 const before=memoryPrevious.snapshot,snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.op==='allowedManifestStatus'?'allowed-manifest-status':'allowed-manifest-complete',sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:before.actors.other.identity.user_id}]});assertMacOtherActorAccountingUnchanged(before,snapshot,'other');for(const kind of['ledger','traces','gatewayCalls'])for(const old of before.actors.current.accounting[kind])check.ok(snapshot.actors.current.accounting[kind].some(row=>macStageDigest(row)===macStageDigest(old)),'Old current business row mutated');
 const file=await attestManifestTopic({caseRoot:root,indexPath:ownedMemoryPath(root,join(root,'packaged-workspace'))});const facts={metadataEscaped:false,descriptionObserved:!!manifestExposure,file,policy:{publishedFilesystemAllowed:true,effectiveFilesystemAllowed:true,executionAllowed:true,version:admin.version,revision:admin.revision,tenantId:authorization.tenantId},snapshot,counters:{supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:memoryIngress.read()},requestDigests:modelRequests.map(macStageDigest),responses:manifestResponses.slice()};
 check.ok(modelCalls<=7&&modelRequests.length<=7&&memoryIngress.read()<=7,'Unexpected extra inference call');
 if(c.op==='allowedManifestReady')facts.sdk=await readAllowedSdkStop({caseRoot:root,sessionId:c.sessionId,modelId:model.id,allowPending:true});
 if(c.op==='allowedManifestComplete'){
 check.deepEqual(facts.counters,{supplierCalls:7,modelRequests:7,rawInferencePosts:7});assertMacActorAccountingDelta(before,snapshot,'current',{ledgerRows:3,traceRows:3,gatewayCalls:3,credits:66,inputTokens:36,outputTokens:30,modelId:model.id,application:'uwork'});
 const expected=await expectedAllowedManifestPrompt({caseRoot:root,file});facts.supplier=assertManifestAdmissionStage(modelRequests,{fromCount:4,filesystemAllowed:true,workspacePath:join(root,'packaged-workspace'),prompt:MANIFEST_PROMPT,description:MANIFEST_MARKER,expectedExtractionPrompt:expected.prompt,expectedMainReply:'原生企业资产联动完成。'});facts.expectedPrompt={mtimeMs:expected.mtimeMs,manifestCount:expected.manifestCount,messageCount:expected.messageCount};
 facts.session=await readAutoMemorySession({caseRoot:root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,sessionId:c.sessionId,modelId:model.id,marker:MANIFEST_PROMPT,enabled:true,expectedGate:1});facts.sdk=await readAllowedSdkStop({caseRoot:root,sessionId:c.sessionId,modelId:model.id});for(let index=4;index<7;index++)check.deepEqual(manifestResponses.filter(r=>r.index===index),[{index,finished:true,upstreamAborted:false}]);facts.naturalEndEvidence='Original SDK extraction stop/zero tools, original no-tool HTTP finish, settled accounting, bounded quiet observation; no runtime drain';await writeFile(join(evidence,'memory-manifest-allowed-complete.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});
 }console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` +
    s.slice(b);
  once(
    "await configure('security',{allowFilesystem:false});const manifestSecurity=",
    "await configure('security',{allowFilesystem:true});const manifestSecurity=",
  );
  once(
    "if(manifestSecurity.published.allowFilesystem!==false||manifestAuthorization.allowed!==false||manifestAuthorization.security.allowFilesystem!==false||manifestExecution.allowed!==true)",
    "if(manifestSecurity.published.allowFilesystem!==true||manifestAuthorization.allowed!==true||manifestAuthorization.security.allowFilesystem!==true||manifestExecution.allowed!==true)",
  );
  once(
    "JSON.stringify({publishedFilesystemAllowed:false,effectiveFilesystemAllowed:manifestAuthorization.allowed",
    "JSON.stringify({publishedFilesystemAllowed:true,effectiveFilesystemAllowed:manifestAuthorization.allowed",
  );
  once(
    "from'./mac-memory-extraction-oracle.mjs';",
    "from'./mac-memory-extraction-oracle-v16-readonly.mjs';",
  );
  return s;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateAllowedManifestProfile(
    process.env.UWORK_NATIVE_FIXTURE_NAME,
    process.env,
  );
  const url = pathToFileURL(
      resolve("scripts/fixtures/client-native-enterprise.mjs"),
    ).href,
    source = deriveAllowedManifestFixture(
      readFileSync(fileURLToPath(url), "utf8"),
    );
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
