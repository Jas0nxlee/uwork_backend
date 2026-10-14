import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { SandboxDriver, SandboxOwner } from "../src/sandbox/contract.js";

export async function cleanupSandboxes(
  driver: SandboxDriver,
  owners: SandboxOwner[],
  recoveryDirectory = resolve("evidence"),
) {
  const results = await Promise.allSettled(
    owners.map((owner) => driver.remove(owner)),
  );
  const failed = owners.filter(
    (_owner, index) => results[index]?.status === "rejected",
  );
  if (!failed.length) return;
  await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
  const path = join(recoveryDirectory, `sandbox-cleanup-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(failed, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  throw new Error(
    `Sandbox cleanup failed; protected recovery metadata retained at ${path}`,
  );
}
