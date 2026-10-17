import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventually,
  liveFixture,
  type ControlledSessionHooks,
} from "./client-native-session-fixture.js";

type Row = Record<string, unknown>;
const evidenceDirectory = "evidence/client-subagent-relay-20261017";
function messages(body: Row): Row[] {
  return Array.isArray(body.messages)
    ? body.messages.filter(
        (v): v is Row => !!v && typeof v === "object" && !Array.isArray(v),
      )
    : [];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part: unknown) =>
      part &&
      typeof part === "object" &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}
function isChild(body: Row): boolean {
  return messages(body).some(
    (message) =>
      message.role === "user" &&
      text(message.content).includes("CONTROL_CHILD_TASK"),
  );
}
function modelBodies(frames: unknown[]): Row[] {
  return frames.flatMap((value) => {
    if (!value || typeof value !== "object" || !("params" in value)) return [];
    const params = value.params;
    if (!params || typeof params !== "object" || !("request" in params))
      return [];
    const request = params.request;
    if (
      !request ||
      typeof request !== "object" ||
      !("kind" in request) ||
      request.kind !== "open" ||
      !("body" in request) ||
      typeof request.body !== "string"
    )
      return [];
    return [JSON.parse(request.body) as Row];
  });
}
function controlledReply(observed: string[]): ControlledSessionHooks["reply"] {
  return (body) => {
    if (!body.stream) {
      observed.push("title-json");
      return { text: "Controlled child task" };
    }
    if (isChild(body)) {
      observed.push("child-sse");
      return { text: "CONTROL_CHILD_COMPLETE" };
    }
    if (messages(body).some((m) => m.role === "tool")) {
      observed.push("parent-after-tool-sse");
      return { text: "CONTROL_PARENT_COMPLETE" };
    }
    observed.push("parent-agent-tool-sse");
    return {
      toolCall: {
        id: "controlled-agent-call",
        name: "Agent",
        arguments: JSON.stringify({
          description: "Controlled child relay",
          prompt:
            "CONTROL_CHILD_TASK: reply CONTROL_CHILD_COMPLETE without tools",
          subagent_type: "general-purpose",
        }),
      },
    };
  };
}

test(
  "actual packaged Agent child uses the same keyless private Host relay and authorized default",
  { timeout: 45000 },
  async (t) => {
    const observed: string[] = [];
    const f = await liveFixture(t, "agent-child-success", true, {
      evidenceDirectory,
      reply: controlledReply(observed),
    });
    assert.ok((await f.gateway().sync("login")).committed);
    const cli = await f.packaged(true);
    assert.equal(
      (await cli.send("CONTROL_PARENT_TRIGGER: delegate the task using Agent"))
        .status,
      "accepted",
    );
    await eventually(
      async () => cli.notifications,
      (values) =>
        values.some(
          (v) =>
            v.method === "v4/telemetry/event" &&
            v.params.kind === "turn.terminal" &&
            v.params.status === "success" &&
            typeof v.params.sourceCommandId === "string",
        ),
      25000,
    );
    await eventually(
      async () => observed,
      (values) => values.filter((kind) => kind === "title-json").length === 1,
    );
    assert.ok(
      observed.includes("child-sse"),
      `real supplier child dispatch missing: ${observed.join(",")}`,
    );
    assert.ok(
      observed.includes("parent-after-tool-sse"),
      "parent must receive actual Agent tool result",
    );
    const opens = modelBodies(f.privateFrames);
    assert.equal(opens.filter(isChild).length, 1);
    const childStatus = cli.notifications.filter(
      (v) =>
        v.method === "v4/telemetry/event" &&
        v.params.kind === "model.request.status" &&
        v.params.querySource === "subagent",
    );
    assert.ok(
      childStatus.some(
        (v) =>
          v.params.status === "model_request_started" &&
          v.params.modelId === f.model.id,
      ),
    );
    assert.ok(opens.every((body) => body.model === f.model.id));
    assert.equal(
      f.calls(),
      4,
      "parent tool request, child, resumed parent, automatic title are distinct real generations",
    );
    assert.equal(
      opens.length,
      f.calls(),
      "each private model open must have one observed backend vendor request",
    );
    const usage = await eventually(
      () =>
        f.api<{ items: Row[] }>(
          `${f.p}/usage`,
          "GET",
          undefined,
          f.login.token,
        ),
      (value) =>
        value.items.length === 4 &&
        value.items.every((row) => row.status === "settled"),
    );
    assert.ok(usage.items.every((row) => row.amount === 9));
    f.check(
      `actual-Agent-child-parent-return-private-RPC-open${opens.length}-vendor${f.calls()}-settled${usage.items.length}`,
    );
  },
);

test(
  "current backend seat revocation before real Agent child relay dispatch cannot create child usage",
  { timeout: 45000 },
  async (t) => {
    const observed: string[] = [];
    let revoked = false;
    const hooks: ControlledSessionHooks = {
      evidenceDirectory,
      reply: controlledReply(observed),
      beforeModelOpen: async (body) => {
        if (isChild(body) && !revoked) {
          await revoke();
          revoked = true;
        }
      },
    };
    const f = await liveFixture(t, "agent-child-revoked", true, hooks);
    assert.ok((await f.gateway().sync("login")).committed);
    const revoke = async () => {
      const profile = await f.api<{ user: { id: string } }>(
        "/api/auth/me",
        "GET",
        undefined,
        f.login.token,
      );
      assert.equal(typeof profile.user.id, "string");
      await f.api(
        `${f.p}/members/${profile.user.id}`,
        "PATCH",
        { seat: false },
        f.login.token,
      );
    };
    const cli = await f.packaged(true);
    assert.equal(
      (await cli.send("CONTROL_PARENT_TRIGGER: delegate the task using Agent"))
        .status,
      "accepted",
    );
    await eventually(
      async () => cli.notifications,
      (values) =>
        values.some(
          (v) =>
            v.method === "v4/telemetry/event" &&
            v.params.kind === "turn.terminal" &&
            typeof v.params.sourceCommandId === "string",
        ),
      25000,
    );
    assert.ok(revoked, "real child open must reach the private Host hook");
    const failedChild = cli.notifications.find(
      (v) =>
        v.method === "v4/telemetry/event" &&
        v.params.kind === "turn.terminal" &&
        String(v.params.sessionId).startsWith("sess_subagent_"),
    );
    assert.equal(failedChild?.params.status, "failed");
    assert.equal(failedChild?.params.errorCode, "NO_SEAT");
    assert.ok(
      f.requests.some(
        (r) => r.route === "/v1/chat/completions" && r.status === 403,
      ),
    );
    assert.equal(
      f.calls(),
      1,
      "only the already admitted parent request may have dispatched",
    );
    assert.ok(
      !observed.includes("child-sse"),
      "revoked child must never reach actual supplier",
    );
    const opens = modelBodies(f.privateFrames);
    assert.equal(opens.filter(isChild).length, 1);
    const usage = await f.api<{ items: Row[] }>(
      `${f.p}/usage`,
      "GET",
      undefined,
      f.login.token,
    );
    assert.equal(usage.items.length, f.calls());
    assert.ok(usage.items.every((row) => row.status === "settled"));
    f.check(
      `actual-child-seat-revoked-before-private-dispatch-no-child-supplier-ledger${usage.items.length}`,
    );
  },
);
