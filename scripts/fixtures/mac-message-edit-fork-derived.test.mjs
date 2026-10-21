import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  deriveMessageFixture,
  PROFILE,
  validateMessageProfile,
} from "./mac-message-edit-fork-derived.mjs";
const original = readFileSync(
  "scripts/fixtures/client-native-enterprise.mjs",
  "utf8",
);
const actual = deriveMessageFixture(original);
const body = (s) =>
  s.slice(
    s.indexOf("async function openWorkspace(workspacePath) {"),
    s.indexOf("async function stopNative() {"),
  );
test("actual full derive parses and preserves 1c secondary, stdio ignore, 10s, packaged-only read and future v15 loader", () => {
  parse(actual, { ecmaVersion: "latest", sourceType: "module" });
  assert.equal(body(actual), body(original));
  assert.equal(
    createHash("sha256").update(body(actual)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.ok(
    actual.includes("native-packaged-macos-arm64-project-memory-runtime.mjs"),
  );
  assert.ok(
    !actual.includes("const outSnapshot = await copyNativeOutSnapshot({"),
  );
  assert.ok(actual.includes("PACKAGED_MAIN_READONLY_BEGIN"));
  assert.throws(() =>
    deriveMessageFixture(
      original.replace("  if (!fileContext) modelRequests.push(body);", ""),
    ),
  );
});
test("actual final Fixture env validates only normal experience + witness; conflict flags fail", () => {
  const env = {
    UWORK_NATIVE_CLIENT_EXPERIENCE: "enabled",
    UWORK_NATIVE_CONFIGURATION_WITNESS: "enabled",
    UWORK_NATIVE_PACKAGED_MANIFEST: "/owned/v15.json",
  };
  validateMessageProfile(PROFILE, env);
  assert.throws(() => validateMessageProfile(PROFILE + "x", env));
  assert.throws(() =>
    validateMessageProfile(PROFILE, {
      ...env,
      UWORK_NATIVE_GATEWAY_USAGE_HOLD: "controlled",
    }),
  );
});
test("actual derived command body executes with only original bindings; lower-case stage snapshot and current Db owner", async () => {
  let branch;
  function visit(n) {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "IfStatement" &&
      actual
        .slice(n.test.start, n.test.end)
        .includes("c.op==='messageLifecycleProof'")
    )
      branch = n.consequent;
    for (const v of Object.values(n))
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
  }
  visit(parse(actual, { ecmaVersion: "latest", sourceType: "module" }));
  assert.ok(branch);
  let saved, logged, scope;
  const db = { owned: true };
  const context = vm.createContext({
    c: {
      op: "messageLifecycleProof",
      phase: "warm",
      taskId: "sess_a",
      dbPath: "/owned/db",
      dom: { ok: true },
    },
    packagedRuntime: {},
    modelCalls: 4,
    modelRequests: [{}, {}, {}, {}],
    messageIngress: { read: () => 4 },
    messagePrevious: undefined,
    api: async () => ({
      items: [{ id: "other", email: "journey-b@example.test" }],
    }),
    p: "/tenant",
    owner: { tenantId: "tenant" },
    member: { id: "current" },
    me: { user: { id: "current" }, tenant: { id: "tenant" } },
    app: { services: { db } },
    model: { id: "model" },
    root: "/owned",
    join: (...p) => p.join("/"),
    evidence: "/evidence",
    captureMacBackendStage: (actualDb, input) => {
      assert.equal(actualDb, db);
      scope = input;
      return {};
    },
    readMessageLifecycle: () => ({
      semantic: {
        modelSelection: {
          providerId: "ucas",
          modelId: "model",
          options: { reasoningLevel: "none" },
        },
      },
    }),
    traffic: Array.from({ length: 4 }, () => ({
      method: "POST",
      pathname: "/v1/chat/completions",
      status: 200,
    })),
    messageSupplier: { safeStatus: () => ({}) },
    macStageDigest: () => "digest",
    writeFile: async (...args) => {
      saved = args;
    },
    console: {
      log: (s) => {
        logged = JSON.parse(s);
      },
    },
  });
  const fn = new vm.Script(
    "(async()=>" + actual.slice(branch.start, branch.end) + ")()",
    { importModuleDynamically: async (name) => import(name) },
  );
  await fn.runInContext(context);
  assert.equal(scope.phase, "message-warm");
  assert.equal(logged.status, "done");
  assert.equal(logged.facts.counters.rawInferencePosts, 4);
  assert.equal(saved[2].flag, "wx");
});
