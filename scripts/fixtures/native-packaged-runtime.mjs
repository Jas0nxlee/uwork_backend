import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export function packagedManifestInput(input, repo, mode) {
  if (input === undefined) return null;
  assert.equal(mode.experience, "enabled");
  assert.equal(
    mode.otherMode,
    false,
    "Packaged runtime cannot use login interception or another fixture mode",
  );
  const path = resolve(input);
  assert.equal(path, input);
  assert.equal(dirname(path), join(repo, "evidence"));
  assert.match(
    basename(path),
    /^client-macos-package-v[0-9]+-manifest-[0-9]{8}\.json$/,
  );
  return path;
}

export async function loadOwnedPackagedRuntime(input, repo, mode) {
  const path = packagedManifestInput(input, repo, mode);
  if (!path) return null;
  assert.equal(await realpath(path), path);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const appPath = resolve(manifest.appPath);
  const cache = join(userInfo().homedir, "Library/Caches/uwork-backend");
  assert.ok(
    appPath.startsWith(cache + "/client-macos-package-") &&
      appPath.endsWith("/mac-arm64/UWork Preview.app"),
  );
  assert.equal(await realpath(appPath), appPath);
  assert.equal(manifest.bundleIdentifier, "dev.zcode.app.preview");
  const required = [
    "app.asar",
    "glm/zcode.cjs",
    "config/provider/zcode-builtin.json",
    "macos-window-bounds/zcode-window-bounds",
  ];
  for (const name of required) {
    const expected = manifest.runtimeFiles[name];
    assert.match(expected.sha256, /^[a-f0-9]{64}$/);
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(
      join(appPath, "Contents/Resources", name),
    )) {
      bytes += chunk.length;
      digest.update(chunk);
    }
    assert.equal(bytes, expected.bytes);
    assert.equal(
      digest.digest("hex"),
      expected.sha256,
      "Packaged runtime changed after verification",
    );
  }
  await promisify(execFile)("codesign", [
    "--verify",
    "--deep",
    "--strict",
    appPath,
  ]);
  return {
    appPath,
    executable: join(appPath, "Contents/MacOS/UWork Preview"),
    manifestPath: path,
    verifiedRuntimeFiles: required,
  };
}
