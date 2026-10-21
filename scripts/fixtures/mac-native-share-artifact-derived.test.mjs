import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Script, createContext } from "node:vm";
import { parse } from "../../node_modules/acorn/dist/acorn.mjs";
import {
  deriveShareArtifactFixture,
  SHARE_PROFILE,
} from "./mac-native-share-artifact-derived.mjs";
import {
  createShareArtifactPdf,
  assertShareArtifactUpload,
} from "./mac-native-share-artifact-pdf.mjs";
const original = readFileSync(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  ),
  source = deriveShareArtifactFixture(original);
test("actual full ESM derives v12 and preserves original one-c body without starting it", () => {
  parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  });
  assert.equal(
    SHARE_PROFILE,
    "client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021",
  );
  const body = (s) =>
    s.slice(
      s.indexOf("async function openWorkspace(workspacePath) {"),
      s.indexOf("async function stopNative() {"),
    );
  assert.equal(body(source), body(original));
  assert.equal(
    createHash("sha256").update(body(source)).digest("hex"),
    "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6",
  );
  assert.ok(
    source.includes("./native-packaged-macos-arm64-secondary-exit-runtime.mjs"),
  );
  assert.ok(
    source.includes("configure('sharing',{publish:'organization',files:true})"),
  );
  assert.ok(source.includes("configure('security',{allowFilesystem:true})"));
  assert.equal(
    readFileSync(
      new URL("./client-native-enterprise.mjs", import.meta.url),
      "utf8",
    ),
    original,
  );
});
test("actual supplier output only modifies the marker-bound streaming main, never title or seed", () => {
  const start = source.indexOf("  const ownedShareTurn="),
    end = source.indexOf("  if (body.stream)", start);
  assert.ok(start > 0 && end > start);
  for (const [stream, content, match] of [
    [true, "MAC_NATIVE_SHARE_ARTIFACT_20261021", true],
    [false, "MAC_NATIVE_SHARE_ARTIFACT_20261021", false],
    [true, "other-user-test", false],
  ]) {
    const ns = createContext({
      body: { stream },
      currentUser: { content },
      messageText: (r) => r.content,
      fileReply: null,
      workflowActor: false,
    });
    new Script(
      source.slice(start, end) + "\nglobalThis.actual={output,ownedShareTurn};",
    ).runInContext(ns);
    assert.equal(ns.actual.ownedShareTurn, match);
    assert.equal(
      ns.actual.output.includes("[本轮结果](native-share-proof.pdf)"),
      match,
    );
  }
});
function observe() {
  const hooks = {};
  const ns = createContext({
    app: {
      addHook: (name, fn) => {
        hooks[name] = fn;
      },
    },
    assertShareArtifactUpload,
    structuredClone,
  });
  const start = source.indexOf("let shareObservationFault=null;"),
    end = source.indexOf("backendOrigin = await app.listen", start);
  assert.ok(start > 0 && end > start);
  new Script(
    source.slice(start, end) +
      "\nglobalThis.read=()=>({fault:shareObservationFault,http:shareHttp,uploads:shareUploads});",
  ).runInContext(ns);
  return { hooks, read: ns.read };
}
test("actual passive upload observer cannot replace original handler/result on malformed bytes", async () => {
  const f = observe(),
    body = { descriptor: {}, content_base64: "bad" },
    req = {
      id: "owned-request",
      method: "POST",
      url: "/api/client/shares/preparations/prep-owned/artifacts",
      body,
    };
  await f.hooks.preHandler(req);
  const originalResult = { status: "untouched", body };
  assert.equal(originalResult.body, body);
  assert.ok(f.read().fault);
  assert.equal(f.read().uploads.length, 0);
  await f.hooks.onResponse(req, { statusCode: 400 });
  assert.equal(f.read().http[0].status, 400);
});
test("actual passive success receipts bind one uploaded PDF to preparation and keep original data", async () => {
  const f = observe(),
    pdf = createShareArtifactPdf(),
    body = {
      descriptor: {
        artifact_type: "pdf",
        extension: "pdf",
        mime_type: "application/pdf",
        display_name: pdf.fileName,
        size_bytes: pdf.bytes.length,
        sha256: pdf.sha256,
        artifact_id: "artifact-owned",
        ref: "zcode-artifact://share/artifact-owned",
      },
      content_base64: pdf.base64,
    };
  const before = JSON.stringify(body),
    req = {
      id: "owned-request",
      method: "POST",
      url: "/api/client/shares/preparations/prep-owned/artifacts",
      body,
    };
  await f.hooks.preHandler(req);
  await f.hooks.onResponse(req, { statusCode: 201 });
  assert.equal(f.read().fault, null);
  assert.equal(f.read().uploads[0].preparationId, "prep-owned");
  assert.equal(f.read().uploads[0].sha256, pdf.sha256);
  assert.equal(f.read().http[0].status, 201);
  assert.equal(JSON.stringify(body), before);
});
function proofHandler() {
  const tree = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  });
  let target;
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "IfStatement" &&
      source
        .slice(node.test.start, node.test.end)
        .includes("c.op==='shareArtifactProof'")
    )
      target = node.consequent;
    for (const v of Object.values(node))
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
  }
  walk(tree);
  assert.ok(target);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return (bindings) =>
    new AsyncFunction(
      ...Object.keys(bindings),
      source.slice(target.start + 1, target.end - 1),
    )(...Object.values(bindings));
}
test("actual command body has only original Common bindings and four-way SHA succeeds", async () => {
  const pdf = createShareArtifactPdf(),
    descriptor = {
      artifact_type: "pdf",
      extension: "pdf",
      mime_type: "application/pdf",
      display_name: pdf.fileName,
      size_bytes: pdf.bytes.length,
      sha256: pdf.sha256,
      artifact_id: "artifact-owned",
      ref: "zcode-artifact://share/artifact-owned",
    },
    row = {
      id: "prep-owned",
      share_code: "share-owned",
      status: "confirmed",
      artifact_count: 1,
    },
    artifact = {
      artifact_id: descriptor.artifact_id,
      descriptor: JSON.stringify(descriptor),
      content: pdf.bytes,
      size_bytes: pdf.bytes.length,
      sha256: pdf.sha256,
    };
  const path = await import("node:path");
  let closed = 0,
    downloadCorrupt = false,
    revoked = false,
    logged = [];
  const bindings = {
    c: { op: "shareArtifactProof", phase: "after" },
    packagedRuntime: {},
    shareObservationFault: null,
    app: {
      services: {
        db: {
          get: (sql) =>
            sql.includes("count(*)")
              ? { n: 0 }
              : { status: revoked ? "revoked" : "confirmed" },
          all: (sql, ...args) => {
            assert.deepEqual(args, [
              "tenant-owned",
              sql.includes("creator_user_id") ? "user-owned" : "prep-owned",
            ]);
            return sql.includes("creator_user_id") ? [row] : [artifact];
          },
        },
      },
    },
    owner: { tenantId: "tenant-owned" },
    member: { id: "user-owned" },
    inspectShareArtifactPdf: (
      await import("./mac-native-share-artifact-pdf.mjs")
    ).inspectShareArtifactPdf,
    shareUploads: [
      {
        preparationId: row.id,
        artifactId: artifact.artifact_id,
        sha256: pdf.sha256,
        descriptor,
      },
    ],
    join: path.join,
    root: "/owned/share-case",
    ownedSharePdf: pdf,
    shareRealpath: async (p) => p,
    openSharePdf: async () => ({
      stat: async () => ({ isFile: () => true, size: pdf.bytes.length }),
      readFile: async () => pdf.bytes,
      close: async () => {
        closed++;
      },
    }),
    fsConstants: { O_RDONLY: 0, O_NOFOLLOW: 256 },
    api: async (p, method, body, identity) => {
      assert.equal(identity, "owned-unit-identity");
      if (method === "DELETE") {
        assert.equal(p, "/api/client/shares/share-owned");
        revoked = true;
        return;
      }
      return {
        artifacts: [
          {
            ...descriptor,
            url: "https://127.0.0.1:1234/api/client/shares/share-owned/artifacts/artifact-owned",
          },
        ],
      };
    },
    identity: "owned-unit-identity",
    origin: "https://127.0.0.1:1234",
    cert: "/owned/share-case/tls.crt",
    readFile: async (value) => {
      assert.equal(value, "/owned/share-case/tls.crt");
      return Buffer.from("owned-unit-case-certificate");
    },
    requestOwnedShareArtifact: async (options) => {
      assert.equal(options.origin, "https://127.0.0.1:1234");
      assert.equal(
        options.expectedPath,
        "/api/client/shares/share-owned/artifacts/artifact-owned/content",
      );
      assert.equal(options.url, options.origin + options.expectedPath);
      assert.equal(options.identity, "owned-unit-identity");
      assert.deepEqual(options.ca, Buffer.from("owned-unit-case-certificate"));
      assert.equal(options.maxBytes, 4096);
      assert.equal(options.timeoutMs, 15000);
      return {
        status: revoked ? 404 : 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(pdf.bytes.length),
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
          "content-disposition": "attachment; filename=owned.pdf",
        },
        body: downloadCorrupt
          ? Buffer.from("corrupted")
          : revoked
            ? Buffer.from('{"error":"unavailable"}')
            : pdf.bytes,
        explicitCaseCa: true,
        socketClosed: true,
        bodyFullyConsumed: true,
      };
    },
    shareHttp: [{ status: 201 }, { status: 201 }, { status: 200 }],
    console: { log: (text) => logged.push(JSON.parse(text)) },
  };
  const run = proofHandler();
  await run(bindings);
  assert.equal(closed, 1);
  assert.equal(logged.length, 1);
  const value = logged[0].facts;
  assert.equal(value.source.sha256, pdf.sha256);
  assert.equal(value.download.sha256, pdf.sha256);
  assert.equal(value.stored.sha256, pdf.sha256);
  downloadCorrupt = true;
  await assert.rejects(run(bindings));
  assert.equal(closed, 2);
  assert.equal(logged.length, 1);
  downloadCorrupt = false;
  bindings.c.phase = "revoke";
  await run(bindings);
  assert.equal(closed, 3);
  assert.equal(logged.length, 2);
  assert.deepEqual(logged[1].facts.revoked, {
    rowStatus: "revoked",
    artifactsRemaining: 0,
    downloadStatus: 404,
  });
});
