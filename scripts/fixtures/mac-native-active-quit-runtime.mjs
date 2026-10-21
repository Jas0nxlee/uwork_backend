/** Controlled supplier observation only. No app ownership, UI action or business mutation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
export const ACTIVE_QUIT_MARKER = "MACOS_ACTIVE_QUIT_HOLD_20261021";
const text = (m) =>
  typeof m?.content === "string"
    ? m.content
    : Array.isArray(m?.content)
      ? m.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
      : "";
export function createActiveQuitHold({
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let workspace, response, timer, started, closedAt;
  const state = {
    armed: false,
    received: false,
    closed: false,
    headersSent: false,
    downstreamFinished: false,
    watchdogExpired: false,
    cleanupTriggered: false,
  };
  return {
    arm(path) {
      assert(
        !state.armed &&
          typeof path === "string" &&
          path.startsWith("/") &&
          !path.includes("\0"),
      );
      workspace = path;
      state.armed = true;
    },
    intercept(body, res, index) {
      const user = body.messages?.findLast((m) => m.role === "user");
      if (!text(user).includes(ACTIVE_QUIT_MARKER)) return false;
      assert(state.armed && !state.received);
      assert.equal(body.model, "controlled");
      assert.equal(body.stream, true);
      assert.equal(body.tools?.length, 32);
      const cwd = (body.messages ?? [])
        .filter((m) => m.role === "system")
        .flatMap((m) =>
          [
            ...text(m).matchAll(/^- Primary working directory: ([^\r\n]+)$/gm),
          ].map((x) => x[1]),
        );
      assert.deepEqual(cwd, [workspace]);
      assert(Number.isSafeInteger(index) && index > 0);
      response = res;
      started = now();
      Object.assign(state, {
        received: true,
        requestIndex: index,
        requestSha256: createHash("sha256")
          .update(JSON.stringify(body))
          .digest("hex"),
      });
      res.setHeader("content-type", "text/event-stream");
      res.flushHeaders();
      state.headersSent = true;
      res.once("close", () => {
        state.closed = true;
        state.downstreamFinished = res.writableFinished;
        closedAt = now();
        clearTimer(timer);
      });
      timer = setTimer(() => {
        state.watchdogExpired = true;
        if (!state.closed) res.destroy();
      }, 45000);
      timer?.unref?.();
      return true;
    },
    safe() {
      return {
        ...state,
        remainingMs:
          state.received && !state.closed
            ? Math.max(0, 45000 - (now() - started))
            : null,
        receivedToCloseMs: closedAt === undefined ? null : closedAt - started,
      };
    },
    dispose() {
      if (timer !== undefined) clearTimer(timer);
      if (response && !state.closed) {
        state.cleanupTriggered = true;
        response.destroy();
      }
    },
  };
}
const account = (v, label = "current") => v.snapshot.actors[label].accounting;
function kept(oldRows, newRows, key) {
  assert.equal(new Set(newRows.map((r) => r[key])).size, newRows.length);
  for (const row of oldRows)
    assert.deepEqual(
      newRows.find((x) => x[key] === row[key]),
      row,
    );
  return newRows.filter((r) => !oldRows.some((x) => x[key] === r[key]));
}
function counterDelta(warm, value) {
  assert.equal(warm.modelCalls, 4);
  assert.equal(warm.rawInferencePosts, 4);
  assert.equal(value.modelCalls, 5);
  assert.equal(value.rawInferencePosts, 5);
  assert.deepEqual(
    value.supplierRequestDigests.slice(0, 4),
    warm.supplierRequestDigests,
  );
  assert.equal(value.supplierRequestDigests.length, 5);
  assert.deepEqual(account(value, "other"), account(warm, "other"));
}
function activeHold(value) {
  assert.equal(value.hold.received, true);
  assert.equal(value.hold.headersSent, true);
  assert.equal(value.hold.watchdogExpired, false);
  assert.equal(value.hold.cleanupTriggered, false);
}
export function assertHeldAccounting(warm, held) {
  counterDelta(warm, held);
  activeHold(held);
  assert.equal(held.hold.closed, false);
  assert.equal(held.nativeAlive, true);
  assert.equal(held.nativeExit, null);
  const a = account(warm),
    b = account(held);
  assert.equal(a.ledger.length, 2);
  assert(a.ledger.every((x) => x.status === "settled"));
  assert.equal(
    a.ledger.reduce((n, x) => n + x.amount, 0),
    44,
  );
  const rows = kept(a.ledger, b.ledger, "id");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.status, "reserved");
  assert.equal(row.amount, 0);
  assert(row.reserved > 0);
  assert.equal(row.input_tokens, 0);
  assert.equal(row.output_tokens, 0);
  assert.equal(row.settled_at, null);
  assert.deepEqual(b.traces, a.traces);
  const calls = kept(a.gatewayCalls, b.gatewayCalls, "requestKeyDigest");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestKeyDigest, row.requestKeyDigest);
  assert.equal(calls[0].has_result, 0);
  return row;
}
export function assertCancelAccounting(held, cancel) {
  for (const key of [
    "modelCalls",
    "rawInferencePosts",
    "supplierRequestDigests",
  ])
    assert.deepEqual(cancel[key], held[key]);
  for (const actor of ["current", "other"])
    assert.deepEqual(account(cancel, actor), account(held, actor));
  activeHold(cancel);
  assert.equal(cancel.hold.closed, false);
  assert.equal(cancel.nativeAlive, true);
  assert.equal(cancel.nativeExit, null);
  for (const key of ["requestIndex", "requestSha256"])
    assert.equal(cancel.hold[key], held.hold[key]);
}
export function assertQuitAccounting(warm, held, after) {
  const reservation = assertHeldAccounting(warm, held);
  counterDelta(warm, after);
  activeHold(after);
  assert.equal(after.hold.closed, true);
  assert.equal(after.hold.downstreamFinished, false);
  assert.equal(after.nativeAlive, false);
  assert.equal(after.nativeExit.code, 0);
  assert.equal(after.nativeExit.signal, null);
  for (const key of ["requestIndex", "requestSha256"])
    assert.equal(after.hold[key], held.hold[key]);
  const a = account(warm),
    b = account(after);
  const rows = kept(a.ledger, b.ledger, "id");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, reservation.id);
  assert.equal(row.status, "uncertain");
  assert.equal(row.amount, reservation.reserved);
  assert.equal(row.reserved, reservation.reserved);
  assert(row.settled_at !== null);
  assert.equal(row.input_tokens, 0);
  assert.equal(row.output_tokens, 0);
  const unchanged = (r) =>
    Object.fromEntries(
      Object.entries(r).filter(
        ([k]) => !["status", "amount", "settled_at"].includes(k),
      ),
    );
  assert.deepEqual(unchanged(row), unchanged(reservation));
  assert.deepEqual(b.gatewayCalls, account(held).gatewayCalls);
  const traces = kept(a.traces, b.traces, "id");
  assert.equal(traces.length, 1);
  const trace = traces[0];
  assert.equal(trace.status, "failed");
  assert.equal(trace.error_code, "CANCELLED");
  assert.equal(trace.input_tokens, 0);
  assert.equal(trace.output_tokens, 0);
  for (const key of ["tenant_id", "user_id", "model_id", "application"])
    assert.equal(trace[key], row[key]);
  return {
    newLedgerId: row.id,
    status: "uncertain",
    amount: row.amount,
    reserved: row.reserved,
    inputTokens: 0,
    outputTokens: 0,
    traceStatus: trace.status,
    traceCode: trace.error_code,
    traceBinding:
      "actor/model/application/token only; no original Trace request-key FK",
  };
}
