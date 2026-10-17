import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyNativeOutSnapshot } from "./native-out-snapshot.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    ownedRoot = join(root, "owned");
  await mkdir(source);
  await mkdir(join(ownedRoot, "app"), { recursive: true });
  return { root, source, ownedRoot, target: join(ownedRoot, "app", "out") };
}

test("snapshot preserves all bytes, hidden files, empty directories and original cp link semantics", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "nested", "empty"), { recursive: true });
  await writeFile(join(f.source, "main.js"), Buffer.from([0, 1, 255, 12]));
  await writeFile(join(f.source, ".hidden.map"), "hidden source map");
  await writeFile(join(f.source, "nested", "asset 3.map"), "retained map");
  await symlink("../main.js", join(f.source, "nested", "relative-link"));
  await symlink(join(f.source, ".hidden.map"), join(f.source, "absolute-link"));
  const result = await copyNativeOutSnapshot({
    source: f.source,
    ownedRoot: f.ownedRoot,
  });
  assert.equal(result.regularFiles, 3);
  assert.equal(result.symlinks, 2);
  assert.equal(result.verified, true);
  assert.deepEqual(
    await readFile(join(f.target, "main.js")),
    Buffer.from([0, 1, 255, 12]),
  );
  assert.equal(
    await readFile(join(f.target, ".hidden.map"), "utf8"),
    "hidden source map",
  );
  assert.equal(
    await readFile(join(f.target, "nested", "asset 3.map"), "utf8"),
    "retained map",
  );
  assert.equal(
    await readlink(join(f.target, "nested", "relative-link")),
    join(f.source, "main.js"),
  );
  assert.equal(
    await readlink(join(f.target, "absolute-link")),
    join(f.source, ".hidden.map"),
  );
  await mkdir(join(f.target, "nested", "empty", "proof"));
});

test("snapshot refuses an existing target and a destination inside its source", async (t) => {
  const f = await fixture(t);
  await mkdir(f.target);
  await writeFile(join(f.target, "sentinel"), "preserve");
  await assert.rejects(
    copyNativeOutSnapshot({ source: f.source, ownedRoot: f.ownedRoot }),
    { code: "EEXIST" },
  );
  assert.equal(await readFile(join(f.target, "sentinel"), "utf8"), "preserve");
  const nestedOwner = join(f.source, "owned");
  await mkdir(join(nestedOwner, "app"), { recursive: true });
  await assert.rejects(
    copyNativeOutSnapshot({ source: f.source, ownedRoot: nestedOwner }),
    /inside source/,
  );
});

test("snapshot stops new copies on first failure and drains already-started IO before rejecting", async (t) => {
  const f = await fixture(t);
  for (const name of ["a", "b", "c", "d"])
    await writeFile(join(f.source, name), name);
  const started = [],
    completed = [];
  let releaseFailure;
  const failureReady = new Promise((resolve) => {
    releaseFailure = resolve;
  });
  await assert.rejects(
    copyNativeOutSnapshot({
      source: f.source,
      ownedRoot: f.ownedRoot,
      concurrency: 2,
      copyFileImpl: async (src, dst, flags) => {
        const name = src.slice(-1);
        started.push(name);
        assert.equal(
          flags,
          constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL,
        );
        if (name === "a") {
          await failureReady;
          throw Error("controlled copy failure");
        }
        releaseFailure();
        await new Promise((resolve) => setTimeout(resolve, 10));
        await copyFile(src, dst, flags);
        completed.push(name);
      },
    }),
    /controlled copy failure/,
  );
  assert.deepEqual(started, ["a", "b"]);
  assert.deepEqual(completed, ["b"]);
  assert.equal(await readFile(join(f.target, "b"), "utf8"), "b");
});

test("snapshot rejects a successful copy API that returned different file bytes", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "main.js"), "expected");
  await assert.rejects(
    copyNativeOutSnapshot({
      source: f.source,
      ownedRoot: f.ownedRoot,
      copyFileImpl: async (_src, dst) =>
        writeFile(dst, "wrong", { flag: "wx" }),
    }),
    /verification mismatch/,
  );
});
