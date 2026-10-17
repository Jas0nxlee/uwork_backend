import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  actor,
  harness,
  begin,
  publish,
  configure,
  result,
  savedFiles,
  proof,
  script,
  expertMarker,
  results,
  evidenceDirectory,
} from "./client-workflow-assets-live-fixture.js";
type Row = Record<string, unknown>;

test(
  "formal SaveWorkflow compiler rejects an unsupported enterprise expert persona selector",
  { timeout: 45000 },
  async (t) => {
    const h = harness(),
      { f, cli } = await begin(t, "workflow-expert-selector-refused", h);
    await publish(f, 1, undefined, true);
    h.setScript(
      'const worker = agent("WorkflowPublishedExpert", { expert: "WorkflowPublishedExpert" });\nreturn await worker.ask("Use the expert.");',
    );
    const output = await result(cli, h, "WF_CREATE_INVALID_EXPERT");
    assert.match(output, /expert.*does not exist|does not exist.*expert/iu);
    assert.match(output, /AgentPersona/u);
    assert.equal(h.approvals.length, 0);
    await assert.rejects(savedFiles(cli), { code: "ENOENT" });
    await proof("workflow-expert-selector-refused", f, h, {
      compiled: false,
      saved: false,
      enterpriseExpertConsumptionSupported: false,
    });
  },
);

test(
  "managed workflow saving succeeds while real execution tool admission is unsupported",
  { timeout: 60000 },
  async (t) => {
    const h = harness(),
      { f, cli } = await begin(t, "workflow-managed-execution-boundary", h);
    await publish(f, 1, undefined, true);
    assert.match(
      await result(cli, h, "WF_CREATE_SAVE_VALID"),
      /Saved the workflow 'controlled-asset-workflow'/u,
    );
    assert.equal(h.approvals.length, 1);
    const filenames = await savedFiles(cli);
    assert.equal(filenames.length, 1);
    const savedPath = join(
      cli.workspacePath,
      ".zcode",
      "workflows",
      filenames[0]!,
    );
    const original = await readFile(savedPath, "utf8");
    assert.ok(original.includes(script) && !original.includes(expertMarker));
    const refusals: Row[] = [];
    for (const [name, input] of [
      ["CreateWorkflow", { saved: { name: "controlled-asset-workflow" } }],
      ["AmendWorkflow", { run_id: "controlled-uncreated-run", script }],
      ["ResumeWorkflowRun", { run_id: "controlled-uncreated-run" }],
    ] as [string, Row][]) {
      h.setAction(name, input);
      const output = await result(cli, h, `WF_CREATE_${name}`);
      assert.equal(output, "enterprise_capability_unsupported");
      refusals.push({ tool: name, code: output, handlerReached: false });
    }
    assert.equal(h.approvals.length, 1);
    assert.equal(h.bodies.filter(actor).length, 0);
    assert.ok(
      !cli.notifications.some((v) =>
        JSON.stringify(v.params).includes('"eventType":"run-launched"'),
      ),
    );
    const sessionId = cli.sessionId;
    await cli.disposeAndWait();
    const cold = await f.packaged(true, {
      dynamicWorkflowEnabled: true,
      resumeSessionId: sessionId,
    });
    h.setAction("CreateWorkflow", {
      saved: { name: "controlled-asset-workflow" },
    });
    assert.equal(
      await result(cold, h, "WF_CREATE_COLD_SAVED"),
      "enterprise_capability_unsupported",
    );
    assert.equal(await readFile(savedPath, "utf8"), original);
    await proof("workflow-managed-execution-boundary", f, h, {
      coverageOutcome:
        "current managed admission refuses runtime tools; G02 actor consumption and run resume remain unverified",
      savedFilename: filenames[0],
      refusals,
      coldSameSession: true,
      actorDispatches: 0,
      runCreated: false,
    });
  },
);

test(
  "current filesystem revocation refuses new SaveWorkflow and preserves its existing definition",
  { timeout: 45000 },
  async (t) => {
    const h = harness(),
      { f, cli } = await begin(t, "workflow-save-filesystem-revoked", h);
    assert.match(
      await result(cli, h, "WF_CREATE_SAVE_ALLOWED"),
      /Saved the workflow/u,
    );
    const filenames = await savedFiles(cli),
      savedPath = join(cli.workspacePath, ".zcode", "workflows", filenames[0]!);
    const original = await readFile(savedPath);
    await configure(f, "security", { allowFilesystem: false });
    h.setAction("SaveWorkflow", {
      name: "new-refused-workflow",
      description: "Current permission must deny",
      scope: "project",
      script,
    });
    assert.equal(
      await result(cli, h, "WF_CREATE_SAVE_REVOKED"),
      "enterprise_filesystem_denied",
    );
    assert.deepEqual(await savedFiles(cli), filenames);
    assert.ok((await readFile(savedPath)).equals(original));
    assert.equal(h.approvals.length, 1);
    await proof("workflow-save-filesystem-revoked", f, h, {
      savedFileUnchanged: true,
      deniedNewFileAbsent: true,
    });
  },
);

test(
  "actual identity logout fences a workflow-trigger parent request before supplier dispatch",
  { timeout: 45000 },
  async (t) => {
    const h = harness(),
      { f, cli } = await begin(t, "workflow-trigger-identity-fence", h);
    assert.match(
      await result(cli, h, "WF_CREATE_BEFORE_LOGOUT"),
      /Saved the workflow/u,
    );
    const calls = f.calls();
    await f.logoutIdentity();
    await result(cli, h, "WF_CREATE_AFTER_LOGOUT");
    assert.equal(f.calls(), calls);
    await proof("workflow-trigger-identity-fence", f, h, {
      boundary: "next parent workflow-trigger request; no live actor exists",
      additionalSupplierCalls: 0,
    });
  },
);

after(async () => {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, "summary.json"),
    JSON.stringify(
      {
        status: results.length === 4 ? "passed" : "failed",
        tests: results.length,
        node: process.version,
        assetConsumptionVerified: false,
        managedWorkflowAdmission:
          "runtime tool permissions currently unsupported",
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
