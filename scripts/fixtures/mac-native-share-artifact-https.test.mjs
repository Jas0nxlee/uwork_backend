import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createShareArtifactPdf } from "./mac-native-share-artifact-pdf.mjs";
const exec = promisify(execFile),
  base = resolve(
    "evidence/client-macos-native-share-artifact-readonly-20261021",
  );
async function fixture(t) {
  const root = await mkdtemp(join(base, "private-tls-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["right", "wrong"])
    await exec(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, name + ".key"),
        "-out",
        join(root, name + ".crt"),
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { timeout: 5000 },
    );
  const ca = await readFile(join(root, "right.crt")),
    wrongCa = await readFile(join(root, "wrong.crt")),
    pdf = createShareArtifactPdf(),
    requests = [],
    sockets = new Set();
  const server = createServer(
    { key: await readFile(join(root, "right.key")), cert: ca },
    (req, res) => {
      requests.push(req.url);
      assert.equal(
        req.headers.authorization,
        "Bearer owned-unit-test-identity",
      );
      if (req.url.includes("/oversize/")) res.end(Buffer.alloc(5000));
      else if (req.url.includes("/missing/")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{\"error\":\"unavailable\"}');
      } else if (req.url.includes("/redirect/")) {
        res.writeHead(302, {
          location: "https://unrelated.invalid/never-follow",
        });
        res.end("not followed");
      } else {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": pdf.bytes.length,
        });
        res.end(pdf.bytes);
      }
    },
  );
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.on("tlsClientError", () => {});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  });
  const origin = "https://127.0.0.1:" + server.address().port,
    path = "/api/client/shares/share-owned/artifacts/artifact-owned/content";
  return { ca, wrongCa, pdf, requests, sockets, origin, path };
}
async function assertNoLiveSockets(f) {
  for (let i = 0; i < 15 && f.sockets.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    f.sockets.size,
    0,
    "Client cleanup must close real sockets before test cleanup",
  );
}
test("real own TLS proves old global fetch rejects; explicit case CA succeeds and wrong CA rejects", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    fetch(f.origin + f.path),
    (e) =>
      e.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      e.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN",
  );
  const { requestOwnedShareArtifact } = await import(
    "./mac-native-share-artifact-https.mjs"
  );
  const input = {
    url: f.origin + f.path,
    origin: f.origin,
    expectedPath: f.path,
    ca: f.ca,
    identity: "owned-unit-test-identity",
    maxBytes: 4096,
    timeoutMs: 2000,
  };
  const good = await requestOwnedShareArtifact(input);
  assert.equal(good.status, 200);
  assert.deepEqual(good.body, f.pdf.bytes);
  assert.equal(good.socketClosed, true);
  assert.equal(good.bodyFullyConsumed, true);
  const before = f.requests.length;
  await assert.rejects(
    requestOwnedShareArtifact({ ...input, ca: f.wrongCa }),
    (e) =>
      ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(
        e.code,
      ),
  );
  assert.equal(f.requests.length, before);
  await assertNoLiveSockets(f);
});
test("real TLS bounded body/redirect response and out-of-scope URL contracts", async (t) => {
  const f = await fixture(t),
    { requestOwnedShareArtifact } = await import(
      "./mac-native-share-artifact-https.mjs"
    );
  const input = {
    url: f.origin + f.path,
    origin: f.origin,
    expectedPath: f.path,
    ca: f.ca,
    identity: "owned-unit-test-identity",
    maxBytes: 4096,
    timeoutMs: 2000,
  };
  for (const patch of [
    { origin: "https://example.invalid" },
    { expectedPath: "/api/auth/me" },
    { url: f.origin + f.path + "?x=1" },
    { url: f.origin + f.path + "#x" },
    { url: "http://127.0.0.1:1234" + f.path },
  ])
    await assert.rejects(requestOwnedShareArtifact({ ...input, ...patch }));
  assert.equal(f.requests.length, 0);
  const oversize = f.path.replace("/artifact-owned/", "/oversize/");
  await assert.rejects(
    requestOwnedShareArtifact({
      ...input,
      url: f.origin + oversize,
      expectedPath: oversize,
    }),
    (e) => e.code === "OWNED_SHARE_BODY_LIMIT",
  );
  const redirect = f.path.replace("/artifact-owned/", "/redirect/");
  const response = await requestOwnedShareArtifact({
    ...input,
    url: f.origin + redirect,
    expectedPath: redirect,
  });
  assert.equal(response.status, 302);
  assert.equal(response.socketClosed, true);
  const missing = f.path.replace("/artifact-owned/", "/missing/");
  const gone = await requestOwnedShareArtifact({
    ...input,
    url: f.origin + missing,
    expectedPath: missing,
  });
  assert.equal(gone.status, 404);
  assert.equal(gone.bodyFullyConsumed, true);
  assert.equal(gone.socketClosed, true);
  assert.equal(f.requests.length, 3);
  await assertNoLiveSockets(f);
});
