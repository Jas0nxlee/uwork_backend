import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { eventually } from "./client-native-session-fixture.js";
import { filesystemFailure } from "./client-workflow-live-assertions.js";
import {
  actor,
  begin,
  configure,
  currentTools,
  evidenceDirectory,
  expertMarker,
  prepared,
  terminal,
  results,
  harness,
  proof,
  publish,
  result,
  step,
} from "./client-workflow-assets-live-fixture.js";

test(
  "direct workflow actor loads approved Skill v1 and current v2 through the real private Host",
  { timeout: 60000 },
  async (t) => {
    const { h, f, cli, id } = await prepared(
      t,
      "workflow-direct-skill-versions",
    );
    let updated = false;
    const previous = h.hooks.beforeModelOpen;
    h.hooks.beforeModelOpen = async (body) => {
      await previous?.(body);
      if (actor(body) && step(body) === 2 && !updated) {
        await publish(f, 2, id);
        updated = true;
      }
    };
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    assert.equal(ack.status, "accepted");
    await terminal(cli, "completed");
    const first = h.bodies.find(
      (b) => actor(b) && step(b) === 1 && currentTools(b).length > 0,
    );
    const second = h.bodies.find(
      (b) => actor(b) && step(b) === 2 && currentTools(b).length > 0,
    );
    assert.ok(
      first &&
        currentTools(first)
          .join("")
          .includes("WORKFLOW_APPROVED_SKILL_VERSION_ONE"),
    );
    assert.ok(
      second &&
        currentTools(second)
          .join("")
          .includes("WORKFLOW_APPROVED_SKILL_VERSION_TWO"),
    );
    assert.ok(
      !h.bodies
        .filter(actor)
        .some((body) => JSON.stringify(body.messages).includes(expertMarker)),
      "same-name enterprise expert is not an implicit workflow persona",
    );
    await proof("workflow-direct-skill-versions", f, h, {
      runId: ack.result.runId,
      versions: [1, 2],
      boundary:
        "real V4 startSavedWorkflow; model tool CreateWorkflow remains separately denied",
    });
  },
);

test(
  "direct workflow actor cannot read revoked Skill from its populated cache",
  { timeout: 60000 },
  async (t) => {
    const { h, f, cli, id } = await prepared(
      t,
      "workflow-direct-skill-revoked",
    );
    let revoked = false;
    const previous = h.hooks.beforeModelOpen;
    h.hooks.beforeModelOpen = async (body) => {
      await previous?.(body);
      if (actor(body) && step(body) === 2 && !revoked) {
        await f.api(
          `${f.p}/policies`,
          "POST",
          {
            name: "Controlled workflow skill revoke",
            family: "skill",
            mode: "deny",
            resourceIds: [id],
            scope: { all: true },
          },
          f.login.token,
          201,
        );
        revoked = true;
      }
    };
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    assert.equal(ack.status, "accepted");
    await terminal(cli, "completed");
    const second = h.bodies.find(
      (b) => actor(b) && step(b) === 2 && currentTools(b).length > 0,
    );
    assert.ok(revoked && second);
    assert.ok(
      !currentTools(second)
        .join("")
        .includes("WORKFLOW_APPROVED_SKILL_VERSION_ONE"),
    );
    assert.equal(currentTools(second).join(""), "enterprise_skill_not_found");
    await proof("workflow-direct-skill-revoked", f, h, {
      runId: ack.result.runId,
      freshSecondSkillDenied: true,
      approvedHistoryRetained: JSON.stringify(second.messages).includes(
        "WORKFLOW_APPROVED_SKILL_VERSION_ONE",
      ),
    });
  },
);

test(
  "direct workflow actor rechecks filesystem permission at its next Skill boundary",
  { timeout: 60000 },
  async (t) => {
    const { h, f, cli } = await prepared(t, "workflow-direct-actor-filesystem");
    let revoked = false;
    const previous = h.hooks.beforeModelOpen;
    h.hooks.beforeModelOpen = async (body) => {
      await previous?.(body);
      if (actor(body) && step(body) === 2 && !revoked) {
        await configure(f, "security", { allowFilesystem: false });
        revoked = true;
      }
    };
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    assert.equal(ack.status, "accepted");
    const facts = await filesystemFailure(cli, h, ack.result.runId);
    assert.ok(revoked);
    await proof("workflow-direct-actor-filesystem", f, h, {
      runId: ack.result.runId,
      ...facts,
    });
  },
);

test(
  "direct workflow actor model request is fenced by actual identity logout",
  { timeout: 60000 },
  async (t) => {
    const { h, f, cli } = await prepared(t, "workflow-direct-actor-identity");
    let fenced = false,
      callsBefore = 0;
    const previous = h.hooks.beforeModelOpen;
    h.hooks.beforeModelOpen = async (body) => {
      await previous?.(body);
      if (actor(body) && step(body) === 2 && !fenced) {
        callsBefore = f.calls();
        await f.logoutIdentity();
        fenced = true;
      }
    };
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    assert.equal(ack.status, "accepted");
    await eventually(
      async () => cli.notifications,
      (values) =>
        fenced &&
        values.some(
          (v) =>
            v.method === "v4/telemetry/event" &&
            v.params.kind === "model.request.status" &&
            v.params.querySource === "workflow_child" &&
            v.params.status === "model_request_failed",
        ),
      10000,
    );
    assert.ok(fenced);
    assert.equal(h.bodies.filter((b) => actor(b) && step(b) === 2).length, 0);
    assert.equal(f.calls(), callsBefore);
    assert.equal(
      (await cli.workflow.cancel(ack.result.runId)).status,
      "accepted",
    );
    await terminal(cli, "stopped");
    await proof("workflow-direct-actor-identity", f, h, {
      runId: ack.result.runId,
      secondActorDispatches: 0,
      callsBefore,
      stoppedExplicitlyAfterFencedAttempt: true,
    });
  },
);

test(
  "stopped direct workflow resumes the same durable run after a cold CLI restart without replaying completed asks",
  { timeout: 60000 },
  async (t) => {
    const { h, f, cli, id } = await prepared(t, "workflow-direct-cold-resume");
    let release!: () => void,
      reached!: () => void,
      held = false;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    const atSecondAsk = new Promise<void>((done) => {
      reached = done;
    });
    const previous = h.hooks.beforeModelOpen;
    h.hooks.beforeModelOpen = async (body) => {
      await previous?.(body);
      if (actor(body) && step(body) === 2 && !held) {
        held = true;
        reached();
        await hold;
      }
    };
    t.after(() => release());
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    assert.equal(ack.status, "accepted");
    await Promise.race([
      atSecondAsk,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("second workflow ask not reached")),
          10000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(
      (await cli.workflow.cancel(ack.result.runId)).status,
      "accepted",
    );
    release();
    await terminal(cli, "stopped");
    assert.equal(h.bodies.filter((b) => actor(b) && step(b) === 2).length, 0);
    await publish(f, 2, id);
    const start = h.bodies.length;
    await cli.disposeAndWait();
    const cold = await f.packaged(true, {
      dynamicWorkflowEnabled: true,
      resumeSessionId: cli.sessionId,
    });
    assert.equal(
      (await cold.workflow.resume(ack.result.runId)).status,
      "accepted",
    );
    await terminal(cold, "completed");
    const resumed = h.bodies.slice(start);
    assert.equal(
      resumed.filter((b) => actor(b) && step(b) === 1).length,
      0,
      "completed ask must replay from the production journal without a new model call",
    );
    const second = resumed.find(
      (b) => actor(b) && step(b) === 2 && currentTools(b).length > 0,
    );
    assert.ok(
      second &&
        currentTools(second)
          .join("")
          .includes("WORKFLOW_APPROVED_SKILL_VERSION_TWO"),
    );
    assert.ok(
      cold.notifications.some(
        (v) =>
          v.params.kind === "workflow.lifecycle" &&
          v.params.runId === ack.result.runId &&
          v.params.status === "completed",
      ),
    );
    await proof("workflow-direct-cold-resume", f, h, {
      runId: ack.result.runId,
      sameRunId: true,
      completedFirstAskSupplierReplays: 0,
      currentVersionLoadedAfterResume: 2,
    });
  },
);

test(
  "direct saved workflow start checks current filesystem permission before launching its VM",
  { timeout: 45000 },
  async (t) => {
    const h = harness(),
      { f, cli: saving } = await begin(
        t,
        "workflow-direct-start-filesystem-fence",
        h,
      );
    assert.match(
      await result(saving, h, "WF_CREATE_SAVE_FOR_DIRECT_START"),
      /Saved the workflow/u,
    );
    await saving.disposeAndWait();
    const cli = await f.packaged(true, { dynamicWorkflowEnabled: true });
    const existingWorkspaceFiles = (
      await readdir(join(cli.workspacePath, ".zcode"))
    ).sort();
    await configure(f, "security", { allowFilesystem: false });
    const calls = f.calls();
    const ack = await cli.workflow.startSaved({
      name: "controlled-asset-workflow",
      scope: "project",
    });
    if (ack.status === "accepted") {
      await cli.workflow.cancel(ack.result.runId);
    }
    await writeFile(
      resolve(
        evidenceDirectory,
        "direct-start-filesystem-fence-observation.json",
      ),
      JSON.stringify(
        {
          ack,
          supplierBefore: calls,
          supplierAfter: f.calls(),
          actorRequests: h.bodies.filter(actor).length,
          notifications: cli.notifications,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    assert.equal(
      ack.status,
      "failed",
      "the existing V4 command-failure contract must refuse the saved start",
    );
    assert.equal(ack.message, "enterprise_filesystem_denied");
    assert.equal(ack.result, undefined);
    assert.deepEqual(
      (await readdir(join(cli.workspacePath, ".zcode"))).sort(),
      existingWorkspaceFiles,
    );
    assert.equal(h.bodies.filter(actor).length, 0);
    assert.equal(f.calls(), calls);
    await proof("workflow-direct-start-filesystem-fence", f, h, {
      refusal: ack,
      newSupplierCalls: 0,
      newActorRequests: 0,
      workspaceFilesUnchanged: true,
    });
  },
);

after(async () => {
  await writeFile(
    resolve(evidenceDirectory, "dynamic-summary.json"),
    JSON.stringify(
      {
        status: results.length === 6 ? "passed" : "partial",
        tests: results.length,
        node: process.version,
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
