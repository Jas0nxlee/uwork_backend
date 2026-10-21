/** Pure two-file package and owned-loopback routes; never starts a listener or installer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const records = new WeakMap();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const pluginName = "uwork-native-bridge-plugin";
const marketplaceName = "uwork-native-bridge-market";
const version = "1.0.0";
const paths = Object.freeze({
  manifest: ".zcode-plugin/plugin.json",
  skill: "skills/bridge/SKILL.md",
  marketplace: "/owned-native-skill/marketplace.json",
  archive: "/plugin.zip",
});
const manifest = Object.freeze({
  name: pluginName,
  version,
  description: "Owned static text Skill",
  skills: Object.freeze(["./skills"]),
});
const skillText =
  "---\nname: bridge\ndescription: Read-only native acceptance note\n---\nRead-only local acceptance note.\nUWORK_NATIVE_PLUGIN_SKILL_BODY_20261021\n";
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  let offset = 0;
  const bodies = [],
    entries = [];
  for (const [name, value] of files) {
    const filename = Buffer.from(name),
      content = Buffer.from(value),
      crc = crc32(content);
    const local = Buffer.alloc(30),
      central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    bodies.push(local, filename, content);
    entries.push(central, filename);
    offset += local.length + filename.length + content.length;
  }
  const directory = Buffer.concat(entries),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, directory, end]);
}
export function createMacPluginSkillPackage() {
  const manifestText = JSON.stringify(manifest);
  const files = [
    [paths.manifest, manifestText],
    [paths.skill, skillText],
  ];
  const bytes = zip(files);
  const counts = {
    marketplaceGet200: 0,
    marketplaceHead200: 0,
    pluginGet200: 0,
    pluginHead200: 0,
  };
  const artifact = Object.freeze({
    get bytes() {
      return Buffer.from(bytes);
    },
    sha256: hash(bytes),
    manifest,
    manifestSha256: hash(manifestText),
    skillText,
    skillSha256: hash(skillText),
    pluginName,
    marketplaceName,
    version,
    skillName: "bridge",
    installId: pluginName + "@" + marketplaceName,
    qualifiedSkill: pluginName + ":bridge",
    paths,
    files: Object.freeze(
      files.map(([path, text]) =>
        Object.freeze({
          path,
          bytes: Buffer.byteLength(text),
          sha256: hash(text),
          mode: 0o100644,
        }),
      ),
    ),
    get counts() {
      return { ...counts };
    },
  });
  records.set(artifact, { bytes, counts });
  return artifact;
}
export function serveMacPluginSkillPackage(req, res, artifact, baseUrl) {
  const marketplace = req.url === paths.marketplace,
    archive = req.url === paths.archive;
  if (!(marketplace || archive) || !["GET", "HEAD"].includes(req.method))
    return false;
  const record = records.get(artifact);
  assert.ok(record, "Only this factory's owned package is accepted");
  const url = new URL(baseUrl);
  assert.ok(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      url.origin === baseUrl,
    "Canonical fixed owned supplier origin required",
  );
  const body = marketplace
    ? Buffer.from(
        JSON.stringify({
          name: marketplaceName,
          owner: { name: "Owned native Skill fixture" },
          plugins: [
            {
              name: pluginName,
              version,
              description: "Owned static text Skill",
              source: {
                source: "url",
                type: "zip",
                url: baseUrl + paths.archive,
                sha256: artifact.sha256,
              },
            },
          ],
        }),
      )
    : record.bytes;
  const key =
    (marketplace ? "marketplace" : "plugin") +
    (req.method === "HEAD" ? "Head200" : "Get200");
  assert.ok(
    record.counts[key] < 256,
    "Owned static package request bound exceeded",
  );
  record.counts[key]++;
  res.writeHead(200, {
    "content-type": marketplace
      ? "application/json; charset=utf-8"
      : "application/zip",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
