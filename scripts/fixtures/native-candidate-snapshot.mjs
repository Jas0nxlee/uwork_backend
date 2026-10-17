import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_INVENTORY_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_SOURCE_ENTRIES = 100000;
const HASH = /^[a-f0-9]{64}$/;
const COPY_FLAGS = constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, reason) => {
  if (!condition) throw Error("Invalid candidate inventory: " + reason);
};
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const absolute = (value) =>
  typeof value === "string" &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  isAbsolute(value) &&
  resolve(value) === value;
const contains = (parent, child) => {
  const value = relative(parent, child);
  return (
    value === "" ||
    (value !== ".." && !value.startsWith(".." + sep) && !isAbsolute(value))
  );
};
const disjoint = (left, right) =>
  !contains(left, right) && !contains(right, left);

/** Pure validation of the original, independently pinned full snapshot inventory. */
export function validateNativeCandidateInventory({
  inventoryBytes,
  expectedInventorySha256,
  source,
}) {
  requireValue(
    inventoryBytes instanceof Uint8Array &&
      inventoryBytes.byteLength > 0 &&
      inventoryBytes.byteLength <= MAX_INVENTORY_BYTES,
    "raw byte bound",
  );
  // 调用方后续修改原Buffer不能改变已准入的清单；SHA在任何FS等待之前核验。
  const raw = Buffer.from(inventoryBytes);
  requireValue(
    typeof expectedInventorySha256 === "string" &&
      HASH.test(expectedInventorySha256) &&
      hash(raw) === expectedInventorySha256,
    "raw inventory checksum",
  );
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw Error("Invalid candidate inventory: UTF8 JSON");
  }
  requireValue(
    exactKeys(value, [
      "sourceRoot",
      "targetRoot",
      "verified",
      "regularFiles",
      "symlinks",
      "directories",
      "bytes",
      "copyMs",
      "totalMs",
      "entries",
    ]),
    "snapshot shape",
  );
  requireValue(
    absolute(source) &&
      value.sourceRoot === source &&
      absolute(value.targetRoot) &&
      disjoint(source, value.targetRoot),
    "sourceRoot or historical target shape",
  );
  requireValue(
    value.verified === true && value.symlinks === 0,
    "only verified regular-file candidates are supported",
  );
  requireValue(
    integer(value.regularFiles, MAX_FILES) &&
      value.regularFiles > 0 &&
      Array.isArray(value.entries) &&
      value.entries.length === value.regularFiles,
    "file count",
  );
  requireValue(
    integer(value.directories, MAX_FILES) &&
      integer(value.bytes, MAX_TOTAL_BYTES) &&
      integer(value.copyMs) &&
      integer(value.totalMs) &&
      value.totalMs >= value.copyMs,
    "snapshot bounds",
  );
  const paths = new Set(),
    directories = new Set(),
    entries = [];
  let bytes = 0;
  for (const entry of value.entries) {
    requireValue(
      exactKeys(entry, [
        "path",
        "kind",
        "bytes",
        "sourceSha256",
        "targetSha256",
      ]),
      "entry shape",
    );
    const path = entry.path;
    requireValue(
      typeof path === "string" &&
        path.length > 0 &&
        Buffer.byteLength(path) <= 4096 &&
        !/[\x00-\x1f\x7f\\:]/.test(path) &&
        !isAbsolute(path),
      "relative path",
    );
    requireValue(
      path
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            Buffer.byteLength(part) <= 255,
        ),
      "canonical path segments",
    );
    requireValue(
      relative(source, join(source, path)) === path && !paths.has(path),
      "path containment or duplicate",
    );
    requireValue(
      entry.kind === "file" &&
        integer(entry.bytes, MAX_FILE_BYTES) &&
        typeof entry.sourceSha256 === "string" &&
        HASH.test(entry.sourceSha256) &&
        entry.sourceSha256 === entry.targetSha256,
      "regular file/hash/byte bound",
    );
    paths.add(path);
    bytes += entry.bytes;
    requireValue(bytes <= MAX_TOTAL_BYTES, "aggregate byte bound");
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent))
      directories.add(parent);
    entries.push({
      path,
      bytes: entry.bytes,
      expectedSha256: entry.sourceSha256,
    });
  }
  requireValue(
    ![...directories].some((path) => paths.has(path)),
    "file/directory conflict",
  );
  requireValue(
    bytes === value.bytes && directories.size === value.directories,
    "aggregate bytes or derived directories",
  );
  return {
    sourceRoot: source,
    inventorySha256: expectedInventorySha256,
    bytes,
    directories: [...directories].sort(),
    entries,
  };
}

async function directory(path) {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(path)) !== path
  )
    throw Error("Snapshot directory must be canonical and not a symlink");
}
async function file(path, bytes) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.size !== bytes ||
    (await realpath(path)) !== path
  )
    throw Error("Snapshot listed file type, containment or byte mismatch");
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw Error("Snapshot target must be fresh");
}
async function bounded(jobs, concurrency, operation) {
  let next = 0,
    failure;
  const stopped = () => failure !== undefined;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (!stopped() && next < jobs.length) {
        const job = jobs[next++];
        try {
          await operation(job, stopped);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
}
async function readHash(path, entry) {
  await file(path, entry.bytes);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== entry.bytes)
      throw Error("Snapshot verification byte mismatch");
    const bytes = Buffer.alloc(entry.bytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== entry.bytes)
      throw Error("Snapshot verification byte mismatch");
    return hash(bytes.subarray(0, offset));
  } finally {
    await handle.close();
  }
}
async function enumerateMetadata(root, acceptedFiles, acceptedDirectories) {
  const counts = {
    regularFiles: 0,
    symlinks: 0,
    directories: 0,
    other: 0,
    total: 0,
  };
  const extra = { ...counts },
    pending = [root];
  while (pending.length) {
    const parent = pending.pop();
    await directory(parent);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = relative(root, join(parent, entry.name));
      const kind = entry.isSymbolicLink()
        ? "symlinks"
        : entry.isFile()
          ? "regularFiles"
          : entry.isDirectory()
            ? "directories"
            : "other";
      counts[kind]++;
      counts.total++;
      if (counts.total > MAX_SOURCE_ENTRIES)
        throw Error("Snapshot metadata enumeration bound");
      if (
        !(kind === "regularFiles" && acceptedFiles.has(path)) &&
        !(kind === "directories" && acceptedDirectories.has(path))
      ) {
        extra[kind]++;
        extra.total++;
      }
      if (kind === "directories") pending.push(join(parent, entry.name));
    }
  }
  return { counts, extra };
}

/** Test-only candidate snapshot. Caller owns/quiesces both roots; failure retains a partial target. */
export async function copyNativeCandidateSnapshot({
  source,
  ownedRoot,
  inventoryBytes,
  expectedInventorySha256,
  concurrency = 8,
  copyFileImpl = copyFile,
}) {
  const inventory = validateNativeCandidateInventory({
    inventoryBytes,
    expectedInventorySha256,
    source,
  });
  requireValue(
    absolute(ownedRoot) &&
      Number.isInteger(concurrency) &&
      concurrency >= 1 &&
      concurrency <= 32 &&
      typeof copyFileImpl === "function",
    "owner or concurrency",
  );
  const appRoot = join(ownedRoot, "app"),
    targetRoot = join(appRoot, "out"),
    started = Date.now();
  if (!disjoint(source, ownedRoot))
    throw Error("Snapshot source and owner overlap");
  await directory(source);
  await directory(ownedRoot);
  await directory(appRoot);
  await absent(targetRoot);
  for (const path of inventory.directories) await directory(join(source, path));
  await bounded(inventory.entries, concurrency, (entry) =>
    file(join(source, entry.path), entry.bytes),
  );
  const sourceMetadata = await enumerateMetadata(
    source,
    new Set(inventory.entries.map((entry) => entry.path)),
    new Set(inventory.directories),
  );
  await directory(appRoot);
  await mkdir(targetRoot);
  for (const path of inventory.directories.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  ))
    await mkdir(join(targetRoot, path));
  await bounded(inventory.entries, concurrency, async (entry, stopped) => {
    const src = join(source, entry.path),
      dst = join(targetRoot, entry.path);
    await file(src, entry.bytes);
    await directory(dirname(dst));
    if (!stopped()) await copyFileImpl(src, dst, COPY_FLAGS);
  });
  const copyMs = Date.now() - started,
    entries = [];
  await bounded(inventory.entries, concurrency, async (entry) => {
    // allSettled避免一侧读取失败时另一侧仍在途就提前退出该校验任务。
    const results = await Promise.allSettled([
      readHash(join(source, entry.path), entry),
      readHash(join(targetRoot, entry.path), entry),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const [sourceSha256, targetSha256] = results.map((result) => result.value);
    if (
      sourceSha256 !== entry.expectedSha256 ||
      targetSha256 !== entry.expectedSha256
    )
      throw Error("Snapshot candidate source/destination checksum mismatch");
    entries.push({
      path: entry.path,
      kind: "file",
      bytes: entry.bytes,
      expectedSha256: entry.expectedSha256,
      sourceSha256,
      targetSha256,
    });
  });
  const target = await enumerateMetadata(
    targetRoot,
    new Set(inventory.entries.map((entry) => entry.path)),
    new Set(inventory.directories),
  );
  if (
    target.extra.total !== 0 ||
    target.counts.regularFiles !== inventory.entries.length ||
    target.counts.directories !== inventory.directories.length
  )
    throw Error("Snapshot complete target mismatch");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    sourceRoot: source,
    targetRoot,
    inventorySha256: inventory.inventorySha256,
    verified: true,
    regularFiles: entries.length,
    symlinks: 0,
    directories: inventory.directories.length,
    bytes: inventory.bytes,
    copyMs,
    totalMs: Date.now() - started,
    sourceMetadataPhase: "before-copy",
    extraSourceEntries: sourceMetadata.extra,
    sourceMetadataCounts: sourceMetadata.counts,
    entries,
  };
}
