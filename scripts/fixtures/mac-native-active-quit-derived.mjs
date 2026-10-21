/** Original owned supplier/child observation only; Quit always comes from native menu AX. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveSecondaryFixture } from "./macos-x64-secondary-derived.mjs";
export const ACTIVE_QUIT_PROFILE =
  "client-native-packaged-macos-clock-arm64-active-quit-v4-20261021";
export function deriveActiveQuitFixture(original) {
  let source = deriveSecondaryFixture(original);
  const once = (a, b) => {
    assert.equal(source.split(a).length, 2, a);
    source = source.replace(a, b);
  };
  once(
    "./native-packaged-macos-x64-startup-runtime.mjs",
    "./native-packaged-macos-arm64-secondary-exit-runtime.mjs",
  );
  once(
    'const model = await api(p + "/models", "POST", {',
    'const model = await api(p + "/models", "POST", {\n  contextWindow:500000,',
  );
  once(
    "const meta = {",
    `const ownedActiveModel=(await api(p+'/models')).find(row=>row.id===model.id);
if(ownedActiveModel.data.contextWindow!==500000||ownedActiveModel.data.supportsTools!==true)throw Error('ACTIVE_QUIT_MODEL_READBACK');
const meta = {
 activeQuitApplicationName:'UWork 联动验证',`,
  );
  once(
    "  if (!fileContext) modelRequests.push(body);",
    `  if (!fileContext) modelRequests.push(body);
  try{if(activeQuitHold.intercept(body,res,modelCalls))return;}
  catch {res.writeHead(400,{'content-type':'application/json'}).end('{"error":"OWNED_ACTIVE_QUIT_SUPPLIER"}');return;}`,
  );
  once("  closing = true;", "  closing = true;\n  activeQuitHold.dispose();");
  const anchor =
    '    else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
  once(
    anchor,
    `    else if(c.op==='activeQuitArm'&&packagedRuntime){
 if(Object.keys(c).sort().join(',')!=='op,workspacePath'||activeQuitChild||!electron||electron.exitCode!==null||electron.signalCode!==null)throw Error('ACTIVE_QUIT_ARM_OWNER');
 const child=electron;const workspacePath=await validateOwnedNativeWorkspace(root,c.workspacePath);
 if(child!==electron||child.exitCode!==null||child.signalCode!==null)throw Error('ACTIVE_QUIT_OWNER_CHANGED');
 activeQuitChild=child;activeQuitStarted=performance.now();
 activeQuitChild.once('exit',(code,signal)=>{activeQuitExit={pid:child.pid,code,signal,observedAfterArmMs:performance.now()-activeQuitStarted};});
 if(activeQuitChild!==electron)throw Error('ACTIVE_QUIT_OWNER_CHANGED');activeQuitHold.arm(workspacePath);
 console.log(JSON.stringify({op:c.op,status:'done',pid:child.pid}));return;
} else if(c.op==='activeQuitSnapshot'&&packagedRuntime){
 if(Object.keys(c).sort().join(',')!=='op,phase'||!['warm','held','cancel-one','cancel-two','after','poll'].includes(c.phase))throw Error('ACTIVE_QUIT_PHASE');
 const others=(await api(p+'/members?q='+encodeURIComponent('journey-b@example.test'))).items.filter(row=>row.email==='journey-b@example.test');if(others.length!==1||others[0].id===member.id)throw Error('ACTIVE_QUIT_ACTOR');
 const facts={bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id},modelCalls,rawInferencePosts:secondaryIngress.read(),supplierRequestDigests:modelRequests.map(row=>createHash('sha256').update(JSON.stringify(row)).digest('hex')),nativeAlive:!!electron&&electron.exitCode===null&&electron.signalCode===null,nativePid:activeQuitChild?.pid??electron?.pid??null,nativeExit:activeQuitExit,hold:activeQuitHold.safe(),snapshot:captureMacBackendStage(app.services.db,{authority:'owned-fixture-existing-db',phase:c.phase,sampledAt:Date.now(),actors:[{label:'current',tenantId:owner.tenantId,userId:member.id},{label:'other',tenantId:owner.tenantId,userId:others[0].id}]})};
 await writeFile(join(evidence,'active-quit-'+c.phase+'.json'),JSON.stringify(facts,null,2),{mode:0o600});console.log(JSON.stringify({op:c.op,status:'done',facts}));return;
} ${anchor}`,
  );
  return (
    `import {createActiveQuitHold} from './mac-native-active-quit-runtime.mjs';\nimport {performance} from 'node:perf_hooks';\nconst activeQuitHold=createActiveQuitHold();let activeQuitChild,activeQuitStarted,activeQuitExit=null;\n` +
    source
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(process.env.UWORK_NATIVE_FIXTURE_NAME, ACTIVE_QUIT_PROFILE);
  assert.equal(process.env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
  for (const name of [
    "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
    "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
    "UWORK_NATIVE_PRIMARY_LOGIN",
    "UWORK_NATIVE_FILE_CONTEXT",
    "UWORK_NATIVE_VIEWER_AUTH",
  ])
    assert.equal(process.env[name], undefined, name);
  const url = pathToFileURL(
    resolve("scripts/fixtures/client-native-enterprise.mjs"),
  ).href;
  const source = deriveActiveQuitFixture(
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
