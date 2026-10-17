import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validateOwnedNativeWorkspace } from "./native-owned-workspace.mjs";

async function fixture(t) {
  const outer = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-native-workspace-")),
  );
  t.after(() => rm(outer, { recursive: true, force: true }));
  const root = join(outer, "owned");
  const project = join(root, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  return { outer, root, project };
}

test("owned native workspace admits a real nested Git directory without mutation", async (t) => {
  const { root, project } = await fixture(t);
  assert.equal(await validateOwnedNativeWorkspace(root, project), project);
});

test("owned native workspace rejects root, sibling prefix and escape", async (t) => {
  const { outer, root } = await fixture(t);
  const sibling = join(outer, "owned-sibling");
  await mkdir(join(sibling, ".git"), { recursive: true });
  for (const candidate of [root, outer, sibling, join(root, "..", "outside")]) {
    await assert.rejects(validateOwnedNativeWorkspace(root, candidate));
  }
});

test("owned native workspace rejects missing and non-Git directories", async (t) => {
  const { root } = await fixture(t);
  const plain = join(root, "plain");
  await mkdir(plain);
  await assert.rejects(validateOwnedNativeWorkspace(root, plain));
  await assert.rejects(
    validateOwnedNativeWorkspace(root, join(root, "missing")),
  );
});

test("owned native workspace rejects symlinked project and ancestor", async (t) => {
  const { root, project } = await fixture(t);
  const alias = join(root, "alias");
  await symlink(project, alias, "dir");
  await assert.rejects(validateOwnedNativeWorkspace(root, alias));
  const nested = join(project, "nested");
  await mkdir(join(nested, ".git"), { recursive: true });
  await assert.rejects(
    validateOwnedNativeWorkspace(root, join(alias, "nested")),
  );
});

test("owned native workspace rejects external symlink and .git indirection", async (t) => {
  const { outer, root } = await fixture(t);
  const external = join(outer, "external");
  await mkdir(join(external, ".git"), { recursive: true });
  const escaped = join(root, "escaped");
  await symlink(external, escaped, "dir");
  await assert.rejects(validateOwnedNativeWorkspace(root, escaped));
  const redirected = join(root, "redirected");
  await mkdir(redirected);
  await symlink(join(external, ".git"), join(redirected, ".git"), "dir");
  await assert.rejects(validateOwnedNativeWorkspace(root, redirected));
  const gitfile = join(root, "gitfile");
  await mkdir(gitfile);
  await writeFile(join(gitfile, ".git"), "gitdir: ../external\n");
  await assert.rejects(validateOwnedNativeWorkspace(root, gitfile));
});

test("owned native workspace rejects ambiguous or invalid path inputs", async (t) => {
  const { root, project } = await fixture(t);
  for (const candidate of [
    undefined,
    null,
    1,
    "",
    "project",
    project + "/",
    project + "/../project",
    project + "\0",
    "/" + "x".repeat(4096),
  ]) {
    await assert.rejects(validateOwnedNativeWorkspace(root, candidate));
  }
});
