/** Reconcile the current menu inventory with actual results, without running business actions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createConnection } from "node:net";
import ts from "typescript";

const output = "evidence/prepublish-linkage-audit-v1-20261021";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const result = (number) =>
  `evidence/admin-run-ui-v${number}-20261021/result.json`;
const verified = new Map();
async function passed(path) {
  const body = await json(path);
  assert.equal(body.status, "passed", path);
  verified.set(
    path,
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  );
  return body;
}
async function array(path, name, kind) {
  const code = await readFile(path, "utf8");
  const source = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  while (expression && ts.isAsExpression(expression))
    expression = expression.expression;
  assert.ok(expression && ts.isArrayLiteralExpression(expression));
  return expression.elements;
}
const business = {
  overview: [39],
  models: [8],
  assets: [15],
  categories: [23],
  credentials: [22],
  policies: [14],
  security: [43],
  configuration: [47],
  agents: [44],
  runs: [3],
  sessions: [52],
  runtimes: [13],
  "sandbox-executions": [13],
  automations: [6],
  datasets: [4],
  evaluations: [4, 5],
  members: [16, 49],
  departments: [16],
  usage: [28, 29],
  "usage-aggregates": [28],
  traces: [28, 29],
  audit: [3, 29],
  "client-events": [28, 29],
  enterprise: [25, 49],
  subscription: [41],
};
const views = (
  await array("admin/src/catalog.ts", "views", ts.ScriptKind.TS)
).map((node) => {
  assert.ok(ts.isObjectLiteralExpression(node));
  return Object.fromEntries(
    node.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      ts.isStringLiteral(property.initializer)
        ? [[property.name.text, property.initializer.text]]
        : [],
    ),
  );
});
const consoleResult = await passed(result(39));
const consoleStage = consoleResult.stages[0];
assert.equal(consoleStage.calibrationObserved, true);
assert.deepEqual(consoleStage.errors, []);
const scoped = views.filter((view) => view.id !== "integrations");
assert.deepEqual(
  scoped.map((view) => view.id).sort(),
  consoleStage.views.map((view) => view.id).sort(),
);
assert.deepEqual(
  scoped.map((view) => view.id).sort(),
  Object.keys(business).sort(),
);
assert.ok(consoleStage.views.every((view) => view.httpDataLoaded));
const coverage = [];
for (const view of scoped) {
  const evidence = business[view.id].map(result);
  for (const path of evidence) await passed(path);
  coverage.push({ ...view, pageLoad: result(39), businessEvidence: evidence });
}
const tabs = (
  await array("admin/src/forms.tsx", "configurationTabs", ts.ScriptKind.TSX)
).map((node) => {
  assert.ok(ts.isArrayLiteralExpression(node));
  return node.elements.map((element) => {
    assert.ok(ts.isStringLiteral(element));
    return element.text;
  });
});
assert.deepEqual(
  tabs.map((tab) => tab[0]).sort(),
  consoleStage.configurationTabs.map((tab) => tab.id).sort(),
);
assert.ok(consoleStage.configurationTabs.every((tab) => tab.httpDataLoaded));
const profiles = [41, 43, 44, 47, 49, 52];
const resources = [];
for (const profile of profiles) {
  const body = await passed(result(profile));
  assert.equal(body.privateRootRemoved, true);
  assert.equal(body.backendPortClosed, true);
  assert.equal(body.providerPortClosed, true);
  assert.equal(body.browserCleanup.fullyClosed, true);
  assert.ok(body.browserCleanup.pids.every((row) => row.exited));
  resources.push({
    evidence: result(profile),
    browserClosed: true,
    serversClosed: true,
    privateRootRemoved: true,
  });
}
let retainedFailures = 0;
for (let profile = 40; profile <= 52; profile++) {
  const body = await json(result(profile));
  assert.equal(body.browserCleanup.fullyClosed, true);
  assert.equal(body.backendPortClosed, true);
  assert.equal(body.providerPortClosed, true);
  assert.equal(body.privateRootRemoved, true);
  if (body.status === "failed") retainedFailures++;
}
for (let profile = 70; profile <= 77; profile++) {
  const path = `evidence/client-native-prepublish-v${profile}-20261021`;
  const body = await json(path + "/result.json");
  const clean = await json(path + "/cleanup.json");
  assert.equal(body.fixtureExit, 0);
  assert.equal(body.cleanupVerified, true);
  assert.deepEqual(clean.errors, []);
  assert.equal(clean.ownedRootRemoved, true);
  if (body.status === "failed") retainedFailures++;
}
const wecomPath = "evidence/real-wecom-admin-v8-20261021/result.json";
const wecom = await passed(wecomPath);
assert.equal(wecom.frontend, "vite-source");
assert.equal(wecom.mainUnchanged, true);
assert.equal(wecom.secretLeaked, false);
assert.equal(wecom.browserCleanup.fullyClosed, true);
assert.equal(wecom.frontendPortClosed, true);
assert.equal(wecom.backendPortClosed, true);
const nativePath = "evidence/client-native-prepublish-v77-20261021";
const native = await passed(nativePath + "/result.json");
const cleanup = await json(nativePath + "/cleanup.json");
assert.equal(native.cleanupVerified, true);
assert.equal(native.fixtureExit, 0);
assert.deepEqual(cleanup.errors, []);
assert.equal(cleanup.ownedRootRemoved, true);
const meta = await json(nativePath + "/desktop-state.json");
await assert.rejects(access(meta.root));
const ports = [meta.origin, meta.backendOrigin, meta.supplierOrigin].map(
  (url) => Number(new URL(url).port),
);
ports.push(meta.cdpPort);
const closed = (port) =>
  new Promise((resolve) => {
    assert.ok(port && port !== 3000);
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(2000);
    socket.once("error", () => resolve(true));
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
for (const port of ports) assert.equal(await closed(port), true);
for (const pid of native.nativePids) assert.throws(() => process.kill(pid, 0));
const live = await fetch("http://127.0.0.1:3000/health", {
  signal: AbortSignal.timeout(5000),
});
assert.equal(live.status, 200);
assert.equal((await live.json()).status, "ok");
await mkdir(output, { mode: 0o700 });
const receipt = {
  status: "verified-inventory-with-open-boundaries",
  generatedAt: new Date().toISOString(),
  adminPageCount: coverage.length,
  configurationTabCount: tabs.length,
  coverage,
  tabs,
  checkedResults: [...verified].map(([path, sha256]) => ({ path, sha256 })),
  resources,
  retainedFailures,
  realWecom: {
    evidence: wecomPath,
    mainIdentityUnchanged: true,
    originalSourceUiSyncPassed: true,
  },
  native: {
    evidence: nativePath,
    originalPrimaryPidsGone: true,
    portsClosed: ports.length,
    privateRootRemoved: true,
  },
  normalBackendHealthy: true,
  excluded: [
    "external MCP",
    "network drives",
    "released multi-platform clients",
  ],
  open: [
    "real member WeCom OAuth/client claim: previously rejected browser URL, not retried",
    "managed remote authority and mobile/cloud consumers: missing implementation or previous refused runtime boundary",
  ],
  limits: [
    "page load is distinct from each business action",
    "configuration tabs are not an exhaustive combination of all field values",
    "local controlled supplier is not external model quality or supplier billing",
    "this audit is not full product completion",
  ],
};
await writeFile(output + "/result.json", JSON.stringify(receipt, null, 2), {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: receipt.status,
    pages: coverage.length,
    tabs: tabs.length,
    results: verified.size,
    resourceChecks: resources.length,
    normalBackendHealthy: true,
    open: receipt.open.length,
  }),
);
