import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "acorn";
import { deriveArchiveFixture } from "./mac-arm64-task-archive-derived.mjs";
import { ARCHIVE_STAGES } from "./mac-task-archive-observer.mjs";
import {
  captureMacBackendStage,
  MAC_STAGE_SELECTS,
  macStageDigest,
} from "./mac-backend-stage-snapshot.mjs";
const original = readFileSync(
  "scripts/fixtures/client-native-enterprise.mjs",
  "utf8",
);
test("actual derived fixture retains original signed launch/secondary, no security mutation, and packaged-only reader", () => {
  const s = deriveArchiveFixture(original),
    part = (s, start, end) =>
      s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start)));
  assert.equal(
    part(s, "async function launch() {", "async function openWorkspace("),
    part(
      original,
      "async function launch() {",
      "async function openWorkspace(",
    ),
  );
  assert.equal(
    part(
      s,
      "async function openWorkspace(workspacePath) {",
      "async function stopNative() {",
    ),
    part(
      original,
      "async function openWorkspace(workspacePath) {",
      "async function stopNative() {",
    ),
  );
  assert(!s.includes("const outSnapshot = await copyNativeOutSnapshot("));
  assert(s.includes("noDevelopmentOutCopied:true"));
  assert(!s.includes("await configure('security'"));
  assert(
    s.includes("./native-packaged-macos-arm64-project-memory-runtime.mjs"),
  );
  assert.throws(() => deriveArchiveFixture(original + original));
});
test("actual six-stage command body reaches original snapshot phases and enforces zero raw/accounting change", async () => {
  const source = deriveArchiveFixture(original);
  let branch;
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "IfStatement" &&
      source.slice(n.test.start, n.test.end).includes("c.op==='archiveStage'")
    )
      branch = n.consequent;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  assert(branch);
  const body = source.slice(branch.start + 1, branch.end - 1),
    db = {
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
    phases = [],
    written = [],
    logged = [];
  const bindings = {
    c: null,
    packagedRuntime: {},
    ARCHIVE_STAGES,
    archiveBaseline: undefined,
    archivePrevious: undefined,
    captureArchiveTask: ({ taskId, dbPath }) => ({
      taskId,
      dbPath,
      archived: ["archived", "opened"].includes(bindings.c.stage),
      pinned: false,
      deleted: false,
      semantic: { index: { title: "Owned title" } },
      semanticSha256: "stable",
    }),
    assertArchiveTaskUnchanged: (a, b, archived) => {
      assert.equal(b.archived, archived);
      assert.deepEqual(b.semantic, a.semantic);
    },
    root: "/owned",
    join,
    api: async () => ({
      items: [{ id: "b", email: "journey-b@example.test" }],
    }),
    p: "/api/tenants/t",
    owner: { tenantId: "t" },
    member: { id: "a" },
    me: { user: { id: "a" }, tenant: { id: "t" } },
    app: { services: { db } },
    captureMacBackendStage: (d, c) => {
      const value = captureMacBackendStage(d, c);
      phases.push(value.phase);
      return value;
    },
    macStageDigest,
    model: { id: "model" },
    modelCalls: 4,
    modelRequests: [{ warm: 0 }, { warm: 1 }, { warm: 2 }, { warm: 3 }],
    archiveIngress: { read: () => 4 },
    writeFile: async (path, bytes) => written.push([path, JSON.parse(bytes)]),
    evidence: "/owned/evidence",
    console: { log: (line) => logged.push(JSON.parse(line)) },
  };
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    ...Object.keys(bindings),
    body,
  );
  for (const stage of ARCHIVE_STAGES) {
    bindings.c = {
      op: "archiveStage",
      stage,
      taskId: "sess_owned",
      dbPath: "/owned/db",
      dom: {
        ok: true,
        stage,
        taskId: "sess_owned",
        sessionId: "sess_owned",
        identity: "企业用户甲",
        title: "Owned title",
        userVisible: true,
        assistantVisible: true,
        model: "model",
        thought: "none",
        confirming: stage === "confirming",
        archivedRows: stage === "opened" ? 1 : 0,
        normalRows: 1,
      },
    };
    await run(...Object.values(bindings));
    const f = logged.at(-1).facts;
    bindings.archiveBaseline ??= f;
    bindings.archivePrevious = f;
  }
  assert.deepEqual(
    phases,
    ARCHIVE_STAGES.map((s) => "archive-" + s),
  );
  assert.equal(written.length, 6);
  bindings.c = {
    ...bindings.c,
    stage: "baseline",
    dom: { ...bindings.c.dom, stage: "baseline" },
  };
  bindings.archivePrevious = undefined;
  bindings.modelRequests.push({ unexpected: true });
  await assert.rejects(() => run(...Object.values(bindings)));
});
