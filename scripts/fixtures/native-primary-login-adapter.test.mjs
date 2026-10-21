import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPrimaryMainEntry } from "./native-primary-entry.mjs";
import * as primaryAdapter from "./native-primary-login-adapter.mjs";
import {
  PRIMARY_ADAPTER_REVIEWED,
  PRIMARY_AUTH_EXPRESSION,
  assertPrimaryCommand,
  createPrimaryParentBridge,
  installPrimaryMainGuard,
  startPrimaryMainEntry,
} from "./native-primary-login-adapter.mjs";
import {
  primaryLimitMemberId,
  primaryLoginModeEnabled,
} from "./native-primary-login.mjs";

const origin = "https://127.0.0.1:50301",
  nonce = "N".repeat(43);
function child() {
  const child = new EventEmitter();
  child.connected = true;
  child.sent = [];
  child.kills = 0;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.send = (message, done) => {
    child.sent.push(message);
    done?.();
  };
  child.kill = () => {
    child.kills++;
  };
  return child;
}
async function electronFixture(t) {
  const root = await mkdtemp(join(import.meta.dirname, "adapter-owned-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = join(root, "app");
  await mkdir(appRoot);
  await writeFile(join(appRoot, "page.html"), "owned");
  const session = () => ({
    installs: 0,
    webRequest: {
      onBeforeRequest(_filter, handler) {
        this.handler = handler;
      },
    },
  });
  const defaultSession = session(),
    loginSession = session();
  const app = new EventEmitter();
  let exits = 0;
  app.isReady = () => true;
  app.exit = () => {
    exits++;
  };
  const owner = new EventEmitter();
  owner.id = 7;
  const expressions = [];
  owner.executeJavaScript = async (expression) => {
    expressions.push(expression);
    return { authenticated: true, signedOut: false, loginVisible: false };
  };
  const guest = new EventEmitter();
  guest.id = 8;
  guest.session = loginSession;
  const channel = child();
  const electron = {
    app,
    session: { defaultSession },
    BrowserWindow: {
      getAllWindows: () => [
        {
          webContents: owner,
          contentView: { children: [{ webContents: guest }] },
        },
      ],
    },
    webContents: { fromId: (id) => (id === guest.id ? guest : undefined) },
    shell: {
      openExternal() {
        throw Error("OS must not be called");
      },
    },
  };
  return {
    root,
    appRoot,
    defaultSession,
    loginSession,
    app,
    owner,
    guest,
    channel,
    electron,
    expressions,
    exits: () => exits,
  };
}
function url() {
  const u = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [key, value] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state: "finite-state",
    login_type: "CorpApp",
    lang: "zh",
  }))
    u.searchParams.set(key, value);
  return u.href;
}

test("reviewed adapter still requires the explicit isolated primary opt-in", () => {
  assert.equal(PRIMARY_ADAPTER_REVIEWED, true);
  assert.equal(
    primaryLoginModeEnabled("enabled", undefined, undefined, undefined),
    false,
  );
  assert.equal(
    primaryLoginModeEnabled("enabled", undefined, undefined, "controlled"),
    true,
  );
  assert.throws(() =>
    primaryLoginModeEnabled(undefined, undefined, undefined, "controlled"),
  );
  assert.throws(() =>
    primaryLoginModeEnabled("enabled", undefined, "controlled", "controlled"),
  );
});

test("PTY whitelist preserves only owned workspace shape and bounded snapshot names", () => {
  for (const c of [
    { op: "launch" },
    { op: "stopNative" },
    { op: "completePrimaryLogin" },
    { op: "primaryLoginStatus" },
    { op: "openWorkspace", workspacePath: "/owned/project" },
    { op: "experienceSnapshot", name: "after-login" },
  ])
    assertPrimaryCommand(c);
  for (const c of [
    null,
    [],
    { op: "launch", token: "bad" },
    { op: "openWorkspace", workspacePath: "relative" },
    { op: "openWorkspace", workspacePath: "/owned/../elsewhere" },
    { op: "openWorkspace", workspacePath: "/owned/project", state: "bad" },
    { op: "experienceSnapshot", name: "../escape" },
    { op: "arbitraryRpc" },
  ])
    assert.throws(() => assertPrimaryCommand(c));
});

test("parent private init uses anonymous messages; raw output becomes bounded byte counters", async (t) => {
  const c = child();
  let aborts = 0;
  const bridge = createPrimaryParentBridge(c, {
    nonce,
    origin,
    hold: {
      abort() {
        aborts++;
      },
    },
  });
  t.after(() => bridge.dispose());
  c.emit("message", { op: "hello" });
  assert.deepEqual(c.sent, [{ op: "init", nonce, origin }]);
  c.emit("message", { op: "ready", nonce });
  await bridge.ready;
  c.stdout.write(Buffer.from(nonce));
  c.stderr.write(Buffer.from(url()));
  const safe = JSON.stringify(bridge.safeStatus());
  assert.ok(!safe.includes(nonce));
  assert.ok(!safe.includes(url()));
  assert.equal(bridge.safeStatus().stdoutBytes, nonce.length);
  assert.equal(aborts, 0);
  bridge.expectStop();
  c.emit("disconnect");
  assert.equal(c.kills, 0);
});

test("private malformed/replayed frames and output overflow stop only the owned child", async (t) => {
  for (const kind of ["extra", "replay", "overflow"]) {
    const c = child();
    let aborted = 0;
    const bridge = createPrimaryParentBridge(c, {
      nonce,
      origin,
      hold: {
        abort() {
          aborted++;
        },
      },
    });
    t.after(() => bridge.dispose());
    c.emit("message", { op: "hello" });
    c.emit("message", { op: "ready", nonce });
    await bridge.ready;
    if (kind === "extra")
      c.emit("message", { op: "ready", nonce, token: "hidden" });
    if (kind === "replay") c.emit("message", { op: "ready", nonce });
    if (kind === "overflow") c.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.equal(bridge.safeStatus().failed, true);
    assert.equal(c.kills, 1);
    assert.equal(aborted, 1);
  }
});

test("Session guard precedes production import, covers every new Session and never sends SSO externally", async (t) => {
  const f = await electronFixture(t);
  let failed = 0;
  const guard = installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: () => {
      failed++;
    },
  });
  f.app.emit("session-created", f.loginSession);
  f.app.emit("web-contents-created", {}, f.guest);
  assert.equal(guard.safeStatus().sessions, 2);
  const replies = [];
  f.loginSession.webRequest.handler(
    {
      id: 11,
      method: "GET",
      resourceType: "mainFrame",
      webContentsId: 8,
      url: url(),
    },
    (value) => replies.push(value),
  );
  assert.deepEqual(replies, []);
  assert.equal(guard.safeStatus().held, true);
  assert.equal(f.channel.sent[0].op, "sso");
  assert.equal(failed, 0);
  f.guest.emit("destroyed");
  await new Promise(setImmediate);
  assert.deepEqual(
    f.channel.sent.map((m) => m.op),
    ["sso", "guest-closed", "authenticated"],
  );
  assert.deepEqual(f.expressions, [PRIMARY_AUTH_EXPRESSION]);
  assert.deepEqual(replies, []);
});

test("owned file and backend origin are allowed, unknown origins and OS external opens are blocked", async (t) => {
  const f = await electronFixture(t);
  let failed = 0;
  const guard = installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: () => {
      failed++;
    },
  });
  const replies = [];
  const send = (value) =>
    f.defaultSession.webRequest.handler({ url: value }, (result) =>
      replies.push(result),
    );
  send(pathToFileURL(join(f.appRoot, "page.html")).href);
  send(origin + "/owned");
  assert.deepEqual(replies, [{ cancel: false }, { cancel: false }]);
  send("https://unknown.example.test/");
  assert.deepEqual(replies.at(-1), { cancel: true });
  assert.equal(failed, 1);
  assert.equal(guard.safeStatus().failed, true);
  await f.electron.shell.openExternal(url());
  assert.equal(failed, 1);
});

test("SSO from owner window instead of the original owned guest cannot be held", async (t) => {
  const f = await electronFixture(t);
  let failed = 0;
  installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: () => {
      failed++;
    },
  });
  const replies = [];
  f.defaultSession.webRequest.handler(
    {
      id: 11,
      method: "GET",
      resourceType: "mainFrame",
      webContentsId: 7,
      url: url(),
    },
    (value) => replies.push(value),
  );
  assert.deepEqual(replies, [{ cancel: true }]);
  assert.equal(f.channel.sent.length, 0);
  assert.equal(failed, 1);
});

test("secondary entry requires the original exact owned workspace and local Git directory", async (t) => {
  const f = await electronFixture(t);
  const workspace = join(f.root, "project");
  await mkdir(workspace);
  await mkdir(join(workspace, ".git"));
  let imports = 0;
  await startPrimaryMainEntry(
    f.electron,
    { argv: ["electron", "app", "--open-workspace", workspace] },
    {
      appRoot: f.appRoot,
      ownedRoot: f.root,
      origin,
      loadMain: async () => {
        imports++;
      },
    },
  );
  assert.equal(imports, 1);
  assert.ok(f.defaultSession.webRequest.handler);
  for (const argv of [
    ["electron", "app"],
    ["electron", "app", "--open-workspace", workspace, "extra"],
    ["electron", "app", "--open-workspace", f.appRoot],
  ]) {
    await assert.rejects(
      startPrimaryMainEntry(
        f.electron,
        { argv },
        {
          appRoot: f.appRoot,
          ownedRoot: f.root,
          origin,
          loadMain: async () => {
            throw Error("must not import");
          },
        },
      ),
    );
  }
});

test("parent-to-child cancellation and disconnect never release an SSO allow", async (t) => {
  const f = await electronFixture(t);
  let failed = 0;
  const guard = installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: () => {
      failed++;
    },
  });
  f.app.emit("session-created", f.loginSession);
  const replies = [];
  f.loginSession.webRequest.handler(
    {
      id: 11,
      method: "GET",
      resourceType: "mainFrame",
      webContentsId: 8,
      url: url(),
    },
    (value) => replies.push(value),
  );
  guard.receive({ op: "cancel", nonce, id: 11 });
  guard.disconnected();
  assert.deepEqual(replies, [{ cancel: true }]);
  assert.equal(failed, 1);
});

test("fixed DOM witness has only three visibility booleans and no authority reads", () => {
  for (const forbidden of [
    "href",
    "token",
    "cookie",
    "innerHTML",
    "fetch",
    "service",
    "window.zcode",
  ])
    assert.ok(!PRIMARY_AUTH_EXPRESSION.includes(forbidden));
  assert.equal(
    (PRIMARY_AUTH_EXPRESSION.match(/data-testid=/gu) ?? []).length,
    3,
  );
});

test("stalled fixed DOM witness has an absolute finite deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await electronFixture(t);
  const failures = [];
  f.owner.executeJavaScript = () => new Promise(() => {});
  const guard = installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: (diagnostic) => failures.push(diagnostic),
  });
  f.app.emit("session-created", f.loginSession);
  f.loginSession.webRequest.handler(
    {
      id: 11,
      method: "GET",
      resourceType: "mainFrame",
      webContentsId: 8,
      url: url(),
    },
    () => {},
  );
  f.guest.emit("destroyed");
  t.mock.timers.tick(3000);
  assert.deepEqual(failures, [
    {
      reason: "auth_deadline",
      lastProjection: null,
      completedReads: 0,
      inFlight: true,
    },
  ]);
  assert.equal(guard.safeStatus().failed, true);
  assert.ok(!f.channel.sent.some((message) => message.op === "authenticated"));
});

test("invalid private stop cannot run the graceful-stop callback", async (t) => {
  const f = await electronFixture(t),
    runtime = child();
  let stops = 0;
  const entry = startPrimaryMainEntry(f.electron, runtime, {
    appRoot: f.appRoot,
    ownedRoot: f.root,
    origin,
    loadMain: async () => {},
    onStop: () => {
      stops++;
    },
  });
  runtime.emit("message", { op: "init", nonce, origin });
  await entry;
  runtime.emit("message", { op: "stop", nonce: "wrong" });
  assert.equal(stops, 0);
  assert.equal(f.exits(), 1);
});

test("private bootstrap env is scrubbed before production Main import, while Main IPC remains live", async (t) => {
  const f = await electronFixture(t),
    runtime = child();
  runtime.env = {
    NODE_CHANNEL_FD: "3",
    NODE_CHANNEL_SERIALIZATION_MODE: "json",
    UWORK_NATIVE_PRIMARY_LOGIN: "controlled",
    UWORK_NATIVE_VIEWER_AUTH: "controlled",
    PATH: "/owned/bin",
    ZCODE_CREDENTIAL_SECRET: "finite-cipher",
  };
  let imported = false;
  const entry = startPrimaryMainEntry(f.electron, runtime, {
    appRoot: f.appRoot,
    ownedRoot: f.root,
    origin,
    loadMain: async () => {
      assert.deepEqual(Object.keys(runtime.env).sort(), [
        "PATH",
        "ZCODE_CREDENTIAL_SECRET",
      ]);
      assert.equal(typeof runtime.send, "function");
      imported = true;
    },
  });
  runtime.emit("message", { op: "init", nonce, origin });
  await entry;
  assert.equal(imported, true);
  assert.ok(runtime.sent.some((message) => message.op === "ready"));
});

test("staged common writes the exact primary member quota while default remains unchanged", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const limitMemberId = primaryLimitMemberId(");
  const end = source.indexOf("let workflowTestLimits;", start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const execute = new AsyncFunction(
    "primaryLoginEnabled",
    "primaryLimitMemberId",
    "member",
    "primaryMember",
    "api",
    "p",
    "initialLimitAmounts",
    source.slice(start, end),
  );
  for (const primary of [false, true]) {
    const calls = [];
    await execute(
      primary,
      primaryLimitMemberId,
      { id: "journey-a" },
      { id: "primary-member" },
      async (path, method, body) => {
        calls.push({ path, method, body });
        return { ok: true };
      },
      "/tenant",
      { member: 123 },
    );
    assert.deepEqual(calls, [
      {
        path: "/tenant/limits",
        method: "PUT",
        body: {
          subjectType: "member",
          subjectId: primary ? "primary-member" : "journey-a",
          amount: 123,
        },
      },
    ]);
  }
});

test("generated primary ESM entry imports the guard first and contains no RAM bindings", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const content = createPrimaryMainEntry({
    appRoot: "/owned/runtime/app",
    ownedRoot: "/owned",
    origin,
    evidenceDirectory: "/evidence/owned",
  });
  assert.ok(content.includes("startPrimaryMainEntry"));
  assert.ok(
    content.indexOf("native-primary-login-adapter.mjs") <
      content.indexOf("loadMain: () => import"),
  );
  for (const forbidden of ["primaryNonce", "primarySupplierKey", nonce])
    assert.ok(!content.includes(forbidden));
  const snapshotStart = source.indexOf(
    "async function saveExperienceProof(name)",
  );
  const snapshotEnd = source.indexOf("let closing = false;", snapshotStart);
  const snapshot = source.slice(snapshotStart, snapshotEnd);
  // The reviewed dual-organization branch retains counts, without model bodies.
  // Removing only that exact branch must recover the frozen original proof.
  const dualProof = `        ...(twoOrganizationAuth
          ? {
              modelRequestsCount: modelRequests.length,
              twoOrganization: {
                auth: twoOrganizationAuth.safeStatus(),
                baseline: projectTwoOrganizationBaseline(
                  app.services.db,
                  twoOrganizationMetadata,
                ),
              },
            }
          : { modelRequests }),
`;
  assert.equal(snapshot.split(dualProof).length - 1, 1);
  assert.equal(
    createHash("sha256")
      .update(snapshot.replace(dualProof, "        modelRequests,\n"))
      .digest("hex"),
    "f17ae3d5813b4c24e91f43e1732197ebd652d8726138eebe92340e893594240c",
  );
  assert.equal(
    createHash("sha256").update(snapshot).digest("hex"),
    "564ad5244237c513117f057b016c770d468e7914304ee3a1dad6dc2ca01e86d3",
  );
});

test("actual common primary logging branch drains counters and never constructs a raw log sink", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "  if (primaryLoginEnabled) {\n    const ownedChild = electron;",
  );
  const end = source.indexOf(
    '  console.log(\n    JSON.stringify({ event: "launched"',
    start,
  );
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const c = child();
  let created = 0;
  c.stdout.pipe = c.stderr.pipe = () => {
    throw Error("raw log pipe forbidden");
  };
  await new AsyncFunction(
    "primaryLoginEnabled",
    "electron",
    "createPrimaryParentBridge",
    "primaryNonce",
    "origin",
    "primaryLoginHold",
    "let primaryBridge;\n" + source.slice(start, end),
  )(
    true,
    c,
    () => {
      created++;
      return { ready: Promise.resolve(), dispose() {} };
    },
    nonce,
    origin,
    {},
  );
  assert.equal(created, 1);
});

test("optional entry rejection reports only fixed early secondary codes", async (t) => {
  for (const code of [
    "secondary_argv_shape",
    "owned_workspace",
    "session_guard",
    "main_import",
  ]) {
    const f = await electronFixture(t);
    const workspace = join(f.root, "project");
    await mkdir(workspace);
    await mkdir(join(workspace, ".git"));
    const reports = [];
    const privateError = Error("SYNTHETIC_PRIVATE_CAUSE_DO_NOT_REPORT");
    if (code === "session_guard")
      f.defaultSession.webRequest.onBeforeRequest = () => {
        throw privateError;
      };
    const argv = [
      "electron",
      "app",
      "--open-workspace",
      code === "owned_workspace" ? f.appRoot : workspace,
    ];
    if (code === "secondary_argv_shape")
      argv.push("https://example.invalid/?state=SYNTHETIC_PRIVATE_STATE");
    await assert.rejects(
      startPrimaryMainEntry(
        f.electron,
        { argv },
        {
          appRoot: f.appRoot,
          ownedRoot: f.root,
          origin,
          onReject: (...args) => reports.push(args),
          loadMain: () => {
            if (code === "main_import") throw privateError;
          },
        },
      ),
      (cause) =>
        cause.message === "Primary private adapter rejected" &&
        cause.cause === undefined,
    );
    assert.deepEqual(reports, [[code]]);
    for (const forbidden of [
      privateError.message,
      "SYNTHETIC_PRIVATE_STATE",
      workspace,
    ])
      assert.ok(!JSON.stringify(reports).includes(forbidden));
  }
});

test("primary import failures report once without serializing the rejected exception", async (t) => {
  const f = await electronFixture(t),
    runtime = child(),
    reports = [];
  const entry = startPrimaryMainEntry(f.electron, runtime, {
    appRoot: f.appRoot,
    ownedRoot: f.root,
    origin,
    onReject: (...args) => reports.push(args),
    loadMain: async () => {
      throw Error("SYNTHETIC_PRIVATE_MAIN_IMPORT");
    },
  });
  runtime.emit("message", { op: "init", nonce, origin });
  await assert.rejects(
    entry,
    (cause) =>
      cause.message === "Primary private adapter rejected" &&
      cause.cause === undefined,
  );
  runtime.emit("disconnect");
  assert.deepEqual(reports, [["main_import"]]);
  assert.ok(!JSON.stringify(reports).includes(nonce));
});

test("malformed init, invalid private stop and hello send failure report private_channel", async (t) => {
  for (const kind of ["init", "stop", "send"]) {
    const f = await electronFixture(t),
      runtime = child(),
      reports = [];
    if (kind === "send")
      runtime.send = () => {
        throw Error("SYNTHETIC_PRIVATE_CHANNEL_CAUSE");
      };
    const entry = startPrimaryMainEntry(f.electron, runtime, {
      appRoot: f.appRoot,
      ownedRoot: f.root,
      origin,
      onReject: (...args) => reports.push(args),
      loadMain: async () => {},
    });
    if (kind === "stop") {
      runtime.emit("message", { op: "init", nonce, origin });
      await entry;
      runtime.emit("message", { op: "stop", nonce: "SYNTHETIC_PRIVATE_NONCE" });
    } else {
      if (kind === "init")
        runtime.emit("message", {
          op: "init",
          nonce,
          origin,
          privateCause: "SYNTHETIC_PRIVATE_CHANNEL_CAUSE",
        });
      await assert.rejects(entry, /Primary private adapter rejected/u);
    }
    assert.deepEqual(reports, [["private_channel"]]);
    assert.ok(!JSON.stringify(reports).includes("SYNTHETIC_PRIVATE"));
  }
});

test("installed Session guard failure reports session_guard independently of Main import", async (t) => {
  const f = await electronFixture(t),
    runtime = child(),
    reports = [];
  const entry = startPrimaryMainEntry(f.electron, runtime, {
    appRoot: f.appRoot,
    ownedRoot: f.root,
    origin,
    onReject: (...args) => reports.push(args),
    loadMain: async () => {},
  });
  runtime.emit("message", { op: "init", nonce, origin });
  await entry;
  f.defaultSession.webRequest.handler(
    { url: "https://outside.invalid/?state=SYNTHETIC_PRIVATE_STATE" },
    () => {},
  );
  runtime.emit("disconnect");
  assert.deepEqual(reports, [
    [
      "session_guard",
      {
        reason: "request_denied",
        lastProjection: null,
        completedReads: 0,
        inFlight: false,
      },
    ],
  ]);
  assert.ok(!JSON.stringify(reports).includes("SYNTHETIC_PRIVATE"));
});

test("absent diagnostics preserve default rejection; throwing diagnostics cannot replace it", async (t) => {
  const f = await electronFixture(t),
    workspace = join(f.root, "project");
  await mkdir(workspace);
  await mkdir(join(workspace, ".git"));
  const original = Error("SYNTHETIC_ORIGINAL_DEFAULT_ERROR");
  await assert.rejects(
    startPrimaryMainEntry(
      f.electron,
      { argv: ["electron", "app", "--open-workspace", workspace] },
      {
        appRoot: f.appRoot,
        ownedRoot: f.root,
        origin,
        loadMain: async () => {
          throw original;
        },
      },
    ),
    (cause) => cause === original,
  );
  for (const onReject of [
    () => {
      throw original;
    },
    async () => {
      throw original;
    },
  ]) {
    await assert.rejects(
      startPrimaryMainEntry(
        f.electron,
        { argv: ["electron", "app"] },
        {
          appRoot: f.appRoot,
          ownedRoot: f.root,
          origin,
          onReject,
          loadMain: async () => {},
        },
      ),
      (cause) =>
        cause.message === "Primary private adapter rejected" &&
        cause.cause === undefined,
    );
  }
  await new Promise(setImmediate);
  const ready = await electronFixture(t),
    runtime = child(),
    reports = [];
  const entry = startPrimaryMainEntry(ready.electron, runtime, {
    appRoot: ready.appRoot,
    ownedRoot: ready.root,
    origin,
    onReject: (...args) => reports.push(args),
    loadMain: async () => {},
  });
  runtime.emit("message", { op: "init", nonce, origin });
  await entry;
  runtime.emit("message", { op: "stop", nonce });
  runtime.emit("disconnect");
  assert.deepEqual(reports, []);
  assert.equal(ready.exits(), 0);
});

test("primary common writes only pid/code diagnostics and preserves actual exit signal", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const content = createPrimaryMainEntry({
    appRoot: "/owned/runtime/app",
    ownedRoot: "/owned",
    origin,
    evidenceDirectory: "/evidence/owned",
  });
  const callbackStart = content.indexOf("onReject:");
  const callbackEnd = content.indexOf("\n    loadMain:", callbackStart);
  assert.ok(callbackStart > 0 && callbackEnd > callbackStart);
  const writes = [];
  const onReject = new Script(
    "(" +
      content
        .slice(callbackStart + "onReject:".length, callbackEnd)
        .trim()
        .replace(/,$/u, "") +
      ")",
  ).runInNewContext({
    process: { pid: 321 },
    fs: { writeFileSync: (...args) => writes.push(args) },
    rejectionWritten: false,
    projectPrimarySessionGuardDiagnostic:
      primaryAdapter.projectPrimarySessionGuardDiagnostic,
  });
  onReject("main_import");
  onReject("https://outside.invalid/?state=SYNTHETIC_PRIVATE_STATE");
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].endsWith("native-rejection-321.json"));
  assert.deepEqual(JSON.parse(writes[0][1]), { pid: 321, code: "main_import" });
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0][2])), {
    flag: "wx",
    mode: 0o600,
  });
  const owned = child();
  owned.pid = 321;
  let disposed = 0;
  const events = [];
  const exitStart = source.indexOf('    ownedChild.once("exit",');
  const exitEnd = source.indexOf("    await ownedBridge.ready;", exitStart);
  const current = new Function(
    "ownedChild",
    "ownedBridge",
    "console",
    "electron",
    source.slice(exitStart, exitEnd) + ";return()=>electron;",
  )(
    owned,
    {
      dispose: () => {
        disposed++;
      },
    },
    { log: (value) => events.push(JSON.parse(value)) },
    owned,
  );
  owned.emit("exit", null, "SIGTERM");
  owned.emit("exit", 0, null);
  assert.deepEqual(events, [
    { event: "native-primary-exit", pid: 321, code: null, signal: "SIGTERM" },
  ]);
  assert.equal(disposed, 1);
  assert.equal(current(), undefined);
});

async function diagnosticFixture(t, read) {
  const f = await electronFixture(t),
    failures = [];
  f.owner.executeJavaScript = read;
  const guard = installPrimaryMainGuard(f.electron, {
    origin,
    nonce,
    channel: f.channel,
    appRoot: f.appRoot,
    onFailure: (value) => failures.push(value),
  });
  f.app.emit("session-created", f.loginSession);
  const replies = [];
  const held = () =>
    f.loginSession.webRequest.handler(
      {
        id: 11,
        method: "GET",
        resourceType: "mainFrame",
        webContentsId: 8,
        url: url(),
      },
      (value) => replies.push(value),
    );
  return { ...f, guard, failures, replies, held };
}

test("guard diagnostic rejects unknown fields and invalid finite public projections", () => {
  const project = primaryAdapter.projectPrimarySessionGuardDiagnostic;
  assert.equal(typeof project, "function");
  const value = {
    reason: "auth_exhausted",
    lastProjection: {
      authenticated: false,
      signedOut: true,
      loginVisible: true,
    },
    completedReads: 25,
    inFlight: false,
  };
  const accepted = project(value);
  assert.deepEqual(accepted, value);
  assert.notEqual(accepted, value);
  assert.notEqual(accepted.lastProjection, value.lastProjection);
  const accessor = { ...value };
  Object.defineProperty(accessor, "reason", {
    get() {
      throw Error("MUST_NOT_READ_PRIVATE_GETTER");
    },
  });
  for (const invalid of [
    null,
    [],
    { ...value, url: "SYNTHETIC_PRIVATE_URL" },
    { ...value, reason: "SYNTHETIC_PRIVATE_CAUSE" },
    {
      ...value,
      lastProjection: { ...value.lastProjection, token: "SYNTHETIC_PRIVATE" },
    },
    {
      ...value,
      lastProjection: {
        authenticated: "true",
        signedOut: false,
        loginVisible: false,
      },
    },
    { ...value, completedReads: -1 },
    { ...value, completedReads: 26 },
    { ...value, completedReads: 1.5 },
    { ...value, completedReads: NaN },
    { ...value, inFlight: 1 },
    { ...value, completedReads: 0 },
    {
      ...value,
      lastProjection: {
        authenticated: true,
        signedOut: false,
        loginVisible: false,
      },
    },
    Object.defineProperty({ ...value }, "secret", {
      value: "SYNTHETIC_PRIVATE",
    }),
    { ...value, [Symbol("secret")]: "SYNTHETIC_PRIVATE" },
    accessor,
  ])
    assert.equal(project(invalid), null);
});

test("unchanged 25 false DOM reads report exhaustion once without authentication", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const projection = {
    authenticated: false,
    signedOut: false,
    loginVisible: false,
  };
  const f = await diagnosticFixture(t, async () => projection);
  f.held();
  f.guest.emit("destroyed");
  await new Promise(setImmediate);
  for (let i = 1; i < 25; i++) {
    assert.equal(f.failures.length, 0);
    t.mock.timers.tick(100);
    await new Promise(setImmediate);
  }
  assert.deepEqual(f.failures, [
    {
      reason: "auth_exhausted",
      lastProjection: projection,
      completedReads: 25,
      inFlight: false,
    },
  ]);
  t.mock.timers.tick(10000);
  assert.equal(f.failures.length, 1);
  assert.ok(!f.channel.sent.some((message) => message.op === "authenticated"));
});

test("DOM rejection and malformed shapes report fixed diagnostics without their cause", async (t) => {
  for (const kind of ["rejected", "shape"]) {
    const f = await diagnosticFixture(t, async () => {
      if (kind === "rejected") throw Error("SYNTHETIC_PRIVATE_CAUSE");
      return {
        authenticated: false,
        signedOut: false,
        loginVisible: false,
        url: "SYNTHETIC_PRIVATE_URL",
      };
    });
    f.held();
    f.guest.emit("destroyed");
    await new Promise(setImmediate);
    assert.deepEqual(f.failures, [
      {
        reason:
          kind === "rejected"
            ? "auth_read_rejected"
            : "auth_projection_invalid",
        lastProjection: null,
        completedReads: 1,
        inFlight: false,
      },
    ]);
    assert.ok(!JSON.stringify(f.failures).includes("SYNTHETIC_PRIVATE"));
    assert.ok(
      !f.channel.sent.some((message) => message.op === "authenticated"),
    );
  }
});

test("network, OS and channel denials stay blocked with distinct finite reasons", async (t) => {
  for (const kind of ["network", "os", "channel"]) {
    const f = await diagnosticFixture(t, async () => ({
      authenticated: true,
      signedOut: false,
      loginVisible: false,
    }));
    if (kind === "network") {
      f.defaultSession.webRequest.handler(
        { url: "https://outside.invalid/?state=SYNTHETIC_PRIVATE" },
        (reply) => f.replies.push(reply),
      );
      assert.deepEqual(f.replies, [{ cancel: true }]);
    } else if (kind === "os")
      await f.electron.shell.openExternal(
        "https://outside.invalid/SYNTHETIC_PRIVATE",
      );
    else {
      f.channel.send = () => {
        throw Error("SYNTHETIC_PRIVATE_CHANNEL");
      };
      f.held();
      assert.deepEqual(f.replies, [{ cancel: true }]);
    }
    assert.deepEqual(f.failures, [
      {
        reason: {
          network: "request_denied",
          os: "external_open_denied",
          channel: "channel_send_failed",
        }[kind],
        lastProjection: null,
        completedReads: 0,
        inFlight: false,
      },
    ]);
    assert.ok(!JSON.stringify(f.failures).includes("SYNTHETIC_PRIVATE"));
  }
});

test("stop and normal disconnect suppress pending DOM failures and late success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const reject of [true, false]) {
    let settle;
    const f = await diagnosticFixture(
      t,
      () =>
        new Promise((resolve, fail) => {
          settle = reject ? fail : resolve;
        }),
    );
    f.held();
    f.guest.emit("destroyed");
    f.guard.receive({ op: "stop", nonce });
    f.guard.disconnected();
    settle(
      reject
        ? Error("SYNTHETIC_PRIVATE_LATE")
        : { authenticated: true, signedOut: false, loginVisible: false },
    );
    await new Promise(setImmediate);
    t.mock.timers.tick(10000);
    assert.deepEqual(f.failures, []);
    assert.ok(
      !f.channel.sent.some((message) => message.op === "authenticated"),
    );
    assert.equal(f.guard.safeStatus().stopping, true);
  }
});
