import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { join } from "node:path";

const execute = promisify(execFile);
const require = createRequire("/opt/builder/package.json");
const asar = require("@electron/asar");
const expected = JSON.parse(await readFile("/input/expected.json", "utf8")).runtimeFiles;
const facts = { status: "failed", artifacts: {} };
async function digest(path) {
  const hash = createHash("sha256");
  for await (const block of createReadStream(path)) hash.update(block);
  return { bytes: (await stat(path)).size, sha256: hash.digest("hex") };
}
async function appRoot(path, depth = 0) {
  if (await stat(join(path, "resources/app.asar")).then(() => true, () => false)) return path;
  assert.ok(depth < 5, "Native app root not found");
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { return await appRoot(join(path, entry.name), depth + 1); } catch { /* Try the next archive directory. */ }
  }
  throw Error("Native app root not found");
}
try {
  const names = (await readdir("/packages")).filter((name) => /\.(AppImage|deb|rpm|pkg\.tar\.zst)$/.test(name));
  assert.equal(names.length, 4, "All four configured formats must exist");
  for (const name of names.sort()) {
    const path = join("/packages", name);
    const kind = name.endsWith("AppImage") ? "AppImage" : name.endsWith(".deb") ? "deb" : name.endsWith(".rpm") ? "rpm" : "pacman";
    const dir = join("/work", kind);
    await mkdir(dir);
    const row = { ...await digest(path), kind };
    facts.artifacts[name] = row;
    if (kind === "AppImage") {
      const handle = await open(path); const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0); await handle.close();
      assert.equal(header.subarray(0, 4).toString("hex"), "7f454c46");
      assert.equal(header.readUInt16LE(18), 183);
      assert.equal(header.subarray(8, 11).toString("hex"), "414902");
      const runtime = "/tmp/owned.AppImage"; await copyFile(path, runtime); await chmod(runtime, 0o755);
      row.squashfsOffset = Number((await execute(runtime, ["--appimage-offset"])).stdout.trim());
      assert.ok(row.squashfsOffset > 0 && row.squashfsOffset < row.bytes);
      await execute(runtime, ["--appimage-extract"], { cwd: dir, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    } else if (kind === "deb") {
      row.metadata = (await execute("dpkg-deb", ["-f", path, "Package", "Version", "Architecture"])).stdout;
      assert.ok(row.metadata.includes("Package: zcode-preview") && row.metadata.includes("Version: 3.16.0") && row.metadata.includes("Architecture: arm64"));
      await execute("dpkg-deb", ["-x", path, dir], { timeout: 90000 });
    } else if (kind === "rpm") {
      row.metadata = (await execute("rpm", ["-qp", "--qf", "%{NAME} %{VERSION} %{ARCH}", path])).stdout;
      assert.equal(row.metadata, "zcode-preview 3.16.0 aarch64");
      row.dependencies = (await execute("rpm", ["-qp", "--requires", path])).stdout.split("\n");
      assert.ok(row.dependencies.includes("mesa-libgbm") && row.dependencies.includes("alsa-lib"));
      await execute("bsdtar", ["-xf", path, "-C", dir, "--no-same-owner"], { timeout: 90000 });
    } else {
      const handle = await open(path); const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0); await handle.close();
      assert.equal(header.toString("hex"), "28b52ffd", "pkg.tar.zst must contain zstd bytes");
      row.metadata = (await execute("bsdtar", ["-xOf", path, ".PKGINFO"])).stdout;
      assert.match(row.metadata, /^pkgname = zcode-preview$/m);
      assert.match(row.metadata, /^pkgver = 3\.16\.0(?:-\d+)?$/m);
      assert.match(row.metadata, /^arch = aarch64$/m);
      await execute("bsdtar", ["-xf", path, "-C", dir, "--no-same-owner"], { timeout: 90000 });
    }
    const root = await appRoot(dir);
    // root 容器会掩盖 0700 安装目录；同时约束普通用户可遍历/读取原包核心路径。
    row.publicRuntimePermissions = [];
    assert.equal((await stat(root)).mode & 0o005, 0o005, kind + " app directory must be public read/traverse");
    row.coreFiles = {};
    for (const [relative, value] of Object.entries(expected)) {
      const parts = relative.split("/");
      for (let index = 1; index < parts.length; index++) {
        const parent = join(root, ...parts.slice(0, index));
        assert.equal((await stat(parent)).mode & 0o005, 0o005, kind + " private runtime directory: " + relative);
      }
      const mode = (await stat(join(root, relative))).mode & 0o777;
      assert.ok(mode & 0o004, kind + " unreadable runtime file: " + relative);
      if (relative === "zcode-preview") assert.ok(mode & 0o001, kind + " non-executable runtime");
      row.publicRuntimePermissions.push({ relative, mode: mode.toString(8) });
      row.coreFiles[relative] = await digest(join(root, relative));
      assert.deepEqual(row.coreFiles[relative], value, kind + " core payload changed: " + relative);
    }
    const metadata = JSON.parse(asar.extractFile(join(root, "resources/app.asar"), "package.json"));
    assert.equal(metadata.version, "3.16.0");
    assert.equal(metadata.zcodeProductFlavor, "preview");
    row.packageVersion = metadata.version;
    row.status = "passed";
  }
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
}
await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n", { flush: true });
process.stdout.write(JSON.stringify({ status: facts.status, formats: Object.keys(facts.artifacts), failure: facts.failure }) + "\n");
process.exitCode = facts.status === "passed" ? 0 : 1;
