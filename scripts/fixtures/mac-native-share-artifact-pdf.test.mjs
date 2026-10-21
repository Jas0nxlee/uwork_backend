import assert from "node:assert/strict";
import test from "node:test";
import {
  createShareArtifactPdf,
  inspectShareArtifactPdf,
  assertShareArtifactUpload,
} from "./mac-native-share-artifact-pdf.mjs";
test("real one-page PDF has byte-correct xref object positions and trailer", () => {
  const f = createShareArtifactPdf();
  const p = inspectShareArtifactPdf(f.bytes);
  assert.equal(p.sha256, f.sha256);
  assert.equal(p.sizeBytes, f.bytes.length);
  assert.equal(p.pageCount, 1);
  assert.equal(p.objectCount, 5);
  assert.ok(
    f.bytes
      .subarray(p.xrefOffset, p.xrefOffset + 4)
      .equals(Buffer.from("xref")),
  );
});
test("header/trailer/xref/object length corruption and foreign PDF bytes are rejected", () => {
  const f = createShareArtifactPdf();
  for (const transform of [
    () => Buffer.from("opaque pdf"),
    (b) => b.subarray(0, b.length - 4),
    (b) => Buffer.from(b.toString().replace("/Root 1 0 R", "/Root 9 0 R")),
    (b) => Buffer.from(b.toString().replace("0000000009", "0000000008")),
    (b) => Buffer.from(b.toString().replace("startxref\n", "startxref\n1")),
  ]) {
    const b = transform(f.bytes);
    assert.notDeepEqual(b, f.bytes);
    assert.throws(() => inspectShareArtifactPdf(b));
  }
});
test("actual upload descriptor, canonical base64, length and exact source SHA must agree", () => {
  const f = createShareArtifactPdf();
  const d = {
    artifact_type: "pdf",
    extension: "pdf",
    mime_type: "application/pdf",
    display_name: f.fileName,
    size_bytes: f.bytes.length,
    sha256: f.sha256,
    artifact_id: "artifact-owned",
    ref: "zcode-artifact://share/artifact-owned",
  };
  assert.equal(
    assertShareArtifactUpload({
      descriptor: d,
      content_base64: f.bytes.toString("base64"),
    }).sha256,
    f.sha256,
  );
  for (const change of [
    { size_bytes: 1 },
    { sha256: "0".repeat(64) },
    { mime_type: "image/png" },
    { display_name: "../secret.pdf" },
    { ref: "file:///tmp/x" },
  ])
    assert.throws(() =>
      assertShareArtifactUpload({
        descriptor: { ...d, ...change },
        content_base64: f.bytes.toString("base64"),
      }),
    );
  assert.throws(() =>
    assertShareArtifactUpload({
      descriptor: d,
      content_base64: f.bytes.toString("base64") + "!",
    }),
  );
});
