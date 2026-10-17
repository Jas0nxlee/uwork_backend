import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  eventually,
  liveFixture,
  type ControlledSessionHooks,
} from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Cli = Awaited<ReturnType<Fixture["packaged"]>>;
const evidenceDirectory = "evidence/client-expert-resume-20261017";
const expertName = "ControlledEnterpriseExpert";
const markerV1 = "EXPERT_PUBLISHED_INSTRUCTIONS_VERSION_ONE";
const markerV2 = "EXPERT_PUBLISHED_INSTRUCTIONS_VERSION_TWO";
const personalMarker = "PERSONAL_SAME_NAME_MUST_NOT_REPLACE_ENTERPRISE";
const results: Row[] = [];

function messages(body: Row): Row[] {
  return Array.isArray(body.messages) ? (body.messages as Row[]) : [];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part: Row) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}
function isChild(body: Row): boolean {
  return messages(body).some(
    (message) =>
      message.role === "user" &&
      text(message.content).includes("EXPERT_CHILD_TASK"),
  );
}
function controlledHooks(
  bodies: Row[],
  selectedType: () => string = () => expertName,
): ControlledSessionHooks {
  return {
    evidenceDirectory,
    prepareCliWorkspace: async ({ storageDirectory }) => {
      const agents = join(storageDirectory, "agents");
      await mkdir(agents, { recursive: true });
      await writeFile(
        join(agents, "same-name.md"),
        `---\nname: ${expertName}\ndescription: Controlled same-name local profile\n---\n${personalMarker}`,
      );
    },
    reply: (body) => {
      bodies.push(structuredClone(body));
      if (!body.stream) return { text: "Controlled expert task" };
      if (isChild(body)) return { text: "EXPERT_CHILD_COMPLETE" };
      const list = messages(body);
      const lastUser = list.findLastIndex((message) => message.role === "user");
      if (list.slice(lastUser + 1).some((message) => message.role === "tool"))
        return { text: "EXPERT_PARENT_COMPLETE" };
      return {
        toolCall: {
          id: `controlled-expert-${bodies.length}`,
          name: "Agent",
          arguments: JSON.stringify({
            description: "Invoke published enterprise expert",
            prompt:
              "EXPERT_CHILD_TASK: reply EXPERT_CHILD_COMPLETE without tools",
            subagent_type: selectedType(),
          }),
        },
      };
    },
  };
}
async function configure(f: Fixture, kind: string, patch: Row) {
  const current = await f.api<Row>(
    `${f.p}/configurations/${kind}`,
    "GET",
    undefined,
    f.login.token,
  );
  const saved = await f.api<Row>(
    `${f.p}/configurations/${kind}`,
    "PUT",
    {
      revision: current.revision,
      data: { ...(current.published as Row), ...patch },
    },
    f.login.token,
  );
  await f.api(
    `${f.p}/configurations/${kind}/publish`,
    "POST",
    { revision: saved.revision },
    f.login.token,
  );
}
async function publishExpert(f: Fixture, version: number, id?: string) {
  if (!id) await configure(f, "security", { allowFilesystem: true });
  const payload = {
    name: expertName,
    kind: "expert",
    scope: { all: true },
    content: {
      instructions: version === 1 ? markerV1 : markerV2,
      profession: "Controlled expert integration probe",
    },
  };
  if (id) {
    const catalog = await f.api<{ items: { id: string; revision: number }[] }>(
      `${f.p}/assets`,
      "GET",
      undefined,
      f.login.token,
    );
    const selected = catalog.items.find((item) => item.id === id);
    assert.ok(selected);
    await f.api(
      `${f.p}/assets/${id}`,
      "PUT",
      { ...payload, revision: selected.revision },
      f.login.token,
    );
  } else {
    const created = await f.api<{ id: string }>(
      `${f.p}/assets`,
      "POST",
      payload,
      f.login.token,
      201,
    );
    id = created.id;
  }
  for (const operation of ["review", "publish"])
    await f.api(
      `${f.p}/assets/${id}/${operation}`,
      "POST",
      { version, ...(operation === "review" ? { approved: true } : {}) },
      f.login.token,
    );
  return id;
}
async function runTurn(cli: Cli, label: string) {
  const initial = cli.notifications.length;
  assert.equal(
    (await cli.send(`EXPERT_PARENT_TRIGGER ${label}`)).status,
    "accepted",
  );
  await eventually(
    async () => cli.notifications.slice(initial),
    (notifications) =>
      notifications.some(
        (value) =>
          value.method === "v4/telemetry/event" &&
          value.params.kind === "turn.terminal" &&
          value.params.sessionId === cli.sessionId &&
          typeof value.params.sourceCommandId === "string",
      ),
    25000,
  );
}
async function settled(f: Fixture) {
  return eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (usage) =>
      usage.items.length === f.calls() &&
      usage.items.every((row) => row.status === "settled"),
  );
}
function assertExpert(body: Row | undefined, marker: string) {
  assert.ok(body, "a real child supplier request must exist");
  assert.ok(
    messages(body).some(
      (message) =>
        message.role === "system" && text(message.content).includes(marker),
    ),
    "published expert instructions must enter the actual child system message",
  );
  assert.ok(!JSON.stringify(body.messages).includes(personalMarker));
}
async function proof(
  name: string,
  f: Fixture,
  supplierBodies: Row[],
  facts: Row,
) {
  const usage = await settled(f);
  const row = {
    name,
    status: "passed",
    supplierCalls: f.calls(),
    settledLedgerRows: usage.items.length,
    ...facts,
  };
  results.push(row);
  f.check(name);
  await writeFile(
    resolve(evidenceDirectory, `${name}-model-proof.json`),
    JSON.stringify({ ...row, supplierBodies }, null, 2),
    { mode: 0o600 },
  );
}

test(
  "published enterprise expert wins a same-name personal profile in an actual Agent child request",
  { timeout: 45000 },
  async (t) => {
    const bodies: Row[] = [];
    const f = await liveFixture(
      t,
      "expert-current",
      true,
      controlledHooks(bodies),
    );
    await publishExpert(f, 1);
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    await runTurn(cli, "VERSION_ONE");
    await eventually(
      async () => bodies,
      (values) => values.some((value) => !value.stream),
    );
    const children = bodies.filter(isChild);
    assert.equal(children.length, 1);
    assertExpert(children[0], markerV1);
    assert.equal(f.calls(), 4);
    await proof("expert-current", f, bodies, { children: children.length });
  },
);

test(
  "warm expert snapshot stays v1 while cold resume of the same persisted session admits published v2",
  { timeout: 60000 },
  async (t) => {
    const bodies: Row[] = [];
    const f = await liveFixture(
      t,
      "expert-resume-version",
      true,
      controlledHooks(bodies),
    );
    const id = await publishExpert(f, 1);
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    await runTurn(cli, "BEFORE_UPDATE");
    await eventually(
      async () => bodies,
      (values) => values.some((value) => !value.stream),
    );
    await publishExpert(f, 2, id);
    await runTurn(cli, "WARM_AFTER_UPDATE");
    const warmChildren = bodies.filter(isChild);
    assert.equal(warmChildren.length, 2);
    warmChildren.forEach((body) => assertExpert(body, markerV1));
    const sessionId = cli.sessionId;
    await cli.disposeAndWait();
    const frameStart = f.privateFrames.length;
    const supplierStart = bodies.length;
    const resumed = await f.packaged(true, { resumeSessionId: sessionId });
    assert.equal(resumed.sessionId, sessionId);
    await runTurn(resumed, "COLD_AFTER_UPDATE");
    const children = bodies.slice(supplierStart).filter(isChild);
    assert.equal(children.length, 1);
    assertExpert(children[0], markerV2);
    const resumedParent = bodies
      .slice(supplierStart)
      .find((body) => body.stream && !isChild(body));
    assert.ok(
      JSON.stringify(resumedParent?.messages).includes("BEFORE_UPDATE"),
    );
    assert.ok(
      JSON.stringify(resumedParent?.messages).includes("WARM_AFTER_UPDATE"),
    );
    const admissions = f.privateFrames.slice(frameStart).filter((frame) => {
      const params = (frame as { params?: Row }).params;
      const asset = params?.asset as { asset?: Row } | undefined;
      return (
        params?.phase === "asset_load" &&
        asset?.asset?.id === id &&
        asset.asset.version === 2
      );
    });
    assert.ok(
      admissions.length >= 2,
      "cold resume must reauthorize v2 before and after body load",
    );
    await proof("expert-resume-version", f, bodies, {
      sessionId,
      warmChildren: 2,
      resumedChildren: 1,
      resumedV2Admissions: admissions.length,
    });
  },
);

test(
  "cold resume after expert revocation cannot fall back to a same-name personal expert or dispatch a child",
  { timeout: 60000 },
  async (t) => {
    const bodies: Row[] = [];
    const f = await liveFixture(
      t,
      "expert-resume-revoked",
      true,
      controlledHooks(bodies),
    );
    const id = await publishExpert(f, 1);
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    await runTurn(cli, "BEFORE_REVOKE");
    await eventually(
      async () => bodies,
      (values) => values.some((value) => !value.stream),
    );
    assertExpert(bodies.find(isChild), markerV1);
    await cli.disposeAndWait();
    await f.api(
      `${f.p}/policies`,
      "POST",
      {
        name: "Controlled expert revoke",
        family: "expert",
        mode: "deny",
        resourceIds: [id],
        scope: { all: true },
      },
      f.login.token,
      201,
    );
    const supplierStart = bodies.length;
    const resumed = await f.packaged(true, { resumeSessionId: cli.sessionId });
    await runTurn(resumed, "AFTER_REVOKE");
    const subsequent = bodies.slice(supplierStart);
    const children = subsequent.filter(isChild);
    assert.equal(
      children.length,
      0,
      "revoked enterprise name cannot dispatch a personal fallback child",
    );
    assert.ok(
      subsequent.every(
        (body) => !JSON.stringify(body.messages).includes(personalMarker),
      ),
    );
    const beforeModelRevoke = f.calls();
    await f.api(
      `${f.p}/policies`,
      "POST",
      {
        name: "Controlled current model revoke",
        family: "model",
        mode: "deny",
        resourceIds: [f.model.id],
        scope: { all: true },
      },
      f.login.token,
      201,
    );
    await runTurn(resumed, "CURRENT_MODEL_REVOKED");
    assert.equal(f.calls(), beforeModelRevoke);
    const denied = resumed.notifications.findLast(
      (value) =>
        value.method === "v4/telemetry/event" &&
        value.params.kind === "turn.terminal" &&
        value.params.sessionId === resumed.sessionId,
    );
    assert.equal(denied?.params.status, "failed");
    await proof("expert-resume-revoked", f, bodies, {
      sessionId: cli.sessionId,
      newChildren: children.length,
      modelRevokeDispatches: f.calls() - beforeModelRevoke,
      modelRevokeErrorCode: denied?.params.errorCode,
    });
  },
);

test(
  "managed allowed personal profiles use canonical names and current policy without reviving a revoked enterprise name",
  { timeout: 60000 },
  async (t) => {
    const bodies: Row[] = [];
    let selectedType = expertName;
    const f = await liveFixture(
      t,
      "expert-personal-current-policy",
      true,
      controlledHooks(bodies, () => selectedType),
    );
    t.after(() =>
      writeFile(
        resolve(
          evidenceDirectory,
          "expert-personal-current-policy-observations.json",
        ),
        JSON.stringify({ supplierBodies: bodies }, null, 2),
        { mode: 0o600 },
      ),
    );
    const phaseCounts = (from: number) => {
      const supplied = bodies.slice(from);
      return {
        parent: supplied.filter((body) => body.stream && !isChild(body)).length,
        child: supplied.filter(isChild).length,
        title: supplied.filter((body) => !body.stream).length,
      };
    };
    const id = await publishExpert(f, 1);
    await configure(f, "personal", { skills: true });
    await configure(f, "security", { dangerousSkills: true });
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    await runTurn(cli, "PERSONAL_ALLOWED_ENTERPRISE_FIRST");
    await eventually(
      async () => bodies,
      (values) => values.some((body) => !body.stream),
    );
    assertExpert(bodies.find(isChild), markerV1);
    const initial = phaseCounts(0);
    await cli.disposeAndWait();
    await f.api(
      `${f.p}/policies`,
      "POST",
      {
        name: "Controlled revoke while personal allowed",
        family: "expert",
        mode: "deny",
        resourceIds: [id],
        scope: { all: true },
      },
      f.login.token,
      201,
    );
    const resumed = await f.packaged(true, { resumeSessionId: cli.sessionId });
    const plainStart = bodies.length;
    await runTurn(resumed, "OLD_PLAIN_NAME_AFTER_ENTERPRISE_REVOKE");
    const revokedPlain = phaseCounts(plainStart);
    assert.equal(
      revokedPlain.child,
      0,
      "even explicitly allowed personal profiles cannot revive the revoked plain enterprise name",
    );
    selectedType = `personal:user:${expertName}`;
    const personalStart = bodies.length;
    await runTurn(resumed, "CANONICAL_PERSONAL_ALLOWED");
    const canonicalPersonal = phaseCounts(personalStart);
    assert.equal(canonicalPersonal.child, 1);
    const personal = bodies.slice(personalStart).find(isChild);
    assert.ok(personal);
    assert.ok(
      messages(personal).some(
        (message) =>
          message.role === "system" &&
          text(message.content).includes(personalMarker),
      ),
    );
    assert.ok(!JSON.stringify(personal.messages).includes(markerV1));
    await configure(f, "personal", { skills: false });
    const deniedStart = bodies.length;
    const deniedFrameStart = f.privateFrames.length;
    await runTurn(resumed, "CANONICAL_PERSONAL_REVOKED_SAME_RUNTIME");
    const revokedCanonical = phaseCounts(deniedStart);
    assert.equal(
      revokedCanonical.child,
      0,
      "current backend personal policy must deny a previously loaded canonical profile before supplier dispatch",
    );
    const currentPersonalAdmissions = f.privateFrames
      .slice(deniedFrameStart)
      .filter((frame) => {
        const params = (frame as { params?: Row }).params;
        const capability = params?.capability as Row | undefined;
        return capability?.permission === "personal_agent";
      }).length;
    assert.ok(
      currentPersonalAdmissions >= 1,
      "the previously loaded canonical profile must reach current private Host personal_agent admission",
    );
    await proof("expert-personal-current-policy", f, bodies, {
      sessionId: cli.sessionId,
      canonicalName: selectedType,
      revokedCanonicalCurrentAdmissions: currentPersonalAdmissions,
      phases: { initial, revokedPlain, canonicalPersonal, revokedCanonical },
    });
  },
);

after(async () => {
  await mkdir(evidenceDirectory, { recursive: true });
  const cleanup = [];
  for (const name of [
    "expert-current",
    "expert-resume-version",
    "expert-resume-revoked",
    "expert-personal-current-policy",
  ]) {
    try {
      const saved = JSON.parse(
        await readFile(
          resolve(evidenceDirectory, `${name}-green.json`),
          "utf8",
        ),
      );
      cleanup.push({
        name,
        ...saved.cleanup,
        cliProcesses: saved.cliProcesses,
      });
    } catch {
      cleanup.push({ name, missing: true });
    }
  }
  await writeFile(
    resolve(evidenceDirectory, "summary.json"),
    JSON.stringify(
      {
        status: results.length === 4 ? "passed" : "failed",
        expectedScenarios: 4,
        boundary:
          "real HTTP email/bootstrap + private identity owner/encrypted store + Gateway/Registry + current packaged CLI; controlled supplier only; actual cold resume same persisted session; Native/automation-bound resume/workflow remain separate",
        results,
        cleanup,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
