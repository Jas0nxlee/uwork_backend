import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createActiveQuitHold,
  ACTIVE_QUIT_MARKER,
  assertHeldAccounting,
  assertCancelAccounting,
  assertQuitAccounting,
} from "./mac-native-active-quit-runtime.mjs";
function fake() {
  let clock = 0,
    timeout;
  const r = Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {
      this.headersSent = true;
    },
    write() {
      assert.fail("No SSE bytes");
    },
    end() {
      assert.fail("No success");
    },
    destroy() {
      this.destroyed = true;
      this.emit("close");
    },
  });
  const hold = createActiveQuitHold({
    now: () => clock,
    setTimer: (fn) => ((timeout = fn), 1),
    clearTimer() {},
  });
  return {
    r,
    hold,
    expire() {
      clock = 45001;
      timeout();
    },
  };
}
const body = () => ({
  model: "controlled",
  stream: true,
  messages: [
    { role: "system", content: "- Primary working directory: /owned/project" },
    { role: "user", content: ACTIVE_QUIT_MARKER + " 请继续。" },
  ],
  tools: Array(32).fill({ type: "function" }),
});
test("one marker/cwd-bound stream sends headers only and records real close without release", () => {
  const f = fake();
  f.hold.arm("/owned/project");
  assert.equal(f.hold.intercept(body(), f.r, 5), true);
  assert(f.r.headersSent);
  assert.equal(f.hold.safe().closed, false);
  f.r.destroy();
  assert.equal(f.hold.safe().closed, true);
  assert.equal(f.hold.safe().watchdogExpired, false);
  assert.equal(f.hold.safe().cleanupTriggered, false);
  assert.throws(() => f.hold.intercept(body(), f.r, 6));
});
test("wrong model/cwd/stream and duplicate arm reject; unrelated seed is not held", () => {
  for (const change of [
    (b) => (b.model = "foreign"),
    (b) => (b.stream = false),
    (b) => (b.messages[0].content = "- Primary working directory: /foreign"),
  ]) {
    const f = fake();
    f.hold.arm("/owned/project");
    const b = body();
    change(b);
    assert.throws(() => f.hold.intercept(b, f.r, 5));
  }
  const f = fake();
  assert.equal(
    f.hold.intercept({ messages: [{ role: "user", content: "seed" }] }, f.r, 1),
    false,
  );
  f.hold.arm("/owned/project");
  assert.throws(() => f.hold.arm("/owned/project"));
});
test("watchdog/dispose close are recorded distinctly and never create successful completion", () => {
  const f = fake();
  f.hold.arm("/owned/project");
  f.hold.intercept(body(), f.r, 5);
  f.expire();
  assert(f.hold.safe().watchdogExpired);
  assert.equal(f.hold.safe().downstreamFinished, false);
  const g = fake();
  g.hold.arm("/owned/project");
  g.hold.intercept(body(), g.r, 5);
  g.hold.dispose();
  assert(g.hold.safe().cleanupTriggered);
});
function stages() {
  const warm = {
    modelCalls: 4,
    rawInferencePosts: 4,
    supplierRequestDigests: ["a", "b", "c", "d"],
    nativeAlive: true,
    nativeExit: null,
    hold: { received: false },
    snapshot: {
      actors: {
        current: {
          accounting: {
            ledger: [
              {
                id: "l1",
                status: "settled",
                amount: 22,
                input_tokens: 12,
                output_tokens: 10,
              },
              {
                id: "l2",
                status: "settled",
                amount: 22,
                input_tokens: 12,
                output_tokens: 10,
              },
            ],
            traces: [{ id: "t1" }, { id: "t2" }],
            gatewayCalls: [
              { requestKeyDigest: "k1" },
              { requestKeyDigest: "k2" },
            ],
          },
        },
        other: {
          accounting: {
            ledger: [{ id: "other" }],
            traces: [],
            gatewayCalls: [],
          },
        },
      },
    },
  };
  const held = structuredClone(warm);
  Object.assign(held, {
    modelCalls: 5,
    rawInferencePosts: 5,
    supplierRequestDigests: [...warm.supplierRequestDigests, "hold"],
    hold: {
      received: true,
      closed: false,
      headersSent: true,
      watchdogExpired: false,
      cleanupTriggered: false,
      requestSha256: "fixed",
      requestIndex: 5,
    },
  });
  held.snapshot.actors.current.accounting.ledger.push({
    id: "lh",
    requestKeyDigest: "kh",
    status: "reserved",
    amount: 0,
    reserved: 500,
    input_tokens: 0,
    output_tokens: 0,
    settled_at: null,
    model_id: "m",
    application: "uwork",
    tenant_id: "tenant",
    user_id: "user",
  });
  held.snapshot.actors.current.accounting.gatewayCalls.push({
    requestKeyDigest: "kh",
    has_result: 0,
  });
  const after = structuredClone(held);
  after.nativeAlive = false;
  after.nativeExit = { code: 0, signal: null };
  after.hold.closed = true;
  after.hold.downstreamFinished = false;
  Object.assign(after.snapshot.actors.current.accounting.ledger.at(-1), {
    status: "uncertain",
    amount: 500,
    settled_at: 100,
  });
  after.snapshot.actors.current.accounting.traces.push({
    id: "tf",
    status: "failed",
    error_code: "CANCELLED",
    input_tokens: 0,
    output_tokens: 0,
    model_id: "m",
    application: "uwork",
    tenant_id: "tenant",
    user_id: "user",
  });
  return { warm, held, after };
}
test("exact held/cancel/final oracle preserves reservation and conservative uncertain amount", () => {
  const { warm, held, after } = stages();
  assertHeldAccounting(warm, held);
  assertCancelAccounting(held, structuredClone(held));
  assertQuitAccounting(warm, held, after);
});
test("oracle rejects refund, settlement, extra title, other actor drift, watchdog and wrong exit", () => {
  for (const mutate of [
    (a) =>
      (a.snapshot.actors.current.accounting.ledger.at(-1).status = "released"),
    (a) => (a.snapshot.actors.current.accounting.ledger.at(-1).amount = 22),
    (a) => a.modelCalls++,
    (a) => (a.snapshot.actors.other.accounting.ledger[0].id = "changed"),
    (a) => (a.hold.watchdogExpired = true),
    (a) => (a.nativeExit.signal = "SIGTERM"),
  ]) {
    const { warm, held, after } = stages();
    mutate(after);
    assert.throws(() => assertQuitAccounting(warm, held, after));
  }
  const { held } = stages();
  const c = structuredClone(held);
  c.hold.closed = true;
  assert.throws(() => assertCancelAccounting(held, c));
});
