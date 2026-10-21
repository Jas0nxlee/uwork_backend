/** Owned Mac transport-only derivation. Original app, fixture and request budgets stay unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function deriveMountedFixture(source) {
  const once = (needle, value) => {
    assert.equal(source.split(needle).length, 2, needle);
    source = source.replace(needle, value);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    'import { loadOwnedPackagedRuntime } from "./native-packaged-macos-gateway-hold-runtime.mjs";\nimport {captureMacBackendStage} from "./mac-backend-stage-snapshot.mjs";\nimport {installMacColdIngressObserver} from "./mac-cold-ingress-observer.mjs";',
  );
  once(
    "const proxy = httpsServer(",
    "const mountedResponses=[]; let mountedRevoked=false,mountedObservationFailed=false;\nconst proxy = httpsServer(",
  );
  once(
    "      (reply) => {\n        const deliver = () => {",
    `      (reply) => {
        try { if(req.method==='GET' && ['/api/client/entitlement','/api/client/usage'].includes((req.url??'').split('?')[0])){
          assertMounted(mountedResponses.length<64);
          mountedResponses.push({path:req.url,status:reply.statusCode,afterServerLogout:mountedRevoked,observedAtMs:Date.now()});
        }} catch {mountedObservationFailed=true;}
        const deliver = () => {`,
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    'const mountedIngress=installMacColdIngressObserver(app.server);\nbackendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
  );
  once(
    '    else if (c.op === "revokeIdentity")\n      await api("/api/auth/logout", "POST", undefined, identity);',
    '    else if (c.op === "revokeIdentity") {\n      await api("/api/auth/logout", "POST", undefined, identity);\n      mountedRevoked=true;\n    }',
  );
  once(
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {',
    `    else if(c.op==='mountedSnapshot') {
      assertMounted(Object.keys(c).length===1 && !mountedObservationFailed);
      const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');
      assertMounted(others.length===1 && others[0].id!==member.id);
      const facts={hold:gatewayUsageHold.command({op:'gatewayUsageHoldStatus'}),responses:mountedResponses.slice(),serverSessionRevoked:mountedRevoked,observedAtMs:Date.now(),rawInference:mountedIngress.read(),modelCalls,supplierRequestDigests:modelRequests.map(row=>createHash('sha256').update(JSON.stringify(row)).digest('hex')),snapshot:captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:'mounted-observe',sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]})};
      await writeFile(join(evidence,'mounted-latest-snapshot.json'),JSON.stringify(facts,null,2),{mode:0o600});
      console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
    }
    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {`,
  );
  return (
    'const assertMounted=(value)=>{if(!value)throw Error("OWNED_MOUNTED_OBSERVATION_REJECTED")};\n' +
    source
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const path = resolve("scripts/fixtures/client-native-enterprise.mjs"),
    url = pathToFileURL(path).href;
  const original = readFileSync(path, "utf8"),
    derived = deriveMountedFixture(original);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  writeFileSync(
    resolve(
      "evidence",
      process.env.UWORK_NATIVE_FIXTURE_NAME,
      "mounted-derived-source.json",
    ),
    JSON.stringify(
      {
        originalSha256: hash(original),
        derivedSha256: hash(derived),
        productMutation: false,
        originalHoldUnchanged: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const result = next(target, context);
      if (target !== url) return result;
      assert.equal(loaded, false);
      loaded = true;
      return { ...result, source: derived };
    },
  });
  await import(url);
}
