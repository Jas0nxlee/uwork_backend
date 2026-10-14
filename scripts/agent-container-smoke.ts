import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import Docker from "dockerode";
import { z } from "zod";
import { DockerSandboxDriver } from "../src/sandbox/docker.js";
import { cleanupSandboxes } from "./sandbox-cleanup.js";

const exec = promisify(execFile),
  context = process.env.UWORK_DOCKER_CONTEXT ?? "colima-uwork-backend",
  image = process.env.UWORK_DOCKER_IMAGE ?? "uwork-backend:local";
const socket =
    process.env.UWORK_SANDBOX_SOCKET ??
    "/Users/ljp/.colima/uwork-backend/docker.sock",
  engineSocket = process.env.UWORK_ENGINE_SOCKET ?? "/var/run/docker.sock";
const owner = randomUUID(),
  label = "uwork.verification-owner",
  name = `uwork-agent-container-${owner.slice(0, 8)}`,
  client = new Docker({ socketPath: socket });
const env = {
  ...process.env,
  MASTER_KEY: randomBytes(32).toString("hex"),
  UWORK_EXPECTED_ENGINE_ID: (await client.info()).ID,
  UWORK_SANDBOX_IMAGE: process.env.UWORK_SANDBOX_IMAGE ?? "uwork-sandbox:local",
};
const docker = async (args: string[]) =>
  exec("docker", ["--context", context, ...args], {
    env,
    maxBuffer: 1024 * 1024,
    timeout: 60000,
  });
assert.equal(
  await docker(["info", "--format", "{{.ID}}"]).then((result) =>
    result.stdout.trim(),
  ),
  env.UWORK_EXPECTED_ENGINE_ID,
);
const common = [
  "--rm",
  "--network=none",
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges:true",
  "--label",
  `${label}=${owner}`,
  "--mount",
  `type=bind,source=${engineSocket},target=/run/uwork-sandbox.sock,readonly`,
];
let stdout = "";
const tenantSchema = z.object({
  type: z.literal("tenant"),
  tenantId: z.string().regex(/^[a-f0-9]{32}$/),
});
const reportSchema = z.object({
  type: z.literal("result"),
  packagedSdkLoop: z.literal(true),
  backendUid1000: z.literal(true),
  sandboxUid1000: z.literal(true),
  noBackendSecretsOrSocket: z.literal(true),
  modelCalls: z.literal(2),
  codeExecutions: z.literal(1),
  cleaned: z.literal(true),
});
function records() {
  return stdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}
try {
  const group = (
    await docker([
      "run",
      ...common,
      image,
      "node",
      "--input-type=module",
      "-e",
      "console.log((await import('node:fs')).statSync('/run/uwork-sandbox.sock').gid)",
    ])
  ).stdout.trim();
  assert.match(group, /^\d+$/);
  const source = await readFile(
    new URL("./fixtures/agent-container.mjs", import.meta.url),
    "utf8",
  );
  try {
    stdout = (
      await docker([
        "run",
        ...common,
        "--init",
        "--name",
        name,
        "--group-add",
        group,
        "--env",
        "MASTER_KEY",
        "--env",
        "UWORK_EXPECTED_ENGINE_ID",
        "--env",
        "UWORK_SANDBOX_IMAGE",
        image,
        "node",
        "--input-type=module",
        "-e",
        source,
      ])
    ).stdout;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string"
    )
      stdout = error.stdout;
    throw new Error("Packaged Agent verification failed");
  }
  const report = records()
    .map((value) => reportSchema.safeParse(value))
    .find((result) => result.success);
  assert.ok(
    report?.success,
    "Packaged Agent did not produce a verified result",
  );
  console.log(JSON.stringify(report.data));
} finally {
  const containers = await client.listContainers({
    all: true,
    filters: { label: [`${label}=${owner}`] },
  });
  const cleanup = await Promise.allSettled(
    containers.map(async (container) => {
      const inspected = await client.getContainer(container.Id).inspect();
      assert.equal(inspected.Config.Labels?.[label], owner);
      await client.getContainer(container.Id).remove({ force: true, v: true });
    }),
  );
  const tenant = records()
    .map((value) => tenantSchema.safeParse(value))
    .find((result) => result.success);
  try {
    if (tenant?.success) {
      const owned = await client.listContainers({
        all: true,
        filters: {
          label: [
            "uwork.managed-by=uwork-backend",
            `uwork.tenant-id=${tenant.data.tenantId}`,
          ],
        },
      });
      const owners = owned.map((container) => ({
        id: container.Labels["uwork.runtime-id"]!,
        tenantId: tenant.data.tenantId,
        ownerToken: container.Labels["uwork.sandbox-owner"]!,
        expiresAt: 0,
      }));
      await cleanupSandboxes(
        new DockerSandboxDriver(socket, env.UWORK_SANDBOX_IMAGE),
        owners,
      );
    }
  } finally {
    if (cleanup.some((result) => result.status === "rejected")) {
      const path = resolve(`evidence/container-cleanup-${randomUUID()}.json`);
      await mkdir(resolve("evidence"), { recursive: true, mode: 0o700 });
      await writeFile(
        path,
        JSON.stringify(
          {
            context,
            engineId: env.UWORK_EXPECTED_ENGINE_ID,
            label,
            owner,
            containerIds: containers
              .filter((_, index) => cleanup[index]?.status === "rejected")
              .map((container) => container.Id),
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
      throw new Error(
        `Verification container cleanup failed; protected recovery metadata retained at ${path}`,
      );
    }
  }
}
