import assert from "node:assert/strict";
import Docker from "dockerode";
import { boundedWait } from "../fixtures/owned-admin-browser.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminRuntimeCase(p: AdminUiCasePorts) {
  const socket = process.env.UWORK_OWNED_SANDBOX_SOCKET;
  const image = process.env.UWORK_OWNED_SANDBOX_IMAGE;
  assert.equal(socket, "/Users/ljp/.colima/uwork-backend/docker.sock");
  assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/);
  const docker = new Docker({ socketPath: socket!, timeout: 15000 });
  const configuration = await p.api(
    p.prefix + "/configurations/security",
    "PUT",
    {
      revision: 0,
      data: {
        allowShell: false,
        allowFilesystem: false,
        allowNetwork: false,
        dangerousSkills: false,
        allowedDomains: [],
        allowSandbox: true,
      },
    },
  );
  await p.api(p.prefix + "/configurations/security/publish", "POST", {
    revision: configuration.revision,
  });
  const capability = await p.api(p.prefix + "/runtimes/capability");
  assert.equal(capability.available, true);
  assert.equal(capability.image, image);
  assert.equal(capability.network, false);
  assert.equal(capability.hostMounts, false);
  await p.run("create-runtime");
  const runtimes = await p.api(p.prefix + "/runtimes");
  const first = (runtimes.items as Row[])[0]!;
  assert.equal((runtimes.items as Row[]).length, 1);
  assert.equal(first.status, "ready");
  p.control.runtimeId = first.id;
  const container = docker.getContainer(`uwork-sbx-${first.id}`);
  const initial = await container.inspect();
  const stored = p.app.services.db.get<Row>(
    "SELECT * FROM sandbox_runtimes WHERE id=?",
    first.id as string,
  )!;
  assert.equal(
    initial.Config.Labels?.["uwork.sandbox-owner"],
    stored.owner_token,
  );
  assert.equal(initial.Config.Labels?.["uwork.runtime-id"], first.id);
  assert.equal(initial.Image, image);
  assert.equal(initial.State.Running, true);
  assert.equal(initial.HostConfig.NetworkMode, "none");
  assert.equal(initial.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(initial.HostConfig.CapDrop, ["ALL"]);
  assert.equal(
    initial.Mounts.some((mount) => mount.Type === "bind"),
    false,
  );
  await p.saveControl();
  await p.run("edit-runtime");
  const updated = await p.api(`${p.prefix}/runtimes/${first.id}`);
  assert.equal(updated.revision, 2);
  assert.equal(updated.containerId, first.containerId);
  assert.equal(updated.expiresAt, first.expiresAt);
  p.control.shortCode =
    "console.log(JSON.stringify({sum:Array.from({length:10},(_,i)=>i+1).reduce((a,b)=>a+b,0),uid:process.getuid(),cwd:process.cwd(),noKey:!process.env.MASTER_KEY}))";
  p.control.longCode =
    "await new Promise(resolve=>setTimeout(resolve,20000));console.log('OWNED_RUNTIME_DELAYED')";
  await p.saveControl();
  const short = (await p.run("execute-short")) as Row;
  assert.equal(typeof short.executionId, "string");
  p.control.shortId = short.executionId;
  await boundedWait(
    () => p.api(`${p.prefix}/sandbox-executions/${short.executionId}`),
    (row) => row.status === "succeeded",
    "real Docker execution by original worker",
  );
  const ciphertext = p.app.services.db.get<Row>(
    "SELECT code,stdout FROM sandbox_executions WHERE id=?",
    short.executionId as string,
  )!;
  assert.ok(
    !String(ciphertext.code).includes("console.log") &&
      !String(ciphertext.stdout).includes("sum"),
  );
  await p.saveControl();
  await p.run("short-output");
  const long = (await p.run("execute-long")) as Row;
  p.control.longId = long.executionId;
  await boundedWait(
    () => p.api(`${p.prefix}/sandbox-executions/${long.executionId}`),
    (row) => row.status === "running",
    "actual in-flight Docker code",
  );
  const active = await boundedWait(
    () => container.inspect(),
    (info) => info.State.Running && (info.ExecIDs?.length ?? 0) >= 1,
    "actual Docker exec admitted",
  );
  assert.equal(active.State.Running, true);
  assert.ok((active.ExecIDs?.length ?? 0) >= 1);
  await p.saveControl();
  await p.run("stop-busy");
  assert.equal((await container.inspect()).State.Running, false);
  const stopped = await p.api(
    `${p.prefix}/sandbox-executions/${long.executionId}`,
  );
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.error_code, "CANCELLED");
  await p.run("cancelled-detail");
  const history = p.app.services.db.all<Row>(
    "SELECT * FROM sandbox_executions ORDER BY id",
  );
  assert.equal(history.length, 2);
  const denied = await p.api(
    `${p.prefix}/runtimes/${first.id}/executions`,
    "POST",
    { code: "console.log('OWNED_STOPPED_REJECT')" },
    409,
  );
  assert.equal((denied.error as Row).code, "SANDBOX_STOPPED");
  assert.deepEqual(
    p.app.services.db.all<Row>("SELECT * FROM sandbox_executions ORDER BY id"),
    history,
  );
  await p.run("delete-runtime");
  await assert.rejects(
    () => container.inspect(),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404,
  );
  assert.deepEqual(
    p.app.services.db.all<Row>("SELECT * FROM sandbox_executions ORDER BY id"),
    history,
  );
  assert.equal(
    p.app.services.db.get<Row>(
      "SELECT status FROM sandbox_runtimes WHERE id=?",
      first.id as string,
    )!.status,
    "deleted",
  );
  assert.equal(p.supplier.length, 0);
  assert.equal(
    p.app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n,
    0,
  );
  const browser = p.traffic.filter((row) => row.source === "browser");
  for (const [method, route, status, count] of [
    ["POST", "/runtimes", 201, 1],
    ["PATCH", "/runtimes/:id", 200, 1],
    ["POST", "/runtimes/:id/executions", 202, 2],
    ["POST", "/runtimes/:id/stop", 200, 1],
    ["DELETE", "/runtimes/:id", 204, 1],
  ] as const) {
    assert.equal(
      browser.filter(
        (row) =>
          row.method === method &&
          row.route === "/api/tenants/:tenantId" + route &&
          row.status === status,
      ).length,
      count,
    );
  }
  p.facts.status = "passed";
  p.facts.runtimeImage = image;
  p.facts.originalDriverAndWorker = true;
  p.facts.containerStoppedThenRemoved = true;
  p.facts.metadataUpdateRetainedContainerAndTtl = true;
  p.facts.historyRetainedAfterRuntimeDeletion = true;
  p.facts.codeAndOutputStoredEncrypted = true;
  p.facts.noModelOrLedgerIncrement = true;
}
