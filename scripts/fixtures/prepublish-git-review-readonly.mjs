import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createGitService } from "../../clients/uwork/packages/services/src/git/gitService.ts";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const root = resolve(input.root);
assert.match(basename(root), /^client-native-prepublish-v\d+-20261021$/);
assert.equal(realpathSync(root), root);
assert.equal(input.workspace, join(root, "prepublish-workspace"));
assert.ok(["unstaged", "staged", "branch"].includes(input.source));
assert.ok(
  [
    "review.txt",
    "deleted.txt",
    "new.txt",
    "binary.bin",
    "rename-new.txt",
    "branch.txt",
  ].includes(input.file),
);
const service = createGitService();
const diff = await service.getDiff({
  workspacePath: input.workspace,
  sourceId: input.source,
  path: join(input.workspace, input.file),
});
process.stdout.write("UW_REVIEW=" + JSON.stringify(diff) + "\n");
