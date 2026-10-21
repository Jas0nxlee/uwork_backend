import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as acorn from "acorn";
import {
  deriveCrashRecoveryFixture,
  RECOVERY_PROFILE,
  RECOVERY_MARKER,
} from "./mac-arm64-crash-recovery-derived.mjs";
import { deriveCrashFixture } from "./mac-arm64-crash-consistency-derived.mjs";
import {
  assertMacActorAccountingDelta,
  assertMacOtherActorAccountingUnchanged,
  macStageDigest,
} from "./mac-backend-stage-snapshot.mjs";
const original = readFileSync(
  new URL("./client-native-enterprise.mjs", import.meta.url),
  "utf8",
);
const source = deriveCrashRecoveryFixture(original);
function action(text) {
  return text.slice(
    text.indexOf('else if (c.op === "macCrashMain"'),
    text.indexOf('else if (c.op === "macCrashCleanup"'),
  );
}
test("new exact profile retains whole proven crash action and strict v12 loader", () => {
  assert.equal(
    RECOVERY_PROFILE,
    "client-native-packaged-macos-clock-arm64-consistency-v5-20261021",
  );
  assert.equal(action(source), action(deriveCrashFixture(original)));
  assert.ok(
    source.includes("native-packaged-macos-arm64-secondary-exit-runtime.mjs"),
  );
  assert.ok(source.includes("projectCapabilitySupplierRequests(modelRequests"));
});
test("missing original transformer anchor rejects before any Common execution", () => {
  assert.throws(() =>
    deriveCrashRecoveryFixture(
      original.replace(
        "async function openWorkspace(workspacePath) {",
        "async function changed() {",
      ),
    ),
  );
});
let block;
function walk(n) {
  if (!n || typeof n !== "object") return;
  if (
    n.type === "IfStatement" &&
    source.slice(n.test.start, n.test.end) ===
      'c.op === "macCrashSnapshot" && packagedRuntime'
  )
    block = n.consequent;
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value?.type) walk(value);
  }
}
walk(acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }));
assert.ok(block);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function actor(id, n) {
  return {
    identity: { tenant_id: "tenant", user_id: id },
    accounting: {
      ledger: Array.from({ length: n }, (_, i) => ({
        id: id + "-l" + i,
        requestKeyDigest: id + "-k" + i,
        status: "settled",
        amount: 22,
        input_tokens: 12,
        output_tokens: 10,
        model_id: "model",
        application: "uwork",
      })),
      traces: Array.from({ length: n }, (_, i) => ({
        id: id + "-t" + i,
        status: "succeeded",
        input_tokens: 12,
        output_tokens: 10,
        model_id: "model",
        application: "uwork",
      })),
      gatewayCalls: Array.from({ length: n }, (_, i) => ({
        requestKeyDigest: id + "-k" + i,
        has_result: 1,
      })),
    },
  };
}
async function replay({
  phase = "post-recovery",
  added = 0,
  oldRowChanged = false,
  otherChanged = false,
  extraCounter = 0,
} = {}) {
  const before = {
      actors: { current: actor("current", 2), other: actor("other", 2) },
    },
    snapshot = {
      actors: {
        current: actor("current", 2 + added),
        other: actor("other", 2),
      },
    };
  if (oldRowChanged) snapshot.actors.current.accounting.ledger[0].amount = 999;
  if (otherChanged)
    snapshot.actors.other.accounting.traces[0].status = "failed";
  const initial = Array.from({ length: 4 }, (_, i) => ({
      controlled: "unit-only",
      i,
    })),
    modelRequests = [
      ...initial,
      ...Array.from({ length: added }, (_, i) => ({
        controlled: "new-unit",
        i,
      })),
    ];
  let facts,
    projectCalls = 0;
  const baseline = {
    snapshot: before,
    counters: {
      supplierCalls: 4,
      modelRequests: 4,
      rawInferencePosts: 4,
      supplierRequestDigests: initial.map(macStageDigest),
    },
    child: { old: true },
  };
  const values = {
    c: { op: "macCrashSnapshot", phase },
    packagedRuntime: {},
    api: async () => ({
      items: [{ id: "other", email: "journey-b@example.test" }],
    }),
    p: "/owned-admin",
    member: { id: "current" },
    owner: { tenantId: "tenant" },
    app: { services: { db: { existing: true } } },
    captureMacBackendStage: (db, context) => {
      assert.equal(db.existing, true);
      assert.equal(context.authority, "owned-fixture-existing-db");
      return snapshot;
    },
    modelCalls: 4 + added + extraCounter,
    modelRequests,
    ownedColdIngress: { read: () => 4 + added },
    macStageDigest,
    ownedColdBaseline: baseline,
    electron: { exitCode: null, signalCode: null },
    assertMacActorAccountingDelta,
    assertMacOtherActorAccountingUnchanged,
    model: { id: "model" },
    me: { user: { id: "current" }, tenant: { id: "tenant" } },
    writeFile: async (_path, _body, options) => {
      assert.equal(options.flag, "wx");
    },
    join,
    evidence: "/owned/evidence",
    root: "/owned/case",
    console: {
      log: (line) => {
        facts = JSON.parse(line).facts;
      },
    },
    projectCapabilitySupplierRequests: (_requests, options) => {
      projectCalls++;
      assert.deepEqual(options, {
        fromIndex: 4,
        workspacePath: "/owned/case/packaged-workspace",
        marker: RECOVERY_MARKER,
        expectedTools: 32,
      });
      return { main: { toolCount: 32, cwdMatches: true } };
    },
  };
  await new AsyncFunction(
    ...Object.keys(values),
    source.slice(block.start + 1, block.end - 1),
  )(...Object.values(values));
  return { facts, projectCalls };
}
test("actual post-recovery branch enforces zero current/other rows and raw/supplier increments", async () => {
  const value = await replay();
  assert.equal(value.projectCalls, 0);
  assert.equal(value.facts.counters.rawInferencePosts, 4);
  await assert.rejects(() => replay({ extraCounter: 1 }));
});
test("actual new-task branch adds exactly2/44 and invokes real supplier oracle interface", async () => {
  const value = await replay({ phase: "post-new-task", added: 2 });
  assert.equal(value.projectCalls, 1);
  assert.equal(value.facts.counters.supplierCalls, 6);
  await assert.rejects(() => replay({ phase: "post-new-task", added: 1 }));
});
test("old current row mutation and any other actor row mutation are rejected", async () => {
  await assert.rejects(() =>
    replay({ phase: "post-new-task", added: 2, oldRowChanged: true }),
  );
  await assert.rejects(() => replay({ otherChanged: true }));
});
