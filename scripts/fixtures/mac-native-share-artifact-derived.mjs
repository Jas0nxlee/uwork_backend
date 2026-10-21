/** Native Share fixture-only derivation; no product/store or alternate publisher injection. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveSecondaryFixture } from "./macos-x64-secondary-derived.mjs";
export const SHARE_PROFILE =
  "client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021";
export function deriveShareArtifactFixture(original) {
  let source = deriveSecondaryFixture(original);
  const once = (before, after) => {
    assert.equal(source.split(before).length, 2, before);
    source = source.replace(before, after);
  };
  once(
    "./native-packaged-macos-x64-startup-runtime.mjs",
    "./native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  );
  once("phase:'secondary-observe'", "phase:'share-observe'");
  once(
    "const facts={modelCalls,",
    "const facts={bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id},modelCalls,",
  );
  once(
    'const model = await api(p + "/models", "POST", {',
    'const model = await api(p + "/models", "POST", {\n  contextWindow:500000,',
  );
  const meta = "const meta = {";
  once(
    meta,
    `await configure('sharing',{publish:'organization',files:true});
await configure('security',{allowFilesystem:true});
const sharePolicy=(await api(p+'/configurations/sharing')).published;
const shareSecurity=(await api(p+'/configurations/security')).published;
if(sharePolicy.publish!=='organization'||sharePolicy.files!==true||shareSecurity.allowFilesystem!==true)throw Error('OWNED_SHARE_CONFIGURATION');
const shareModel=(await api(p+'/models')).find(row=>row.id===model.id);
if(shareModel?.data.contextWindow!==500000)throw Error('OWNED_SHARE_MODEL');
${meta}
  shareArtifact:{fileName:ownedSharePdf.fileName,sha256:ownedSharePdf.sha256,sizeBytes:ownedSharePdf.bytes.length,base64:ownedSharePdf.base64},`,
  );
  const output = "  const output =\n    fileReply?.text ??";
  once(
    output,
    `  const ownedShareTurn=body.stream===true && messageText(currentUser).includes('MAC_NATIVE_SHARE_ARTIFACT_20261021');
  const output =
    (ownedShareTurn ? '原生企业资产联动完成。\\n\\n[本轮结果](native-share-proof.pdf)' : null) ??
    fileReply?.text ??`,
  );
  once(
    "for (const content of fileReply || workflowActor",
    "for (const content of fileReply || workflowActor || ownedShareTurn",
  );
  const listen =
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });';
  once(
    listen,
    `let shareObservationFault=null;const shareHttp=[],shareUploads=[];
app.addHook('preHandler',async req=>{
 if(req.method!=='POST'||!/^\\/api\\/client\\/shares\\/preparations(?:\\/[^/?]+\\/(?:artifacts|confirm))?$/.test(req.url))return;
 try{if(shareHttp.length>=8)throw Error('SHARE_OBSERVATION_BOUND');shareHttp.push({requestId:req.id,method:req.method,path:req.url,status:null});
 if(req.url.endsWith('/artifacts'))shareUploads.push({preparationId:req.url.split('/')[5],...assertShareArtifactUpload(req.body),descriptor:structuredClone(req.body.descriptor)});
 if(req.url==='/api/client/shares/preparations'&&req.body.artifact_count!==1)throw Error('OWNED_ARTIFACT_COUNT');
 }catch(e){shareObservationFault=true;}
});
app.addHook('onResponse',async(req,reply)=>{try{const row=shareHttp.find(row=>row.requestId===req.id);if(row)row.status=reply.statusCode;}catch(e){shareObservationFault=true;}});
${listen}`,
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='shareArtifactProof'&&packagedRuntime){
 const ensure=(await import('node:assert/strict')).default;
 ensure.deepEqual(Object.keys(c).sort(),['op','phase']);ensure.ok(['after','revoke'].includes(c.phase));ensure.equal(shareObservationFault,null);
 const rows=app.services.db.all('SELECT id,share_code,status,artifact_count FROM conversation_shares WHERE tenant_id=? AND creator_user_id=?',owner.tenantId,member.id);ensure.equal(rows.length,1);const row=rows[0];ensure.equal(row.status,'confirmed');ensure.equal(row.artifact_count,1);
 const artifacts=app.services.db.all('SELECT artifact_id,descriptor,content,size_bytes,sha256 FROM conversation_share_artifacts WHERE tenant_id=? AND preparation_id=?',owner.tenantId,row.id);ensure.equal(artifacts.length,1);const stored=artifacts[0],descriptor=JSON.parse(stored.descriptor),blob=inspectShareArtifactPdf(Buffer.from(stored.content));
 ensure.equal(stored.size_bytes,blob.sizeBytes);ensure.equal(stored.sha256,blob.sha256);ensure.equal(shareUploads.length,1);ensure.equal(shareUploads[0].preparationId,row.id);ensure.equal(shareUploads[0].artifactId,stored.artifact_id);ensure.deepEqual(descriptor,shareUploads[0].descriptor);
 const path=join(root,'packaged-workspace',ownedSharePdf.fileName);ensure.equal(await shareRealpath(join(root,'packaged-workspace')),join(root,'packaged-workspace'));ensure.equal(await shareRealpath(path),path);
 const handle=await openSharePdf(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);let local;
 try{const stat=await handle.stat();ensure.ok(stat.isFile());ensure.equal(stat.size,ownedSharePdf.bytes.length);local=inspectShareArtifactPdf(await handle.readFile());}finally{await handle.close();}
 const preview=await api('/api/client/shares/'+row.share_code+'/preview','GET',undefined,identity);ensure.equal(preview.artifacts.length,1);ensure.equal(preview.artifacts[0].artifact_id,stored.artifact_id);for(const[key,value]of Object.entries(descriptor))ensure.deepEqual(preview.artifacts[0][key],value);
 const downloadUrl=new URL(preview.artifacts[0].url+'/content');ensure.equal(downloadUrl.origin,new URL(origin).origin);ensure.equal(downloadUrl.pathname,'/api/client/shares/'+row.share_code+'/artifacts/'+stored.artifact_id+'/content');
 const shareDownloadCa=await readFile(cert);const download=await requestOwnedShareArtifact({url:downloadUrl.href,origin,expectedPath:downloadUrl.pathname,ca:shareDownloadCa,identity,maxBytes:4096,timeoutMs:15000});ensure.ok(download.explicitCaseCa&&download.socketClosed&&download.bodyFullyConsumed);ensure.equal(download.status,200);ensure.equal(download.headers['content-type'],'application/octet-stream');ensure.equal(Number(download.headers['content-length']),ownedSharePdf.bytes.length);ensure.equal(download.headers['x-content-type-options'],'nosniff');ensure.equal(download.headers['cache-control'],'no-store');const remote=inspectShareArtifactPdf(download.body);
 ensure.equal(local.sha256,blob.sha256);ensure.equal(remote.sha256,local.sha256);ensure.equal(descriptor.sha256,local.sha256);ensure.equal(shareUploads[0].sha256,local.sha256);
 ensure.equal(shareHttp.length,3);ensure.ok(shareHttp.every(value=>value.status>=200&&value.status<300));
 let revoked=null;if(c.phase==='revoke'){await api('/api/client/shares/'+row.share_code,'DELETE',undefined,identity);ensure.equal(app.services.db.get('SELECT status FROM conversation_shares WHERE tenant_id=? AND id=?',owner.tenantId,row.id).status,'revoked');ensure.equal(app.services.db.get('SELECT count(*) AS n FROM conversation_share_artifacts WHERE tenant_id=? AND preparation_id=?',owner.tenantId,row.id).n,0);const blocked=await requestOwnedShareArtifact({url:downloadUrl.href,origin,expectedPath:downloadUrl.pathname,ca:shareDownloadCa,identity,maxBytes:4096,timeoutMs:15000});ensure.equal(blocked.status,404);ensure.ok(blocked.explicitCaseCa&&blocked.socketClosed&&blocked.bodyFullyConsumed);revoked={rowStatus:'revoked',artifactsRemaining:0,downloadStatus:blocked.status};}
 const facts={source:local,upload:shareUploads[0],stored:{artifactId:stored.artifact_id,descriptor,sizeBytes:blob.sizeBytes,sha256:blob.sha256},download:{status:download.status,sizeBytes:remote.sizeBytes,sha256:remote.sha256,explicitCaseCa:download.explicitCaseCa,socketClosed:download.socketClosed,bodyFullyConsumed:download.bodyFullyConsumed,contentDisposition:download.headers['content-disposition']},share:{status:row.status,artifactCount:row.artifact_count,ownedByCurrent:true},http:shareHttp,revoked};console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ${anchor}`,
  );
  return (
    `import {requestOwnedShareArtifact} from './mac-native-share-artifact-https.mjs';\nimport {createShareArtifactPdf,inspectShareArtifactPdf,assertShareArtifactUpload} from './mac-native-share-artifact-pdf.mjs';\nimport {open as openSharePdf,realpath as shareRealpath} from 'node:fs/promises';\nconst ownedSharePdf=createShareArtifactPdf();\n` +
    source
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(process.env.UWORK_NATIVE_FIXTURE_NAME, SHARE_PROFILE);
  const url = pathToFileURL(
      resolve("scripts/fixtures/client-native-enterprise.mjs"),
    ).href,
    source = deriveShareArtifactFixture(
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
