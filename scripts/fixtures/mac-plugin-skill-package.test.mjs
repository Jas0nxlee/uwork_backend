import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { crc32 } from "node:zlib";
import test from "node:test";
import {
  createMacPluginSkillPackage,
  serveMacPluginSkillPackage,
} from "./mac-plugin-skill-package.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const origin = "http://127.0.0.1:43123";
const yauzl = createRequire(
  new URL(
    "../../clients/uwork/apps/zcode-cli/packages/adapters/package.json",
    import.meta.url,
  ),
)("yauzl");
function response() {
  return {
    headers: null,
    status: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    },
  };
}
function entries(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 2);
  let offset = bytes.readUInt32LE(end + 16);
  const result = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const size = bytes.readUInt32LE(offset + 24),
      length = bytes.readUInt16LE(offset + 28);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString();
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    assert.equal(bytes.readUInt16LE(local + 26), length);
    assert.equal(bytes.readUInt32LE(local + 22), size);
    const start = local + 30 + length;
    result.push({ name, mode, body: bytes.subarray(start, start + size) });
    offset += 46 + length;
  }
  assert.equal(offset, end);
  return result;
}
test("deterministic archive contains only two regular files with exact manifest and readonly Skill", () => {
  const a = createMacPluginSkillPackage(),
    b = createMacPluginSkillPackage();
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.sha256, sha(a.bytes));
  const files = entries(a.bytes);
  assert.deepEqual(
    files.map((f) => [f.name, f.mode]),
    [
      [a.paths.manifest, 0o100644],
      [a.paths.skill, 0o100644],
    ],
  );
  assert.deepEqual(JSON.parse(files[0].body), {
    name: "uwork-native-bridge-plugin",
    version: "1.0.0",
    description: "Owned static text Skill",
    skills: ["./skills"],
  });
  assert.equal(files[0].body.toString(), JSON.stringify(a.manifest));
  assert.equal(a.manifestSha256, sha(files[0].body));
  assert.equal(a.skillSha256, sha(files[1].body));
  assert.equal(files[1].body.toString(), a.skillText);
  assert.match(
    a.skillText,
    /^---\nname: bridge\ndescription: Read-only native acceptance note\n---\n/,
  );
  assert.equal(
    a.skillText.split("UWORK_NATIVE_PLUGIN_SKILL_BODY_20261021").length,
    2,
  );
  assert.equal(
    a.installId,
    "uwork-native-bridge-plugin@uwork-native-bridge-market",
  );
  assert.equal(a.qualifiedSkill, "uwork-native-bridge-plugin:bridge");
});
test("original CLI ZIP reader consumes both exact files and independent builtin CRC validates them", async () => {
  const a = createMacPluginSkillPackage();
  const read = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(a.bytes, { lazyEntries: true }, (error, zip) =>
      error ? reject(error) : resolve(zip),
    ),
  );
  const found = [];
  await new Promise((resolve, reject) => {
    read.on("error", reject);
    read.on("end", resolve);
    read.on("entry", (entry) =>
      read.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = [];
        stream.on("error", reject);
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          try {
            const body = Buffer.concat(chunks);
            assert.equal(crc32(body), entry.crc32);
            found.push({ path: entry.fileName, sha256: sha(body) });
            read.readEntry();
          } catch (failure) {
            reject(failure);
          }
        });
      }),
    );
    read.readEntry();
  });
  assert.deepEqual(
    found,
    a.files.map(({ path, sha256 }) => ({ path, sha256 })),
  );
});
test("exact GET metadata uses fixed loopback origin, original URL-zip schema and archive hash", () => {
  const a = createMacPluginSkillPackage(),
    r = response();
  assert.equal(
    serveMacPluginSkillPackage(
      {
        method: "GET",
        url: a.paths.marketplace,
        headers: { host: "evil.invalid" },
      },
      r,
      a,
      origin,
    ),
    true,
  );
  assert.equal(r.status, 200);
  assert.equal(Number(r.headers["content-length"]), r.body.length);
  const metadata = JSON.parse(r.body);
  assert.equal(metadata.name, "uwork-native-bridge-market");
  assert.equal(metadata.plugins.length, 1);
  assert.deepEqual(metadata.plugins[0].source, {
    source: "url",
    type: "zip",
    url: origin + "/plugin.zip",
    sha256: a.sha256,
  });
  assert.equal(metadata.plugins[0].name, a.pluginName);
  assert.ok(!r.body.includes("evil.invalid"));
});
test("GET archive and HEAD both routes preserve exact lengths while HEAD sends zero bytes", () => {
  const a = createMacPluginSkillPackage(),
    get = response();
  assert.equal(
    serveMacPluginSkillPackage(
      { method: "GET", url: a.paths.archive },
      get,
      a,
      origin,
    ),
    true,
  );
  assert.deepEqual(get.body, a.bytes);
  for (const path of [a.paths.archive, a.paths.marketplace]) {
    const g = response(),
      h = response();
    serveMacPluginSkillPackage({ method: "GET", url: path }, g, a, origin);
    assert.equal(
      serveMacPluginSkillPackage({ method: "HEAD", url: path }, h, a, origin),
      true,
    );
    assert.equal(h.status, 200);
    assert.equal(h.headers["content-length"], g.headers["content-length"]);
    assert.equal(h.body.length, 0);
  }
});
test("foreign routes, queries and methods are not intercepted or counted", () => {
  const a = createMacPluginSkillPackage();
  for (const [method, url] of [
    ["GET", "/"],
    ["GET", "/v1/models"],
    ["POST", "/v1/chat/completions"],
    ["POST", a.paths.archive],
    ["GET", a.paths.archive + "?x=1"],
    ["GET", a.paths.marketplace + "/"],
  ]) {
    const r = response();
    assert.equal(
      serveMacPluginSkillPackage({ method, url }, r, a, origin),
      false,
    );
    assert.equal(r.status, null);
  }
  assert.equal(
    Object.values(a.counts).reduce((x, y) => x + y, 0),
    0,
  );
});
test("noncanonical or foreign origins and forged artifacts fail before response mutation", () => {
  const a = createMacPluginSkillPackage();
  for (const base of [
    "http://example.test:43123",
    "http://localhost:43123",
    "http://127.0.0.1:43123/",
    "http://127.0.0.1:43123/path",
    "http://user@127.0.0.1:43123",
    "http://127.0.0.1:43123?x=1",
    "https://127.0.0.1:43123",
  ]) {
    const r = response();
    assert.throws(() =>
      serveMacPluginSkillPackage(
        { method: "GET", url: a.paths.archive },
        r,
        a,
        base,
      ),
    );
    assert.equal(r.status, null);
  }
  assert.throws(() =>
    serveMacPluginSkillPackage(
      { method: "GET", url: a.paths.archive },
      response(),
      { ...a },
      origin,
    ),
  );
});
test("returned archive copies and counters cannot alter sealed bytes or observed counts", () => {
  const a = createMacPluginSkillPackage(),
    original = a.bytes;
  a.bytes.fill(0);
  assert.deepEqual(a.bytes, original);
  const c = a.counts;
  c.pluginGet200 = 100;
  const r = response();
  serveMacPluginSkillPackage(
    { method: "GET", url: a.paths.archive },
    r,
    a,
    origin,
  );
  assert.equal(a.counts.pluginGet200, 1);
  assert.equal(sha(r.body), a.sha256);
});
