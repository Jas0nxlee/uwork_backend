import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const image = "/opt/artifacts/uwork-preview.AppImage";
const facts = { status: "failed", cases: [] };
async function exists(path) { return stat(path).then(() => true, () => false); }
async function closed(child) {
  return new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
}
try {
  facts.appImageSha256 = createHash("sha256").update(await readFile(image)).digest("hex");
  for (const label of ["default"]) {
    const root = "/tmp/owned-" + label;
    await mkdir(root, { mode: 0o700 });
    const ready = "/work/" + label + "-ready.json";
    const stop = "/work/" + label + "-stop";
    const env = { ...process.env, TMPDIR: root, ELECTRON_RUN_AS_NODE: "1", APPIMAGE_EXTRACT_AND_RUN: "1" };
    delete env.NO_CLEANUP;
    const code = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({executable:process.execPath}));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})){clearInterval(timer);process.exit(0);}},100);`;
    const primary = spawn(image, ["-e", code], { env, stdio: "ignore" });
    const primaryClosed = closed(primary);
    try {
      const deadline = Date.now() + 20000;
      while (!(await exists(ready)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.ok(await exists(ready));
      const executable = JSON.parse(await readFile(ready, "utf8")).executable;
      assert.ok(executable.startsWith(root + "/appimage_extracted_"));
      assert.ok(await exists(executable));
      const secondaryReady = "/work/" + label + "-secondary.json";
      const secondaryCode = `require('node:fs').writeFileSync(${JSON.stringify(secondaryReady)},JSON.stringify({executable:process.execPath}));`;
      const secondary = spawn(image, ["-e", secondaryCode], { env, stdio: "ignore" });
      const secondaryExit = await closed(secondary);
      assert.deepEqual(secondaryExit, { code: 0, signal: null });
      const retained = await exists(executable);
      const secondaryExecutable = JSON.parse(await readFile(secondaryReady, "utf8")).executable;
      const row = { mode: label, secondaryExit, primaryExecutableRetained: retained,
        extractionDirectoriesDiffer: executable !== secondaryExecutable,
        secondaryExecutableRetained: await exists(secondaryExecutable) };
      facts.cases.push(row);
      assert.equal(retained, true, "Concurrent runtime exit must retain the original application's executable");
      await writeFile(stop, "stop");
      row.primaryExit = await primaryClosed;
      row.ownerCleanedExtractedFiles = !(await exists(executable));
      assert.equal(row.ownerCleanedExtractedFiles, true);
      assert.deepEqual(row.primaryExit, { code: 0, signal: null });
    } finally {
      await writeFile(stop, "stop");
      await Promise.race([primaryClosed, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (primary.exitCode === null) primary.kill("SIGTERM");
    }
  }
  facts.status = "passed-runtime-lifetime-contract";
} catch (error) { facts.failure = String(error); }
await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n");
process.stdout.write(JSON.stringify(facts) + "\n");
process.exitCode = facts.status === "passed-runtime-lifetime-contract" ? 0 : 1;
