/** Fixed harmless PDF fixture and byte-level oracle; never writes the client store. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function createShareArtifactPdf() {
  const content =
    "BT /F1 12 Tf 40 100 Td (Native Share owned PDF 20261021) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1))
    text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(text);
  return {
    fileName: "native-share-proof.pdf",
    bytes,
    sha256: sha(bytes),
    base64: bytes.toString("base64"),
  };
}
export function inspectShareArtifactPdf(input) {
  const bytes = Buffer.from(input),
    text = bytes.toString("ascii");
  assert.ok(
    bytes.length > 100 && bytes.length < 4096 && text.startsWith("%PDF-1.4\n"),
  );
  const ending = text.match(
    /trailer\n<< \/Size 6 \/Root 1 0 R >>\nstartxref\n([0-9]+)\n%%EOF\n$/,
  );
  assert.ok(ending);
  const xref = Number(ending[1]);
  assert.ok(
    Number.isSafeInteger(xref) &&
      xref > 0 &&
      text.slice(xref).startsWith("xref\n0 6\n"),
  );
  const table = text.slice(xref).split("\n");
  assert.equal(table[2], "0000000000 65535 f ");
  for (let i = 1; i <= 5; i++) {
    const line = table[i + 2];
    assert.match(line, /^[0-9]{10} 00000 n $/);
    assert.ok(text.slice(Number(line.slice(0, 10))).startsWith(`${i} 0 obj\n`));
  }
  assert.equal((text.match(/\n[1-5] 0 obj\n/g) || []).length, 5);
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 1);
  const stream = text.match(
    /<< \/Length ([0-9]+) >>\nstream\n([^]*?)endstream/,
  );
  assert.ok(stream);
  assert.equal(Buffer.byteLength(stream[2]), Number(stream[1]));
  assert.ok(stream[2].includes("(Native Share owned PDF 20261021) Tj"));
  assert.ok(
    bytes.equals(createShareArtifactPdf().bytes),
    "Only the fixed owned source PDF is in this case",
  );
  return {
    fileName: "native-share-proof.pdf",
    sizeBytes: bytes.length,
    sha256: sha(bytes),
    pageCount: 1,
    objectCount: 5,
    xrefOffset: xref,
  };
}
export function assertShareArtifactUpload(body) {
  assert.ok(
    body && typeof body === "object" && typeof body.content_base64 === "string",
  );
  const b = Buffer.from(body.content_base64, "base64");
  assert.equal(b.toString("base64"), body.content_base64);
  const pdf = inspectShareArtifactPdf(b),
    d = body.descriptor;
  assert.ok(d && typeof d === "object");
  for (const [key, value] of Object.entries({
    artifact_type: "pdf",
    extension: "pdf",
    mime_type: "application/pdf",
    display_name: pdf.fileName,
    size_bytes: pdf.sizeBytes,
    sha256: pdf.sha256,
  }))
    assert.equal(d[key], value);
  assert.match(d.artifact_id, /^[A-Za-z0-9._~-]{1,128}$/);
  assert.equal(d.ref, "zcode-artifact://share/" + d.artifact_id);
  return { ...pdf, artifactId: d.artifact_id };
}
