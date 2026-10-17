import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  copyNativeCandidateSnapshot,
  validateNativeCandidateInventory,
} from "./native-candidate-snapshot.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const seal = (object) => {
  const inventoryBytes = Buffer.from(JSON.stringify(object));
  return { inventoryBytes, expectedInventorySha256: sha(inventoryBytes) };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "native-candidate-snapshot-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    ownedRoot = join(root, "owned"),
    target = join(ownedRoot, "app", "out");
  await mkdir(source);
  await mkdir(join(ownedRoot, "app"), { recursive: true });
  const files = {
    ".hidden": "hidden",
    "main/index.js": "const main = 1;\n",
    "renderer/index.html": Buffer.from([0, 1, 255]),
    "renderer/assets/listed 3.js3.map":
      "This suffix is part of the accepted candidate.",
  };
  const entries = [],
    dirs = new Set();
  for (const [path, value] of Object.entries(files)) {
    const bytes = Buffer.from(value);
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes, { mode: 0o640 });
    entries.push({
      path,
      kind: "file",
      bytes: bytes.length,
      sourceSha256: sha(bytes),
      targetSha256: sha(bytes),
    });
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent))
      dirs.add(parent);
  }
  const inventory = {
    sourceRoot: source,
    targetRoot: "/historical/owned/app/out",
    verified: true,
    regularFiles: entries.length,
    symlinks: 0,
    directories: dirs.size,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    copyMs: 1,
    totalMs: 2,
    entries,
  };
  return {
    root,
    source,
    ownedRoot,
    target,
    files,
    inventory,
    request: () => ({ source, ownedRoot, ...seal(inventory) }),
  };
}
const absent = async (path) => assert.rejects(lstat(path), { code: "ENOENT" });

test("copies every accepted byte including hidden/suffix names; extras are metadata only", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "unlisted 3.js"), "EXTRA_NOT_TO_READ", {
    mode: 0,
  });
  await mkdir(join(f.source, "unlisted-dir"));
  await mkdir(join(f.source, "empty-extra"));
  await writeFile(
    join(f.source, "unlisted-dir", "another.js3.map"),
    "EXTRA_NOT_TO_COPY",
  );
  const external = join(f.root, "outside.txt");
  await writeFile(external, "OUTSIDE");
  await symlink(external, join(f.source, "unlisted-link"));
  const started = [];
  const result = await copyNativeCandidateSnapshot({
    ...f.request(),
    copyFileImpl: async (src, dst, flags) => {
      started.push(src);
      assert.ok(
        Object.keys(f.files).some((path) => join(f.source, path) === src),
      );
      assert.equal(flags, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      await copyFile(src, dst, flags);
    },
  });
  assert.equal(result.verified, true);
  assert.equal(result.sourceMetadataPhase, "before-copy");
  assert.equal(result.entries.length, 4);
  assert.equal(started.length, 4);
  assert.deepEqual(result.extraSourceEntries, {
    regularFiles: 2,
    symlinks: 1,
    directories: 2,
    other: 0,
    total: 5,
  });
  for (const [path, value] of Object.entries(f.files)) {
    assert.deepEqual(await readFile(join(f.target, path)), Buffer.from(value));
    assert.equal((await lstat(join(f.target, path))).mode & 0o777, 0o640);
  }
  assert.equal((await readdir(f.target, { recursive: true })).length, 7);
  await absent(join(f.target, "unlisted 3.js"));
  await absent(join(f.target, "unlisted-link"));
  assert.equal(await readFile(external, "utf8"), "OUTSIDE");
  assert.ok(
    result.entries.every(
      (e) =>
        e.sourceSha256 === e.targetSha256 &&
        e.targetSha256 === e.expectedSha256,
    ),
  );
});

test("raw checksum tamper rejects before target creation or copy dispatch", async (t) => {
  const f = await fixture(t),
    request = f.request();
  let copies = 0;
  request.inventoryBytes[0] ^= 1;
  await assert.rejects(
    copyNativeCandidateSnapshot({
      ...request,
      copyFileImpl: async () => {
        copies++;
      },
    }),
    /inventory/i,
  );
  assert.equal(copies, 0);
  await absent(f.target);
});

test("rejects malformed shape, hash/count/byte/directory bounds and file-dir collisions", async (t) => {
  const f = await fixture(t);
  const mutations = [
    (x) => {
      x.verified = false;
    },
    (x) => {
      x.symlinks = 1;
    },
    (x) => {
      x.regularFiles++;
    },
    (x) => {
      x.bytes++;
    },
    (x) => {
      x.directories++;
    },
    (x) => {
      x.entries[0].bytes = -1;
    },
    (x) => {
      x.entries[0].bytes = 64 * 1024 * 1024 + 1;
    },
    (x) => {
      x.entries[0].kind = "symlink";
    },
    (x) => {
      x.entries[0].targetSha256 = "0".repeat(64);
    },
    (x) => {
      x.entries[0].sourceSha256 = "ABC";
    },
    (x) => {
      x.entries[1].path = x.entries[0].path;
    },
    (x) => {
      x.entries[0].path = "main";
    },
    (x) => {
      x.regularFiles = 20001;
    },
    (x) => {
      x.copyMs = null;
    },
    (x) => {
      x.unknown = true;
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(f.inventory);
    mutate(value);
    await assert.rejects(
      copyNativeCandidateSnapshot({
        source: f.source,
        ownedRoot: f.ownedRoot,
        ...seal(value),
      }),
    );
    await absent(f.target);
  }
});

test("rejects rooted, noncanonical, duplicate and escaping inventory paths", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "",
    "/outside",
    "../escape",
    "main/../escape",
    "main//index.js",
    "main/./index.js",
    "main\\index.js",
    "C:/escape",
    "main/",
    "main/\0file",
    "x".repeat(4097),
  ]) {
    const value = structuredClone(f.inventory);
    value.entries[0].path = path;
    await assert.rejects(
      copyNativeCandidateSnapshot({
        source: f.source,
        ownedRoot: f.ownedRoot,
        ...seal(value),
      }),
    );
    await absent(f.target);
  }
});

test("changed listed bytes cannot pass the expected-source-destination triple check", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "main/index.js"), "const main = 2;\n");
  await assert.rejects(copyNativeCandidateSnapshot(f.request()), /mismatch/);
});

test("destination corruption rejects even when every current source still matches expected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    copyNativeCandidateSnapshot({
      ...f.request(),
      copyFileImpl: async (src, dst, flags) => {
        await copyFile(src, dst, flags);
        if (src.endsWith(".hidden")) await writeFile(dst, "TAMPER");
      },
    }),
    /checksum mismatch/,
  );
  assert.equal(await readFile(join(f.source, ".hidden"), "utf8"), "hidden");
});

test("missing, symlinked or nonregular listed files reject without following outside", async (t) => {
  for (const kind of ["missing", "symlink", "directory"]) {
    const f = await fixture(t),
      file = join(f.source, ".hidden");
    await rm(file);
    if (kind === "symlink") {
      const external = join(f.root, "external");
      await writeFile(external, "SECRET_OUTSIDE");
      await symlink(external, file);
    }
    if (kind === "directory") await mkdir(file);
    await assert.rejects(copyNativeCandidateSnapshot(f.request()));
    await absent(f.target);
  }
});

test("listed parent aliases, foreign inventory source and aliased owner/app are refused", async (t) => {
  const f = await fixture(t),
    external = join(f.root, "external");
  await mkdir(external);
  await rm(join(f.source, "main"), { recursive: true });
  await symlink(external, join(f.source, "main"));
  await assert.rejects(copyNativeCandidateSnapshot(f.request()));
  await absent(f.target);
  const g = await fixture(t);
  const wrong = structuredClone(g.inventory);
  wrong.sourceRoot = external;
  await assert.rejects(
    copyNativeCandidateSnapshot({ ...g.request(), ...seal(wrong) }),
  );
  await absent(g.target);
  const sourceAlias = join(g.root, "source-alias");
  await symlink(g.source, sourceAlias, "dir");
  await assert.rejects(
    copyNativeCandidateSnapshot({
      ...g.request(),
      source: sourceAlias,
      ...seal({ ...g.inventory, sourceRoot: sourceAlias }),
    }),
  );
  await absent(g.target);
  const alias = join(g.root, "owner-alias");
  await symlink(g.ownedRoot, alias, "dir");
  await assert.rejects(
    copyNativeCandidateSnapshot({ ...g.request(), ownedRoot: alias }),
  );
  await rm(join(g.ownedRoot, "app"), { recursive: true });
  await symlink(external, join(g.ownedRoot, "app"), "dir");
  await assert.rejects(copyNativeCandidateSnapshot(g.request()));
});

test("fresh target only and disjoint source/owner; existing target bytes survive", async (t) => {
  const f = await fixture(t);
  await mkdir(f.target);
  await writeFile(join(f.target, "sentinel"), "KEEP");
  await assert.rejects(copyNativeCandidateSnapshot(f.request()), /fresh/);
  assert.equal(await readFile(join(f.target, "sentinel"), "utf8"), "KEEP");
  const nested = join(f.source, "nested-owner");
  await mkdir(join(nested, "app"), { recursive: true });
  await assert.rejects(
    copyNativeCandidateSnapshot({ ...f.request(), ownedRoot: nested }),
    /overlap|inside/,
  );
});

test("captures raw inventory before asynchronous filesystem work", async (t) => {
  const f = await fixture(t),
    request = f.request();
  const operation = copyNativeCandidateSnapshot(request);
  request.inventoryBytes.fill(0);
  await operation;
  assert.deepEqual(
    await readFile(join(f.target, "main/index.js")),
    Buffer.from(f.files["main/index.js"]),
  );
});

test("concurrent failure drains a held real copy before rejection and starts no later copy", async (t) => {
  const f = await fixture(t),
    held = deferred(),
    failed = deferred(),
    release = deferred(),
    finished = [];
  const started = [];
  let settled = false;
  const operation = copyNativeCandidateSnapshot({
    ...f.request(),
    concurrency: 2,
    copyFileImpl: async (src, dst, flags) => {
      started.push(src);
      if (src.endsWith(".hidden")) {
        await held.promise;
        failed.resolve();
        throw Error("owned injected copy failure");
      }
      held.resolve();
      await release.promise;
      await copyFile(src, dst, flags);
      finished.push(dst);
    },
  });
  operation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await failed.promise;
  await new Promise((done) => setImmediate(done));
  assert.equal(settled, false);
  assert.equal(started.length, 2);
  const rejected = assert.rejects(operation, /owned injected copy failure/);
  release.resolve();
  await rejected;
  assert.equal(finished.length, 1);
  assert.equal(started.length, 2);
  const snapshot = await readdir(f.target, { recursive: true });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(await readdir(f.target, { recursive: true }), snapshot);
});

test("pure validation requires raw bytes, lowercase pinned hash and valid UTF8 JSON", async (t) => {
  const f = await fixture(t),
    sealed = seal(f.inventory);
  const parsed = validateNativeCandidateInventory({
    source: f.source,
    ...sealed,
  });
  assert.equal(parsed.entries.length, 4);
  for (const request of [
    { ...sealed, inventoryBytes: "not raw bytes" },
    {
      ...sealed,
      expectedInventorySha256: sealed.expectedInventorySha256.toUpperCase(),
    },
    {
      inventoryBytes: Buffer.from([255]),
      expectedInventorySha256: sha(Buffer.from([255])),
    },
    {
      inventoryBytes: Buffer.alloc(8 * 1024 * 1024 + 1),
      expectedInventorySha256: "0".repeat(64),
    },
  ])
    assert.throws(() =>
      validateNativeCandidateInventory({ source: f.source, ...request }),
    );
});
