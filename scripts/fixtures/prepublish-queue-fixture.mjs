// 只扩展隔离测试供应商的响应时机；产品 Main/Host/UI/CLI 与后端保持原入口。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.match(
  process.env.UWORK_NATIVE_FIXTURE_NAME ?? "",
  /^client-native-prepublish-v\d+-20261021$/,
);
assert.equal(process.env.UWORK_NATIVE_PACKAGED_MANIFEST, undefined);
const url = pathToFileURL(
  resolve("scripts/fixtures/client-native-enterprise.mjs"),
).href;
let source = readFileSync(new URL(url), "utf8");
const rewindEnabled = process.env.UWORK_NATIVE_REWIND_FILES === "1";
const permissionProject = process.env.UWORK_NATIVE_PERMISSION_PROJECT === "1";
const permissionEnabled =
  process.env.UWORK_NATIVE_PERMISSION_DENY === "1" || permissionProject;
assert.ok(
  !(permissionProject && process.env.UWORK_NATIVE_PERMISSION_DENY === "1"),
);
assert.ok(
  !(rewindEnabled && permissionEnabled),
  "independent file scenarios cannot share a supplier",
);
function once(from, to) {
  assert.equal(source.split(from).length, 2);
  source = source.replace(from, to);
}
once(
  "const modelRequests = [];",
  `const modelRequests = [];
let queueRelease, queueHeld = false;
const queueGate = new Promise(resolve => { queueRelease = resolve; });`,
);
once(
  "  const currentUser = body.messages[lastUserIndex];",
  `  const currentUser = body.messages[lastUserIndex];
  if (body.stream && messageText(currentUser).includes('PREPUBLISH_QUEUE_A')) {
    queueHeld = true;
    await Promise.race([queueGate, new Promise(resolve => res.once('close', resolve))]);
    queueHeld = false;
    if (res.destroyed) return;
  }`,
);
once(
  '    } else if (c.op === "launch") await launch();',
  `    } else if (c.op === "queueRelease") { queueRelease(); }
    else if (c.op === "queueProof") {
      const facts = {held:queueHeld,modelCalls,modelRequests,
        ledger:app.services.db.all('SELECT id,user_id,model_id,status,amount,reserved,input_tokens,output_tokens FROM ledger WHERE tenant_id=? ORDER BY id',owner.tenantId)};
      await writeFile(join(evidence,c.name+'-queue-proof.json'),JSON.stringify(facts,null,2),{mode:0o600,flag:'wx'});
      console.log(JSON.stringify({op:c.op,status:'done',facts:{held:queueHeld,modelCalls}}));return;
    } else if (c.op === "launch") await launch();`,
);
once("  closing = true;", "  closing = true; queueRelease();");
// 仅给本轮历史组合的受控普通回复加分支marker，保留原usage和title路径。
once(
  "  const output =\n    fileReply?.text ??",
  `  const historyMarker = body.stream && ['A','E','B'].find(phase => messageText(currentUser).includes('PREPUBLISH_HISTORY_QUERY_'+phase));
  const output =\n    (historyMarker ? '原生企业资产联动完成。 PREPUBLISH_HISTORY_ANSWER_'+historyMarker : undefined) ??
    fileReply?.text ??`,
);
once(
  "for (const content of fileReply || workflowActor",
  "for (const content of historyMarker || fileReply || workflowActor",
);
if (rewindEnabled) {
  source =
    'import { createRewindSupplier } from "./prepublish-rewind-supplier.mjs";\n' +
    source;
  once(
    "const modelRequests = [];",
    "const modelRequests = [];\nconst rewindSupplier = createRewindSupplier(root);",
  );
  once(
    "  const currentHasTool = body.messages",
    `  try { fileReply = await rewindSupplier.reply(body) ?? fileReply; }
  catch { res.writeHead(400, {'content-type':'application/json'}).end(JSON.stringify({error:'OWNED_REWIND_PROTOCOL'}));return; }
  const currentHasTool = body.messages`,
  );
  once(
    "const facts = {held:queueHeld,modelCalls,modelRequests,",
    "const facts = {held:queueHeld,modelCalls,modelRequests,rewind:rewindSupplier.status(),",
  );
  once(
    '    } else if (c.op === "queueRelease")',
    `    } else if (c.op === "rewindSetup") {
      const old=await api(p+'/configurations/security');
      const saved=await api(p+'/configurations/security','PUT',{revision:old.revision,data:{...old.draft,allowFilesystem:true}});
      await api(p+'/configurations/security/publish','POST',{revision:saved.revision});
    } else if (c.op === "queueRelease")`,
  );
}
if (permissionEnabled) {
  source =
    (permissionProject
      ? 'import { createProjectPermissionSupplier as createPermissionSupplier } from "./prepublish-project-permission-supplier.mjs";\n'
      : 'import { createPermissionSupplier } from "./prepublish-permission-supplier.mjs";\n') +
    source;
  once(
    "const modelRequests = [];",
    "const modelRequests = [];\nconst permissionSupplier = createPermissionSupplier(root);",
  );
  once(
    "  const currentHasTool = body.messages",
    `  try { fileReply = await permissionSupplier.reply(body) ?? fileReply; }
  catch { res.writeHead(400, {'content-type':'application/json'}).end(JSON.stringify({error:'OWNED_PERMISSION_PROTOCOL'}));return; }
  const currentHasTool = body.messages`,
  );
  once(
    "const facts = {held:queueHeld,modelCalls,modelRequests,",
    "const facts = {held:queueHeld,modelCalls,modelRequests,permission:permissionSupplier.status(),",
  );
  once(
    '    } else if (c.op === "queueRelease")',
    `    } else if (c.op === "permissionSetup") {
      const old=await api(p+'/configurations/security');
      const saved=await api(p+'/configurations/security','PUT',{revision:old.revision,data:{...old.draft,allowFilesystem:true}});
      await api(p+'/configurations/security/publish','POST',{revision:saved.revision});
    } else if (c.op === "queueRelease")`,
  );
}
if (process.env.UWORK_NATIVE_OUT_MANIFEST) {
  source =
    'import { loadOwnedDesktopInput } from "./owned-desktop-input.mjs";\n' +
    source;
  once(
    'const outSnapshot = await copyNativeOutSnapshot({\n  source: join(client, "packages/desktop/out"),',
    `const frozenOut = await loadOwnedDesktopInput({repository:process.cwd(),manifestPath:process.env.UWORK_NATIVE_OUT_MANIFEST,cacheBase:process.env.UWORK_NATIVE_OUT_CACHE_BASE});
const outSnapshot = await copyNativeOutSnapshot({\n  source: frozenOut.source,`,
  );
  once(
    'await writeFile(\n  join(evidence, "native-out-snapshot.json"),',
    'await frozenOut.verify(outSnapshot);\nawait writeFile(\n  join(evidence, "native-out-snapshot.json"),',
  );
}
registerHooks({
  load(target, context, next) {
    const result = next(target, context);
    return target === url ? { ...result, source } : result;
  },
});
await import(url);
