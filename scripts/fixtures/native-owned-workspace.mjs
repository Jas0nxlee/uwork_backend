import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function validateOwnedNativeWorkspace(ownedRoot, workspacePath) {
  if (
    typeof workspacePath !== "string" ||
    workspacePath.length > 4096 ||
    workspacePath.includes("\0") ||
    !isAbsolute(workspacePath) ||
    resolve(workspacePath) !== workspacePath
  )
    throw Error("Invalid owned workspace path");
  const root = await realpath(ownedRoot);
  const path = relative(root, workspacePath);
  if (!path || path === ".." || path.startsWith(".." + sep) || isAbsolute(path))
    throw Error("Workspace must be a strict child of this fixture root");
  const [directory, git] = await Promise.all([
    lstat(workspacePath),
    lstat(join(workspacePath, ".git")),
  ]);
  // 测试入口只认领本次真实目录，拒绝软链及 gitdir 间接引用到其他工作区。
  if (
    !directory.isDirectory() ||
    !git.isDirectory() ||
    (await realpath(workspacePath)) !== workspacePath
  )
    throw Error("Owned workspace must have a real local Git directory");
  return workspacePath;
}
