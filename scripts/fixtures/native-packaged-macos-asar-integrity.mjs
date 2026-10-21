/** Additional read-only admission. Never calls the production metadata writer or changes fuse/signature bytes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
const hostRequire = createRequire(
  new URL("../../clients/uwork/packages/desktop/package.json", import.meta.url),
);
export const HEADER_ALGORITHM =
  "SHA256 of original UTF8 JSON string bytes from Pickle ReadString; not envelope/padding/normalized JSON";
export function assertMacAsarHeaderEvidence({
  builderHeader,
  electronHeader,
  pickleBytes,
  info,
  expected,
}) {
  assert.equal(typeof builderHeader, "string");
  assert.equal(
    builderHeader,
    electronHeader,
    "Installed raw header readers must agree",
  );
  JSON.parse(builderHeader);
  const bytes = Buffer.byteLength(builderHeader, "utf8");
  assert.ok(bytes > 0 && bytes <= 16 * 1024 * 1024);
  assert.ok(
    Number.isSafeInteger(pickleBytes) &&
      pickleBytes >= bytes + 8 &&
      pickleBytes <= bytes + 12,
  );
  const sha256 = createHash("sha256")
    .update(builderHeader, "utf8")
    .digest("hex");
  const declared = info?.ElectronAsarIntegrity?.["Resources/app.asar"];
  assert.equal(declared?.algorithm, "SHA256");
  assert.equal(
    declared?.hash,
    sha256,
    "Final Info.plist declaration must equal exact raw UTF8 header SHA",
  );
  const actual = {
    algorithm: HEADER_ALGORITHM,
    headerUtf8Bytes: bytes,
    pickleBytes,
    sha256,
    declaredHashMatches: true,
    twoInstalledReadersMatch: true,
  };
  assert.deepEqual(actual, expected);
  return actual;
}
export async function verifyMacAsarHeaderAndFuses(
  appPath,
  expected,
  expectedFuses,
) {
  const asar = join(appPath, "Contents/Resources/app.asar"),
    handle = await open(asar, "r");
  try {
    const size = Buffer.alloc(8);
    assert.equal((await handle.read(size, 0, 8, 0)).bytesRead, 8);
    assert.ok(
      size.readUInt32LE(4) <= 16 * 1024 * 1024,
      "Bounded immutable ASAR header",
    );
  } finally {
    await handle.close();
  }
  const { readAsarHeader } = hostRequire("app-builder-lib/out/asar/asar.js"),
    { getRawHeader } = hostRequire("@electron/asar");
  const builder = await readAsarHeader(asar),
    electron = getRawHeader(asar);
  assert.equal(builder.size, electron.headerSize);
  const info = hostRequire("plist").parse(
    await readFile(join(appPath, "Contents/Info.plist"), "utf8"),
  );
  const actual = assertMacAsarHeaderEvidence({
    builderHeader: builder.header,
    electronHeader: electron.headerString,
    pickleBytes: builder.size,
    info,
    expected,
  });
  const fuses =
    await hostRequire("@electron/fuses").getCurrentFuseWire(appPath);
  assert.deepEqual(
    fuses,
    expectedFuses,
    "Actual original fuse wire must be preserved",
  );
  return { ...actual, originalFuseWireMatches: true };
}
