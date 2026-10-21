import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  captureCrashGeneration,
  crashOwnedMain,
  cleanupCapturedCrashGeneration,
} from "./mac-arm64-crash-consistency-process.mjs";
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 300001,
    exitCode: null,
    signalCode: null,
  });
  const rows = [
    { pid: 300001, ppid: 30, pgid: 300001 },
    { pid: 300002, ppid: 300001, pgid: 300001 },
    { pid: 300003, ppid: 300002, pgid: 300003 },
    { pid: 300004, ppid: 300003, pgid: 300004 },
  ];
  let now = 0;
  const signals = [],
    alive = new Set(rows.map((row) => row.pid));
  const boundary = {
    table: async () => rows,
    identity: async (pid) =>
      alive.has(pid)
        ? {
            pid,
            birth: "owned birth",
            commandName: "owned",
            executable: pid === child.pid ? "/owned/app" : "/owned/exe",
            mappedTextFiles: [pid === child.pid ? "/owned/app" : "/owned/exe"],
          }
        : null,
    signal(pid, signal) {
      signals.push({ pid, signal });
      if (pid === -child.pid) {
        alive.delete(child.pid);
        child.signalCode = signal;
        queueMicrotask(() => child.emit("exit", null, signal));
      } else alive.delete(pid);
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  };
  return {
    child,
    rows,
    boundary,
    alive,
    signals,
    options: {
      child,
      executable: "/owned/app",
      requiredPids: [300003, 300004],
      forbiddenPids: [30, 92288],
    },
  };
}
test("actual capture keeps detached CLI/PTY identities rather than assuming Main group owns them", async () => {
  const f = fixture();
  const value = await captureCrashGeneration(f.options, f.boundary);
  assert.equal(value.rows.length, 4);
  assert.equal(value.rows[2].pgid, 300003);
  assert.deepEqual(value.requiredPids, [300003, 300004]);
});
test("wrong group, foreign member, missing required child or executable reject without signal", async () => {
  for (const variant of ["group", "foreign", "missing", "exe"]) {
    const f = fixture();
    if (variant === "group") f.rows[0].pgid = 30;
    if (variant === "foreign")
      f.rows.push({ pid: 300009, ppid: 1, pgid: 300001 });
    if (variant === "missing") f.options.requiredPids = [300099];
    if (variant === "exe") f.options.executable = "/foreign";
    await assert.rejects(() => captureCrashGeneration(f.options, f.boundary));
    assert.deepEqual(f.signals, []);
  }
});
test("real child handle signal receipt distinguishes SIGKILL from TERM/normal exit", async () => {
  const f = fixture();
  const value = await crashOwnedMain(f.options, f.boundary);
  assert.deepEqual(value.exit, { code: null, signal: "SIGKILL" });
  assert.deepEqual(f.signals, [{ pid: -300001, signal: "SIGKILL" }]);
  assert.ok(f.alive.has(300003));
  assert.equal(f.child.listenerCount("exit"), 0);
});
test("ownership birth change immediately before group signal denies kill", async () => {
  const f = fixture(),
    original = f.boundary.identity;
  let calls = 0;
  f.boundary.identity = async (pid) => {
    const row = await original(pid);
    return pid === f.child.pid && ++calls > 1
      ? { ...row, birth: "reused" }
      : row;
  };
  await assert.rejects(() => crashOwnedMain(f.options, f.boundary));
  assert.deepEqual(f.signals, []);
});
test("residual cleanup only signals exact captured identities and retains initial failure", async () => {
  const f = fixture(),
    capture = await captureCrashGeneration(f.options, f.boundary);
  f.alive.delete(f.child.pid);
  const r = await cleanupCapturedCrashGeneration(capture, f.boundary);
  assert.deepEqual(r.residualBeforeCleanup, [300004, 300003, 300002]);
  assert.ok(r.absent);
  assert.ok(r.signals.every((x) => x.pid > 0));
  assert.equal("passed" in r, false);
});
test("PID reuse during cleanup cannot authorize any signal", async () => {
  const f = fixture(),
    capture = await captureCrashGeneration(f.options, f.boundary);
  const original = f.boundary.identity;
  f.boundary.identity = async (pid) => {
    const row = await original(pid);
    return row ? { ...row, birth: "new birth" } : null;
  };
  const r = await cleanupCapturedCrashGeneration(capture, f.boundary);
  assert.equal(r.absent, false);
  assert.equal(r.unsafe.length, 4);
  assert.deepEqual(f.signals, []);
});
test("capture rejects child reparent/PID reuse between inventory and identity before authorizing cleanup", async () => {
  const f = fixture(),
    original = f.boundary.identity;
  f.boundary.table = async () => f.rows.map((row) => ({ ...row }));
  f.boundary.identity = async (pid) => {
    if (pid === 300003) f.rows[2].ppid = 1;
    return original(pid);
  };
  await assert.rejects(() => captureCrashGeneration(f.options, f.boundary));
  assert.deepEqual(f.signals, []);
});
test("old executable text mapping cannot authorize a different actual executable during cleanup", async () => {
  const f = fixture(),
    capture = await captureCrashGeneration(f.options, f.boundary),
    original = f.boundary.identity;
  f.boundary.identity = async (pid) => {
    const row = await original(pid);
    return row
      ? {
          ...row,
          executable: "/foreign/actual",
          mappedTextFiles: [...row.mappedTextFiles, "/foreign/actual"],
        }
      : null;
  };
  const value = await cleanupCapturedCrashGeneration(capture, f.boundary);
  assert.deepEqual(f.signals, []);
  assert.equal(value.unsafe.length, 4);
});
test("setup exhausting overall prekill budget cannot signal a late owned Main", async () => {
  const f = fixture();
  let now = 0;
  f.boundary.now = () => now;
  await assert.rejects(() =>
    crashOwnedMain(
      {
        ...f.options,
        onCaptured: async () => {
          now = 31000;
        },
      },
      f.boundary,
    ),
  );
  assert.deepEqual(f.signals, []);
});

// Execute the actual metadata reader; only OS metadata/open IO are controlled.
async function executeActualReader({
  missing = [],
  denied = [],
  images = ["/owned/main"],
  commandName = "/owned/main",
  kernelPath = "/owned/main",
  paths = ["/owned/main", "/owned/transient-map"],
} = {}) {
  const { build } = await import("esbuild");
  const { createContext, Script } = await import("node:vm");
  const { createRequire } = await import("node:module");
  const { readFile } = await import("node:fs/promises");
  const { promisify } = await import("node:util");
  const source = await readFile(
    new URL("./mac-arm64-crash-consistency-process.mjs", import.meta.url),
    "utf8",
  );
  const closed = [],
    opened = [];
  const errors = {};
  const execFile = () => {};
  execFile[promisify.custom] = async (command) => ({
    stdout:
      command === "/bin/ps"
        ? "Wed Oct 21 03:00:00 2026 " + commandName + "\n"
        : command === "/usr/bin/python3"
          ? JSON.stringify({ path: kernelPath, errno: 0 })
          : paths.map((path) => "n" + path).join("\n") + "\n",
    stderr: "",
  });
  const fixture = {
    execFile,
    async open(path) {
      opened.push(path);
      if (missing.includes(path) || denied.includes(path)) {
        const error = Object.assign(new Error("controlled mapped file error"), {
          code: missing.includes(path) ? "ENOENT" : "EACCES",
        });
        errors[path] = error;
        throw error;
      }
      return {
        async read(buffer) {
          buffer.fill(0);
          buffer.writeUInt32LE(0xfeedfacf, 0);
          buffer.writeUInt32LE(images.includes(path) ? 2 : 6, 12);
          return { bytesRead: buffer.length };
        },
        async close() {
          closed.push(path);
        },
      };
    },
  };
  const built = await build({
    stdin: {
      contents: source + "\nglobalThis.actualReader=readCrashProcessIdentity;",
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "owned-reader-io",
        setup(b) {
          for (const [specifier, body] of [
            [
              "node:child_process",
              "export const execFile=globalThis.fixture.execFile;",
            ],
            ["node:fs/promises", "export const open=globalThis.fixture.open;"],
          ]) {
            b.onResolve({ filter: new RegExp("^" + specifier + "$") }, () => ({
              path: specifier,
              namespace: "owned-io",
            }));
            b.onLoad(
              {
                filter: new RegExp("^" + specifier + "$"),
                namespace: "owned-io",
              },
              () => ({ contents: body }),
            );
          }
        },
      },
    ],
  });
  const context = createContext({
    fixture,
    process,
    setTimeout,
    clearTimeout,
    Buffer,
    require: createRequire(import.meta.url),
    module: { exports: {} },
    exports: {},
  });
  new Script(built.outputFiles[0].text).runInContext(context);
  let value, error;
  try {
    value = await context.actualReader(300001);
  } catch (e) {
    error = e;
  }
  return { value, error, errors, closed, opened };
}
test("actual reader only opens kernel absolute executable, never unrelated ENOENT or EACCES mapping", async () => {
  for (const key of ["missing", "denied"]) {
    const value = await executeActualReader({
      [key]: ["/owned/transient-map"],
    });
    assert.equal(value.error, undefined);
    assert.equal(value.value.executable, "/owned/main");
    assert.deepEqual(value.opened, ["/owned/main"]);
    assert.deepEqual(value.closed, ["/owned/main"]);
    assert.deepEqual(value.errors, {});
  }
});
test("actual executable ENOENT or EACCES remain original failures without fallback", async () => {
  for (const key of ["missing", "denied"]) {
    const value = await executeActualReader({
      [key]: ["/owned/main"],
      paths: ["/owned/main", "/owned/other"],
      images: ["/owned/other"],
    });
    assert.equal(value.error, value.errors["/owned/main"]);
    assert.equal(value.error.code, key === "missing" ? "ENOENT" : "EACCES");
    assert.deepEqual(value.opened, ["/owned/main"]);
  }
});
test("missing, relative or nonmapped kernel path refuses identity without opening any mapping", async () => {
  for (const kernelPath of [null, "unknown-title", "/unmapped/main"]) {
    const value = await executeActualReader({ kernelPath });
    assert.ok(value.error);
    assert.equal(value.value, undefined);
    assert.deepEqual(value.opened, []);
  }
});
test("mapped absolute kernel image still requires actual MH_EXECUTE", async () => {
  const value = await executeActualReader({ images: [] });
  assert.ok(value.error);
  assert.equal(value.value, undefined);
  assert.deepEqual(value.opened, ["/owned/main"]);
  assert.deepEqual(value.closed, ["/owned/main"]);
});

test("comm/title is diagnostic only; kernel path exact mapping is the sole executable authority", async () => {
  const value = await executeActualReader({
    commandName: "node-private-title",
  });
  assert.equal(value.error, undefined);
  assert.equal(value.value.executable, "/owned/main");
  assert.equal(value.value.commandName, "node-private-title");
  assert.deepEqual(value.opened, ["/owned/main"]);
});
