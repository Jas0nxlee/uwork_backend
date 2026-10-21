/** New Native manifest-description consumer test, transport observation only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveMemoryFixture } from "./mac-arm64-memory-derived.mjs";
import { derivePackagedMainReadonly } from "./mac-arm64-memory-filesystem-denied-derived.mjs";
export const PROFILE =
  "client-native-packaged-macos-clock-arm64-memory-manifest-fixed-denied-v2-20261021";
export const MANIFEST_MARKER =
  "UWORK_NATIVE_MEMORY_MANIFEST_DESCRIPTION_20261021";
export const MANIFEST_PROMPT =
  "UWORK_NATIVE_MEMORY_MANIFEST_QUERY_20261021 retain project preference";
export const TOPIC_NAME = "owned-manifest-topic.md";
export const TOPIC_TEXT =
  "---\nname: owned-manifest-topic\ndescription: " +
  MANIFEST_MARKER +
  "\nmetadata:\n  type: project\n---\nOwned local acceptance topic.\n";
export function projectManifestRequest(request, marker) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  return {
    metadataEscaped: JSON.stringify(request).includes(marker),
    stream: request?.stream === true,
    roles: messages.map((m) => m?.role),
    toolCount: Array.isArray(request?.tools) ? request.tools.length : 0,
    requestKind: request?.stream === true ? "stream-main" : "nonstream",
  };
}
export async function attestManifestTopic({ caseRoot, indexPath }) {
  const check = (await import("node:assert/strict")).default,
    { lstat, realpath, readFile } = await import("node:fs/promises"),
    p = await import("node:path"),
    { createHash } = await import("node:crypto");
  check.equal(p.resolve(caseRoot), caseRoot);
  check.equal(p.resolve(indexPath), indexPath);
  check.ok(
    indexPath.startsWith(
      p.join(caseRoot, "data/.uwork/cli/memories/projects") + p.sep,
    ),
  );
  check.equal(p.basename(indexPath), "MEMORY.md");
  check.equal(p.basename(p.dirname(indexPath)), "memory");
  const filePath = p.join(p.dirname(indexPath), TOPIC_NAME),
    tail = p.relative(caseRoot, filePath);
  check.ok(
    tail &&
      !p.isAbsolute(tail) &&
      tail !== ".." &&
      !tail.startsWith(".." + p.sep),
  );
  let cursor = caseRoot;
  check.equal(await realpath(cursor), cursor);
  for (const part of tail.split(p.sep)) {
    cursor = p.join(cursor, part);
    const st = await lstat(cursor);
    check.ok(!st.isSymbolicLink());
    check.ok(cursor === filePath ? st.isFile() : st.isDirectory());
    check.equal(await realpath(cursor), cursor);
  }
  const bytes = await readFile(filePath);
  check.equal(bytes.toString("utf8"), TOPIC_TEXT);
  try {
    await lstat(indexPath);
    check.fail("No index may be seeded or written in manifest test");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    filePath,
    relativeFilePath: tail,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    indexAbsent: true,
    plainOwnedPath: true,
    descriptionOnlyMarker: true,
  };
}
export function deriveManifestFixture(original) {
  let s = deriveMemoryFixture(original);
  const once = (a, b) => {
    assert.equal(s.split(a).length, 2, a);
    s = s.replace(a, b);
  };
  once(
    "from'./native-packaged-macos-arm64-asar-integrity-runtime.mjs';",
    "from'./native-packaged-macos-arm64-memory-manifest-runtime.mjs';",
  );
  const imports =
    "import{MEMORY_LABELS,MEMORY_STAGES,ownedMemoryPath,attestMemoryInput,inspectMemorySession,projectMemoryStageRequests}from'./mac-memory-stage.mjs';";
  once(
    imports,
    imports +
      `\nimport{macStageDigest}from'./mac-backend-stage-snapshot.mjs';
import{projectCapabilitySupplierRequests}from'./mac-model-capability-stage.mjs';
import{readAutoMemorySession}from'./mac-memory-extraction-oracle.mjs';
const MANIFEST_MARKER=${JSON.stringify(MANIFEST_MARKER)},MANIFEST_PROMPT=${JSON.stringify(MANIFEST_PROMPT)},TOPIC_NAME=${JSON.stringify(TOPIC_NAME)},TOPIC_TEXT=${JSON.stringify(TOPIC_TEXT)};
const projectManifestRequest=${projectManifestRequest.toString()},attestManifestTopic=${attestManifestTopic.toString()};
let manifestExposure=null,manifestObserverFailed=false;`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    `  if (!fileContext) modelRequests.push(body);
try{const observed=projectManifestRequest(body,MANIFEST_MARKER);if(observed.metadataEscaped&&!manifestExposure)manifestExposure={...observed,index:modelRequests.length-1,requestDigest:macStageDigest(body),code:'MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE'};}catch{manifestObserverFailed=true;}`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if((c.op==='manifestMemoryStatus'||c.op==='manifestMemoryComplete')&&packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.equal(memoryPrevious?.stage,'warm');check.equal(manifestObserverFailed,false,'MANIFEST_OBSERVER_FAILED');
 const admin=await api(p+'/configurations/security');check.equal(admin.published.allowFilesystem,false);check.ok(Number.isSafeInteger(admin.version));const authorization=await api('/api/client/authorize','POST',{channel:'local',action:'filesystem'},identity),execution=await api('/api/client/authorize','POST',{channel:'local',action:'execution'},identity);check.equal(authorization.allowed,false);check.equal(authorization.security.allowFilesystem,false);check.equal(execution.allowed,true);check.equal(authorization.tenantId,owner.tenantId);
 const before=memoryPrevious.snapshot,snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.op==='manifestMemoryStatus'?'manifest-memory-status':'manifest-memory-complete',sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:before.actors.other.identity.user_id}]});
 assertMacOtherActorAccountingUnchanged(before,snapshot,'other');for(const kind of['ledger','traces','gatewayCalls'])for(const old of before.actors.current.accounting[kind])check.ok(snapshot.actors.current.accounting[kind].some(row=>macStageDigest(row)===macStageDigest(old)),'Old current business row mutated');
 const file=await attestManifestTopic({caseRoot:root,indexPath:ownedMemoryPath(root,join(root,'packaged-workspace'))});const facts={metadataEscaped:!!manifestExposure,exposure:manifestExposure,file,policy:{publishedFilesystemAllowed:false,effectiveFilesystemAllowed:authorization.allowed,effectiveSecurity:authorization.security,executionAllowed:execution.allowed,version:admin.version,revision:admin.revision,tenantId:authorization.tenantId},snapshot,counters:{supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:memoryIngress.read()},requestDigests:modelRequests.map(macStageDigest)};
 if(manifestExposure)await writeFile(join(evidence,'memory-manifest-denied-exposure.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'w'});
 if(c.op==='manifestMemoryComplete'){
 check.equal(facts.metadataEscaped,false,'MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE');check.deepEqual(facts.counters,{supplierCalls:6,modelRequests:6,rawInferencePosts:6});
 assertMacActorAccountingDelta(before,snapshot,'current',{ledgerRows:2,traceRows:2,gatewayCalls:2,credits:44,inputTokens:24,outputTokens:20,modelId:model.id,application:'uwork'});facts.supplier=projectCapabilitySupplierRequests(modelRequests,{fromIndex:4,workspacePath:join(root,'packaged-workspace'),marker:MANIFEST_PROMPT,expectedTools:32});facts.session=await readAutoMemorySession({caseRoot:root,workspacePath:join(root,'packaged-workspace'),dbPath:c.dbPath,sessionId:c.sessionId,modelId:model.id,marker:MANIFEST_PROMPT,enabled:true,expectedGate:1});facts.noNaturalSidecar=true;await writeFile(join(evidence,'memory-manifest-denied-complete.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});
 }console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  once(
    'console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));',
    `await configure('security',{allowFilesystem:false});const manifestSecurity=await api(p+'/configurations/security'),manifestAuthorization=await api('/api/client/authorize','POST',{channel:'local',action:'filesystem'},identity),manifestExecution=await api('/api/client/authorize','POST',{channel:'local',action:'execution'},identity);if(manifestSecurity.published.allowFilesystem!==false||manifestAuthorization.allowed!==false||manifestAuthorization.security.allowFilesystem!==false||manifestExecution.allowed!==true)throw Error('MANIFEST_FILESYSTEM_FALSE_PREREQUISITE');
await writeFile(join(evidence,'memory-manifest-before-launch.json'),JSON.stringify({publishedFilesystemAllowed:false,effectiveFilesystemAllowed:manifestAuthorization.allowed,executionAllowed:manifestExecution.allowed,version:manifestSecurity.version,revision:manifestSecurity.revision,tenantId:manifestAuthorization.tenantId},null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));`,
  );
  return derivePackagedMainReadonly(s).replace(
    "from'./mac-memory-stage.mjs';",
    "from'./mac-memory-stage-v16-readonly.mjs';",
  );
}
export function validateManifestProfile(name, env) {
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
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateManifestProfile(process.env.UWORK_NATIVE_FIXTURE_NAME, process.env);
  const url = pathToFileURL(
      resolve("scripts/fixtures/client-native-enterprise.mjs"),
    ).href,
    source = deriveManifestFixture(readFileSync(fileURLToPath(url), "utf8"));
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
