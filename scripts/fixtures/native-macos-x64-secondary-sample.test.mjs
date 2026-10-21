import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, open, writeFile, lstat } from "node:fs/promises";
import { fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X64_APP_PATH } from "./native-packaged-macos-x64-runtime.mjs";
import { scheduleOwnedSecondarySample } from "./native-macos-x64-secondary-sample.mjs";
const executable = join(X64_APP_PATH, "Contents/MacOS/UWork Preview");
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "uwork-sample-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = Object.assign(new EventEmitter(), {
    pid: 12001,
    exitCode: null,
    signalCode: null,
  });
  let current = child,
    now = 1000;
  const timers = [],
    fds = [],
    spawns = [],
    warnings = [];
  let accepted;
  const written = new Promise((resolve) => {
    accepted = resolve;
  });
  const identity = { pid: child.pid, birth: "owned birth", executable };
  const dependencies = {
    identity: async () => ({ ...identity }),
    now: () => now,
    setTimeout: (fn, ms) => {
      const value = { fn, ms, cleared: false };
      timers.push(value);
      return value;
    },
    clearTimeout: (value) => {
      if (value) value.cleared = true;
    },
    open: async (...args) => {
      const handle = await open(...args);
      fds.push(handle.fd);
      return handle;
    },
    writeFile: async (path, data, options) => {
      await writeFile(path, data, options);
      if (path.endsWith("-sample.json")) accepted(JSON.parse(data));
    },
    warn: (text) => warnings.push(text),
    spawn: (program, args, options) => {
      spawns.push({ program, args, options });
      const sample = Object.assign(new EventEmitter(), { pid: 12002 });
      sample.kill = (signal) => {
        queueMicrotask(() => sample.emit("exit", null, signal));
        return true;
      };
      void writeFile(
        args[3],
        "Process: owned [12001]\nCall graph:\n    NotifyOtherProcessWithTimeout\n",
        { mode: 0o600 },
      ).then(() => sample.emit("exit", 0, null));
      return sample;
    },
    ...overrides,
  };
  const observer = scheduleOwnedSecondarySample(
    {
      child,
      currentChild: () => current,
      expectedExecutable: executable,
      evidence: root,
      spawnAtMs: 1000,
    },
    dependencies,
  );
  const fire = async () => {
    await Promise.resolve();
    await Promise.resolve();
    now = 9000;
    timers.find((row) => row.ms === 8000).fn();
    return written;
  };
  return {
    root,
    child,
    identity,
    observer,
    spawns,
    timers,
    fds,
    warnings,
    written,
    fire,
    dependencies,
    replace: () => {
      current = { ...child };
    },
  };
}
function closed(fds) {
  for (const fd of fds) assert.throws(() => fstatSync(fd), { code: "EBADF" });
}
test("only exact executable is eligible, never arbitrary process targets", () => {
  const child = { pid: 12001 };
  assert.throws(() =>
    scheduleOwnedSecondarySample({
      child,
      currentChild: () => child,
      expectedExecutable: "/Applications/Other.app",
      evidence: "/owned",
      spawnAtMs: 0,
    }),
  );
});
test("monotonic spawn marker schedules8s and only sample1s with private FD output", async (t) => {
  const f = await fixture(t);
  assert.equal(f.timers[0].ms, 8000);
  const report = await f.fire();
  assert.equal(report.status, "captured-exact-owned-stack");
  assert.equal(f.spawns.length, 1);
  const s = f.spawns[0];
  assert.equal(s.program, "/usr/bin/sample");
  assert.deepEqual(s.args.slice(0, 3), ["12001", "1", "-file"]);
  assert.equal(s.options.umask, undefined);
  assert.equal((await lstat(s.args[3])).mode & 0o777, 0o600);
  assert.ok(s.options.stdio.slice(1).every(Number.isInteger));
  assert.equal(s.options.env.ZCODE_CREDENTIAL_SECRET, undefined);
  assert.equal((await lstat(s.args[3])).mode & 0o777, 0o600);
  closed(f.fds);
  await f.observer.dispose();
  assert.ok(f.timers.every((v) => v.cleared));
});
test("child exit before8s clears observer timer without sampling", async (t) => {
  const f = await fixture(t);
  f.child.exitCode = 0;
  f.child.emit("exit", 0, null);
  const report = await f.observer.dispose();
  assert.equal(report.status, "canceled-before-sample");
  assert.equal(f.spawns.length, 0);
  assert.ok(f.timers[0].cleared);
});
test("handle replacement is refused even with same PID", async (t) => {
  const f = await fixture(t);
  f.replace();
  const report = await f.fire();
  assert.equal(report.status, "canceled-before-sample");
  assert.equal(f.spawns.length, 0);
  await f.observer.dispose();
});
test("birth reuse before sample rejects without sampler spawn", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    identity: async () => ({
      pid: 12001,
      birth: ++calls === 1 ? "original" : "reused",
      executable,
    }),
  });
  const report = await f.fire();
  assert.equal(report.status, "observer-unavailable");
  assert.equal(f.spawns.length, 0);
  closed(f.fds);
  await f.observer.dispose();
});
test("post sample birth reuse never labels a real stack as accepted", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    identity: async () => ({
      pid: 12001,
      birth: ++calls < 3 ? "original" : "reused",
      executable,
    }),
  });
  const report = await f.fire();
  assert.equal(f.spawns.length, 1);
  assert.equal(report.status, "observer-unavailable");
  assert.equal(report.after, undefined);
  closed(f.fds);
  await f.observer.dispose();
});
test("wrong executable projection rejects before launching sample", async (t) => {
  const f = await fixture(t, {
    identity: async () => ({
      pid: 12001,
      birth: "original",
      executable: "/foreign",
    }),
  });
  const report = await f.fire();
  assert.equal(report.status, "observer-unavailable");
  assert.equal(f.spawns.length, 0);
  closed(f.fds);
  await f.observer.dispose();
});
test("identity observer error never kills or changes original child", async (t) => {
  const f = await fixture(t, {
    identity: async () => {
      throw Error("identity unavailable");
    },
  });
  let kills = 0;
  f.child.kill = () => {
    kills++;
  };
  const report = await f.fire();
  assert.equal(report.status, "observer-unavailable");
  assert.equal(kills, 0);
  assert.equal(f.child.exitCode, null);
  closed(f.fds);
  await f.observer.dispose();
});
test("second output open failure releases first FD and does not sample", async (t) => {
  let count = 0,
    fd;
  const f = await fixture(t, {
    open: async (...args) => {
      if (++count === 2) throw Error("second open unavailable");
      const handle = await open(...args);
      fd = handle.fd;
      return handle;
    },
  });
  const report = await f.fire();
  assert.equal(report.status, "observer-unavailable");
  assert.equal(f.spawns.length, 0);
  closed([fd]);
  await f.observer.dispose();
});
test("sampler spawn error closes private FDs and keeps original child alive", async (t) => {
  const f = await fixture(t, {
    spawn: () => {
      throw Error("owned sample unavailable");
    },
  });
  const report = await f.fire();
  assert.equal(report.status, "observer-unavailable");
  assert.equal(f.child.exitCode, null);
  closed(f.fds);
  await f.observer.dispose();
});
test("early dispose tolerates metadata and warning writer failure", async (t) => {
  const f = await fixture(t, {
    writeFile: async () => {
      throw Error("metadata unavailable");
    },
    warn: () => {
      throw Error("warning unavailable");
    },
  });
  await assert.doesNotReject(() => f.observer.dispose());
  assert.equal(f.child.exitCode, null);
  assert.equal(f.spawns.length, 0);
});

test("child error before8s also clears only observer timer", async (t) => {
  const f = await fixture(t);
  let originalErrorEvents = 0;
  f.child.on("error", () => {
    originalErrorEvents++;
  });
  f.child.emit("error", Error("owned spawn failed"));
  await f.observer.dispose();
  assert.equal(originalErrorEvents, 1);
  assert.equal(f.spawns.length, 0);
  assert.ok(f.timers[0].cleared);
});
test("child exit during sample stops only the owned sampler and rejects acceptance", async (t) => {
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  let samplerKills = 0,
    childKills = 0;
  const f = await fixture(t, {
    spawn: () => {
      const value = Object.assign(new EventEmitter(), { pid: 12002 });
      value.kill = (signal) => {
        samplerKills++;
        queueMicrotask(() => value.emit("exit", null, signal));
        return true;
      };
      started();
      return value;
    },
  });
  f.child.kill = () => {
    childKills++;
  };
  const result = f.fire();
  await began;
  f.child.exitCode = 0;
  f.child.emit("exit", 0, null);
  const report = await result;
  assert.equal(report.status, "observer-unavailable");
  assert.ok(samplerKills >= 1);
  assert.equal(childKills, 0);
  closed(f.fds);
  await f.observer.dispose();
});
test("unreaped sampler is an explicit cleanup failure, never a closed success", async (t) => {
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const kills = [];
  const f = await fixture(t, {
    spawn: () => {
      const value = Object.assign(new EventEmitter(), { pid: 12002 });
      value.kill = (signal) => {
        kills.push(signal);
        return true;
      };
      started();
      return value;
    },
  });
  const pending = f.fire();
  await began;
  f.timers.find((row) => row.ms === 2000).fn();
  await pending;
  const disposing = f.observer.dispose();
  for (let i = 0; i < 20 && !f.timers.some((row) => row.ms === 500); i++)
    await new Promise((resolve) => setImmediate(resolve));
  f.timers.find((row) => row.ms === 500).fn();
  const report = await disposing;
  assert.equal(report.samplerClosed, false);
  assert.equal(report.status, "owned-sampler-cleanup-failed");
  assert.equal(report.cleanupErrorType, "OwnedSamplerNotReaped");
  assert.ok(kills.includes("SIGKILL"));
  closed(f.fds);
  assert.equal(f.child.exitCode, null);
});
