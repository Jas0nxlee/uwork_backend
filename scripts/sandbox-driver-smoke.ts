import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import type { SandboxOwner } from "../src/sandbox/contract.js";
import { ApiError } from "../src/core.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";
const socket =
  process.env.UWORK_SANDBOX_SOCKET ??
  "/Users/ljp/.colima/uwork-backend/docker.sock";
const driver = new DockerSandboxDriver(
  socket,
  process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
);
const docker = new Docker({ socketPath: socket });
const owners: SandboxOwner[] = [];
const create = async (ttlMs = 120000) => {
  const owner = {
    id: randomBytes(16).toString("hex"),
    tenantId: "controlled-verification",
    ownerToken: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + ttlMs,
  };
  owners.push(owner);
  await driver.create(owner);
  return owner;
};
try {
  assert.equal((await driver.health()).available, true);
  const owner = await create();
  const info = await docker.getContainer(`uwork-sbx-${owner.id}`).inspect();
  assert.equal(info.Config.User, "999:999");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(info.HostConfig.NetworkMode, "none");
  assert.equal(info.HostConfig.Memory, 256 * 1024 * 1024);
  assert.equal(info.HostConfig.PidsLimit, 64);
  assert.equal(info.HostConfig.NanoCpus, 500000000);
  assert.ok(info.HostConfig.CapDrop?.includes("ALL"));
  assert.ok(info.HostConfig.SecurityOpt?.includes("no-new-privileges:true"));
  assert.ok(info.Mounts.every((m) => m.Type === "tmpfs"));
  const run = await driver.execute(
    owner,
    `import fs from 'node:fs/promises';let readOnly=false;try{await fs.writeFile('/escape','x');}catch(e){readOnly=e.code==='EROFS'||e.code==='EACCES';}await fs.writeFile('/workspace/state','persisted');let networkBlocked=false;try{await fetch('http://1.1.1.1',{signal:AbortSignal.timeout(1000)});}catch{networkBlocked=true;}console.log(JSON.stringify({uid:process.getuid(),readOnly,networkBlocked,noHostFiles:!await fs.stat('/Users/ljp').then(()=>true,()=>false),noMasterKey:!process.env.MASTER_KEY}));`,
    new AbortController().signal,
  );
  assert.equal(run.exitCode, 0);
  assert.equal(
    (
      await driver.execute(
        owner,
        "try { process.kill(1,0); console.log('unexpected'); } catch (error) { console.log(error.code); }",
        new AbortController().signal,
      )
    ).stdout.trim(),
    "EPERM",
  );
  assert.deepEqual(JSON.parse(run.stdout), {
    uid: 1000,
    readOnly: true,
    networkBlocked: true,
    noHostFiles: true,
    noMasterKey: true,
  });
  assert.equal(
    (
      await driver.execute(
        owner,
        `console.log(await (await import('node:fs/promises')).readFile('/workspace/state','utf8'))`,
        new AbortController().signal,
      )
    ).stdout.trim(),
    "persisted",
  );
  await assert.rejects(
    () => driver.inspect({ ...owner, ownerToken: "wrong" }),
    (e) => e instanceof ApiError && e.status === 403,
  );
  assert.equal((await driver.inspect(owner))?.running, true);
  const controller = new AbortController();
  const work = driver.execute(owner, "while(true){}", controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(work);
  assert.equal((await driver.inspect(owner))?.running, false);
  const outputOwner = await create();
  await assert.rejects(
    () =>
      driver.execute(
        outputOwner,
        "console.log('x'.repeat(200000))",
        new AbortController().signal,
      ),
    (e) => e instanceof ApiError && e.code === "SANDBOX_OUTPUT_LIMIT",
  );
  assert.equal((await driver.inspect(outputOwner))?.running, false);
  const unstarted: SandboxOwner = {
    id: randomBytes(16).toString("hex"),
    tenantId: "controlled-verification",
    ownerToken: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 120000,
  };
  owners.push(unstarted);
  await docker.createContainer({
    name: `uwork-sbx-${unstarted.id}`,
    Image: process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
    Labels: {
      "uwork.sandbox-owner": unstarted.ownerToken,
      "uwork.runtime-id": unstarted.id,
      "uwork.managed-by": "uwork-backend",
      "uwork.tenant-id": unstarted.tenantId,
    },
  });
  await assert.rejects(
    () =>
      driver.execute(
        unstarted,
        "console.log('must not execute')",
        new AbortController().signal,
      ),
    (error) => error instanceof ApiError && error.code === "SANDBOX_STOPPED",
  );
  const expiring = await create(1000);
  await assert.rejects(
    () => driver.execute(expiring, "while(true){}", AbortSignal.timeout(5000)),
    (error) => error instanceof ApiError && error.code === "TIMEOUT",
  );
  assert.equal((await driver.inspect(expiring))?.running, false);
  assert.equal((await driver.inspect(expiring))?.deadlineExpired, true);
  console.log(
    JSON.stringify({
      isolation: true,
      workspacePersistence: true,
      ownershipProtection: true,
      cancellationStopsProcess: true,
      outputLimit: true,
      protectedDeadline: true,
    }),
  );
} finally {
  await cleanupSandboxes(driver, owners);
}
