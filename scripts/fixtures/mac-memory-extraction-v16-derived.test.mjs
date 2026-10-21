import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "acorn";
import { deriveAutoMemoryFixture } from "./mac-memory-extraction-v16-derived.mjs";
test("actual Common preserves original secondary and streaming branch; standard nonstream three-call batch renders", () => {
  const old = readFileSync(
      "scripts/fixtures/client-native-enterprise.mjs",
      "utf8",
    ),
    source = deriveAutoMemoryFixture(old);
  const body = (s) =>
    s.slice(
      s.indexOf("async function openWorkspace(workspacePath) {"),
      s.indexOf("async function stopNative() {"),
    );
  assert.equal(body(old), body(source));
  assert.equal(
    createHash("sha256").update(body(source)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  let target;
  const walk = (node) => {
    if (
      node?.type === "IfStatement" &&
      node.test.type === "MemberExpression" &&
      node.test.object?.name === "body" &&
      node.test.property?.name === "stream"
    )
      target = node;
    for (const value of Object.values(node ?? {})) {
      if (Array.isArray(value))
        value.forEach((v) => v && typeof v === "object" && walk(v));
      else if (value && typeof value === "object" && value.type) walk(value);
    }
  };
  walk(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  assert(target);
  let rendered;
  const calls = Array.from({ length: 3 }, (_, i) => ({
    id: "owned" + i,
    type: "function",
    function: { name: "Write", arguments: "{}" },
  }));
  new Function(
    "body",
    "res",
    "fileReply",
    "toolTurn",
    "call",
    "output",
    "workflowActor",
    source.slice(target.start, target.end),
  )(
    { stream: false },
    {
      setHeader() {},
      end(value) {
        rendered = JSON.parse(value);
      },
    },
    { toolCalls: calls },
    true,
    { ignored: true },
    "",
    false,
  );
  assert.deepEqual(rendered.choices[0].message.tool_calls, calls);
  assert.deepEqual(rendered.usage, {
    prompt_tokens: 12,
    completion_tokens: 10,
  });
  const oldTree = parse(old, { ecmaVersion: "latest", sourceType: "module" });
  let oldTarget;
  const visit = (node) => {
    if (
      node?.type === "IfStatement" &&
      node.test.type === "MemberExpression" &&
      node.test.object?.name === "body" &&
      node.test.property?.name === "stream"
    )
      oldTarget = node;
    for (const value of Object.values(node ?? {})) {
      if (Array.isArray(value))
        value.forEach((v) => v && typeof v === "object" && visit(v));
      else if (value && typeof value === "object" && value.type) visit(value);
    }
  };
  visit(oldTree);
  assert.equal(
    source.slice(target.consequent.start, target.consequent.end),
    old.slice(oldTarget.consequent.start, oldTarget.consequent.end),
  );
  assert.throws(() => deriveAutoMemoryFixture(old + old));
});

test("actual autoMemoryProof phases enter original capture as lowercase canonical identifiers", async () => {
  const { MAC_STAGE_SELECTS, captureMacBackendStage } = await import(
    "./mac-backend-stage-snapshot.mjs"
  );
  const source = deriveAutoMemoryFixture(
    readFileSync("scripts/fixtures/client-native-enterprise.mjs", "utf8"),
  );
  let branch;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "IfStatement" &&
      source
        .slice(n.test.start, n.test.end)
        .includes("c.op==='autoMemoryProof'")
    )
      branch = n.consequent;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  assert(branch);
  const db = {
      all: (sql, ...args) =>
        sql === MAC_STAGE_SELECTS.member
          ? [
              {
                tenant_id: args[0],
                user_id: args[1],
                role: "member",
                department_id: null,
                status: "active",
                seat: 1,
              },
            ]
          : [],
    },
    seen = [],
    stop = Symbol("actual capture accepted");
  for (const [stage, previous] of [
    ["warm", undefined],
    ["after-A", { stage: "warm" }],
    ["after-B", { stage: "after-A" }],
  ]) {
    const bindings = {
      c: {
        op: "autoMemoryProof",
        stage,
        sessionId: "owned-session",
        dbPath: "/owned/db",
      },
      autoMemoryRejected: undefined,
      autoMemoryPrevious: previous,
      api: async () => ({
        items: [{ email: "journey-b@example.test", id: "b" }],
      }),
      p: "/api/tenants/t",
      member: { id: "a" },
      owner: { tenantId: "t" },
      app: { services: { db } },
      captureMacBackendStage: (d, c) => {
        const actual = captureMacBackendStage(d, c);
        seen.push(actual.phase);
        throw stop;
      },
    };
    const run = new (Object.getPrototypeOf(async function () {}).constructor)(
      ...Object.keys(bindings),
      source.slice(branch.start + 1, branch.end - 1),
    );
    await assert.rejects(
      () => run(...Object.values(bindings)),
      (error) => error === stop,
    );
  }
  assert.deepEqual(seen, ["warm", "after-a", "after-b"]);
  assert(
    source.includes(
      "./native-packaged-macos-arm64-memory-manifest-runtime.mjs",
    ),
  );
  assert(!source.includes("const outSnapshot = await copyNativeOutSnapshot("));
  assert(source.includes("noDevelopmentOutCopied:true"));
});
