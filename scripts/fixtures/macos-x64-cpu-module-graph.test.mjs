/** Real Node ESM topology contract only; never evaluates the real Common/backend body. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { parse } from "acorn";
import { deriveMainCpuFixture } from "./macos-x64-cpu-derived.mjs";
const repo = resolve(import.meta.dirname, "../..");
const originalCommon = join(
  repo,
  "scripts/fixtures/client-native-enterprise.mjs",
);
const realEntry = join(repo, "scripts/fixtures/macos-x64-cpu-derived.mjs");
const archived = join(
  repo,
  "data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v3-20261021/fixture-derived.mjs",
);
function importedDiagnostic(source) {
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const matches = tree.body.filter(
    (n) =>
      n.type === "ImportDeclaration" &&
      n.specifiers.some(
        (s) =>
          s.type === "ImportSpecifier" &&
          s.imported.name === "runOwnedMainCpuDiagnostic",
      ),
  );
  assert.equal(matches.length, 1);
  const specifier = matches[0].source.value;
  assert.match(specifier, /^\.\/[A-Za-z0-9-]+\.mjs$/);
  return specifier;
}
async function nodeGraph(t, specifier) {
  const root = await mkdtemp(join(tmpdir(), "uwork-cpu-module-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, basename(realEntry)),
    common = join(root, "dummy-common.mjs");
  await writeFile(
    entry,
    'await import("./dummy-common.mjs"); process.stdout.write("OWNED_ESM_GRAPH_COMPLETE\\n");\n',
  );
  await writeFile(
    common,
    `const runtime=await import(${JSON.stringify(specifier)}); if(typeof runtime.runOwnedMainCpuDiagnostic!=="function")throw Error("DIAGNOSTIC_EXPORT_MISSING");\n`,
  );
  if (basename(specifier) !== basename(entry)) {
    const actualRuntime = new URL(specifier, pathToFileURL(originalCommon));
    await writeFile(
      join(root, specifier),
      `export {runOwnedMainCpuDiagnostic} from ${JSON.stringify(actualRuntime.href)};\n`,
    );
  }
  return spawnSync(process.execPath, [entry], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
  });
}
test("archived actual Common import back to entry reproduces unresolved TLA exit13", async (t) => {
  const source = await readFile(archived, "utf8");
  const specifier = importedDiagnostic(source);
  assert.equal(specifier, "./macos-x64-cpu-derived.mjs");
  const result = await nodeGraph(t, specifier);
  assert.equal(result.status, 13);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unsettled top-level await/i);
});
test("actual selected Common diagnostic import resolves without executing Common body", async (t) => {
  const override = process.env.UWORK_CPU_GRAPH_ARCHIVED_RED;
  const source = override
    ? await readFile(archived, "utf8")
    : deriveMainCpuFixture(await readFile(originalCommon, "utf8"));
  const specifier = importedDiagnostic(source);
  const result = await nodeGraph(t, specifier);
  assert.equal(
    result.status,
    0,
    "Actual selected diagnostic dependency must resolve; exit13 reproduces the archived entry cycle",
  );
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "OWNED_ESM_GRAPH_COMPLETE\n");
  assert.equal(result.stderr, "");
  assert.equal(specifier, "./macos-x64-cpu-runtime.mjs");
});
test("actual runtime is a separate node-only module with no top-level await or entry import", async () => {
  const source = deriveMainCpuFixture(await readFile(originalCommon, "utf8")),
    specifier = importedDiagnostic(source),
    runtime = new URL(specifier, pathToFileURL(originalCommon));
  assert.notEqual(runtime.href, pathToFileURL(realEntry).href);
  const text = await readFile(runtime, "utf8"),
    tree = parse(text, { ecmaVersion: "latest", sourceType: "module" });
  assert.ok(
    tree.body
      .filter((n) => n.type === "ImportDeclaration")
      .every((n) => n.source.value.startsWith("node:")),
  );
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type)
    )
      return;
    assert.notEqual(node.type, "AwaitExpression");
    if (node.type === "ForOfStatement") assert.equal(node.await, false);
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
  }
  walk(tree);
});
