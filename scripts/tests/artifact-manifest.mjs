import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const client = resolve(dirname(fileURLToPath(import.meta.url)), "../../clients/uwork");
const namespaces = {
  cli: "apps/zcode-cli/packages/cli/dist",
  "staged-cli": "packages/desktop/bundled-agents/darwin-arm64/glm",
  server: "packages/server/dist",
  web: "packages/web/dist",
  desktop: "packages/desktop/out",
  "server-cli": "packages/zcode-server-cli/dist",
};

async function walk(root) {
  const out = [];
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        out.push({ path: full, link: true, target: (await lstat(full)).isSymbolicLink() });
        continue;
      }
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push({ path: full, link: false });
    }
  };
  await visit(root);
  return out;
}

const result = {};
for (const [name, relativePath] of Object.entries(namespaces)) {
  const root = join(client, relativePath);
  const files = (await walk(root)).sort((a, b) => a.path.localeCompare(b.path));
  const entries = [];
  let bytes = 0;
  let links = 0;
  for (const file of files) {
    if (file.link) {
      links += 1;
      continue;
    }
    const content = await readFile(file.path);
    bytes += content.length;
    entries.push({
      path: relative(root, file.path),
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  result[name] = { path: relativePath, fileCount: entries.length, linkCount: links, bytes, files: entries };
  console.log(`${name}: ${entries.length} files, ${links} links, ${bytes} bytes`);
}

const target = process.argv[2];
if (!target) throw Error("Pass an output json path");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(result, null, 1));
console.log(`written ${target}`);
