/** Owned fixture derivation only; product and shared fixture bytes stay intact. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const name = process.env.UWORK_NATIVE_FIXTURE_NAME;
assert.match(
  name ?? "",
  /^client-native-packaged-macos-clock-arm64-capability-v[0-9]+-20261021$/,
);
assert.equal(process.env.UWORK_NATIVE_CLIENT_EXPERIENCE, "enabled");
assert.ok(process.env.UWORK_NATIVE_PACKAGED_MANIFEST);
for (const flag of [
  "UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE",
  "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN",
  "UWORK_NATIVE_PRIMARY_LOGIN",
  "UWORK_NATIVE_FILE_CONTEXT",
  "UWORK_NATIVE_VIEWER_AUTH",
]) {
  assert.equal(process.env[flag], undefined, flag);
}
const original = resolve("scripts/fixtures/client-native-enterprise.mjs");
const originalUrl = pathToFileURL(original).href;
const originalSource = readFileSync(original, "utf8");
const anchor = `const model = await api(p + "/models", "POST", {
  name: twoOrganizationLoginEnabled ? TWO_ORG_PROFILES.A.model : "联动受控模型",
  upstreamModel: "controlled",
  credentialId: credential.id,
  baseUrl: \`http://127.0.0.1:\${upstream.address().port}/v1\`,
  scope: { all: true },
  maxOutputTokens: 1024,
  supportsTools: true,
  ...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),
});`;
assert.equal(
  originalSource.split(anchor).length,
  2,
  "One original model POST anchor required",
);
const replacement =
  anchor.replace(
    '...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),',
    "contextWindow: 500000,",
  ) +
  `
const ownedModelReadback = (await api(p + "/models")).find(row => row.id === model.id);
const ownedModelAssert = (await import("node:assert/strict")).default;
ownedModelAssert.equal(ownedModelReadback.data.contextWindow, 500000);
ownedModelAssert.equal(ownedModelReadback.data.maxOutputTokens, 1024);
ownedModelAssert.equal(ownedModelReadback.data.supportsTools, true);
await writeFile(join(evidence, "controlled-model-metadata.json"), JSON.stringify({
  id: model.id, contextWindow: ownedModelReadback.data.contextWindow,
  maxOutputTokens: ownedModelReadback.data.maxOutputTokens,
  supportsTools: ownedModelReadback.data.supportsTools,
  inputPath: "original POST Admin API and GET readback; original schema",
}, null, 2), { mode: 0o600 });
`;
const requestReceiptSource = `
const ownedRequestMetrics = [];
app.addHook("preHandler", async req => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions" || ownedRequestMetrics.length >= 16) return;
  const body = req.body;
  if (body.model !== model.id) return;
  const messages = (body.messages ?? []).map(m => ({
    role: m.role,
    contentUtf8Bytes: typeof m.content === "string" ? Buffer.byteLength(m.content) :
      (m.content ?? []).reduce((sum, part) => sum + (part.type === "text" ? Buffer.byteLength(part.text) : Buffer.byteLength(part.image_url.url) + 16384), 0),
    toolCallsUtf8Bytes: m.tool_calls ? Buffer.byteLength(JSON.stringify(m.tool_calls)) : 0,
    toolCallIdUtf8Bytes: Buffer.byteLength(m.tool_call_id ?? ""),
  }));
  const toolsUtf8Bytes = body.tools ? Buffer.byteLength(JSON.stringify(body.tools)) : 0;
  const inputBound = 256 + toolsUtf8Bytes + messages.reduce((sum, m) => sum + m.contentUtf8Bytes + m.toolCallsUtf8Bytes + m.toolCallIdUtf8Bytes + 64, 0);
  ownedRequestMetrics.push({ requestId: req.id, messages, toolsUtf8Bytes,
    toolCount: body.tools?.length ?? 0, inputBound,
    requestedMaxTokens: body.max_tokens ?? null,
    cappedMaxTokens: Math.min(body.max_tokens ?? 1024, 1024),
    contextWindow: 500000, measurement: "original gateway conservative UTF8 byte upper bound; not tokenizer output",
  });
});
app.addHook("onResponse", async (req, reply) => {
  const metric = ownedRequestMetrics.find(row => row.requestId === req.id);
  if (!metric) return;
  metric.actualStatusCode = reply.statusCode;
  await writeFile(join(evidence, "controlled-request-metrics.json"), JSON.stringify(ownedRequestMetrics, null, 2), { mode: 0o600 });
});
`;
const receiptAnchor =
  "// 仅被动投影原响应；解析/绑定失败记录到测试守卫，不能重写认证响应。";
assert.equal(originalSource.split(receiptAnchor).length, 2);
let derivedSource = originalSource
  .replace(anchor, replacement)
  .replace(receiptAnchor, requestReceiptSource + receiptAnchor);
const loaderAnchor =
  'import { loadOwnedPackagedRuntime } from "./native-packaged-runtime.mjs";';
assert.equal(derivedSource.split(loaderAnchor).length, 2);
derivedSource = derivedSource.replace(
  loaderAnchor,
  'import {loadOwnedPackagedRuntime} from "./native-packaged-macos-arm64-consistency-runtime.mjs";',
);
const listenAnchor =
  'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });';
assert.equal(derivedSource.split(listenAnchor).length, 2);
derivedSource = derivedSource.replace(
  listenAnchor,
  `const capIngress=installMacColdIngressObserver(app.server);
const capCatalog=[];let capObservationFailed=false,capChange,capPreviousProof;
app.addHook("onSend",async(req,reply,payload)=>{
 if(req.method==="GET" && req.raw.url?.split("?",1)[0]==="/v1/models" && reply.statusCode===200){
  try{const data=JSON.parse(Buffer.isBuffer(payload)?payload.toString("utf8"):payload);const rows=data.data.filter(row=>row.id===model.id);if(rows.length!==1||typeof rows[0].supports_tools!=="boolean")throw Error("catalog");capCatalog.push({sequence:capCatalog.length+1,modelId:model.id,supportsTools:rows[0].supports_tools,status:200,observedAt:Date.now()});if(capCatalog.length>32)throw Error("bound");}catch{capObservationFailed=true;}
 }return payload;
});
${listenAnchor}`,
);
const commandAnchor =
  'else if (c.op === "packagedRuntimeProof" && packagedRuntime) {';
assert.equal(derivedSource.split(commandAnchor).length, 2);
const capBranch = `else if (c.op === "capabilityChange" && packagedRuntime) {
 const ensure=(await import("node:assert/strict")).default;ensure.deepEqual(Object.keys(c).sort(),["op","supportsTools"]);
 ensure.equal(typeof c.supportsTools,"boolean");ensure.ok(capPreviousProof);
 ensure.equal(capPreviousProof.stage,c.supportsTools?"tools-off":"warm");
 const fence=capCatalog.length;const mutation=await updateOwnedModelCapability(api,p,model.id,c.supportsTools);
 capChange={...mutation,catalogFence:fence};
 await writeFile(join(evidence,"capability-change-"+(c.supportsTools?"on":"off")+".json"),JSON.stringify(capChange,null,2),{mode:0o600,flag:"wx"});
 console.log(JSON.stringify({op:c.op,status:"done",facts:capChange}));return;
} else if (c.op === "capabilityStatus" && packagedRuntime) {
 const ensure=(await import("node:assert/strict")).default;ensure.ok(!capObservationFailed,"Catalog observer unavailable");
 const catalog=capChange?capCatalog.findLast(row=>row.sequence>capChange.catalogFence&&row.supportsTools===capChange.supportsTools):null;
 console.log(JSON.stringify({op:c.op,status:"done",facts:{change:capChange,catalog:catalog??null,catalogReady:!!catalog}}));return;
} else if (c.op === "capabilityProof" && packagedRuntime) {
 const ensure=(await import("node:assert/strict")).default;ensure.deepEqual(Object.keys(c).sort(),["op","stage"]);ensure.ok(!capObservationFailed);
 const stages=["warm","tools-off","tools-on"],ordinal=stages.indexOf(c.stage);ensure.ok(ordinal>=0);ensure.equal(capPreviousProof?.stage,ordinal?stages[ordinal-1]:undefined);
 const marker=ordinal===0?"MACOS_CLOCK_LINK_20261020":ordinal===1?"MAC_CAP_TOOLS_OFF_20261021":"MAC_CAP_TOOLS_ON_20261021";
 const supplier=projectCapabilitySupplierRequests(modelRequests,{fromIndex:2+2*ordinal,workspacePath:join(root,"packaged-workspace"),marker,expectedTools:ordinal===1?0:32});
 const others=(await api(p+"/members?q="+encodeURIComponent("journey-b@example.test"))).items.filter(row=>row.email==="journey-b@example.test");ensure.equal(others.length,1);ensure.notEqual(others[0].id,member.id);
 const snapshot=captureMacBackendStage(app.services.db,{authority:"owned-fixture-existing-db",phase:c.stage,sampledAt:Date.now(),actors:[{label:"current",tenantId:owner.tenantId,userId:member.id},{label:"other",tenantId:owner.tenantId,userId:others[0].id}]});
 const counters={supplierCalls:modelCalls,modelRequests:modelRequests.length,rawInferencePosts:capIngress.read()};ensure.deepEqual(counters,{supplierCalls:4+2*ordinal,modelRequests:4+2*ordinal,rawInferencePosts:4+2*ordinal});
 const responses=traffic.filter(row=>row.method==="POST"&&row.pathname==="/v1/chat/completions").map(row=>row.status);ensure.equal(responses.length,4+2*ordinal);ensure.ok(responses.every(status=>status===200));
 if(capPreviousProof){assertMacActorAccountingDelta(capPreviousProof.snapshot,snapshot,"current",{ledgerRows:2,traceRows:2,gatewayCalls:2,credits:44,inputTokens:24,outputTokens:20,modelId:model.id,application:"uwork"});assertMacOtherActorAccountingUnchanged(capPreviousProof.snapshot,snapshot,"other");}
 const result={stage:c.stage,snapshot,counters,supplier,catalogReceipts:capCatalog,responses,bootstrapActor:{userId:me.user.id,tenantId:me.tenant.id}};
 ensure.equal(me.user.id,member.id);ensure.equal(me.tenant.id,owner.tenantId);capPreviousProof={stage:c.stage,snapshot};
 await writeFile(join(evidence,"capability-"+c.stage+"-proof.json"),JSON.stringify(result,null,2),{mode:0o600,flag:"wx"});console.log(JSON.stringify({op:c.op,status:"done",facts:result}));return;
} `;
derivedSource = derivedSource.replace(commandAnchor, capBranch + commandAnchor);
derivedSource =
  'import {updateOwnedModelCapability,projectCapabilitySupplierRequests} from "./mac-model-capability-stage.mjs";\nimport {captureMacBackendStage,assertMacActorAccountingDelta,assertMacOtherActorAccountingUnchanged} from "./mac-backend-stage-snapshot.mjs";\nimport {installMacColdIngressObserver} from "./mac-cold-ingress-observer.mjs";\n' +
  derivedSource;
const originalBody = (text) =>
  text.slice(
    text.indexOf("async function openWorkspace(workspacePath) {"),
    text.indexOf("async function stopNative() {"),
  );
assert.equal(
  createHash("sha256").update(originalBody(originalSource)).digest("hex"),
  "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
);
assert.equal(originalBody(derivedSource), originalBody(originalSource));
assert.equal(readFileSync(original, "utf8"), originalSource);

const digest = (text) => createHash("sha256").update(text).digest("hex");
writeFileSync(
  resolve("evidence", name, "derived-fixture-source.json"),
  JSON.stringify(
    {
      originalPath: original,
      originalSha256: digest(originalSource),
      derivedSha256: digest(derivedSource),
      capabilityScope:
        "same-ID supportsTools true-false-true, originalUI sync/newtask; exact supplier main/title receipts",
      originalSecondaryBodyPreserved: true,
      modelPostAnchors: 1,
      passiveReceiptAnchors: 1,
      declaration:
        "owned controlled model POST contextWindow=500000; real Admin API GET readback and readonly request byte receipts",
      productMutation: false,
      originalFixtureMutation: false,
      tokenizerMocked: false,
      toolsRemoved: false,
      gatewayGuardChanged: false,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
let loaded = false;
registerHooks({
  load(url, context, nextLoad) {
    const value = nextLoad(url, context);
    if (url !== originalUrl) return value;
    assert.equal(loaded, false);
    loaded = true;
    return { ...value, source: derivedSource };
  },
});
await import(originalUrl);
