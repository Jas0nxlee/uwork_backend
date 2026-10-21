/** Finite owned V8 CPU diagnostic only. Never evaluates code or reads source/heap. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, realpath, lstat } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
const MAX_BYTES = 8 * 1024 * 1024,
  MAX_NODES = 20000,
  MAX_SAMPLES = 100000;
const EMPTY = [
  "Profiler.enable",
  "Profiler.start",
  "Profiler.stop",
  "Runtime.runIfWaitingForDebugger",
  "Debugger.enable",
  "Debugger.resume",
];
const need = (x) => {
  if (!x) throw Error("OWNED_MAIN_CPU_DIAGNOSTIC_REJECTED");
};
export function validateOwnedInspectorUrl(value, expectedPort) {
  need(
    Number.isInteger(expectedPort) && expectedPort > 0 && expectedPort <= 65535,
  );
  need(typeof value === "string");
  const u = new URL(value);
  need(
    u.protocol === "ws:" &&
      u.hostname === "127.0.0.1" &&
      Number(u.port) === expectedPort &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash,
  );
  need(
    /^\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      u.pathname,
    ),
  );
  need(u.href === value);
  return value;
}
export function assertAllowedMainCpuMethod(method, params) {
  need(params && typeof params === "object" && !Array.isArray(params));
  if (method === "Profiler.setSamplingInterval") {
    assert.deepEqual(params, { interval: 1000 });
    return;
  }
  need(EMPTY.includes(method));
  assert.deepEqual(params, {});
}
export function summarizeOwnedCpuProfile(profile) {
  need(profile && typeof profile === "object");
  need(
    Object.keys(profile).every((k) =>
      ["nodes", "startTime", "endTime", "samples", "timeDeltas"].includes(k),
    ),
  );
  need(
    Array.isArray(profile.nodes) &&
      profile.nodes.length > 0 &&
      profile.nodes.length <= MAX_NODES,
  );
  need(
    Array.isArray(profile.samples) &&
      profile.samples.length > 0 &&
      profile.samples.length <= MAX_SAMPLES &&
      Array.isArray(profile.timeDeltas) &&
      profile.samples.length === profile.timeDeltas.length,
  );
  need(
    Number.isFinite(profile.startTime) &&
      Number.isFinite(profile.endTime) &&
      profile.endTime >= profile.startTime,
  );
  const nodes = new Map(),
    parent = new Map();
  for (const n of profile.nodes) {
    need(
      Object.keys(n).every((k) =>
        [
          "id",
          "callFrame",
          "hitCount",
          "children",
          "deoptReason",
          "positionTicks",
        ].includes(k),
      ),
    );
    need(Number.isSafeInteger(n.id) && !nodes.has(n.id));
    need(
      n.hitCount === undefined ||
        (Number.isSafeInteger(n.hitCount) && n.hitCount >= 0),
    );
    need(
      n.deoptReason === undefined ||
        (typeof n.deoptReason === "string" && n.deoptReason.length <= 1024),
    );
    if (n.positionTicks !== undefined) {
      need(Array.isArray(n.positionTicks) && n.positionTicks.length <= 10000);
      for (const tick of n.positionTicks) {
        need(Object.keys(tick).sort().join() === "line,ticks");
        need(
          Number.isSafeInteger(tick.line) &&
            Number.isSafeInteger(tick.ticks) &&
            tick.ticks >= 0,
        );
      }
    }
    const f = n.callFrame;
    need(
      f &&
        Object.keys(f).every((k) =>
          [
            "functionName",
            "scriptId",
            "url",
            "lineNumber",
            "columnNumber",
          ].includes(k),
        ),
    );
    need(
      typeof f.functionName === "string" &&
        f.functionName.length <= 4096 &&
        typeof f.url === "string" &&
        f.url.length <= 8192 &&
        typeof f.scriptId === "string" &&
        f.scriptId.length <= 128,
    );
    need(Number.isInteger(f.lineNumber) && Number.isInteger(f.columnNumber));
    need(
      !n.children ||
        (Array.isArray(n.children) && n.children.length <= MAX_NODES),
    );
    nodes.set(n.id, n);
  }
  for (const n of nodes.values())
    for (const id of n.children ?? []) {
      need(nodes.has(id) && !parent.has(id) && id !== n.id);
      parent.set(id, n.id);
    }
  const roots = [...nodes.keys()].filter((id) => !parent.has(id));
  need(roots.length === 1);
  const order = [],
    seen = new Set(),
    stack = [roots[0]];
  while (stack.length) {
    const id = stack.pop();
    need(!seen.has(id));
    seen.add(id);
    order.push(id);
    stack.push(...(nodes.get(id).children ?? []));
  }
  need(seen.size === nodes.size);
  const self = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i],
      delta = profile.timeDeltas[i];
    need(nodes.has(id) && Number.isFinite(delta) && delta >= 0);
    self.set(id, self.get(id) + delta);
  }
  const inclusive = new Map(self);
  for (const id of order.toReversed())
    if (parent.has(id))
      inclusive.set(
        parent.get(id),
        inclusive.get(parent.get(id)) + inclusive.get(id),
      );
  const frame = (f) => {
    let script = "anonymous";
    if (/^node:[A-Za-z0-9_./-]+$/.test(f.url)) script = f.url.slice(0, 180);
    else if (f.url) {
      try {
        const url = new URL(f.url);
        script =
          url.protocol === "file:"
            ? basename(url.pathname).slice(0, 180) || "anonymous"
            : "non-file-code-frame";
      } catch {
        script = "non-url-code-frame";
      }
    }
    return {
      functionName: f.functionName.slice(0, 160),
      script,
      urlSha256: createHash("sha256").update(f.url).digest("hex"),
      line: f.lineNumber,
      column: f.columnNumber,
    };
  };
  const rows = [...nodes.values()].map((n) => ({
    ...frame(n.callFrame),
    selfMs: Number((self.get(n.id) / 1000).toFixed(3)),
    inclusiveMs: Number((inclusive.get(n.id) / 1000).toFixed(3)),
  }));
  return {
    nodeCount: nodes.size,
    sampleCount: profile.samples.length,
    profileWindowMs: (profile.endTime - profile.startTime) / 1000,
    observedSampleMs: profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000,
    topSelf: rows.toSorted((a, b) => b.selfMs - a.selfMs).slice(0, 20),
    topInclusive: rows
      .toSorted((a, b) => b.inclusiveMs - a.inclusiveMs)
      .slice(0, 20),
    scope:
      "Code-frame basename and hash only; no source, locals, heap or full URL in summary",
  };
}
export async function profileOwnedMainCpu({
  inspectorUrl,
  expectedPort,
  actorOwned,
  outputFile,
  durationMs = 30000,
  maxTotalMs,
  WebSocketClass = globalThis.WebSocket,
}) {
  validateOwnedInspectorUrl(inspectorUrl, expectedPort);
  need(
    typeof actorOwned === "function" && typeof WebSocketClass === "function",
  );
  need(Number.isInteger(durationMs) && durationMs >= 50 && durationMs <= 30000);
  need(
    Number.isInteger(maxTotalMs) &&
      maxTotalMs <= 45000 &&
      maxTotalMs >= durationMs + 3000,
  );
  const totalDeadline = performance.now() + maxTotalMs;
  const workDeadline = totalDeadline - 2000;
  need(typeof outputFile === "string" && resolve(outputFile) === outputFile);
  need(process.env.NODE_USE_ENV_PROXY === undefined, "No environment proxy");
  let primaryError;
  let socket,
    closed = false,
    closing = false,
    nextId = 0,
    pauseSeen = false,
    finished = false;
  const timers = new Set(),
    pending = new Map(),
    methods = [];
  let fatalReject, pauseResolve, pauseReject;
  const fatal = new Promise((_, reject) => {
    fatalReject = reject;
  });
  fatal.catch(() => {});
  const pause = new Promise((res, rej) => {
    pauseResolve = res;
    pauseReject = rej;
  });
  pause.catch(() => {});
  const timer = (fn, ms) => {
    const id = setTimeout(
      () => {
        timers.delete(id);
        fn();
      },
      Math.max(1, Math.min(ms, workDeadline - performance.now())),
    );
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    clearTimeout(id);
    timers.delete(id);
  };
  const fail = () => {
    if (finished) return;
    const error = Error("OWNED_MAIN_CPU_DIAGNOSTIC_REJECTED");
    fatalReject(error);
    pauseReject(error);
    for (const entry of pending.values()) {
      cancel(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };
  const bounded = async (work, ms) => {
    const limit = Math.min(ms, workDeadline - performance.now());
    need(limit > 0);
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        fatal,
        new Promise((_, reject) => {
          timeout = timer(
            () => reject(Error("OWNED_MAIN_CPU_BUDGET_EXCEEDED")),
            limit,
          );
        }),
      ]);
    } finally {
      if (timeout) cancel(timeout);
    }
  };
  const guard = (stage) =>
    bounded(
      async () =>
        need(
          (await actorOwned({ stage, inspectorUrl, expectedPort })) === true,
        ),
      3000,
    );
  async function rpc(method, params = {}) {
    assertAllowedMainCpuMethod(method, params);
    await guard("rpc:" + method);
    need(socket?.readyState === 1);
    const id = ++nextId;
    methods.push(method);
    return bounded(
      () =>
        new Promise((res, rej) => {
          const timeout = timer(() => {
            pending.delete(id);
            rej(Error("OWNED_MAIN_CPU_RPC_TIMEOUT"));
          }, 15000);
          pending.set(id, { resolve: res, reject: rej, timeout });
          try {
            socket.send(JSON.stringify({ id, method, params }));
          } catch {
            pending.delete(id);
            cancel(timeout);
            rej(Error("OWNED_MAIN_CPU_SEND_FAILED"));
          }
        }),
      15000,
    );
  }
  const onMessage = (event) => {
    try {
      need(
        typeof event.data === "string" &&
          Buffer.byteLength(event.data) <= MAX_BYTES,
      );
      const message = JSON.parse(event.data);
      if (Object.hasOwn(message, "id")) {
        need(Number.isInteger(message.id));
        const entry = pending.get(message.id);
        need(entry);
        pending.delete(message.id);
        cancel(entry.timeout);
        if (message.error) entry.reject(Error("OWNED_MAIN_CPU_RPC_REJECTED"));
        else entry.resolve(message.result ?? {});
        return;
      }
      if (message.method === "Debugger.paused") {
        need(
          !pauseSeen &&
            ["Break on start", "BreakOnStart"].includes(message.params?.reason),
        );
        pauseSeen = true;
        pauseResolve();
      } /* Every other event is discarded, never persisted. */
    } catch {
      fail();
    }
  };
  const onError = () => fail();
  const onClose = () => {
    closed = true;
    if (!closing) fail();
  };
  timer(fail, Math.max(1, workDeadline - performance.now()));
  try {
    await guard("before-connect");
    const parent = dirname(outputFile);
    need((await realpath(parent)) === parent);
    const parentStat = await lstat(parent);
    need(parentStat.isDirectory() && !parentStat.isSymbolicLink());
    await guard("connect-now");
    socket = new WebSocketClass(inspectorUrl);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    await bounded(
      () =>
        socket.readyState === 1
          ? Promise.resolve()
          : new Promise((res) =>
              socket.addEventListener("open", res, { once: true }),
            ),
      15000,
    );
    await guard("connected");
    await rpc("Profiler.enable");
    await rpc("Profiler.setSamplingInterval", { interval: 1000 });
    await rpc("Debugger.enable");
    need(workDeadline - performance.now() >= durationMs + 500);
    await rpc("Profiler.start");
    await rpc("Runtime.runIfWaitingForDebugger");
    await bounded(() => pause, 15000);
    await rpc("Debugger.resume");
    need(workDeadline - performance.now() >= durationMs + 500);
    const sampleStarted = performance.now();
    await bounded(
      () =>
        new Promise((res) => {
          // Duration must never be shortened into success by the deadline clamp.
          const id = setTimeout(() => {
            timers.delete(id);
            res();
          }, durationMs);
          timers.add(id);
        }),
      durationMs + 1000,
    );
    const actualSampleWaitMs = performance.now() - sampleStarted;
    need(actualSampleWaitMs >= durationMs - 1);
    const result = await rpc("Profiler.stop");
    await guard("profile-received");
    const profile = result.profile;
    const bytes = JSON.stringify(profile) + "\n";
    need(Buffer.byteLength(bytes) <= MAX_BYTES);
    const summary = summarizeOwnedCpuProfile(profile);
    await guard("before-write");
    const handle = await open(outputFile, "wx", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    need(performance.now() < workDeadline);
    finished = true;
    return {
      summary,
      profileBytes: Buffer.byteLength(bytes),
      requestedDurationMs: durationMs,
      actualSampleWaitMs,
      methods,
      socketClosed: true,
      profileOnly: true,
      releasedInitialBreak: true,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      closing = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const entry of pending.values())
        entry.reject(Error("OWNED_MAIN_CPU_CLOSED"));
      pending.clear();
      if (socket) {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        if (socket.readyState !== 3) {
          await new Promise((res, rej) => {
            const timeout = setTimeout(
              () => rej(Error("OWNED_MAIN_CPU_SOCKET_NOT_CLOSED")),
              Math.max(1, Math.min(2000, totalDeadline - performance.now())),
            );
            socket.addEventListener(
              "close",
              () => {
                clearTimeout(timeout);
                closed = true;
                res();
              },
              { once: true },
            );
            try {
              socket.close();
            } catch {
              clearTimeout(timeout);
              rej(Error("OWNED_MAIN_CPU_SOCKET_CLOSE_FAILED"));
            }
          });
        }
        need(closed || socket.readyState === 3);
        socket.removeEventListener("close", onClose);
      }
    } catch (cleanupError) {
      if (primaryError)
        throw new AggregateError(
          [primaryError, cleanupError],
          "OWNED_MAIN_CPU_FAILURE_AND_CLEANUP_FAILURE",
        );
      throw cleanupError;
    }
  }
}
