import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const COPY_CONCURRENCY = 8;
const COPY_FLAGS = constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function runBounded(jobs, concurrency, operation) {
  let next = 0,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (!failure && next < jobs.length) {
        const job = jobs[next++];
        try {
          await operation(job);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
}

/** Test-only immutable Native out snapshot. The target is always a fresh owned app/out. */
export async function copyNativeOutSnapshot({
  source,
  ownedRoot,
  concurrency = COPY_CONCURRENCY,
  copyFileImpl = copyFile,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw Error("Invalid snapshot concurrency");
  const started = Date.now();
  const sourceRoot = resolve(source),
    canonicalSource = await realpath(sourceRoot),
    owner = await realpath(ownedRoot);
  const appRoot = await realpath(join(owner, "app"));
  if (appRoot !== join(owner, "app"))
    throw Error("Snapshot app directory must be owned");
  const targetRoot = join(appRoot, "out"),
    fromSource = relative(canonicalSource, targetRoot);
  if (
    !fromSource ||
    (!fromSource.startsWith(".." + sep) &&
      fromSource !== ".." &&
      !isAbsolute(fromSource))
  )
    throw Error("Snapshot target is inside source");
  await mkdir(targetRoot);
  const jobs = [],
    directories = [],
    pending = [sourceRoot];
  while (pending.length) {
    const folder = pending.pop();
    const entries = (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const src = join(folder, entry.name),
        path = relative(sourceRoot, src),
        dst = join(targetRoot, path);
      if (entry.isDirectory()) {
        await mkdir(dst);
        directories.push(path);
        pending.push(src);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        jobs.push({
          src,
          dst,
          path,
          kind: entry.isSymbolicLink() ? "symlink" : "file",
        });
      } else throw Error("Unsupported snapshot entry: " + path);
    }
  }
  await runBounded(jobs, concurrency, async (job) => {
    if (job.kind === "file") await copyFileImpl(job.src, job.dst, COPY_FLAGS);
    else
      await symlink(
        resolve(dirname(job.src), await readlink(job.src)),
        job.dst,
      );
  });
  const copyMs = Date.now() - started,
    manifest = [];
  await runBounded(jobs, concurrency, async (job) => {
    if (job.kind === "symlink") {
      const expected = resolve(dirname(job.src), await readlink(job.src)),
        actual = await readlink(job.dst);
      if (expected !== actual)
        throw Error("Snapshot symlink verification mismatch: " + job.path);
      manifest.push({ path: job.path, kind: job.kind, target: actual });
      return;
    }
    const [src, dst] = await Promise.all([
      readFile(job.src),
      readFile(job.dst),
    ]);
    const sourceSha256 = hash(src),
      targetSha256 = hash(dst);
    if (sourceSha256 !== targetSha256)
      throw Error("Snapshot verification mismatch: " + job.path);
    manifest.push({
      path: job.path,
      kind: job.kind,
      bytes: src.length,
      sourceSha256,
      targetSha256,
    });
  });
  const targetEntries = await readdir(targetRoot, { recursive: true });
  if (targetEntries.length !== jobs.length + directories.length)
    throw Error("Snapshot entry verification mismatch");
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  return {
    sourceRoot,
    targetRoot,
    verified: true,
    regularFiles: jobs.filter((j) => j.kind === "file").length,
    symlinks: jobs.filter((j) => j.kind === "symlink").length,
    directories: directories.length,
    bytes: manifest.reduce((sum, row) => sum + (row.bytes ?? 0), 0),
    copyMs,
    totalMs: Date.now() - started,
    entries: manifest,
  };
}
