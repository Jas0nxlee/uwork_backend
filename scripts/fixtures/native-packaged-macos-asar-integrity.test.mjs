import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertMacAsarHeaderEvidence,
  HEADER_ALGORITHM,
} from "./native-packaged-macos-asar-integrity.mjs";
function fixture() {
  const header = '{ "files": {"中文😀": { "size": 3 }} }';
  const bytes = Buffer.byteLength(header),
    sha256 = createHash("sha256").update(header, "utf8").digest("hex");
  const pickleBytes = 4 + 4 + Math.ceil((bytes + 1) / 4) * 4;
  return {
    builderHeader: header,
    electronHeader: header,
    pickleBytes,
    info: {
      ElectronAsarIntegrity: {
        "Resources/app.asar": { algorithm: "SHA256", hash: sha256 },
      },
    },
    expected: {
      algorithm: HEADER_ALGORITHM,
      headerUtf8Bytes: bytes,
      pickleBytes,
      sha256,
      declaredHashMatches: true,
      twoInstalledReadersMatch: true,
    },
  };
}
test("raw UTF8 Unicode and whitespace are hashed exactly rather than normalized JSON/padding", () => {
  const f = fixture();
  assert.deepEqual(assertMacAsarHeaderEvidence(f), f.expected);
  assert.notEqual(
    f.expected.sha256,
    createHash("sha256")
      .update(JSON.stringify(JSON.parse(f.builderHeader)))
      .digest("hex"),
  );
});
test("stale declaration, wrong algorithm, reader drift or claimed hash mismatch reject", () => {
  for (const edit of [
    (f) =>
      (f.info.ElectronAsarIntegrity["Resources/app.asar"].hash = "0".repeat(
        64,
      )),
    (f) =>
      (f.info.ElectronAsarIntegrity["Resources/app.asar"].algorithm = "SHA1"),
    (f) => (f.electronHeader += " "),
    (f) => (f.expected.sha256 = "0".repeat(64)),
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => assertMacAsarHeaderEvidence(f));
  }
});
test("missing declaration, bad header and incorrect pickle envelope cannot pass", () => {
  for (const edit of [
    (f) => (f.info = {}),
    (f) => (f.builderHeader = "{"),
    (f) => (f.pickleBytes = 4),
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => assertMacAsarHeaderEvidence(f));
  }
});
