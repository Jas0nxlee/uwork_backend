// 只对已核归档的私有副本调用公开 JS 方法；不实例化 PTY，不创建 child/provider/model。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const root = process.argv[2];
const variant = process.argv[3];
assert.ok(
  root === "/input" ||
    root ===
      "/Users/ljp/Library/Caches/uwork-backend/client-server-node-pty-audit-20261020/input",
);
assert.ok(["darwin-old", "darwin-new", "linux-new"].includes(variant));
const dir = path.join(root, variant, "node_modules/node-pty");
const { UnixTerminal } = await import(
  pathToFileURL(path.join(dir, "lib/unixTerminal.js")).href
);
const { loadNativeModule } = await import(
  pathToFileURL(path.join(dir, "lib/utils.js")).href
);
// 使用原包与 UnixTerminal 相同的导出 loader；不自行装载或重写 native。
const native = loadNativeModule("pty").module;
const packageJson = JSON.parse(
  await readFile(path.join(dir, "package.json"), "utf8"),
);
let publicError, nativeFiveError;
try {
  UnixTerminal.prototype.resize.call({ _fd: -1 }, 80, 24);
} catch (error) {
  publicError = error.message;
}
try {
  native.resize(-1, 80, 24, 0, 0);
} catch (error) {
  nativeFiveError = error.message;
}
console.log(
  JSON.stringify({
    variant,
    node: process.version,
    arch: process.arch,
    uid: process.getuid(),
    jsVersion: packageJson.version,
    publicError,
    nativeFiveError,
    ptyOrChildCreated: false,
  }),
);
assert.match(
  publicError,
  /EBADF/,
  "Original Server public JS resize must reach ioctl validation, not reject its argument shape",
);
