import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as reservePort } from "node:net";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createApp } from "../../src/app.js";
import { bootstrap } from "../../src/identity.js";
import { DockerSandboxDriver } from "../../src/sandbox/docker.js";
import type {
  SandboxOwner,
  SandboxRuntimeRow,
} from "../../src/sandbox/contract.js";
import { cleanupSandboxes } from "../sandbox-cleanup.js";
import {
  OwnedAdminBrowser,
  boundedWait,
  portClosed,
} from "../fixtures/owned-admin-browser.js";

type Row = Record<string, unknown>;
const scenario = process.env.UWORK_ADMIN_UI_CASE ?? "run";
const uiDrivers: Record<string, string> = {
  run: "admin-run-ui.py",
  evaluation: "admin-run-ui.py",
  "evaluation-cancel": "admin-run-ui.py",
  automation: "admin-automation-ui.py",
  model: "admin-model-ui.py",
  "delete-pending": "admin-delete-pending-ui.py",
  runtime: "admin-runtime-ui.py",
  policy: "admin-policy-ui.py",
  assets: "admin-assets-ui.py",
};
assert.ok(
  Object.hasOwn(uiDrivers, scenario),
  "unsupported original admin UI scenario",
);
const uiDriver = uiDrivers[scenario];
assert.ok(uiDriver, "unsupported original admin UI scenario");
const profile = process.argv[2];
assert.ok(profile);
assert.match(profile, /^admin-run-ui-v\d+-20261021$/);
const evidence = resolve("evidence", profile);
await mkdir(evidence, { mode: 0o700 });
const root = await mkdtemp(join(tmpdir(), "uwork-owned-admin-run-"));
const email = "owned-admin-run@example.test";
const password = randomBytes(24).toString("hex");
const supplierSecret = randomBytes(24).toString("hex");
const supplier: Row[] = [];
const traffic: Row[] = [];
let held = false,
  heldClosed = false,
  heldCloseCount = 0;
const upstream = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    if (req.headers.authorization !== `Bearer ${supplierSecret}`) {
      res.writeHead(401).end();
      return;
    }
    const count = Number(facts.supplierDiscoveryCalls ?? 0);
    facts.supplierDiscoveryCalls = count + 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "owned" }] }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  assert.equal(req.headers.authorization, `Bearer ${supplierSecret}`);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    messages: { content: unknown }[];
  };
  const isHeld = body.messages.some(
    (m) =>
      m.content === "OWNED_ADMIN_HOLD" ||
      (scenario === "evaluation-cancel" &&
        (m.content === "OWNED_EVAL_FIRST" ||
          m.content === "OWNED_EVAL_SECOND")),
  );
  const evaluationInput = body.messages
    .map((message) => message.content)
    .find(
      (value) => value === "OWNED_EVAL_FIRST" || value === "OWNED_EVAL_SECOND",
    );
  const automationInput = body.messages
    .map((message) => message.content)
    .find(
      (value) =>
        value === "OWNED_AUTOMATION_ONCE" ||
        value === "OWNED_AUTOMATION_PAUSED",
    );
  supplier.push({
    held: isHeld,
    ...(evaluationInput ? { evaluationInput } : {}),
    ...(automationInput ? { automationInput } : {}),
  });
  if (isHeld) {
    held = true;
    res.once("close", () => {
      heldClosed = true;
      heldCloseCount++;
    });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { content: "OWNED_ADMIN_RESULT" } }],
      usage: { prompt_tokens: 12, completion_tokens: 2 },
    }),
  );
});
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let browser: OwnedAdminBrowser | undefined;
let sandboxDriver: DockerSandboxDriver | undefined;
let backendPort = 0,
  providerPort = 0;
let token = "";
let releaseDeleteReply: (() => void) | undefined;
const deleteReplyGate = new Promise<void>((resolve) => {
  releaseDeleteReply = resolve;
});
const facts: Row = {
  status: "failed",
  worker: true,
  syntheticOnly: true,
  scenario,
  uiDriver,
  stages: [],
};
try {
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  providerPort = (upstream.address() as { port: number }).port;
  const probe = reservePort();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  backendPort = (probe.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    probe.close((error) => (error ? reject(error) : done())),
  );
  const origin = `http://127.0.0.1:${backendPort}`;
  assert.notEqual(backendPort, 3000);
  if (scenario === "runtime") {
    assert.equal(
      process.env.UWORK_OWNED_SANDBOX_SOCKET,
      "/Users/ljp/.colima/uwork-backend/docker.sock",
    );
    assert.match(
      process.env.UWORK_OWNED_SANDBOX_IMAGE ?? "",
      /^sha256:[a-f0-9]{64}$/,
    );
    sandboxDriver = new DockerSandboxDriver(
      process.env.UWORK_OWNED_SANDBOX_SOCKET!,
      process.env.UWORK_OWNED_SANDBOX_IMAGE!,
    );
    assert.equal((await sandboxDriver.health()).available, true);
  }
  app = await createApp({
    ...(sandboxDriver ? { sandboxDriver } : {}),
    database: join(root, "fixture.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: origin,
    worker: true,
    allowPrivateUpstreams: true,
    logger: false,
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (typeof payload === "string" && payload.includes(supplierSecret))
      facts.responseLeakedSupplierSecret = true;
    if (
      req.routeOptions.url === "/api/tenants/:tenantId/audit" &&
      typeof payload === "string"
    ) {
      const body = JSON.parse(payload) as { items?: Row[] };
      const receipts = (facts.auditResponses ??= []) as Row[];
      receipts.push({
        query: (req.query as Row).q,
        actions: body.items?.map((row) => row.action),
        total: body.items?.length,
      });
    }
    traffic.push({
      source:
        req.headers["x-owned-test-source"] === "controller"
          ? "controller"
          : "browser",
      method: req.method,
      route: req.routeOptions.url,
      status: reply.statusCode,
    });
    if (
      scenario === "delete-pending" &&
      req.headers["x-owned-test-source"] !== "controller" &&
      req.method === "DELETE" &&
      req.routeOptions.url === "/api/tenants/:tenantId/automations/:id"
    ) {
      facts.deleteReplyAttempts = Number(facts.deleteReplyAttempts ?? 0) + 1;
      if (reply.statusCode === 204) await deleteReplyGate;
    }
    return payload;
  });
  const owner = await bootstrap(app.services.db, {
    name: "Owned run UI",
    email,
    password,
  });
  await app.listen({ host: "127.0.0.1", port: backendPort });
  const api = async (
    path: string,
    method = "GET",
    data?: Row,
    expected = 200,
  ): Promise<Row> => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        "x-owned-test-source": "controller",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(response.status, expected, `controlled ${method} status`);
    return response.status === 204 ? {} : ((await response.json()) as Row);
  };
  token = String(
    (await api("/api/auth/login", "POST", { email, password })).token,
  );
  const prefix = `/api/tenants/${owner.tenantId}`;
  const credential = await api(
    prefix + "/credentials",
    "POST",
    { name: "Owned supplier", value: supplierSecret },
    201,
  );
  const model = await api(
    prefix + "/models",
    "POST",
    {
      name: "Owned model",
      upstreamModel: "owned",
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      credentialId: credential.id,
      scope: { all: true },
      maxOutputTokens: 128,
      inputRate: 1000,
      outputRate: 1000,
    },
    201,
  );
  const agent = await api(
    prefix + "/agents",
    "POST",
    {
      name: "Owned admin execution",
      modelId: model.id,
      instructions: "Respond to this owned functional test.",
      assetIds: [],
      scope: { all: true },
      maxOutputTokens: 64,
    },
    201,
  );
  await api(`${prefix}/agents/${agent.id}/publish`, "POST", { version: 1 });
  const controlPath = join(root, "control.json");
  const control: Row = {
    origin,
    email,
    password,
    tenantId: owner.tenantId,
    userId: owner.userId,
    agentId: agent.id,
    modelId: model.id,
    credentialId: credential.id,
    modelBaseUrl: `http://127.0.0.1:${providerPort}/v1`,
  };
  const saveControl = () =>
    writeFile(controlPath, JSON.stringify(control), { mode: 0o600 });
  await saveControl();
  browser = new OwnedAdminBrowser({
    root,
    evidence,
    name: profile,
    redact: (value) =>
      [password, supplierSecret, token].reduce(
        (text, secret) => text.replaceAll(secret, "[redacted]"),
        value,
      ),
  });
  await browser.start();
  const stages = facts.stages as Row[];
  const run = async (stage: string) => {
    const receipt = await browser!.run(
      resolve("scripts/tests", uiDriver),
      stage,
      {
        UWORK_ADMIN_RUN_CONTROL: controlPath,
      },
    );
    stages.push(receipt);
    return receipt;
  };
  if (scenario === "policy") {
    const { runAdminPolicyCase } = await import("./admin-policy-case.js");
    await runAdminPolicyCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
    });
  } else if (scenario === "assets") {
    const { runAdminAssetsCase } = await import("./admin-assets-case.js");
    await runAdminAssetsCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
    });
  } else if (scenario === "runtime") {
    const { runAdminRuntimeCase } = await import("./admin-runtime-case.js");
    await runAdminRuntimeCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
    });
  } else if (scenario === "delete-pending") {
    const { runAdminDeletePendingCase } = await import(
      "./admin-delete-pending-case.js"
    );
    await runAdminDeletePendingCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
      releaseDeleteReply: () => releaseDeleteReply!(),
    });
  } else if (scenario === "model") {
    const { runAdminModelCase } = await import("./admin-model-case.js");
    await runAdminModelCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
    });
  } else if (scenario === "automation") {
    const { runAdminAutomationCase } = await import(
      "./admin-automation-case.js"
    );
    await runAdminAutomationCase({
      app,
      prefix,
      api,
      run,
      control,
      saveControl,
      supplier,
      traffic,
      facts,
    });
  } else if (scenario === "evaluation" || scenario === "evaluation-cancel") {
    await run("create-dataset");
    const datasets = await api(prefix + "/datasets");
    assert.ok(Array.isArray(datasets));
    assert.equal(datasets.length, 1);
    control.datasetId = (datasets as Row[])[0]!.id;
    await saveControl();
    const dataset = await api(`${prefix}/datasets/${control.datasetId}`);
    assert.equal((dataset.cases as Row[]).length, 2);
    await run("create-evaluation");
    if (scenario === "evaluation-cancel") {
      const evaluations = await boundedWait(
        async () => {
          const rows = await api(prefix + "/evaluations");
          assert.ok(Array.isArray(rows));
          return rows as Row[];
        },
        (rows) =>
          rows.length === 1 &&
          rows[0]?.status === "running" &&
          supplier.filter((row) => row.held).length === 2,
        "two actual in-flight evaluation cases",
      );
      control.evaluationId = evaluations[0]!.id;
      const cases = (evaluations[0]!.report as { cases: { runId: string }[] })
        .cases;
      const before = app.services.db.all<Row>(
        "SELECT id,status,reserved,amount FROM ledger ORDER BY id",
      );
      assert.equal(before.length, 2);
      assert.ok(before.every((row) => row.status === "reserved"));
      await saveControl();
      await run("evaluation-cancel");
      await boundedWait(
        async () => heldCloseCount,
        (count) => count === 2,
        "both supplier connections cancelled",
      );
      for (const row of cases) {
        const child = await api(`${prefix}/runs/${row.runId}`);
        assert.equal(child.status, "cancelled");
        assert.equal(child.error_code, "CANCELLED");
        assert.equal(child.output, null);
      }
      const cancelled = await api(
        `${prefix}/evaluations/${control.evaluationId}`,
      );
      assert.equal(cancelled.status, "cancelled");
      const ledger = app.services.db.all<Row>(
        "SELECT id,status,reserved,amount FROM ledger ORDER BY id",
      );
      assert.equal(ledger.length, 2);
      for (const row of ledger) {
        assert.equal(row.status, "uncertain");
        assert.equal(
          row.amount,
          before.find((entry) => entry.id === row.id)!.reserved,
        );
      }
      assert.equal(supplier.length, 2);
      assert.equal(
        app.services.db.get<{ n: number }>(
          "SELECT count(*) n FROM runs WHERE status IN ('queued','running')",
        )!.n,
        0,
      );
      const cancelAudits = app.services.db.all<Row>(
        "SELECT user_id,action,target FROM audit WHERE action IN ('evaluation.cancel','runtime.cancel')",
      );
      assert.equal(
        cancelAudits.filter((row) => row.action === "runtime.cancel").length,
        2,
      );
      assert.equal(
        cancelAudits.filter(
          (row) =>
            row.action === "evaluation.cancel" &&
            row.target === control.evaluationId,
        ).length,
        1,
      );
      assert.ok(cancelAudits.every((row) => row.user_id === owner.userId));
      const browserTraffic = traffic.filter((row) => row.source === "browser");
      assert.equal(
        browserTraffic.filter(
          (row) =>
            row.method === "POST" &&
            row.route === "/api/tenants/:tenantId/evaluations/:id/cancel" &&
            row.status === 200,
        ).length,
        1,
      );
      facts.status = "passed";
      facts.supplier = supplier;
      facts.ledger = ledger;
      facts.heldConnectionsClosed = heldCloseCount;
      facts.evaluationCancelled = true;
      facts.cancelAudits = cancelAudits;
    } else {
      const evaluations = await boundedWait(
        async () => {
          const rows = await api(prefix + "/evaluations");
          assert.ok(Array.isArray(rows));
          return rows as Row[];
        },
        (rows) => rows.length === 1 && rows[0]?.status === "succeeded",
        "original evaluation worker",
      );
      const evaluation = evaluations[0]!;
      control.evaluationId = evaluation.id;
      await saveControl();
      const report = evaluation.report as {
        total: number;
        passed: number;
        passRate: number;
        cases: { runId: string; passed: boolean; status: string }[];
      };
      assert.equal(report.total, 2);
      assert.equal(report.passed, 2);
      assert.equal(report.passRate, 1);
      assert.ok(
        report.cases.every((row) => row.passed && row.status === "succeeded"),
      );
      for (const row of report.cases) {
        const run = await api(`${prefix}/runs/${row.runId}`);
        assert.equal(run.output, "OWNED_ADMIN_RESULT");
        assert.equal(run.user_id, owner.userId);
        assert.equal(run.tenant_id, owner.tenantId);
      }
      await run("evaluation-detail");
      assert.deepEqual(supplier.map((row) => row.evaluationInput).sort(), [
        "OWNED_EVAL_FIRST",
        "OWNED_EVAL_SECOND",
      ]);
      const ledger = app.services.db.all<Row>(
        "SELECT status,amount,input_tokens,output_tokens FROM ledger ORDER BY id",
      );
      assert.equal(ledger.length, 2);
      assert.ok(
        ledger.every(
          (row) =>
            row.status === "settled" &&
            row.amount === 14 &&
            row.input_tokens === 12 &&
            row.output_tokens === 2,
        ),
      );
      const browserTraffic = traffic.filter((row) => row.source === "browser");
      for (const [route, status] of [
        ["datasets", 201],
        ["evaluations", 202],
      ] as const) {
        assert.equal(
          browserTraffic.filter(
            (row) =>
              row.route === "/api/tenants/:tenantId/" + route &&
              row.method === "POST" &&
              row.status === status,
          ).length,
          1,
        );
      }
      const audits = app.services.db.all<Row>(
        "SELECT user_id,action,target FROM audit WHERE action IN ('evaluation.dataset.create','evaluation.create')",
      );
      assert.equal(audits.length, 2);
      assert.ok(audits.every((row) => row.user_id === owner.userId));
      assert.equal(
        audits.find((row) => row.action === "evaluation.dataset.create")
          ?.target,
        control.datasetId,
      );
      assert.equal(
        audits.find((row) => row.action === "evaluation.create")?.target,
        control.evaluationId,
      );
      const encrypted = app.services.db.get<{ cases: string }>(
        "SELECT cases FROM datasets WHERE id=?",
        control.datasetId as string,
      )!;
      assert.ok(!encrypted.cases.includes("OWNED_EVAL"));
      const encryptedReport = app.services.db.get<{ report: string }>(
        "SELECT report FROM evaluations WHERE id=?",
        control.evaluationId as string,
      )!;
      assert.ok(!encryptedReport.report.includes("runId"));
      facts.status = "passed";
      facts.supplier = supplier;
      facts.ledger = ledger;
      facts.evaluation = {
        total: report.total,
        passed: report.passed,
        passRate: report.passRate,
      };
      facts.evaluationAudits = audits;
      facts.databaseContentEncrypted = true;
    }
  } else {
    await run("launch-success");
    const success = await boundedWait(
      () => api(prefix + "/runs"),
      (data) =>
        Array.isArray(data.items) &&
        (data.items as Row[]).length === 1 &&
        (data.items as Row[])[0]?.status === "succeeded",
      "original worker successful run",
    );
    control.successId = (success.items as Row[])[0]!.id;
    await saveControl();
    await run("success-detail");
    await run("launch-held");
    const hanging = await boundedWait(
      () => api(prefix + "/runs"),
      (data) =>
        held &&
        Array.isArray(data.items) &&
        (data.items as Row[]).some((r) => r.status === "running"),
      "actual held supplier request",
    );
    control.heldId = (hanging.items as Row[]).find(
      (r) => r.status === "running",
    )!.id;
    await saveControl();
    const heldLedger = app.services.db.all<Row>(
      "SELECT id,status,reserved,amount FROM ledger ORDER BY id",
    );
    const reserved = heldLedger.find((r) => r.status === "reserved");
    assert.ok(reserved);
    await run("cancel-held");
    await boundedWait(
      async () => heldClosed,
      (value) => value,
      "supplier cancellation connection closed",
    );
    await run("cancel-detail-reload");
    const audit = app.services.db.all<Row>(
      "SELECT user_id,action,target FROM audit WHERE action LIKE 'runtime.%' ORDER BY action,target",
    );
    assert.equal(audit.length, 3);
    assert.ok(audit.every((row) => row.user_id === owner.userId));
    assert.deepEqual(
      audit
        .filter((row) => row.action === "runtime.enqueue")
        .map((row) => row.target)
        .sort(),
      [control.successId, control.heldId].sort(),
    );
    assert.equal(
      audit.find((row) => row.action === "runtime.cancel")?.target,
      control.heldId,
    );
    facts.runtimeAudit = audit;
    await run("audit-consumer");
    const ledger = app.services.db.all<Row>(
      "SELECT id,status,reserved,amount,input_tokens,output_tokens FROM ledger ORDER BY id",
    );
    facts.ledger = ledger;
    assert.equal(ledger.length, 2);
    assert.equal(ledger.find((r) => r.status === "settled")?.amount, 14);
    const cancelled = ledger.find((r) => r.id === reserved.id);
    assert.equal(cancelled?.status, "uncertain");
    assert.equal(cancelled.amount, reserved.reserved);
    assert.equal(supplier.length, 2);
    const browserTraffic = traffic.filter((r) => r.source === "browser");
    assert.equal(
      browserTraffic.filter(
        (r) =>
          r.method === "POST" &&
          r.route === "/api/tenants/:tenantId/runs" &&
          r.status === 202,
      ).length,
      2,
    );
    assert.equal(
      browserTraffic.filter(
        (r) =>
          r.method === "POST" &&
          r.route === "/api/tenants/:tenantId/runs/:id/cancel" &&
          r.status === 200,
      ).length,
      1,
    );
    assert.equal(
      app.services.db.get<{ n: number }>(
        "SELECT count(*) n FROM runs WHERE status IN ('queued','running')",
      )!.n,
      0,
    );
    facts.status = "passed";
    facts.supplier = supplier;
    facts.heldConnectionClosed = heldClosed;
    facts.ledger = ledger;
    facts.runtimeAudit = audit;
  }
} catch (error) {
  facts.failure =
    error instanceof assert.AssertionError
      ? {
          kind: "assertion",
          message: error.message.split("\n")[0],
          operator: error.operator,
          actual:
            typeof error.actual === "number" ||
            typeof error.actual === "boolean"
              ? error.actual
              : typeof error.actual,
          expected:
            typeof error.expected === "number" ||
            typeof error.expected === "boolean"
              ? error.expected
              : typeof error.expected,
        }
      : { kind: error instanceof Error ? error.name : "unknown" };
} finally {
  releaseDeleteReply?.();
  facts.traffic = traffic;
  facts.browserCleanup = await browser?.close();
  if (browser && !(facts.browserCleanup as Row)?.fullyClosed)
    facts.status = "failed";
  const sandboxOwners: SandboxOwner[] =
    sandboxDriver && app
      ? app.services.db
          .all<SandboxRuntimeRow>("SELECT * FROM sandbox_runtimes")
          .map((row) => ({
            id: row.id,
            tenantId: row.tenant_id,
            ownerToken: row.owner_token,
            expiresAt: row.expires_at,
          }))
      : [];
  await app?.close();
  if (sandboxDriver) {
    try {
      await cleanupSandboxes(
        sandboxDriver,
        sandboxOwners,
        join(evidence, "private-recovery"),
      );
      facts.sandboxCleanupVerified = true;
    } catch {
      facts.sandboxCleanupFailed = true;
      facts.status = "failed";
    }
  }
  upstream.closeAllConnections();
  await new Promise<void>((done) => upstream.close(() => done()));
  facts.backendPortClosed = backendPort ? await portClosed(backendPort) : true;
  facts.providerPortClosed = providerPort
    ? await portClosed(providerPort)
    : true;
  if (!facts.backendPortClosed || !facts.providerPortClosed)
    facts.status = "failed";
  if (
    (!browser || (facts.browserCleanup as Row)?.fullyClosed) &&
    !facts.sandboxCleanupFailed
  ) {
    await rm(root, { recursive: true, force: true });
    facts.privateRootRemoved = true;
  }
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(facts, null, 2),
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(facts));
process.exitCode = facts.status === "passed" ? 0 : 1;
