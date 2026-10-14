import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSandboxes } from "../scripts/sandbox-cleanup.js";
import type { SandboxDriver, SandboxOwner } from "../src/sandbox/contract.js";

test("verification cleanup attempts every owned sandbox and protects failed recovery metadata", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-cleanup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls: string[] = [],
    owners: SandboxOwner[] = ["first", "second"].map((id) => ({
      id,
      tenantId: "controlled",
      ownerToken: "controlled-owner",
      expiresAt: Date.now() + 1000,
    }));
  const driver: SandboxDriver = {
    health: async () => ({ available: true, image: "controlled" }),
    create: async () => {
      throw new Error("Not expected");
    },
    execute: async () => {
      throw new Error("Not expected");
    },
    inspect: async () => null,
    stop: async () => {},
    remove: async (owner) => {
      calls.push(owner.id);
      if (owner.id === "first") throw new Error("Controlled removal failure");
    },
  };
  await assert.rejects(
    () => cleanupSandboxes(driver, owners, dir),
    /protected recovery metadata/,
  );
  assert.deepEqual(calls, ["first", "second"]);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const path = join(dir, files[0]!);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), [owners[0]]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});
