import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateOwnedInspectorUrl,
  assertAllowedMainCpuMethod,
  summarizeOwnedCpuProfile,
  profileOwnedMainCpu,
} from "./owned-main-cpu-profiler.mjs";
const url = "ws://127.0.0.1:49152/12345678-1234-1234-1234-123456789abc";
const profile = {
  nodes: [
    {
      id: 1,
      callFrame: {
        functionName: "(root)",
        scriptId: "0",
        url: "",
        lineNumber: -1,
        columnNumber: -1,
      },
      children: [2],
    },
    {
      id: 2,
      callFrame: {
        functionName: "work",
        scriptId: "1",
        url: "file:///owned/app/main.js?private=DO_NOT_SUMMARIZE",
        lineNumber: 1,
        columnNumber: 0,
      },
    },
  ],
  startTime: 0,
  endTime: 2000,
  samples: [2, 2],
  timeDeltas: [1000, 1000],
};
test("exact owned loopback port UUID only", () => {
  assert.equal(validateOwnedInspectorUrl(url, 49152), url);
  for (const bad of [
    url.replace("127.0.0.1", "localhost"),
    url.replace("ws:", "wss:"),
    url + "?x=1",
    url + "#x",
    url.replace("/12345678", "/bad12345678"),
    "ws://user@127.0.0.1:49152/12345678-1234-1234-1234-123456789abc",
  ])
    assert.throws(() => validateOwnedInspectorUrl(bad, 49152));
  assert.throws(() => validateOwnedInspectorUrl(url, 49153));
});
test("method whitelist never exposes evaluation source heap or arbitrary resume", () => {
  for (const method of [
    "Runtime.evaluate",
    "HeapProfiler.takeHeapSnapshot",
    "Debugger.getScriptSource",
    "Debugger.setBreakpoint",
  ])
    assert.throws(() => assertAllowedMainCpuMethod(method, {}));
  assertAllowedMainCpuMethod("Profiler.start", {});
  assert.throws(() =>
    assertAllowedMainCpuMethod("Profiler.start", { expression: "bad" }),
  );
  assert.throws(() =>
    assertAllowedMainCpuMethod("Profiler.setSamplingInterval", { interval: 2 }),
  );
});
test("bounded profile summary computes self/inclusive without emitting URL query", () => {
  const v = summarizeOwnedCpuProfile(profile);
  assert.equal(v.sampleCount, 2);
  assert.equal(v.topSelf[0].selfMs, 2);
  assert.ok(!JSON.stringify(v).includes("DO_NOT_SUMMARIZE"));
  for (const invalid of [
    { ...profile, locals: {} },
    { ...profile, samples: [9, 9] },
    { ...profile, timeDeltas: [-1, 1] },
  ])
    assert.throws(() => summarizeOwnedCpuProfile(invalid));
});
class FakeSocket extends EventTarget {
  static instances = [];
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(raw) {
    const m = JSON.parse(raw);
    this.sent.push(m);
    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: m.id,
            result: m.method === "Profiler.stop" ? { profile } : {},
          }),
        }),
      );
      if (m.method === "Runtime.runIfWaitingForDebugger")
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              method: "Debugger.paused",
              params: {
                reason: "Break on start",
                callFrames: [{ scopeChain: "MUST_NOT_SAVE" }],
              },
            }),
          }),
        );
    });
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  }
}
test("failed ownership prevents connection entirely", async () => {
  const before = FakeSocket.instances.length;
  await assert.rejects(
    profileOwnedMainCpu({
      inspectorUrl: url,
      expectedPort: 49152,
      actorOwned: async () => false,
      outputFile: "/unused/profile.cpuprofile",
      durationMs: 50,
      maxTotalMs: 5000,
      WebSocketClass: FakeSocket,
    }),
  );
  assert.equal(FakeSocket.instances.length, before);
});
test("one initial resume, fixed RPCs, exclusive0600 profile and all socket cleanup", async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "owned-v8-cpu-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stages = [];
  const r = await profileOwnedMainCpu({
    inspectorUrl: url,
    expectedPort: 49152,
    actorOwned: async (c) => {
      stages.push(c.stage);
      return true;
    },
    outputFile: join(dir, "main.cpuprofile"),
    durationMs: 50,
    maxTotalMs: 5000,
    WebSocketClass: FakeSocket,
  });
  assert.equal(r.socketClosed, true);
  assert.ok(r.actualSampleWaitMs >= 49);
  const disk = await stat(join(dir, "main.cpuprofile"));
  assert.equal(disk.size, r.profileBytes);
  assert.equal(disk.mode & 0o777, 0o600);
  assert.deepEqual(
    JSON.parse(await readFile(join(dir, "main.cpuprofile"), "utf8")),
    profile,
  );
  const socket = FakeSocket.instances.at(-1);
  assert.equal(
    socket.sent.filter((m) => m.method === "Debugger.resume").length,
    1,
  );
  assert.ok(socket.sent.every((m) => !m.method.includes("evaluate")));
  assert.ok(stages.length >= socket.sent.length);
  assert.ok(!JSON.stringify(r).includes("MUST_NOT_SAVE"));
});
test("ownership loss before resume sends no resume and closes socket", async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "owned-v8-cpu-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    profileOwnedMainCpu({
      inspectorUrl: url,
      expectedPort: 49152,
      actorOwned: async (c) => c.stage !== "rpc:Debugger.resume",
      outputFile: join(dir, "main.cpuprofile"),
      durationMs: 50,
      maxTotalMs: 5000,
      WebSocketClass: FakeSocket,
    }),
  );
  const socket = FakeSocket.instances.at(-1);
  assert.equal(socket.readyState, 3);
  assert.ok(!socket.sent.some((m) => m.method === "Debugger.resume"));
});
for (const mode of ["rpc-error", "oversize", "close", "error", "timeout"])
  test(
    "bounded " + mode + " cleans owned socket and pending timers",
    async (t) => {
      const dir = await realpath(
        await mkdtemp(join(tmpdir(), "owned-v8-cpu-")),
      );
      t.after(() => rm(dir, { recursive: true, force: true }));
      class Bad extends FakeSocket {
        send(raw) {
          const m = JSON.parse(raw);
          this.sent.push(m);
          if (mode === "timeout") return;
          queueMicrotask(() => {
            if (mode === "close") this.close();
            else if (mode === "error") this.dispatchEvent(new Event("error"));
            else
              this.dispatchEvent(
                new MessageEvent("message", {
                  data:
                    mode === "oversize"
                      ? "x".repeat(8 * 1024 * 1024 + 1)
                      : JSON.stringify({
                          id: m.id,
                          error: { code: -1, message: "PRIVATE_RPC_ERROR" },
                        }),
                }),
              );
          });
        }
      }
      await assert.rejects(
        profileOwnedMainCpu({
          inspectorUrl: url,
          expectedPort: 49152,
          actorOwned: async () => true,
          outputFile: join(dir, "main.cpuprofile"),
          durationMs: 50,
          maxTotalMs: 3100,
          WebSocketClass: Bad,
        }),
      );
      assert.equal(FakeSocket.instances.at(-1).readyState, 3);
    },
  );
test("private real Node inspect-brk CPU workload uses the same finite protocol without evaluating code", async (t) => {
  const { spawn, execFileSync } = await import("node:child_process");
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "owned-v8-cpu-real-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [
      "--inspect-brk=127.0.0.1:0",
      "-e",
      "function ownedCpuWork(){const end=performance.now()+5;while(performance.now()<end)Math.sqrt(Math.random());setImmediate(ownedCpuWork)}ownedCpuWork()",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  const endpoint = await new Promise((res, rej) => {
    const timeout = setTimeout(
      () => rej(Error("Private inspector not ready")),
      3000,
    );
    child.stderr.on("data", (b) => {
      stderr += b.toString();
      const found = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/);
      if (found) {
        clearTimeout(timeout);
        res(found[0]);
      }
    });
    child.once("error", rej);
  });
  const port = Number(new URL(endpoint).port);
  const birth = execFileSync("ps", ["-p", String(child.pid), "-o", "lstart="], {
    encoding: "utf8",
  }).trim();
  try {
    const result = await profileOwnedMainCpu({
      inspectorUrl: endpoint,
      expectedPort: port,
      outputFile: join(dir, "main.cpuprofile"),
      durationMs: 150,
      maxTotalMs: 10000,
      actorOwned: async () => {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        const current = execFileSync(
          "ps",
          ["-p", String(child.pid), "-o", "lstart="],
          { encoding: "utf8" },
        ).trim();
        const ports = execFileSync(
          "lsof",
          [
            "-nP",
            "-a",
            "-p",
            String(child.pid),
            "-iTCP:" + port,
            "-sTCP:LISTEN",
            "-Fn",
          ],
          { encoding: "utf8" },
        );
        return current === birth && ports.includes("n127.0.0.1:" + port);
      },
    });
    assert.equal(result.socketClosed, true);
    assert.equal(result.releasedInitialBreak, true);
    assert.ok(result.summary.sampleCount > 0);
    assert.ok(
      result.summary.topSelf.some((r) => r.functionName === "ownedCpuWork"),
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((res, rej) => {
      if (child.exitCode !== null || child.signalCode !== null) return res();
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        rej(Error("Private Node did not exit"));
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timeout);
        res();
      });
    });
  }
});
test("setup spending the stop margin cannot turn the sample into a short success", async (t) => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "owned-v8-cpu-budget-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    profileOwnedMainCpu({
      inspectorUrl: url,
      expectedPort: 49152,
      actorOwned: async (c) => {
        if (c.stage === "rpc:Debugger.resume")
          await new Promise((r) => setTimeout(r, 700));
        return true;
      },
      outputFile: join(dir, "main.cpuprofile"),
      durationMs: 50,
      maxTotalMs: 3050,
      WebSocketClass: FakeSocket,
    }),
  );
  assert.equal(FakeSocket.instances.at(-1).readyState, 3);
});
test("summary never exposes dynamic data URL source text", () => {
  const p = structuredClone(profile);
  p.nodes[1].callFrame.url =
    "data:text/javascript,DYNAMIC_SOURCE_MUST_NOT_SUMMARIZE";
  assert.ok(
    !JSON.stringify(summarizeOwnedCpuProfile(p)).includes(
      "DYNAMIC_SOURCE_MUST_NOT_SUMMARIZE",
    ),
  );
});
