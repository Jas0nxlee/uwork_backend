/** One original secondary command diagnostic. No inspector, CPU sampler, UI bridge or alternate API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
export function validateSecondaryProfile(name) {
  assert.equal(
    name,
    "client-native-packaged-macos-clock-x64-startup-v6-20261021",
  );
  return name;
}
export function deriveSecondaryFixture(source) {
  const original = source;
  const once = (a, b) => {
    assert.equal(source.split(a).length, 2, a);
    source = source.replace(a, b);
  };
  once(
    'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";',
    'import { loadOwnedPackagedRuntime } from "./native-packaged-macos-x64-startup-runtime.mjs";\nimport {captureMacBackendStage} from "./mac-backend-stage-snapshot.mjs";\nimport {installMacColdIngressObserver} from "./mac-cold-ingress-observer.mjs";',
  );
  once(
    'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
    'const secondaryIngress=installMacColdIngressObserver(app.server);\nbackendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
  );
  once(
    "const meta = {",
    "await mkdir(join(root,'userdata'),{mode:0o700});\nconst meta = {",
  );
  once(
    '      "--remote-debugging-port=" + cdpPort,',
    '      "--user-data-dir="+join(root,"userdata"),\n      "--remote-debugging-port=" + cdpPort,',
  );
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='secondaryDiagnosticSnapshot'&&packagedRuntime){
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');if(others.length!==1||others[0].id===member.id)throw Error('OWNED_ACTOR_SCOPE');
 const facts={modelCalls,rawInferencePosts:secondaryIngress.read(),supplierRequestDigests:modelRequests.map(row=>createHash('sha256').update(JSON.stringify(row)).digest('hex')),snapshot:captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:'secondary-observe',sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]})};console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ` + anchor,
  );
  const body = (s) =>
    s.slice(
      s.indexOf("async function openWorkspace(workspacePath) {"),
      s.indexOf("async function stopNative() {"),
    );
  assert.equal(body(source), body(original));
  assert.equal(
    createHash("sha256").update(body(original)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  return source;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateSecondaryProfile(process.env.UWORK_NATIVE_FIXTURE_NAME);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveSecondaryFixture(
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
