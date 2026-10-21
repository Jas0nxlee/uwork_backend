/** Pure owned fixture derivation; original signed Main/Host/CLI and installer are unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function derivePluginFixture(source) {
  const original = source;
  const once = (anchor, value) => {
    assert.equal(source.split(anchor).length, 2, anchor);
    source = source.replace(anchor, value);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    'import { loadOwnedPackagedRuntime } from "./native-packaged-macos-arm64-consistency-runtime.mjs";\nimport {createMacPluginSkillPackage,serveMacPluginSkillPackage} from "./mac-plugin-skill-package.mjs";\nimport {createMacPluginSkillOracle} from "./mac-plugin-skill-oracle.mjs";\nimport {captureMacBackendStage,assertMacActorAccountingDelta,assertMacOtherActorAccountingUnchanged} from "./mac-backend-stage-snapshot.mjs";\nimport {installMacColdIngressObserver} from "./mac-cold-ingress-observer.mjs";',
  );
  once(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  );
  once(
    "const upstream = httpServer(async (req, res) => {",
    `const pluginArtifact=await createMacPluginSkillPackage();
const pluginOracle=createMacPluginSkillOracle({caseRoot:root,workspacePath:join(root,'packaged-workspace'),artifact:pluginArtifact});
let pluginProofBaseline;
const upstream = httpServer(async (req, res) => {
  if(serveMacPluginSkillPackage(req,res,pluginArtifact,'http://127.0.0.1:'+upstream.address().port))return;`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    '  if (!fileContext) modelRequests.push(body);\n  if (!fileContext) { try {fileReply=await pluginOracle.reply(body);} catch {res.writeHead(400,{"content-type":"application/json"}).end(JSON.stringify({error:"OWNED_PLUGIN_SKILL_REPLY_REJECTED"}));return;} }',
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    'const pluginIngress=installMacColdIngressObserver(app.server);\nbackendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
  );
  once(
    'console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));',
    `await configure('security',{allowFilesystem:true,dangerousSkills:true});
await configure('personal',{skills:true});
const pluginPermissionSecurity=await api(p+'/configurations/security');
const pluginPermissionPersonal=await api(p+'/configurations/personal');
if(pluginPermissionSecurity.published.allowFilesystem!==true||pluginPermissionSecurity.published.dangerousSkills!==true||pluginPermissionPersonal.published.skills!==true)throw Error('OWNED_PLUGIN_PUBLISHED_PERMISSIONS_MISSING');
console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));`,
  );
  const command =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    command,
    `    else if(c.op==='pluginSkillProof' && packagedRuntime){
 const check=(await import('node:assert/strict')).default;check.deepEqual(Object.keys(c).sort(),['op','stage']);check.ok(['before-install','after-install','after-send'].includes(c.stage));
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');check.equal(others.length,1);check.notEqual(others[0].id,member.id);
 const snapshot=captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.stage,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]});
 const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:pluginIngress.read()};
 const oracle=pluginOracle.safeStatus();
 const security=await api(p+'/configurations/security'),personal=await api(p+'/configurations/personal');
 check.equal(security.published.allowFilesystem,true);check.equal(security.published.dangerousSkills,true);check.equal(personal.published.skills,true);
 const permissions={allowFilesystem:security.published.allowFilesystem,dangerousSkills:security.published.dangerousSkills,personalSkills:personal.published.skills,securityVersion:security.version,securityRevision:security.revision,personalVersion:personal.version,personalRevision:personal.revision};
 const metadata=(await api(p+'/models')).find(row=>row.id===model.id);check.equal(metadata.data.contextWindow,500000);
 const packageProof={sha256:pluginArtifact.sha256,manifestSha256:pluginArtifact.manifestSha256,skillSha256:pluginArtifact.skillSha256,installId:pluginArtifact.installId,qualifiedSkill:pluginArtifact.qualifiedSkill,paths:pluginArtifact.paths,files:pluginArtifact.files,counts:pluginArtifact.counts};
 const result={stage:c.stage,snapshot,counters,oracle,package:packageProof,permissions,supplierRequestDigests:modelRequests.map(row=>createHash('sha256').update(JSON.stringify(row)).digest('hex')),responses:traffic.filter(row=>row.method==='POST'&&row.pathname==='/v1/chat/completions').map(row=>row.status),bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};
 check.equal(me.user.id,member.id);check.equal(me.tenant.id,owner.tenantId);
 if(c.stage==='before-install'){check.equal(pluginProofBaseline,undefined);check.deepEqual(counters,{supplierCalls:2,modelRequests:2,rawInferencePosts:2});pluginProofBaseline=result;}
 else {check.ok(pluginProofBaseline);const added=c.stage==='after-send';check.deepEqual(counters,{supplierCalls:added?5:2,modelRequests:added?5:2,rawInferencePosts:added?5:2});assertMacActorAccountingDelta(pluginProofBaseline.snapshot,snapshot,'current',{ledgerRows:added?3:0,traceRows:added?3:0,gatewayCalls:added?3:0,credits:added?66:0,inputTokens:added?36:0,outputTokens:added?30:0,modelId:model.id,application:'uwork'});assertMacOtherActorAccountingUnchanged(pluginProofBaseline.snapshot,snapshot,'other');
 if(added){check.equal(oracle.stage,'completed');check.equal(oracle.mainRequests,1);check.equal(oracle.followupRequests,1);check.equal(oracle.titleRequests,1);check.equal(oracle.receipts.length,3);check.equal(result.responses.length,5);check.ok(result.responses.every(status=>status===200));}
 else {check.deepEqual(result.supplierRequestDigests,pluginProofBaseline.supplierRequestDigests);}}
 await writeFile(join(evidence,'plugin-skill-'+c.stage+'-proof.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({op:c.op,status:'done',facts:result}));return;
} ` + command,
  );
  const body = (text) =>
    text.slice(
      text.indexOf("async function openWorkspace(workspacePath) {"),
      text.indexOf("async function stopNative() {"),
    );
  assert.equal(
    createHash("sha256").update(body(original)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.equal(body(source), body(original));
  return source;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const path = resolve("scripts/fixtures/client-native-enterprise.mjs"),
    url = pathToFileURL(path).href,
    original = readFileSync(path, "utf8"),
    derived = derivePluginFixture(original);
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  writeFileSync(
    resolve(
      "evidence",
      process.env.UWORK_NATIVE_FIXTURE_NAME,
      "plugin-derived-source.json",
    ),
    JSON.stringify(
      {
        originalSha256: sha(original),
        derivedSha256: sha(derived),
        originalWorkspaceBodySha256:
          "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
        productMutation: false,
        installerReplaced: false,
        modelContextWindow: 500000,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const value = next(target, context);
      if (target !== url) return value;
      assert.equal(loaded, false);
      loaded = true;
      return { ...value, source: derived };
    },
  });
  await import(url);
}
