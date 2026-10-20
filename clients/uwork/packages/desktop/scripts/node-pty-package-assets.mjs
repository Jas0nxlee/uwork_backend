import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

export function restoreTargetNodePtyPrebuild({ desktopPackageRoot, targetPlatform }) {
  if (targetPlatform.os !== "linux") {
    console.log(`[beforePack] node-pty prebuild restore skipped for ${targetPlatform.key}`);
    return;
  }

  const platformKey = targetPlatform.key;
  const sourcePackageName = `@lydell/node-pty-${platformKey}`;
  let sourcePackageRoot;

  try {
    sourcePackageRoot = resolveSourcePackageRoot({ sourcePackageName, desktopPackageRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`缺少 ${sourcePackageName}，无法为 ${platformKey} 打包 node-pty: ${message}`);
  }

  const nodePtyPackageRoot = dirname(
    require.resolve("node-pty/package.json", { paths: [desktopPackageRoot] }),
  );
  const jsPackage = readPackage(nodePtyPackageRoot);
  const sourcePackage = readPackage(sourcePackageRoot);
  // 1.1 JS 的 resize 传三个参数，1.2 beta native 已要求五个；能加载不代表 ABI 匹配。
  // 先验证同一 Desktop 根解析的完整组合，避免覆盖文件后才发现跨版本或跨平台混装。
  if (
    jsPackage.name !== "node-pty" ||
    sourcePackage.name !== sourcePackageName ||
    typeof jsPackage.version !== "string" ||
    !jsPackage.version.trim() ||
    typeof sourcePackage.version !== "string" ||
    jsPackage.version !== sourcePackage.version ||
    !Array.isArray(sourcePackage.os) ||
    !sourcePackage.os.includes(targetPlatform.os) ||
    !Array.isArray(sourcePackage.cpu) ||
    !sourcePackage.cpu.includes(targetPlatform.arch)
  ) {
    throw new Error(
      `node-pty JS/native 版本或平台不一致: JS ${jsPackage.version}, ${sourcePackageName} ${sourcePackage.version} (${platformKey})`,
    );
  }
  const sourceBinaryPath = resolveNativeBinary(sourcePackageRoot, platformKey);
  const header = readFileSync(sourceBinaryPath).subarray(0, 20);
  const machine = { arm64: 183, x64: 62 }[targetPlatform.arch];
  if (
    !machine ||
    header.length !== 20 ||
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(18) !== machine
  ) {
    throw new Error(`node-pty native ELF 架构不匹配: ${platformKey}`);
  }
  const targetPrebuildDir = resolve(nodePtyPackageRoot, "prebuilds", platformKey);
  const targetBinaryPath = resolve(targetPrebuildDir, "pty.node");

  // Linux 包中 node-pty 本体只会查自己的 prebuilds/linux-*/pty.node，
  // 但 Linux 预编译文件实际来自 @lydell/node-pty-linux-* 平台包；若排除该平台包，
  // 而 node-pty 自身目录没有 linux prebuild，最终安装包里会缺 pty.node，终端启动失败。
  // 这里在 beforePack 阶段恢复依赖资产，让后续 asarUnpack 按标准链路处理 native addon。
  mkdirSync(targetPrebuildDir, { recursive: true });
  cpSync(sourceBinaryPath, targetBinaryPath);

  if (!existsSync(targetBinaryPath))
    throw new Error(`node-pty 预编译产物恢复失败: ${targetBinaryPath}`);

  console.log(`[beforePack] node-pty prebuild restored: ${targetBinaryPath}`);
}

export function resolveSourceNodePtyPrebuildPath({ sourcePackageName, platformKey }) {
  return resolveNativeBinary(resolveSourcePackageRoot({ sourcePackageName }), platformKey);
}

function readPackage(root) {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
}

function resolveSourcePackageRoot({ sourcePackageName, desktopPackageRoot }) {
  const options = desktopPackageRoot ? { paths: [desktopPackageRoot] } : undefined;
  try {
    // 原 1.1 平台包只有 package.json/pty.node，没有可解析的 JS 入口。
    return dirname(require.resolve(`${sourcePackageName}/package.json`, options));
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }
  const sourcePackageEntry = require.resolve(sourcePackageName, options);
  let currentDir = dirname(sourcePackageEntry);
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(resolve(currentDir, "package.json"))) return currentDir;
    currentDir = dirname(currentDir);
  }
  throw new Error(`无法定位 node-pty 平台包: ${sourcePackageName}`);
}

function resolveNativeBinary(sourcePackageRoot, platformKey) {
  const candidates = [
    resolve(sourcePackageRoot, "pty.node"),
    resolve(sourcePackageRoot, "prebuilds", platformKey, "pty.node"),
  ].filter((path) => existsSync(path));
  // 不能让旧版本残留的另一布局优先命中；原平台包必须提供唯一 native 资产。
  if (candidates.length !== 1) {
    throw new Error(`node-pty native 缺失或布局有歧义: ${sourcePackageRoot} (${platformKey})`);
  }
  return candidates[0];
}

export function resolvePackagedNodePtyPrebuildPath({ resourcesDir, platformKey }) {
  return resolve(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
    "prebuilds",
    platformKey,
    "pty.node",
  );
}
