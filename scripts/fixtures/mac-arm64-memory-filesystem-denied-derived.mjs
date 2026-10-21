/** New explicit-FS-denied transport observer; no change to signed product or Memory consumer. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveMemoryFixture } from "./mac-arm64-memory-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-memory-filesystem-denied-v4-20261021";
export const DENIED_LABEL = "UWORK_NATIVE_MEMORY_FILESYSTEM_DENIED_20261021";
export function projectDeniedMemoryRequest(request, label, bodyMarker) {
  const messageText = (m) =>
    typeof m?.content === "string"
      ? m.content
      : Array.isArray(m?.content)
        ? m.content
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("\n")
        : "";
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const stageMain =
    request?.stream === true &&
    messages.some((m) => m.role === "user" && messageText(m).includes(label));
  return {
    stageMain,
    bodyEscaped:
      stageMain && messages.some((m) => messageText(m).includes(bodyMarker)),
    stream: request?.stream === true,
    roles: messages.map((m) => m.role),
    toolCount: Array.isArray(request?.tools) ? request.tools.length : 0,
  };
}
export function deriveDeniedMemoryFixture(original) {
  let s = deriveMemoryFixture(original);
  assert.equal(
    s.split("native-packaged-macos-arm64-asar-integrity-runtime.mjs").length,
    2,
  );
  s = s.replace(
    "native-packaged-macos-arm64-asar-integrity-runtime.mjs",
    "native-packaged-macos-arm64-project-memory-runtime.mjs",
  );
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  once(
    "import{MEMORY_LABELS,MEMORY_STAGES,ownedMemoryPath,attestMemoryInput,inspectMemorySession,projectMemoryStageRequests}from'./mac-memory-stage.mjs';",
    `import{MEMORY_LABELS,MEMORY_STAGES,MEMORY_BODY,ownedMemoryPath,attestMemoryInput,inspectMemorySession,projectMemoryStageRequests}from'./mac-memory-stage.mjs';
import{projectCapabilitySupplierRequests}from'./mac-model-capability-stage.mjs';
import{macStageDigest}from'./mac-backend-stage-snapshot.mjs';
const DENIED_LABEL=${JSON.stringify(DENIED_LABEL)};
const projectDeniedMemoryRequest=${projectDeniedMemoryRequest.toString()};
let deniedMemoryExposure=null,deniedMemoryObserverFailed=false;`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    `  if (!fileContext) modelRequests.push(body);
try{const seen=projectDeniedMemoryRequest(body,DENIED_LABEL,MEMORY_BODY);if(seen.bodyEscaped&&!deniedMemoryExposure)deniedMemoryExposure={...seen,index:modelRequests.length-1,requestDigest:macStageDigest(body),code:'MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE'};}catch{deniedMemoryObserverFailed=true;}`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if((c.op==='memoryFilesystemStatus'||c.op==='memoryFilesystemComplete')&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.ok(memoryPrevious?.stage==='warm');check.equal(deniedMemoryObserverFailed,false,'MEMORY_DENIED_OBSERVER_FAILED');
 const admin=await api(p+'/configurations/security');check.equal(admin.published.allowFilesystem,false);check.ok(Number.isSafeInteger(admin.version));
 const effective=await api('/api/client/authorize','POST',{channel:'local',action:'filesystem'},identity);const execution=await api('/api/client/authorize','POST',{channel:'local',action:'execution'},identity);check.equal(effective.allowed,false);check.equal(effective.security.allowFilesystem,false);check.equal(execution.allowed,true);check.equal(effective.tenantId,owner.tenantId);
 const before=memoryPrevious.snapshot;const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.op==='memoryFilesystemStatus'?'memory-filesystem-status':'memory-filesystem-complete',sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:before.actors.other.identity.user_id}]});
 assertMacOtherActorAccountingUnchanged(before,snapshot,'other');
 const facts={bodyEscaped:!!deniedMemoryExposure,exposure:deniedMemoryExposure,policy:{publishedFilesystemAllowed:admin.published.allowFilesystem,version:admin.version,revision:admin.revision,effectiveFilesystemAllowed:effective.allowed,effectiveSecurity:effective.security,executionAllowed:execution.allowed,tenantId:effective.tenantId},snapshot,counters:{supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:memoryIngress.read()},requestDigests:modelRequests.map(macStageDigest)};
 if(deniedMemoryExposure){await writeFile(join(evidence,'memory-filesystem-denied-exposure.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'w'});}
 if(c.op==='memoryFilesystemComplete'){
  check.equal(facts.bodyEscaped,false,'MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE');
  check.deepEqual(facts.counters,{supplierCalls:6,modelRequests:6,rawInferencePosts:6});
  assertMacActorAccountingDelta(before,snapshot,'current',{ledgerRows:2,traceRows:2,gatewayCalls:2,credits:44,inputTokens:24,outputTokens:20,modelId:model.id,application:'uwork'});
  facts.supplier=projectCapabilitySupplierRequests(modelRequests,{fromIndex:4,workspacePath:join(root,'packaged-workspace'),marker:DENIED_LABEL,expectedTools:32});
  const requests=modelRequests.slice(4).map(r=>projectDeniedMemoryRequest(r,DENIED_LABEL,MEMORY_BODY));check.equal(requests.filter(r=>r.stageMain).length,1);check.ok(requests.every(r=>!r.bodyEscaped));
  facts.session=await inspectMemorySession({caseRoot:root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,sessionId:c.sessionId,marker:DENIED_LABEL,enabled:true,modelId:model.id});facts.file=await attestMemoryInput(root,join(root,'packaged-workspace'));
  await writeFile(join(evidence,'memory-filesystem-denied-complete.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});
 }
 console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  once(
    'console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));',
    `await configure('security',{allowFilesystem:false});
const deniedPolicy=await api(p+'/configurations/security');if(deniedPolicy.published.allowFilesystem!==false)throw Error('MEMORY_DENIED_PUBLISHED_REQUIRED');
const deniedAuthorization=await api('/api/client/authorize','POST',{channel:'local',action:'filesystem'},identity);const deniedExecution=await api('/api/client/authorize','POST',{channel:'local',action:'execution'},identity);if(deniedAuthorization.allowed!==false||deniedAuthorization.security.allowFilesystem!==false||deniedExecution.allowed!==true)throw Error('MEMORY_DENIED_EFFECTIVE_REQUIRED');
await writeFile(join(evidence,'memory-filesystem-before-launch.json'),JSON.stringify({publishedFilesystemAllowed:deniedPolicy.published.allowFilesystem,revision:deniedPolicy.revision,version:deniedPolicy.version,effectiveFilesystemAllowed:deniedAuthorization.allowed,security:deniedAuthorization.security,executionAllowed:deniedExecution.allowed,tenantId:deniedAuthorization.tenantId},null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));`,
  );
  return derivePackagedMainReadonly(s);
}
export function derivePackagedMainReadonly(original) {
  let s = original;
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  const snapshotStart = original.indexOf(
    "const outSnapshot = await copyNativeOutSnapshot({",
  );
  const snapshotEnd = original.indexOf(
    'await writeFile(\n  join(appRoot, "env-guard.cjs"),',
    snapshotStart,
  );
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  once(
    original.slice(snapshotStart, snapshotEnd),
    `// PACKAGED_MAIN_READONLY_BEGIN
if(!packagedRuntime)throw Error('MEMORY_DENIED_SIGNED_PACKAGE_REQUIRED');
const packagedMainArchive=join(packagedRuntime.appPath,'Contents/Resources/app.asar');
const packagedMainReader=await import(pathToFileURL(join(client,'node_modules/@electron/asar/lib/asar.js')).href);
const packagedMainEntry=packagedMainReader.statFile(packagedMainArchive,'out/main/index.js',false);
if(!Number.isSafeInteger(packagedMainEntry.size)||packagedMainEntry.size<=0||packagedMainEntry.size>16*1024*1024||packagedMainEntry.link!==undefined||packagedMainEntry.unpacked===true)throw Error('MEMORY_DENIED_INVALID_PACKAGED_MAIN');
const packagedMainBytes=packagedMainReader.extractFile(packagedMainArchive,'out/main/index.js',false);
if(!Buffer.isBuffer(packagedMainBytes)||packagedMainBytes.length!==packagedMainEntry.size)throw Error('MEMORY_DENIED_PACKAGED_MAIN_SIZE');
const mainHash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const mainEntrySha256=mainHash(packagedMainBytes);
await writeFile(join(evidence,'packaged-main-readonly.json'),JSON.stringify({noDevelopmentOutCopied:true,packagedActualMain:true,entry:'out/main/index.js',bytes:packagedMainBytes.length,mainEntrySha256,authority:'strict-loader-verified-signed-app.asar',notDevelopmentOutSnapshot:true},null,2),{mode:0o600,flag:'wx'});
// PACKAGED_MAIN_READONLY_END
`,
  );
  return s;
}
export function validateDeniedMemoryProfile(name, env) {
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
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateDeniedMemoryProfile(
    process.env.UWORK_NATIVE_FIXTURE_NAME,
    process.env,
  );
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveDeniedMemoryFixture(
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
