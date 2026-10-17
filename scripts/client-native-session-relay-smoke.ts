import assert from "node:assert/strict";
import { test } from "node:test";
import { liveFixture, eventually } from "./client-native-session-fixture.js";
type Row = Record<string, unknown>;

test("packaged CLI JSON uses private Host model relay without any key exchange", async (t) => {
  const f = await liveFixture(t, "stdio-json", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  const result = await cli.json();
  assert.equal(result.text, "联动测试完成。");
  assert.equal(result.usage.totalTokens, 7);
  const usage = await f.api<{ items: Row[] }>(
    `${f.p}/usage`,
    "GET",
    undefined,
    f.login.token,
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  assert.equal(usage.items[0]!.status, "settled");
  assert.equal(usage.items[0]!.amount, 9);
  f.check("actual-packaged-JSON-private-relay-vendor1-settled1-no-secret");
});

test("packaged CLI V4 SSE and title settle through the same private relay", async (t) => {
  const f = await liveFixture(t, "stdio-sse", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 2 &&
      value.items.every((row) => row.status === "settled"),
  );
  assert.equal(f.calls(), 2);
  assert.ok(usage.items.every((row) => row.amount === 9));
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v: { method: string; params: Row }) =>
          v.method === "v4/telemetry/event" &&
          v.params.kind === "turn.terminal" &&
          v.params.status === "success",
      ),
  );
  const chunks = cli.notifications.filter(
    (v: { method: string; params: Row }) =>
      v.method === "v4/telemetry/event" &&
      v.params.kind === "stream.chunk" &&
      v.params.channel === "text",
  );
  assert.deepEqual(
    chunks.map((v: { params: Row }) => v.params.chunkLength),
    [2, 2, 3],
  );
  f.check(
    "actual-packaged-SSE-3delta-success-main-plus-auto-title-vendor2-ledger2-no-secret",
  );
});

test("packaged CLI stop cancels pending Host open and closes actual backend upstream", async (t) => {
  const f = await liveFixture(t, "stdio-cancel", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierReceivedAt,
  );
  f.observations.abortAt = Date.now();
  assert.equal((await cli.stop()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierClosedAt,
    2000,
  );
  assert.ok(f.observations.proxyClosedAt && f.observations.backendClosedAt);
  assert.ok(f.observations.supplierClosedAt);
  assert.ok(f.observations.supplierClosedAt - f.observations.abortAt < 2000);
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 1 && value.items[0]!.status === "uncertain",
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  f.check(
    "packaged-V4-stop-cancel-notice-closes-pending-open-all3hops-uncertain-not-refund",
  );
});

test("packaged CLI stop during an admitted Host read closes streamed SSE", async (t) => {
  const f = await liveFixture(t, "stdio-cancel-read", true);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged();
  assert.equal((await cli.send()).status, "accepted");
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v: { method: string; params: Row }) =>
          v.method === "v4/telemetry/event" && v.params.kind === "stream.chunk",
      ),
  );
  f.observations.abortAt = Date.now();
  assert.equal((await cli.stop()).status, "accepted");
  await eventually(
    async () => f.observations,
    (value) => !!value.supplierClosedAt,
    2000,
  );
  assert.ok(f.observations.supplierClosedAt);
  assert.ok(f.observations.supplierClosedAt - f.observations.abortAt < 2000);
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 1 && value.items[0]!.status === "uncertain",
  );
  assert.equal(f.calls(), 1);
  assert.equal(usage.items.length, 1);
  f.check(
    "packaged-stop-active-read-closes-3hops-uncertain-partial-SSE-no-refund",
  );
});

test("fresh packaged CLI sends its first message with Gateway default and no manually selected model", async (t) => {
  const f = await liveFixture(t, "stdio-fresh-default", false);
  assert.ok((await f.gateway().sync("login")).committed);
  const cli = await f.packaged(true);
  assert.equal((await cli.send()).status, "accepted");
  const usage = await eventually(
    () =>
      f.api<{ items: Row[] }>(`${f.p}/usage`, "GET", undefined, f.login.token),
    (value) =>
      value.items.length === 2 &&
      value.items.every((row) => row.status === "settled"),
  );
  assert.equal(f.calls(), 2);
  assert.ok(usage.items.every((row) => row.amount === 9));
  const opens = f.privateFrames.flatMap((value: unknown) => {
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
  assert.equal(opens.length, 2);
  assert.ok(opens.some((body) => body.stream === true));
  assert.ok(opens.some((body) => body.stream !== true));
  assert.ok(
    opens.every(
      (body) =>
        !Object.hasOwn(body, "tools") && !Object.hasOwn(body, "tool_choice"),
    ),
  );
  assert.ok(opens.every((body) => body.model === f.model.id));
  assert.ok(
    opens.every(
      (body) =>
        !Object.hasOwn(body, "reasoning_effort") &&
        !Object.hasOwn(body, "thinking") &&
        !Object.hasOwn(body, "max_completion_tokens"),
    ),
  );
  await eventually(
    async () => cli.notifications,
    (values) =>
      values.some(
        (v) =>
          v.method === "v4/telemetry/event" &&
          v.params.kind === "turn.terminal" &&
          v.params.status === "success",
      ),
  );
  f.check(
    "fresh-HOME-no-create-config-no-send-selection-default-opaque-none-main-and-title-success",
  );
});
