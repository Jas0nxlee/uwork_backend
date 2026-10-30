import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createOwnedMacosUriLaunchers } from "./native-macos-secondary-uri.mjs";

test("finite URI launcher rejects unknown roles and reused roles before spawning", async () => {
  const calls = [];
  const primary = { pid: 200, exitCode: null, signalCode: null };
  const create = () =>
    createOwnedMacosUriLaunchers({
      executable: "/owned/UWork Preview.app/Contents/MacOS/UWork Preview",
      cwd: "/owned/runtime",
      candidate: "/owned/确认 中文 空格",
      primary: () => primary,
      validate: async (path) => {
        assert.equal(path, "/owned/确认 中文 空格");
        return path;
      },
      environment: () => ({ OWNED_TEST_ENV: "private-not-printed" }),
      emit: () => {},
      spawnProcess: (file, args, options) => {
        calls.push({ file, args, options });
        const c = new EventEmitter();
        c.pid = 201;
        c.exitCode = null;
        c.signalCode = null;
        c.kill = () => {
          c.exitCode = 0;
          queueMicrotask(() => c.emit("exit", 0, null));
        };
        return c;
      },
    });
  const launcher = create();
  await assert.rejects(launcher.launch("arbitrary"), /role/);
  assert.equal(calls.length, 0);
  await launcher.launch("cancel");
  await assert.rejects(launcher.launch("cancel"), /once/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    "zcode://workspace/open?path=%2Fowned%2F%E7%A1%AE%E8%AE%A4%20%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC",
  ]);
  assert.equal(
    calls[0].file,
    "/owned/UWork Preview.app/Contents/MacOS/UWork Preview",
  );
  assert.equal(calls[0].options.env.OWNED_TEST_ENV, "private-not-printed");
  await launcher.dispose();
});

test("stale primary and invalid owned directory never spawn a secondary", async () => {
  let calls = 0;
  const options = {
    executable: "/owned/app",
    cwd: "/owned",
    candidate: "/owned/确认 中文 空格",
    environment: () => ({}),
    emit: () => {},
    spawnProcess: () => {
      calls++;
      throw Error("must not spawn");
    },
  };
  const stopped = createOwnedMacosUriLaunchers({
    ...options,
    primary: () => ({ pid: 1, exitCode: 0, signalCode: null }),
    validate: async (p) => p,
  });
  await assert.rejects(stopped.launch("confirm"), /Main/);
  const outside = createOwnedMacosUriLaunchers({
    ...options,
    primary: () => ({ pid: 1, exitCode: null, signalCode: null }),
    validate: async () => {
      throw Error("owned directory denied");
    },
  });
  await assert.rejects(outside.launch("confirm"), /owned directory/);
  assert.equal(calls, 0);
});

test("a concurrent duplicate is reserved before asynchronous validation; unknown URI is fixed", async () => {
  const primary = { pid: 300, exitCode: null, signalCode: null };
  let unblock,
    calls = [];
  const launcher = createOwnedMacosUriLaunchers({
    executable: "/owned/app",
    cwd: "/owned",
    candidate: "/owned/path",
    primary: () => primary,
    validate: () =>
      new Promise((resolve) => {
        unblock = () => resolve("/owned/path");
      }),
    environment: () => ({}),
    emit: () => {},
    spawnProcess: (file, args) => {
      calls.push(args);
      const child = new EventEmitter();
      child.pid = 301;
      child.exitCode = null;
      child.signalCode = null;
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      });
      return child;
    },
  });
  const pending = launcher.launch("cancel");
  await assert.rejects(launcher.launch("cancel"), /once/);
  unblock();
  await pending;
  await launcher.launch("parallel-unknown");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[1], ["zcode://unrecognized-owned-protocol-test"]);
  assert.equal(
    launcher
      .status()
      .every((row) => row.closed && !row.timedOut && row.exitCode === 0),
    true,
  );
  await launcher.dispose();
});
