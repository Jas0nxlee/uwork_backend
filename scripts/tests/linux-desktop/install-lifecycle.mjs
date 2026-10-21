import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const facts = { status: "failed" };
const launcher = "/usr/bin/zcode-preview";
async function link(path) {
  try { return { exists: true, symlink: (await lstat(path)).isSymbolicLink(), target: await readlink(path) }; }
  catch (error) { return { exists: error.code !== "ENOENT", error: error.code }; }
}
try {
  const queried = await execute("dpkg-query", ["-W", "-f=${Package} ${Version} ${Architecture} ${db:Status-Status}", "zcode-preview"]);
  assert.equal(queried.stdout, "zcode-preview 3.16.0 arm64 installed");
  const files = (await execute("dpkg-query", ["-L", "zcode-preview"], { maxBuffer: 4 * 1024 * 1024 })).stdout.split("\n");
  const desktopFiles = files.filter((path) => path.endsWith(".desktop"));
  assert.ok(desktopFiles.length > 0);
  facts.installed = { package: queried.stdout, fileCount: files.length, launcher: await link(launcher),
    executable: await realpath(launcher), desktops: [] };
  assert.equal(facts.installed.executable, "/opt/UWork Preview/zcode-preview");
  for (const path of desktopFiles) {
    const content = await readFile(path, "utf8");
    assert.ok(content.includes("x-scheme-handler/zcode"));
    facts.installed.desktops.push({ path, exec: content.split("\n").find((line) => line.startsWith("Exec=")), protocolDeclared: true });
  }
  const removed = await execute("dpkg", ["--purge", "zcode-preview"]);
  facts.purge = { stdout: removed.stdout, stderr: removed.stderr };
  facts.after = { launcher: await link(launcher), alternative: await link("/etc/alternatives/zcode-preview"),
    packageDirectoryExists: await lstat("/opt/UWork Preview").then(() => true, () => false),
    desktopsExist: await Promise.all(desktopFiles.map((path) => lstat(path).then(() => true, () => false))) };
  assert.equal(facts.after.launcher.exists, false, "Uninstalled launcher must not remain dangling");
  assert.equal(facts.after.alternative.exists, false, "Uninstalled alternative must be removed");
  assert.equal(facts.after.packageDirectoryExists, false);
  assert.ok(facts.after.desktopsExist.every((value) => !value));
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
}
await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n", { flush: true });
process.stdout.write(JSON.stringify(facts) + "\n");
process.exitCode = facts.status === "passed" ? 0 : 1;
