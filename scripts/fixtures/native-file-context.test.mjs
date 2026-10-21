import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  FILE_CONTEXT_PROMPTS,
  FILE_CONTEXT_CALLS,
  FILE_CONTEXT_NAMES,
  fileContextModeEnabled,
  createNativeFileContextScenario,
  assertNativeFileContextCommand,
  projectNativeFileContextAccounting,
  createNativeFileContextOutputCounter,
  createNativeFileContextEntry,
} from "./native-file-context.mjs";
import { createPrimarySupplierWitness } from "./native-primary-login.mjs";
import {
  installPrimaryMainGuard,
  scrubPrimaryControlEnvironment,
} from "./native-primary-login-adapter.mjs";

const root = "/owned/data/client-native-file-context-finite",
  runTag = "a".repeat(24);
const fixture = () => createNativeFileContextScenario({ root, runTag });
const user = (stage) => ({
  role: "user",
  content:
    FILE_CONTEXT_PROMPTS[stage] +
    ` [${FILE_CONTEXT_NAMES[stage]}](./${FILE_CONTEXT_NAMES[stage]})`,
});
const body = (stage, extra = []) => ({
  model: "controlled",
  stream: true,
  tools: [{ function: { name: "Read" } }],
  messages: [user(stage), ...extra],
});
const result = (stage, content) => ({
  role: "tool",
  tool_call_id: FILE_CONTEXT_CALLS[stage],
  content,
});
const bootstrap = (f) => {
  for (let i = 0; i < 2; i++)
    f.selectReply({
      model: "controlled",
      stream: false,
      messages: [{ role: "user", content: "other-user-test" }],
    });
};
const title = (f) => f.selectReply({ ...body("a"), stream: false });
function positive() {
  const f = fixture();
  bootstrap(f);
  title(f);
  f.selectReply(body("a"));
  f.selectReply(body("a", [result("a", "1\t" + f.files[0].content)]));
  return f;
}
const rejected = (fn) =>
  assert.throws(fn, /^Error: NATIVE_FILE_CONTEXT_REJECTED$/u);

test("file mode rejects invalid or competing flags before the common first FS operation", async () => {
  assert.equal(
    fileContextModeEnabled(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ),
    false,
  );
  assert.equal(
    fileContextModeEnabled(
      "enabled",
      undefined,
      undefined,
      undefined,
      "controlled",
    ),
    true,
  );
  for (const args of [
    [undefined, undefined, undefined, undefined, "controlled"],
    ["enabled", "alwaysOn", undefined, undefined, "controlled"],
    ["enabled", undefined, "controlled", undefined, "controlled"],
    ["enabled", undefined, undefined, "controlled", "controlled"],
    ["enabled", undefined, undefined, undefined, "yes"],
  ])
    rejected(() => fileContextModeEnabled(...args));
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("const fileContextEnabled = fileContextModeEnabled(") <
      source.indexOf("await mkdir(evidence"),
  );
  assert.ok(
    source.indexOf('!fixtureName.startsWith("client-native-file-context-")') <
      source.indexOf("await mkdir(evidence"),
  );
});

test("scenario owns exactly two fresh marker paths and rejects external/private knobs", () => {
  const f = fixture();
  assert.equal(f.workspacePath, root + "/project-file-context");
  assert.deepEqual(
    f.files.map((v) => v.name),
    Object.values(FILE_CONTEXT_NAMES),
  );
  for (const file of f.files) {
    assert.ok(file.path.startsWith(f.workspacePath + "/"));
    assert.ok(
      !Object.values(FILE_CONTEXT_PROMPTS).some((p) =>
        p.includes(file.content.split("\n")[0]),
      ),
    );
  }
  rejected(() => createNativeFileContextScenario({ root: "/outside", runTag }));
  rejected(() =>
    createNativeFileContextScenario({ root, runTag, reply: () => ({}) }),
  );
  rejected(() =>
    createNativeFileContextEntry({
      root,
      origin: "https://127.0.0.1:50301",
      mainUrl: "https://outside.invalid/main.js",
    }),
  );
});

test("bootstrap and one concurrent title never emit Read; first main issues only owned A", () => {
  const f = fixture();
  bootstrap(f);
  assert.equal(title(f).toolCall, undefined);
  const call = f.selectReply(body("a")).toolCall;
  assert.deepEqual(call, {
    id: FILE_CONTEXT_CALLS.a,
    name: "Read",
    arguments: JSON.stringify({ file_path: f.files[0].path }),
  });
  rejected(() => f.selectReply(body("a")));
  assert.equal(f.safeFacts().aMainRequests, 1);
});

test("A completion needs the exact actual tool id and numbered source marker", () => {
  for (const output of [
    result("b", "1\tNATIVE_G07C_FILE_A_" + runTag),
    result("a", "wrong"),
    result("a", "NATIVE_G07C_FILE_A_" + runTag),
  ]) {
    const f = fixture();
    bootstrap(f);
    f.selectReply(body("a"));
    rejected(() => f.selectReply(body("a", [output])));
  }
  const f = positive();
  assert.equal(f.safeFacts().aResultMatched, true);
  assert.equal(f.safeFacts().aMainRequests, 2);
  assert.equal(f.safeFacts().titleRequests, 1);
  assert.ok(!JSON.stringify(f.safeFacts()).includes(runTag));
});

test("same-task B has two main requests and accepts denial while retaining lawful A history", () => {
  const f = positive(),
    history = [user("a"), result("a", "1\t" + f.files[0].content)];
  const b = body("b");
  b.messages.unshift(...history);
  assert.equal(f.selectReply(b).toolCall.id, FILE_CONTEXT_CALLS.b);
  assert.equal(
    f.selectReply({
      ...b,
      messages: [...b.messages, result("b", "enterprise_filesystem_denied")],
    }).text,
    "NATIVE_G07C_DENIAL_CONFIRMED",
  );
  assert.deepEqual(
    [
      f.safeFacts().bMainRequests,
      f.safeFacts().bDeniedMatched,
      f.safeFacts().bMarkerAbsent,
    ],
    [2, true, true],
  );
  rejected(() => title(f));
});

test("new B marker anywhere or a mismatched/missing B denial cannot be accepted", () => {
  const early = positive();
  rejected(() =>
    early.selectReply({
      ...body("b"),
      messages: [
        { role: "system", content: early.files[1].content },
        user("b"),
      ],
    }),
  );
  for (const output of [
    result("a", "enterprise_filesystem_denied"),
    result("b", "allowed"),
    result("b", "enterprise_filesystem_denied NATIVE_G07C_FILE_B_" + runTag),
  ]) {
    const f = positive();
    f.selectReply(body("b"));
    rejected(() => f.selectReply(body("b", [output])));
  }
});

test("fixed commands/accounting/output facts cannot expose body, ids, keys or arbitrary operations", () => {
  const f = fixture();
  for (const command of [
    { op: "close" },
    {
      op: "configure",
      kind: "security",
      data: { allowFilesystem: false, allowShell: true },
    },
    { op: "openWorkspace", workspacePath: "/outside" },
    { op: "experienceSnapshot", name: "../../x" },
  ])
    rejected(() => assertNativeFileContextCommand(command, f.workspacePath));
  assertNativeFileContextCommand(
    { op: "configure", kind: "security", data: { allowFilesystem: false } },
    f.workspacePath,
  );
  const row = {
    user_id: "a",
    model_id: "m",
    application: "uwork",
    status: "settled",
    amount: 22,
    input_tokens: 12,
    output_tokens: 10,
  };
  const facts = projectNativeFileContextAccounting(
    [{ ...row, user_id: "b" }, { ...row, user_id: "b" }, row, row, row],
    [],
    "a",
    "m",
  );
  assert.equal(facts.nativeLedgerRows, 3);
  assert.equal(facts.nativeCredits, 66);
  assert.equal(facts.baselineOtherCredits, 44);
  assert.ok(
    Object.values(facts).every(
      (v) => typeof v === "boolean" || Number.isSafeInteger(v),
    ),
  );
  const counter = createNativeFileContextOutputCounter();
  counter.count("stdout", 2 ** 22);
  assert.equal(counter.safeFacts().outputLimitExceeded, true);
  assert.equal(counter.safeFacts().stdoutBytes, 2 ** 21);
});

test("the reused strict supplier witness requires exact models/chat/key and rejects query/unknown paths", () => {
  const w = createPrimarySupplierWitness("FINITE_KEY");
  assert.equal(w.check("/v1/models", "Bearer FINITE_KEY"), true);
  assert.equal(w.check("/v1/chat/completions", "Bearer FINITE_KEY"), true);
  for (const [path, key] of [
    ["/v1/models?x", "Bearer FINITE_KEY"],
    ["/v1/chat/completions?x", "Bearer FINITE_KEY"],
    ["/unexpected", "Bearer FINITE_KEY"],
    ["/v1/chat/completions", "bad"],
  ])
    assert.equal(w.check(path, key), false);
  assert.equal(w.check("/v1/traces", undefined), true);
  assert.deepEqual(w.safeStatus(), {
    modelsMatched: 1,
    chatMatched: 1,
    rejected: 4,
  });
  assert.ok(!JSON.stringify(w.safeStatus()).includes("FINITE_KEY"));
});

test("file ESM installs the actual sole guard before Main, preserves allow/deny and default producer bytes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uwork-file-entry-contract-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ownedRoot = join(dir, "data/client-native-file-context-test"),
    appRoot = join(ownedRoot, "runtime/app");
  await mkdir(appRoot, { recursive: true });
  await writeFile(join(appRoot, "page.html"), "owned");
  await writeFile(join(dir, "outside.txt"), "owned outside app");
  const content = createNativeFileContextEntry({
    root: ownedRoot,
    origin: "https://127.0.0.1:50301",
  });
  assert.equal(
    spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: content,
      encoding: "utf8",
      timeout: 3000,
    }).status,
    0,
  );
  const app = new EventEmitter();
  app.isReady = () => false;
  app.getAppPath = () => appRoot;
  app.isPackaged = false;
  const exits = [];
  app.exit = (code) => exits.push(code);
  let requests,
    listenerCount = 0,
    guards = 0,
    entered = false,
    release;
  const writes = [],
    order = [];
  const target = {
    webRequest: {
      onBeforeRequest(_filter, fn) {
        requests = fn;
        listenerCount++;
      },
    },
  };
  const electron = {
    app,
    session: { defaultSession: target },
    shell: {
      openExternal() {
        throw Error("OS must not open");
      },
    },
    webContents: { fromId: () => undefined },
    BrowserWindow: { getAllWindows: () => [] },
  };
  const guardModule = async () => ({
    installPrimaryMainGuard: (...args) => {
      guards++;
      assert.equal(args[1].channel, undefined);
      assert.equal(args[1].nonce, undefined);
      return installPrimaryMainGuard(...args);
    },
    scrubPrimaryControlEnvironment,
  });
  const requireMock = (name) => {
    order.push(name);
    if (name === "./env-guard.cjs") return {};
    if (name === "electron") return electron;
    if (name === "node:path") return { join };
    if (name === "node:fs")
      return { writeFileSync: (...args) => writes.push(args) };
    throw Error("UNEXPECTED_REQUIRE");
  };
  const transformed = content
    .replace(
      'import { createRequire } from "node:module";',
      "const createRequire=()=>requireMock;",
    )
    .replace(
      "import.meta.url",
      JSON.stringify(pathToFileURL(join(appRoot, "entry.mjs")).href),
    )
    .replace(
      "await import('./native-primary-login-adapter.mjs')",
      "await guardModule()",
    )
    .replace(
      `await import(${JSON.stringify(pathToFileURL(join(appRoot, "out/main/index.js")).href)})`,
      "await loadMain()",
    );
  const runtime = {
    pid: 321,
    ppid: 123,
    env: {
      UWORK_NATIVE_FILE_CONTEXT: "controlled",
      NODE_CHANNEL_FD: "3",
      KEEP: "yes",
    },
  };
  const pending = new (Object.getPrototypeOf(async () => {}).constructor)(
    "requireMock",
    "guardModule",
    "loadMain",
    "process",
    transformed,
  )(
    requireMock,
    guardModule,
    async () => {
      assert.equal(guards, 1);
      app.emit("session-created", target);
      app.emit("web-contents-created", {}, { session: target });
      entered = true;
      await new Promise((r) => {
        release = r;
      });
    },
    runtime,
  );
  await new Promise(setImmediate);
  assert.equal(entered, true);
  assert.equal(listenerCount, 1);
  assert.equal(order[0], "./env-guard.cjs");
  assert.deepEqual(runtime.env, { KEEP: "yes" });
  const passive = writes.find(([path]) =>
    path.endsWith("native-runtime-info-321.json"),
  );
  assert.deepEqual(JSON.parse(passive[1]), {
    pid: 321,
    ppid: 123,
    isPackaged: false,
    appPath: appRoot,
  });
  assert.deepEqual(passive[2], { flag: "wx", mode: 0o600 });
  const check = (url) => {
    let allowed;
    requests({ url, method: "GET", resourceType: "mainFrame" }, (v) => {
      allowed = !v.cancel;
    });
    return allowed;
  };
  assert.equal(check("about:blank"), true);
  assert.equal(check("https://127.0.0.1:50301/api/client/configuration"), true);
  assert.equal(check(pathToFileURL(join(appRoot, "page.html")).href), true);
  assert.equal(check(pathToFileURL(join(dir, "outside.txt")).href), false);
  assert.deepEqual(exits, [70]);
  assert.ok(!JSON.stringify(writes).includes("outside.txt"));
  const rejection = writes.find(([path]) =>
    path.endsWith("native-file-context-rejection-321.json"),
  );
  assert.deepEqual(JSON.parse(rejection[1]), {
    pid: 321,
    code: "session_guard",
  });
  release();
  await pending;
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function saveExperienceProof(name)"),
    end = source.indexOf("let closing = false;", start);
  // The reviewed dual-organization branch is the only sanctioned change in this region;
  // removing exactly that branch must still recover the frozen original proof.
  const snapshot = source.slice(start, end);
  assert.equal(
    snapshot.split(`        ...(twoOrganizationAuth
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
`).length - 1,
    1,
  );
  assert.equal(
    createHash("sha256")
      .update(
        snapshot.replace(
          `        ...(twoOrganizationAuth
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
`,
          "        modelRequests,\n",
        ),
      )
      .digest("hex"),
    "f17ae3d5813b4c24e91f43e1732197ebd652d8726138eebe92340e893594240c",
  );
  assert.equal(
    createHash("sha256").update(snapshot).digest("hex"),
    "564ad5244237c513117f057b016c770d468e7914304ee3a1dad6dc2ca01e86d3",
  );
  const fileStart = source.indexOf("async function saveFileContextProof(name)"),
    fileEnd = source.indexOf(
      "async function saveExperienceProof(name)",
      fileStart,
    ),
    producer = source.slice(fileStart, fileEnd);
  for (const raw of ["modelRequests", "rendererTraceBatches", "traffic"])
    assert.ok(!producer.includes(raw));
  assert.ok(source.includes("if (!fileContext) modelRequests.push(body)"));
});
