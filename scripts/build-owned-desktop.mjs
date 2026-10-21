/** Fresh normal bundles frozen outside Desktop; no installer or release is created. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { desktopInputHashes } from "./fixtures/owned-desktop-input.mjs";
import { copyNativeOutSnapshot } from "./fixtures/native-out-snapshot.mjs";

assert.match(process.versions.node, /^24\./);
const repository = process.cwd();
const inputs = await desktopInputHashes(repository);
await new Promise((done, reject) => {
  const p = spawn(
    "pnpm",
    ["--dir", "packages/desktop", "build:no-runtime-assets"],
    {
      cwd: join(repository, "clients/uwork"),
      env: process.env,
      stdio: "inherit",
    },
  );
  p.once("error", reject);
  p.once("exit", (code) =>
    code === 0 ? done() : reject(Error("normal desktop build failed")),
  );
});
assert.deepEqual(
  await desktopInputHashes(repository),
  inputs,
  "desktop inputs changed during build",
);
const base = join(homedir(), ".cache/uwork-prepublish-desktop");
await mkdir(base, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(base, "build-"));
await mkdir(join(root, "app"), { mode: 0o700 });
const snapshot = await copyNativeOutSnapshot({
  source: resolve("clients/uwork/packages/desktop/out"),
  ownedRoot: root,
});
assert.deepEqual(
  await desktopInputHashes(repository),
  inputs,
  "desktop sources changed while freezing outputs",
);
const manifestPath = join(root, "manifest.json");
await writeFile(
  manifestPath,
  JSON.stringify({ schema: 1, repository, inputs, snapshot }, null, 2),
  { flag: "wx", mode: 0o600 },
);
const receipt = {
  status: "built",
  manifestPath,
  sourceFiles: inputs.length,
  artifactFiles: snapshot.regularFiles,
  copyMs: snapshot.copyMs,
  totalMs: snapshot.totalMs,
  normalBuild: true,
};
await writeFile(
  resolve(
    "evidence/prepublish-continuation-20261021/owned-desktop-latest.json",
  ),
  JSON.stringify(receipt, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(receipt));
