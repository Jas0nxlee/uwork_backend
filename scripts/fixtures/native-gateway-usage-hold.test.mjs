import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  createNativeGatewayUsageHold,
  gatewayUsageHoldModeEnabled,
  isNativeGatewayUsageHoldCommand,
} from "./native-gateway-usage-hold.mjs";

const path = "/api/client/usage?period=month&metric=requests";
const closed = (stream) =>
  new Promise((resolve) => stream.once("close", resolve));
function responsePair(status = 200) {
  const reply = new PassThrough();
  reply.statusCode = status;
  reply.headers = {
    "content-type": "application/json",
    "x-owned": "unchanged",
  };
  const res = new PassThrough();
  const body = [];
  let deliveries = 0;
  let deliveredHeaders;
  res.on("data", (value) => body.push(value));
  const deliver = () => {
    deliveries++;
    deliveredHeaders = reply.headers;
    reply.pipe(res);
  };
  return {
    reply,
    res,
    deliver,
    body,
    get deliveries() {
      return deliveries;
    },
    get headers() {
      return deliveredHeaders;
    },
  };
}

test("usage hold is opt-in, scoped and accepts only four exact no-arg commands", () => {
  assert.equal(
    gatewayUsageHoldModeEnabled(undefined, true, undefined, "old-default"),
    false,
  );
  assert.equal(
    gatewayUsageHoldModeEnabled(
      "enabled",
      false,
      "controlled",
      "client-native-gateway-usage-owned",
    ),
    true,
  );
  for (const args of [
    [undefined, false, "controlled", "client-native-gateway-usage-owned"],
    ["enabled", true, "controlled", "client-native-gateway-usage-owned"],
    ["enabled", false, "controlled", "client-native-other"],
  ])
    assert.throws(
      () => gatewayUsageHoldModeEnabled(...args),
      /NATIVE_GATEWAY_USAGE_HOLD_REJECTED/,
    );
  const gate = createNativeGatewayUsageHold();
  assert.equal(
    isNativeGatewayUsageHoldCommand({ op: "gatewayUsageHoldStatus" }),
    true,
  );
  assert.equal(isNativeGatewayUsageHoldCommand({ op: "configure" }), false);
  assert.throws(
    () => gate.command({ op: "armGatewayUsageHold", arbitrary: "secret" }),
    /NATIVE_GATEWAY_USAGE_HOLD_REJECTED/,
  );
  assert.equal(gate.command({ op: "gatewayUsageHoldStatus" }).armed, false);
});

test("disarmed, unrelated, non-200 and already closed responses are never held", async () => {
  const gate = createNativeGatewayUsageHold();
  const p = responsePair();
  assert.equal(
    gate.hold(
      { method: "GET", url: path },
      p.res,
      p.reply,
      p.deliver,
      Date.now(),
    ),
    false,
  );
  gate.command({ op: "armGatewayUsageHold" });
  for (const req of [
    { method: "POST", url: path },
    { method: "GET", url: "/api/client/configuration" },
    { method: "GET", url: path + "&extra=1" },
  ])
    assert.equal(gate.hold(req, p.res, p.reply, p.deliver, Date.now()), false);
  const other = responsePair(401);
  assert.equal(
    gate.hold(
      { method: "GET", url: path },
      other.res,
      other.reply,
      other.deliver,
      Date.now(),
    ),
    false,
  );
  assert.equal(
    gate.command({ op: "gatewayUsageHoldStatus" }).response200,
    false,
  );
  assert.equal(p.deliveries, 0);
  gate.command({ op: "disposeGatewayUsageHold" });
  p.reply.destroy();
  p.res.destroy();
  other.reply.destroy();
  other.res.destroy();
  const closedGate = createNativeGatewayUsageHold();
  closedGate.command({ op: "armGatewayUsageHold" });
  const ended = responsePair();
  const end = closed(ended.res);
  ended.res.destroy();
  await end;
  assert.equal(
    closedGate.hold(
      { method: "GET", url: path },
      ended.res,
      ended.reply,
      ended.deliver,
      Date.now(),
    ),
    false,
  );
  assert.equal(
    closedGate.command({ op: "gatewayUsageHoldStatus" }).held,
    false,
  );
  closedGate.command({ op: "disposeGatewayUsageHold" });
  ended.reply.destroy();
});

test("one pending response preserves its real stream bytes and headers, release never replays", async () => {
  const gate = createNativeGatewayUsageHold();
  gate.command({ op: "armGatewayUsageHold" });
  const p = responsePair();
  const requestStartedAtMs = Date.now() - 1000; // A pre-existing request keeps its original time; a runner must reject wrong attribution.
  assert.equal(
    gate.hold(
      { method: "GET", url: path },
      p.res,
      p.reply,
      p.deliver,
      requestStartedAtMs,
    ),
    true,
  );
  p.reply.end("SYNTHETIC_USAGE_BODY");
  assert.equal(gate.command({ op: "gatewayUsageHoldStatus" }).held, true);
  assert.equal(p.deliveries, 0);
  assert.equal(p.body.length, 0);
  assert.throws(
    () => gate.command({ op: "armGatewayUsageHold" }),
    /NATIVE_GATEWAY_USAGE_HOLD_REJECTED/,
  );
  const finish = new Promise((resolve) => p.res.once("finish", resolve));
  gate.command({ op: "releaseGatewayUsageHold" });
  gate.command({ op: "releaseGatewayUsageHold" });
  await finish;
  assert.equal(p.deliveries, 1);
  assert.equal(Buffer.concat(p.body).toString(), "SYNTHETIC_USAGE_BODY");
  assert.equal(p.headers, p.reply.headers);
  const status = gate.command({ op: "gatewayUsageHoldStatus" });
  assert.equal(status.downstreamFinished, true);
  assert.equal(status.held, false);
  assert.equal(status.response200, true);
  assert.equal(status.matchedResponses, 1);
  assert.equal(status.oneShotId, 1);
  assert.equal(status.oneShotCount, 1);
  assert.equal(status.requestStartedAtMs, requestStartedAtMs);
  assert.ok(status.replyHeldAtMs >= requestStartedAtMs);
});

test("a second matching response cannot replace the one-shot pending slot", () => {
  const gate = createNativeGatewayUsageHold();
  gate.command({ op: "armGatewayUsageHold" });
  const first = responsePair();
  const second = responsePair();
  assert.equal(
    gate.hold(
      { method: "GET", url: path },
      first.res,
      first.reply,
      first.deliver,
      Date.now(),
    ),
    true,
  );
  assert.equal(
    gate.hold(
      { method: "GET", url: path },
      second.res,
      second.reply,
      second.deliver,
      Date.now(),
    ),
    false,
  );
  assert.equal(
    gate.command({ op: "gatewayUsageHoldStatus" }).duplicateResponse,
    true,
  );
  gate.command({ op: "disposeGatewayUsageHold" });
  assert.equal(first.reply.destroyed && first.res.destroyed, true);
  assert.equal(second.reply.destroyed || second.res.destroyed, false);
  second.reply.destroy();
  second.res.destroy();
});

test("actual downstream close retires the held response and release records a drop", async () => {
  const gate = createNativeGatewayUsageHold();
  gate.command({ op: "armGatewayUsageHold" });
  const p = responsePair();
  gate.hold(
    { method: "GET", url: path },
    p.res,
    p.reply,
    p.deliver,
    Date.now(),
  );
  const end = closed(p.res);
  p.res.destroy();
  await end;
  const status = gate.command({ op: "releaseGatewayUsageHold" });
  assert.equal(status.downstreamClosed, true);
  assert.equal(status.held, false);
  assert.equal(status.releaseRequested, true);
  assert.equal(status.deliveryStarted, false);
  assert.equal(p.deliveries, 0);
  assert.equal(p.reply.destroyed, true);
});

test("upstream errors are observed and disposal is bounded, idempotent and private", async () => {
  for (const failure of [true, false]) {
    const gate = createNativeGatewayUsageHold();
    gate.command({ op: "armGatewayUsageHold" });
    const p = responsePair();
    gate.hold(
      { method: "GET", url: path },
      p.res,
      p.reply,
      p.deliver,
      Date.now(),
    );
    const ends = Promise.all([closed(p.reply), closed(p.res)]);
    if (failure) p.reply.destroy(Error("SECRET_ERROR_OR_URL"));
    else gate.command({ op: "disposeGatewayUsageHold" });
    await ends;
    gate.command({ op: "disposeGatewayUsageHold" });
    const status = gate.command({ op: "disposeGatewayUsageHold" });
    assert.equal(status.held, false);
    assert.equal(status.disposed, true);
    assert.equal(status.transportError, failure);
    assert.equal(p.deliveries, 0);
    assert.equal(JSON.stringify(status).includes("SECRET"), false);
  }
});

test("actual Common retirement branch preserves the new-mode root on empty errors", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const branch = source.slice(
    source.indexOf("  paths.setDataBaseDir(null);"),
    source.indexOf('  await writeFile(\n    evidence + "/cleanup.json"'),
  );
  assert.match(branch, /!gatewayUsageRaceEnabled/);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "paths",
    "errors",
    "gatewayUsageRaceEnabled",
    "attempt",
    "rm",
    "root",
    branch,
  );
  for (const enabled of [false, true]) {
    let removals = 0;
    await run(
      { setDataBaseDir() {} },
      [],
      enabled,
      async (fn) => fn(),
      async () => {
        removals++;
      },
      "/synthetic-owned-root",
    );
    assert.equal(removals, enabled ? 0 : 1);
  }
});
