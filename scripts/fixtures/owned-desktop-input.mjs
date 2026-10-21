import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, lstat, readlink } from "node:fs/promises";
import { resolve, join, relative, dirname, sep } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function desktopInputHashes(repository) {
  const paths = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() || entry.isSymbolicLink()) paths.push(file);
      else throw Error("Unsupported desktop source input");
    }
  }
  for (const base of [
    "clients/uwork/packages",
    "clients/uwork/apps/zcode-cli/packages",
  ])
    for (const entry of await readdir(join(repository, base), {
      withFileTypes: true,
    }))
      if (entry.isDirectory()) {
        const folder = join(repository, base, entry.name, "src");
        try {
          await lstat(folder);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        await visit(folder);
      }
  for (const file of [
    "clients/uwork/package.json",
    "clients/uwork/pnpm-lock.yaml",
    "clients/uwork/packages/desktop/vite.config.ts",
    "clients/uwork/packages/desktop/tsup.config.ts",
  ])
    paths.push(join(repository, file));
  const rows = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < paths.length) {
        const file = paths[next++];
        const st = await lstat(file);
        rows.push({
          path: relative(repository, file),
          sha256: hash(
            st.isSymbolicLink() ? await readlink(file) : await readFile(file),
          ),
        });
      }
    }),
  );
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadOwnedDesktopInput({
  repository,
  manifestPath,
  cacheBase,
}) {
  repository = await realpath(repository);
  cacheBase = await realpath(cacheBase);
  const path = resolve(manifestPath);
  assert.equal(await realpath(path), path, "cache manifest must be canonical");
  assert.ok(
    path.startsWith(cacheBase + sep),
    "cache manifest outside owned base",
  );
  assert.equal((await lstat(dirname(path))).mode & 0o777, 0o700);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.repository, repository);
  const out = join(dirname(path), "app/out");
  assert.equal(manifest.snapshot.targetRoot, out);
  assert.equal(await realpath(out), out);
  assert.deepEqual(
    await desktopInputHashes(repository),
    manifest.inputs,
    "desktop sources differ from frozen build",
  );
  return {
    source: out,
    async verify(snapshot) {
      assert.deepEqual(
        snapshot.entries,
        manifest.snapshot.entries,
        "frozen desktop artifact bytes differ",
      );
      assert.equal(snapshot.directories, manifest.snapshot.directories);
      assert.deepEqual(
        await desktopInputHashes(repository),
        manifest.inputs,
        "desktop sources changed during snapshot",
      );
    },
  };
}
