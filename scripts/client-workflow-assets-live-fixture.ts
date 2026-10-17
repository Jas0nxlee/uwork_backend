import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  eventually,
  liveFixture,
  type ControlledSessionHooks,
} from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Cli = Awaited<ReturnType<Fixture["packaged"]>>;
export const evidenceDirectory = "evidence/client-workflow-assets-20261017";
const markerV1 = "WORKFLOW_APPROVED_SKILL_VERSION_ONE";
const markerV2 = "WORKFLOW_APPROVED_SKILL_VERSION_TWO";
export const expertMarker = "EXPERT_BODY_MUST_NOT_BE_IMPLICIT_WORKFLOW_PERSONA";
export const results: Row[] = [];
export const script = [
  'const worker = agent("WorkflowPublishedExpert", { system: "WORKFLOW_ACTOR_IDENTITY" });',
  'const first = await worker.ask("WF_STEP_ONE: invoke the specified enterprise Skill then finish.");',
  'const second = await worker.ask("WF_STEP_TWO: invoke the specified enterprise Skill again then finish.");',
  "return { first, second };",
].join("\n");

function messages(body: Row): Row[] {
  return Array.isArray(body.messages) ? (body.messages as Row[]) : [];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part: Row) => part.text ?? "").join("");
}
export function actor(body: Row): boolean {
  return messages(body).some(
    (m) =>
      m.role === "system" &&
      text(m.content).includes("WORKFLOW_ACTOR_IDENTITY"),
  );
}
function lastUser(body: Row): number {
  return messages(body).findLastIndex((m) => m.role === "user");
}
export function step(body: Row): number {
  return text(messages(body)[lastUser(body)]?.content).includes("WF_STEP_TWO")
    ? 2
    : 1;
}
export function currentTools(body: Row): string[] {
  return messages(body)
    .slice(lastUser(body) + 1)
    .filter((m) => m.role === "tool")
    .map((m) => text(m.content));
}
export function harness() {
  let assetId = "",
    runId = "",
    workflowScript = script,
    toolName = "SaveWorkflow",
    toolInput: Row | undefined;
  const approvals: Row[] = [];
  const bodies: Row[] = [],
    attempted: Row[] = [];
  const hooks: ControlledSessionHooks = {
    evidenceDirectory,
    onPermissionRequest: async (params) => {
      approvals.push(params);
      return { decision: "allow" };
    },
    beforeModelOpen: async (body) => {
      attempted.push(structuredClone(body));
    },
    reply(body) {
      bodies.push(structuredClone(body));
      if (!body.stream) return { text: "Controlled workflow title" };
      const tools = currentTools(body);
      if (actor(body)) {
        if (tools.length) return { text: `WF_STEP_${step(body)}_COMPLETE` };
        return {
          toolCall: {
            id: `workflow-skill-${bodies.length}`,
            name: "Skill",
            arguments: JSON.stringify({ skill: `enterprise:${assetId}` }),
          },
        };
      }
      for (const tool of tools) {
        const match = /background with ID: ([\w-]+)\./u.exec(tool);
        if (match) runId = match[1]!;
      }
      if (tools.length) return { text: "WORKFLOW_PARENT_COMPLETE" };
      const user = text(messages(body)[lastUser(body)]?.content);
      if (user.startsWith("WF_CREATE"))
        return {
          toolCall: {
            id: `workflow-create-${bodies.length}`,
            name: toolName,
            arguments: JSON.stringify(
              toolInput ?? {
                name: "controlled-asset-workflow",
                description: "Controlled asset workflow",
                scope: "project",
                script: workflowScript,
              },
            ),
          },
        };
      if (user.startsWith("WF_RESUME"))
        return {
          toolCall: {
            id: `workflow-resume-${bodies.length}`,
            name: "ResumeWorkflowRun",
            arguments: JSON.stringify({ run_id: runId }),
          },
        };
      return { text: "WORKFLOW_NOTIFICATION_ACKNOWLEDGED" };
    },
  };
  return {
    hooks,
    bodies,
    attempted,
    approvals,
    setAction: (name: string, input: Row) => {
      toolName = name;
      toolInput = input;
    },
    setAsset: (id: string) => {
      assetId = id;
    },
    setScript: (value: string) => {
      workflowScript = value;
    },
    run: () => runId,
  };
}
export async function configure(f: Fixture, kind: string, patch: Row) {
  const old = await f.api<Row>(
    `${f.p}/configurations/${kind}`,
    "GET",
    undefined,
    f.login.token,
  );
  const saved = await f.api<Row>(
    `${f.p}/configurations/${kind}`,
    "PUT",
    { revision: old.revision, data: { ...(old.published as Row), ...patch } },
    f.login.token,
  );
  await f.api(
    `${f.p}/configurations/${kind}/publish`,
    "POST",
    { revision: saved.revision },
    f.login.token,
  );
}
export async function publish(
  f: Fixture,
  version = 1,
  id?: string,
  expert = false,
) {
  const payload = {
    name: expert ? "WorkflowPublishedExpert" : "WorkflowApprovedSkill",
    kind: expert ? "expert" : "skill",
    scope: { all: true },
    content: expert
      ? { instructions: expertMarker, profession: "Controlled expert probe" }
      : {
          files: [
            {
              path: "SKILL.md",
              content: `---\nname: workflow-approved-skill\ndescription: Controlled workflow asset probe\n---\n${version === 1 ? markerV1 : markerV2}`,
            },
          ],
          highRisk: false,
        },
  };
  if (id) {
    const catalog = await f.api<{ items: { id: string; revision: number }[] }>(
      `${f.p}/assets`,
      "GET",
      undefined,
      f.login.token,
    );
    const old = catalog.items.find((v) => v.id === id);
    assert.ok(old);
    await f.api(
      `${f.p}/assets/${id}`,
      "PUT",
      { ...payload, revision: old.revision },
      f.login.token,
    );
  } else
    id = (
      await f.api<{ id: string }>(
        `${f.p}/assets`,
        "POST",
        payload,
        f.login.token,
        201,
      )
    ).id;
  for (const action of ["review", "publish"])
    await f.api(
      `${f.p}/assets/${id}/${action}`,
      "POST",
      { version, ...(action === "review" ? { approved: true } : {}) },
      f.login.token,
    );
  return id;
}
export async function begin(
  t: Parameters<typeof liveFixture>[0],
  name: string,
  h: ReturnType<typeof harness>,
) {
  const f = await liveFixture(t, name, true, h.hooks);
  await configure(f, "security", { allowFilesystem: true });
  // 完整 workflow 工具说明计入上下文；夹具显式提供足够窗口，不能绕过后端预算。
  const model = (
    await f.api<Row[]>(`${f.p}/models`, "GET", undefined, f.login.token)
  )[0]!;
  await f.api(
    `${f.p}/models/${f.model.id}`,
    "PUT",
    {
      ...(model.data as Row),
      name: model.name,
      scope: model.scope,
      revision: model.revision,
      contextWindow: 500000,
    },
    f.login.token,
  );
  const id = await publish(f);
  h.setAsset(id);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged(true, { dynamicWorkflowEnabled: true });
  assert.equal((await cli.setMode("yolo")).status, "accepted");
  return { f, cli, id };
}
export async function prepared(t: Parameters<typeof begin>[0], name: string) {
  const h = harness(),
    { f, cli: saving, id } = await begin(t, name, h);
  assert.match(
    await result(saving, h, "WF_CREATE_SAVE_FOR_DIRECT_START"),
    /Saved the workflow/u,
  );
  await publish(f, 1, undefined, true);
  await saving.disposeAndWait();
  const cli = await f.packaged(true, { dynamicWorkflowEnabled: true });
  return { h, f, cli, id };
}
export async function terminal(cli: Cli, status: string) {
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v) =>
          v.method === "v4/telemetry/event" &&
          v.params.kind === "workflow.lifecycle" &&
          v.params.status === status,
      ),
    25000,
  );
  if (status === "completed")
    await eventually(
      async () => cli.notifications,
      (values) =>
        values.some(
          (v) =>
            v.method === "v4/telemetry/event" &&
            v.params.kind === "model.request.status" &&
            v.params.querySource === "main_turn" &&
            v.params.status === "model_request_completed",
        ),
      10000,
    );
}
async function turn(cli: Cli, message: string) {
  const start = cli.notifications.length;
  assert.equal((await cli.send(message)).status, "accepted");
  await eventually(
    async () => cli.notifications.slice(start),
    (values) =>
      values.some(
        (v) =>
          v.method === "v4/telemetry/event" &&
          v.params.kind === "turn.terminal" &&
          v.params.sessionId === cli.sessionId &&
          typeof v.params.sourceCommandId === "string",
      ),
    25000,
  );
}
export async function result(
  cli: Cli,
  h: ReturnType<typeof harness>,
  message: string,
) {
  const start = h.bodies.length;
  await turn(cli, message);
  return h.bodies.slice(start).flatMap(currentTools).join("\n");
}
export async function savedFiles(cli: Cli) {
  return (await readdir(join(cli.workspacePath, ".zcode", "workflows"))).sort();
}
export async function proof(
  name: string,
  f: Fixture,
  h: ReturnType<typeof harness>,
  facts: Row,
) {
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === f.calls() &&
      value.items.every((row) => row.status === "settled"),
  );
  const row = {
    name,
    status: "passed",
    supplierCalls: f.calls(),
    ledgerRows: usage.items.length,
    ...facts,
  };
  results.push(row);
  f.check(name);
  await writeFile(
    resolve(evidenceDirectory, `${name}-proof.json`),
    JSON.stringify(
      {
        ...row,
        bodies: h.bodies,
        attempted: h.attempted,
        approvals: h.approvals,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
