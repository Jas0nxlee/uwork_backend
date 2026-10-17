import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createConfigurationSession } from "../admin/src/configurationSession.js";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const envelope = (text: string, revision = 1) => ({
  draft: { text },
  revision,
  version: 0,
});
async function settle() {
  await setImmediate();
}

test("pending or invalid current scope cannot submit any write", async () => {
  const read = deferred<unknown>(),
    calls: string[] = [];
  const session = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "menus",
    notify() {},
    request: async (path, method = "GET") => {
      calls.push(method + " " + path);
      return read.promise;
    },
  });
  const stop = session.activate();
  assert.equal(session.getSnapshot().status, "loading");
  for (const action of ["save", "publish", "discard"] as const)
    assert.equal(await session.action(action), false);
  assert.deepEqual(calls, ["GET /api/tenants/A/configurations/menus"]);
  read.resolve({ draft: {}, revision: -1, version: 0 });
  await settle();
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(await session.action("save"), false);
  stop();
});

test("a late old-tenant success or failure cannot replace the next scoped draft", async () => {
  for (const outcome of ["success", "failure"] as const) {
    const oldRead = deferred<unknown>(),
      notices: string[] = [];
    const old = createConfigurationSession({
      base: "/api/tenants/A",
      kind: "menus",
      notify: (v) => notices.push(v),
      request: async () => oldRead.promise,
    });
    const stopOld = old.activate();
    stopOld();
    const current = createConfigurationSession({
      base: "/api/tenants/B",
      kind: "help",
      notify: (v) => notices.push(v),
      request: async () => envelope("B"),
    });
    const stopCurrent = current.activate();
    await settle();
    if (outcome === "success") oldRead.resolve(envelope("old A", 20));
    else oldRead.reject(new Error("late A failure"));
    await settle();
    assert.deepEqual(current.getSnapshot().data, { text: "B" });
    assert.equal(current.getSnapshot().revision, 1);
    assert.equal(current.getSnapshot().error, "");
    assert.deepEqual(notices, []);
    stopCurrent();
  }
});

test("same-scope load order and StrictMode reactivation reject old completions", async () => {
  const first = deferred<unknown>(),
    second = deferred<unknown>();
  let count = 0;
  const session = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "menus",
    notify() {},
    request: async () => (++count === 1 ? first.promise : second.promise),
  });
  const stopFirst = session.activate();
  stopFirst();
  const stopSecond = session.activate();
  second.resolve(envelope("current", 2));
  await settle();
  first.resolve(envelope("old", 1));
  await settle();
  assert.deepEqual(session.getSnapshot().data, { text: "current" });
  assert.equal(session.getSnapshot().revision, 2);
  stopSecond();
});

test("a newer same-scope reload keeps its draft when the first read fails late", async () => {
  const first = deferred<unknown>(),
    second = deferred<unknown>();
  let count = 0;
  const session = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "menus",
    notify() {},
    request: async () => (++count === 1 ? first.promise : second.promise),
  });
  const stop = session.activate();
  const reloaded = session.reload();
  second.resolve(envelope("newer", 9));
  assert.equal(await reloaded, true);
  first.reject(new Error("late first load error"));
  await settle();
  assert.deepEqual(session.getSnapshot().data, { text: "newer" });
  assert.equal(session.getSnapshot().revision, 9);
  assert.equal(session.getSnapshot().error, "");
  stop();
});

test("an accepted old action finishes on its original URL without reloading or notifying the new kind", async () => {
  const write = deferred<unknown>(),
    calls: { path: string; method: string; body: unknown }[] = [],
    notices: string[] = [];
  const old = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "menus",
    notify: (v) => notices.push(v),
    request: async (path, method = "GET", body) => {
      calls.push({ path, method, body });
      return method === "GET" ? envelope("A", 5) : write.promise;
    },
  });
  const stopOld = old.activate();
  await settle();
  old.edit({ text: "edited A" });
  const submitted = old.action("save");
  stopOld();
  const current = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "desktop",
    notify: (v) => notices.push(v),
    request: async () => envelope("desktop", 1),
  });
  const stopCurrent = current.activate();
  await settle();
  write.resolve({ ok: true });
  assert.equal(
    await submitted,
    true,
    "the already accepted mutation may finish",
  );
  assert.deepEqual(calls, [
    {
      path: "/api/tenants/A/configurations/menus",
      method: "GET",
      body: undefined,
    },
    {
      path: "/api/tenants/A/configurations/menus",
      method: "PUT",
      body: { revision: 5, data: { text: "edited A" } },
    },
  ]);
  assert.deepEqual(current.getSnapshot().data, { text: "desktop" });
  assert.deepEqual(notices, []);
  stopCurrent();
});

test("the shared validation port rejects an invalid draft without losing local edits or calling API", async () => {
  const calls: string[] = [];
  const session = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "help",
    notify() {},
    prepare: (data) => {
      if ((data as { text: string }).text === "bad")
        throw new Error("invalid current form");
      return data;
    },
    request: async (_path, method = "GET") => {
      calls.push(method);
      return envelope("valid");
    },
  });
  const stop = session.activate();
  await settle();
  session.edit({ text: "bad" });
  assert.equal(await session.action("save"), false);
  assert.deepEqual(calls, ["GET"]);
  assert.deepEqual(session.getSnapshot().data, { text: "bad" });
  assert.match(session.getSnapshot().error, /invalid current form/);
  stop();
});

test("save, publish and discard preserve the existing revision and endpoint contracts", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  let revision = 4,
    version = 2;
  const session = createConfigurationSession({
    base: "/api/tenants/A",
    kind: "new-chat",
    notify() {},
    request: async (path, method = "GET", body) => {
      calls.push({ path, method, body });
      if (method !== "GET") {
        revision++;
        if (method === "POST") version++;
        return { ok: true };
      }
      return {
        draft: { welcome: "original", mcpHub: null },
        revision,
        version,
      };
    },
  });
  const stop = session.activate();
  await settle();
  session.edit({ welcome: "", mcpHub: null });
  assert.equal(await session.action("save"), true);
  assert.equal(await session.action("publish"), true);
  assert.equal(await session.action("discard"), true);
  assert.deepEqual(
    calls.filter((call) => call.method !== "GET"),
    [
      {
        path: "/api/tenants/A/configurations/new-chat",
        method: "PUT",
        body: { revision: 4, data: { welcome: "", mcpHub: null } },
      },
      {
        path: "/api/tenants/A/configurations/new-chat/publish",
        method: "POST",
        body: { revision: 5 },
      },
      {
        path: "/api/tenants/A/configurations/new-chat/draft",
        method: "DELETE",
        body: undefined,
      },
    ],
  );
  assert.equal(session.getSnapshot().revision, 7);
  assert.equal(session.getSnapshot().version, 3);
  stop();
});
