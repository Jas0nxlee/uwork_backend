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
registerHooks({
  load(target, context, next) {
    const result = next(target, context);
    return target === url ? { ...result, source } : result;
  },
});
await import(url);
