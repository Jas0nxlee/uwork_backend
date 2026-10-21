import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, open, stat } from "node:fs/promises";
import { fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { instrumentOwnedWorkspaceChild } from "./native-macos-x64-secondary-logs.mjs";
const source = await readFile(
  new URL("./client-native-enterprise.mjs", import.meta.url),
  "utf8",
);
const derived = instrumentOwnedWorkspaceChild(source);
async function contract(run, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "uwork-x64-child-fd-"));
  const childPath = join(directory, "owned-node-child");
  await writeFile(
    childPath,
    "#!" +
      process.execPath +
      '\nprocess.stdout.write("[app-quit] owned contract\\n");process.stderr.write("TypeError: owned contract\\n");\n',
    { mode: 0o700 },
  );
  const handles = [],
    calls = [],
    events = [],
    timerDelays = [];
  const env = {
    PATH: process.env.PATH,
    OWNED_ENV_SENTINEL: "DO_NOT_COPY_THIS_ENV",
  };
  const sandbox = {
    performance,
    scheduleOwnedSecondarySample: () => ({ dispose: async () => {} }),
    join,
    evidence: directory,
    root: directory,
    appRoot: directory,
    packagedRuntime: true,
    electron: { pid: 900001, exitCode: null, signalCode: null },
    runtime: { electron: childPath },
    validateOwnedNativeWorkspace: async (_root, path) => path,
    nativeEnvironment: () => env,
    console: { log: (text) => events.push(JSON.parse(text)) },
    process: { stderr: { write: () => {} } },
    openOwnedWorkspaceLog: async (...args) => {
      const value = await open(...args);
      handles.push({ handle: value, fd: value.fd });
      return value;
    },
    writeFile,
    setTimeout: (callback, delay) => {
      timerDelays.push(delay);
      return setTimeout(callback, delay);
    },
    clearTimeout,
    spawn: (...args) => {
      calls.push(args);
      return realSpawn(...args);
    },
    ...overrides,
  };
  try {
    const fn = vm.runInNewContext(
      "(" + derived.instrumentedFunction + ")",
      sandbox,
    );
    await run({
      fn,
      directory,
      childPath,
      handles,
      calls,
      events,
      timerDelays,
      env,
      sandbox,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function closed(handles) {
  for (const { fd } of handles)
    assert.throws(() => fstatSync(fd), { code: "EBADF" });
}
test("exact original function only, original timers/argv/env/cwd retained", () => {
  assert.ok(
    derived.source.endsWith(
      source.slice(source.indexOf("async function stopNative() {")),
    ),
  );
  for (const text of [
    "}, 10000);",
    "2000,",
    "env: nativeEnvironment()",
    "cwd: appRoot",
    '"--open-workspace", target',
  ])
    assert.ok(derived.instrumentedFunction.includes(text));
  assert.ok(!derived.instrumentedFunction.includes('stdio: "pipe"'));
  assert.equal(
    (derived.instrumentedFunction.match(/"wx", 0o600/g) || []).length,
    2,
  );
});
test("changed original function or duplicated anchor is rejected", () => {
  assert.throws(() =>
    instrumentOwnedWorkspaceChild(source.replace("}, 10000);", "}, 11000);")),
  );
  assert.throws(() =>
    instrumentOwnedWorkspaceChild(source + "\n" + derived.originalFunction),
  );
});
test("real owned Node child writes 0600 FD logs; parent FDs close; no env in timings", async () => {
  await contract(
    async ({
      fn,
      directory,
      childPath,
      handles,
      calls,
      events,
      timerDelays,
      env,
    }) => {
      const value = await fn(join(directory, "workspace"));
      assert.equal(value, undefined);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], childPath);
      assert.deepEqual(Array.from(calls[0][1]), [
        "--open-workspace",
        join(directory, "workspace"),
      ]);
      assert.equal(calls[0][2].cwd, directory);
      assert.equal(calls[0][2].env, env);
      assert.equal(calls[0][2].stdio[0], "ignore");
      assert.ok(calls[0][2].stdio.slice(1).every(Number.isInteger));
      assert.deepEqual(timerDelays, [10000]);
      closed(handles);
      for (const name of [
        "workspace-secondary.stdout.log",
        "workspace-secondary.stderr.log",
        "workspace-secondary-timing.json",
      ])
        assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
      assert.match(
        await readFile(
          join(directory, "workspace-secondary.stdout.log"),
          "utf8",
        ),
        /owned contract/,
      );
      const raw = await readFile(
        join(directory, "workspace-secondary-timing.json"),
        "utf8",
      );
      const timing = JSON.parse(raw);
      assert.equal(timing.envRecorded, false);
      assert.ok(!raw.includes(env.OWNED_ENV_SENTINEL));
      assert.deepEqual(
        timing.marks.map((row) => row.phase),
        ["command", "spawned", "exit"],
      );
      assert.ok(
        timing.marks.every(
          (row, i, rows) =>
            Number.isFinite(row.atMs) && (!i || row.atMs >= rows[i - 1].atMs),
        ),
      );
      assert.equal(events[1].event, "workspace-secondary-exit");
      assert.equal(events[1].timedOut, false);
      assert.equal(events[1].exit.code, 0);
    },
  );
});
test("async spawn error preserves original error identity and closes both FDs", async () => {
  const original = Error("owned original spawn failure");
  await contract(
    async ({ fn, handles, directory }) => {
      await assert.rejects(
        fn(join(directory, "workspace")),
        (error) => error === original,
      );
      closed(handles);
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("error", original));
        return child;
      },
    },
  );
});
test("second open failure closes first FD and does not spawn", async () => {
  const original = Error("owned second-open failure");
  let opened,
    fd,
    count = 0,
    spawns = 0;
  await contract(
    async ({ fn, directory }) => {
      await assert.rejects(
        fn(join(directory, "workspace")),
        (error) => error === original,
      );
      assert.equal(spawns, 0);
      assert.throws(() => fstatSync(fd), { code: "EBADF" });
    },
    {
      openOwnedWorkspaceLog: async (...args) => {
        if (++count === 2) throw original;
        opened = await open(...args);
        fd = opened.fd;
        return opened;
      },
      spawn: () => {
        spawns++;
      },
    },
  );
});
test("one close diagnostic failure still closes other FD and keeps success", async () => {
  let count = 0;
  await contract(
    async ({ fn, directory }) => {
      await fn(join(directory, "workspace"));
      const timing = JSON.parse(
        await readFile(
          join(directory, "workspace-secondary-timing.json"),
          "utf8",
        ),
      );
      assert.deepEqual(timing.closeErrors, ["Error"]);
    },
    {
      openOwnedWorkspaceLog: async (...args) => {
        const file = await open(...args);
        const ordinal = ++count;
        return {
          fd: file.fd,
          close: async () => {
            await file.close();
            if (ordinal === 1) throw Error("closed but observer failed");
          },
        };
      },
    },
  );
});
test("timing write and stderr failures cannot mask original child error", async () => {
  const original = Error("original child error");
  await contract(
    async ({ fn, directory, handles }) => {
      await assert.rejects(
        fn(join(directory, "workspace")),
        (error) => error === original,
      );
      closed(handles);
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("error", original));
        return child;
      },
      writeFile: async () => {
        throw Error("timing unavailable");
      },
      process: {
        stderr: {
          write: () => {
            throw Error("stderr unavailable");
          },
        },
      },
    },
  );
});

for (const replacement of [false, true]) {
  test(`Main ${replacement ? "generation replacement" : "exit"} during async log opens refuses spawn and closes both FDs`, async () => {
    await contract(async ({ fn, directory, sandbox, handles, calls }) => {
      const originalOpen = sandbox.openOwnedWorkspaceLog;
      let opens = 0;
      sandbox.openOwnedWorkspaceLog = async (...args) => {
        const file = await originalOpen(...args);
        if (++opens === 2) {
          if (replacement)
            sandbox.electron = {
              pid: 900002,
              exitCode: null,
              signalCode: null,
            };
          else sandbox.electron.exitCode = 0;
        }
        return file;
      };
      let failure;
      try {
        await fn(join(directory, "workspace"));
      } catch (error) {
        failure = error;
      }
      assert.equal(handles.length, 2);
      closed(handles);
      assert.equal(
        calls.length,
        0,
        "The original last Main guard must follow every diagnostic await",
      );
      assert.equal(failure?.message, "Owned Native Main changed");
    });
  });
}

for (const reject of [false, true]) {
  test(`sampler observer failure cannot replace original ${reject ? "error" : "success"}`, async () => {
    const original = Error("original owned child failure");
    await contract(
      async ({ fn, directory, handles }) => {
        if (reject)
          await assert.rejects(
            fn(join(directory, "workspace")),
            (error) => error === original,
          );
        else assert.equal(await fn(join(directory, "workspace")), undefined);
        closed(handles);
      },
      {
        scheduleOwnedSecondarySample: () => {
          throw Error("sampler observer unavailable");
        },
        ...(reject
          ? {
              spawn: () => {
                const child = new EventEmitter();
                queueMicrotask(() => child.emit("error", original));
                return child;
              },
            }
          : {}),
      },
    );
  });
}
