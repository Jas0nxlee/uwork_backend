/** Build the current admin into a fresh owned snapshot; keep the normal dist intact. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { build } from "vite";

assert.match(process.versions.node, /^24\./);
const repository = process.cwd();
const base = resolve("evidence/client-experience-20261017");
const run =
  "owned-history-" +
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomBytes(3).toString("hex");
const root = join(base, run),
  outDir = join(root, "admin/dist"),
  emptyEnv = join(root, "empty-env");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function tree(directory) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...(await tree(path)));
    else {
      assert.ok(entry.isFile() && !entry.isSymbolicLink());
      rows.push({
        path: relative(repository, path),
        bytes: (await readFile(path)).length,
        sha256: sha(await readFile(path)),
      });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
async function sources() {
  const rows = [
    ...(await tree(resolve("admin/src"))),
    ...(await tree(resolve("admin/public"))),
  ];
  for (const path of [
    "admin/index.html",
    "admin/vite.config.ts",
    "admin/tsconfig.json",
    "package.json",
    "package-lock.json",
    "src/client-experience.ts",
  ])
    rows.push({ path, sha256: sha(await readFile(path)) });
  return rows
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
const before = await sources(),
  mainBefore = await tree(resolve("admin/dist"));
const manifestPath = join(base, "owned-admin-artifacts.json");
const previous = await readFile(manifestPath);
await mkdir(root, { mode: 0o700 });
await mkdir(emptyEnv, { mode: 0o700 });
await writeFile(join(root, "previous-owned-admin-artifacts.json"), previous, {
  mode: 0o600,
  flag: "wx",
});
await build({
  configFile: resolve("admin/vite.config.ts"),
  envDir: emptyEnv,
  build: { outDir, emptyOutDir: false },
});
assert.deepEqual(
  await sources(),
  before,
  "admin sources changed during owned build",
);
assert.deepEqual(
  await tree(resolve("admin/dist")),
  mainBefore,
  "normal admin dist must remain unchanged",
);
const ownedAssets = (await tree(outDir)).map((row) => ({
  ...row,
  path: relative(outDir, resolve(row.path)),
}));
assert.ok(ownedAssets.length > 0 && ownedAssets.length <= 100);
const manifest = {
  outDir,
  emptyEnv,
  mainAssetsUnchanged: true,
  mainBefore,
  ownedAssets,
  node: process.version,
  sources: before,
  reason: "normal fresh Vite build for current prepublish linkage sources",
};
await writeFile(
  join(root, "owned-admin-artifacts.json"),
  JSON.stringify(manifest, null, 2),
  { mode: 0o600, flag: "wx" },
);
const pending = join(root, "manifest-pending.json");
await writeFile(pending, JSON.stringify(manifest, null, 2), {
  mode: 0o600,
  flag: "wx",
});
await rename(pending, manifestPath);
console.log(
  JSON.stringify({
    status: "built",
    outDir,
    sourceFiles: before.length,
    assetFiles: ownedAssets.length,
    mainAssetsUnchanged: true,
    previousManifestRetained: true,
  }),
);
