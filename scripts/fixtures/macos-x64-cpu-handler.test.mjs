/** Actual derived handler body execution, not a backend/App/inspector test. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import vm from "node:vm";
import { parse } from "acorn";
import { deriveMainCpuFixture } from "./macos-x64-cpu-derived.mjs";
const repo = path.resolve(import.meta.dirname, "../..");
const commonPath = path.join(
  repo,
  "scripts/fixtures/client-native-enterprise.mjs",
);
const archivedPath = path.join(
  repo,
  "data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v4-20261021/fixture-derived.mjs",
);
const original = await readFile(commonPath, "utf8");
const ast = (source) =>
  parse(source, { ecmaVersion: "latest", sourceType: "module" });
function pathBindings() {
  const rows = ast(original).body.filter(
    (n) => n.type === "ImportDeclaration" && n.source.value === "node:path",
  );
  const values = {};
  for (const row of rows)
    for (const s of row.specifiers) {
      assert.equal(s.type, "ImportSpecifier");
      values[s.local.name] = path[s.imported.name];
    }
  assert.equal(typeof values.join, "function");
  assert.equal(
    values.resolve,
    undefined,
    "Original Common does not import resolve",
  );
  return values;
}
function containsCommand(n) {
  if (!n || typeof n !== "object") return false;
  if (
    n.type === "BinaryExpression" &&
    n.operator === "===" &&
    n.left.type === "MemberExpression" &&
    n.left.object.name === "c" &&
    n.left.property.name === "op" &&
    n.right.value === "mainCpuProfile"
  )
    return true;
  return Object.values(n).some((v) =>
    Array.isArray(v)
      ? v.some(containsCommand)
      : typeof v === "object" && containsCommand(v),
  );
}
function handler(source) {
  const hits = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "IfStatement" && containsCommand(n.test))
      hits.push(n.consequent);
    for (const v of Object.values(n))
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
  }
  walk(ast(source));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, "BlockStatement");
  return source.slice(hits[0].start + 1, hits[0].end - 1);
}
async function execute(source) {
  const calls = [],
    writes = [],
    logs = [];
  let launches = 0;
  const evidence =
    "evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021";
  const child = { pid: 12345, exitCode: null, signalCode: null },
    runtime = {
      electron: "/owned/frozen/UWork Preview.app/Contents/MacOS/UWork Preview",
    };
  const profiler = () =>
    assert.fail("Handler must pass profiler, not invoke it");
  const facts = { completed: true };
  const bindings = {
    ...pathBindings(),
    electron: child,
    runtime,
    mainInspectorPort: 49152,
    evidence,
    c: { op: "mainCpuProfile", budgetMs: 65000 },
    process: { cwd: () => repo },
    profileOwnedMainCpu: profiler,
    runOwnedMainCpuDiagnostic: async (params) => {
      calls.push(params);
      return facts;
    },
    writeFile: async (...args) => {
      writes.push(args);
    },
    console: { log: (value) => logs.push(value) },
    spawn: () => {
      launches++;
      assert.fail("Handler must not launch");
    },
  };
  const context = vm.createContext(bindings);
  let timeout;
  try {
    await Promise.race([
      new vm.Script("(async()=>{" + handler(source) + "})()").runInContext(
        context,
        { timeout: 1000 },
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error("FINITE_HANDLER_TEST_TIMEOUT")),
          1000,
        );
      }),
    ]);
  } catch (error) {
    error.receipt = {
      calls: calls.length,
      writes: writes.length,
      logs: logs.length,
      launches,
    };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(calls.length, 1);
  const p = calls[0];
  assert.equal(p.child, child);
  assert.equal(p.isCurrent(), true);
  assert.equal(p.expectedExecutable, runtime.electron);
  assert.equal(p.expectedPort, 49152);
  assert.equal(p.budgetMs, 65000);
  assert.equal(p.profiler, profiler);
  assert.equal(
    p.outputFile,
    path.join(repo, evidence, "main-cpu-profile.json"),
  );
  assert.equal(path.isAbsolute(p.outputFile), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], path.join(evidence, "main-cpu-summary.json"));
  assert.deepEqual(JSON.parse(writes[0][1]), facts);
  assert.equal(writes[0][2].mode, 0o600);
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), {
    op: "mainCpuProfile",
    status: "done",
    facts,
  });
  assert.equal(launches, 0);
}
test("archived actual v4 handler demonstrates missing resolve before any diagnostic dispatch", async () => {
  await assert.rejects(
    execute(await readFile(archivedPath, "utf8")),
    (error) => {
      assert.equal(error.name, "ReferenceError");
      assert.match(error.message, /resolve is not defined/);
      assert.deepEqual(error.receipt, {
        calls: 0,
        writes: 0,
        logs: 0,
        launches: 0,
      });
      return true;
    },
  );
});
test("actual selected handler executes with only Common path bindings and dispatches exactly once", async () => {
  const source = process.env.UWORK_CPU_HANDLER_ARCHIVED_RED
    ? await readFile(archivedPath, "utf8")
    : deriveMainCpuFixture(original);
  await execute(source);
});
