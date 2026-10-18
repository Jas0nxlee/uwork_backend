import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Script } from "node:vm";
import { pathToFileURL } from "node:url";
import { createPrimaryMainEntry } from "./native-primary-entry.mjs";
import * as primaryAdapter from "./native-primary-login-adapter.mjs";

const options = {
  appRoot: "/owned/runtime/app",
  ownedRoot: "/owned",
  origin: "https://127.0.0.1:50301",
  evidenceDirectory: "/evidence/owned",
};

function fixture(start) {
  const writes = [],
    order = [],
    exits = [];
  const app = {
    isPackaged: false,
    getAppPath: () => options.appRoot,
    exit: (code) => exits.push(code),
  };
  const requireMock = (name) => {
    order.push(name);
    if (name === "./env-guard.cjs") return {};
    if (name === "electron") return { app };
    if (name === "node:fs")
      return { writeFileSync: (...args) => writes.push(args) };
    if (name === "node:path") return { join };
    throw Error("UNEXPECTED_REQUIRE");
  };
  const source = createPrimaryMainEntry(options)
    .replace(
      'import { createRequire } from "node:module";',
      "const createRequire = () => requireMock;",
    )
    .replace("import.meta.url", '"file:///owned/runtime/app/entry.mjs"')
    .replace(
      'await import("./native-primary-login-adapter.mjs")',
      "await loadAdapter()",
    )
    .replace(
      `import(${JSON.stringify(pathToFileURL(join(options.appRoot, "out/main/index.js")).href)})`,
      "importMain()",
    );
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = (importMain) =>
    new AsyncFunction(
      "requireMock",
      "loadAdapter",
      "importMain",
      "process",
      source,
    )(
      requireMock,
      async () => ({
        startPrimaryMainEntry: start,
        projectPrimarySessionGuardDiagnostic:
          primaryAdapter.projectPrimarySessionGuardDiagnostic,
      }),
      importMain,
      {
        pid: 321,
        ppid: 123,
        env: {},
      },
    );
  return { run, writes, order, exits, app };
}

test("primary entry rejects private or external code-loading options", () => {
  for (const value of [
    { ...options, nonce: "SYNTHETIC_PRIVATE" },
    { ...options, mainUrl: "https://outside.invalid/main.mjs" },
    { ...options, appRoot: "/outside/app" },
    { ...options, evidenceDirectory: "relative/evidence" },
    { ...options, origin: "https://outside.invalid" },
    { ...options, origin: "https://127.0.0.1:65536" },
    { ...options, origin: "https://127.0.0.1:0" },
  ])
    assert.throws(
      () => createPrimaryMainEntry(value),
      /^Error: PRIMARY_ENTRY_REJECTED$/u,
    );
});

test("generated entry is an ESM module with awaited adapter and original owned Main", () => {
  const content = createPrimaryMainEntry(options);
  const parsed = spawnSync(
    process.execPath,
    ["--input-type=module", "--check"],
    {
      input: content,
      encoding: "utf8",
      timeout: 3000,
    },
  );
  assert.equal(parsed.status, 0);
  assert.ok(
    content.includes('await import("./native-primary-login-adapter.mjs")'),
  );
  assert.ok(content.includes("await startPrimaryMainEntry(electron, process,"));
  assert.ok(
    content.includes('import("file:///owned/runtime/app/out/main/index.js")'),
  );
  for (const forbidden of [
    "primaryNonce",
    "primarySupplierKey",
    "BackendSession",
    "process.argv",
  ])
    assert.ok(!content.includes(forbidden));
});

test("env guard is first and top-level completion waits for the original Main promise", async () => {
  let release,
    settled = false;
  const main = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture(async (_electron, _runtime, value) => {
    await value.loadMain();
  });
  const running = f
    .run(() => main)
    .then(() => {
      settled = true;
    });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(f.order[0], "./env-guard.cjs");
  assert.equal(f.order[1], "electron");
  assert.equal(f.writes.length, 2);
  const passive = f.writes.find(([path]) =>
    path.endsWith("native-runtime-info-321.json"),
  );
  assert.deepEqual(JSON.parse(passive[1]), {
    pid: 321,
    ppid: 123,
    isPackaged: false,
    appPath: options.appRoot,
  });
  assert.deepEqual(passive[2], { flag: "wx", mode: 0o600 });
  assert.equal(f.app.setAsDefaultProtocolClient(), false);
  f.app.clearRecentDocuments();
  release();
  await running;
  assert.equal(settled, true);
  assert.deepEqual(f.exits, []);
});

test("entry diagnostics persist only fixed pid/code and never an import exception", async () => {
  const f = fixture(async (_electron, _runtime, value) => {
    value.onReject("main_import");
    value.onReject("SYNTHETIC_PRIVATE_URL_OR_CAUSE");
    throw Error("SYNTHETIC_PRIVATE_IMPORT_EXCEPTION");
  });
  await f.run(() => Promise.resolve());
  const reports = f.writes.filter(([path]) =>
    path.includes("native-rejection-"),
  );
  assert.equal(reports.length, 1);
  assert.deepEqual(JSON.parse(reports[0][1]), {
    pid: 321,
    code: "main_import",
  });
  assert.deepEqual(reports[0][2], { flag: "wx", mode: 0o600 });
  assert.deepEqual(f.exits, [70]);
  assert.ok(!JSON.stringify(f.writes).includes("SYNTHETIC_PRIVATE"));
});

test("entry persists one validated Session diagnostic as a fixed wx0600 projection", async () => {
  const diagnostic = {
    reason: "auth_deadline",
    lastProjection: null,
    completedReads: 0,
    inFlight: true,
  };
  const f = fixture(async (_electron, _runtime, value) => {
    value.onReject("session_guard", diagnostic);
    value.onReject("main_import");
    value.onReject("session_guard", {
      ...diagnostic,
      url: "SYNTHETIC_PRIVATE",
    });
  });
  await f.run(() => Promise.resolve());
  const reports = f.writes.filter(([path]) =>
    path.includes("native-rejection-"),
  );
  assert.equal(reports.length, 1);
  assert.deepEqual(JSON.parse(reports[0][1]), {
    pid: 321,
    code: "session_guard",
    diagnostic,
  });
  assert.deepEqual(reports[0][2], { flag: "wx", mode: 0o600 });
  assert.ok(!JSON.stringify(f.writes).includes("SYNTHETIC_PRIVATE"));
});

test("entry drops malformed or non-Session diagnostics without persisting extra data", async () => {
  const valid = {
    reason: "auth_deadline",
    lastProjection: null,
    completedReads: 0,
    inFlight: true,
  };
  for (const detail of [
    { ...valid, url: "SYNTHETIC_PRIVATE" },
    { ...valid, reason: "SYNTHETIC_PRIVATE" },
    {
      ...valid,
      lastProjection: {
        authenticated: 1,
        signedOut: false,
        loginVisible: false,
      },
    },
    { ...valid, completedReads: 26 },
    { ...valid, inFlight: "SYNTHETIC_PRIVATE" },
  ]) {
    const f = fixture(async (_electron, _runtime, value) =>
      value.onReject("session_guard", detail),
    );
    await f.run(() => Promise.resolve());
    const reports = f.writes.filter(([path]) =>
      path.includes("native-rejection-"),
    );
    assert.equal(reports.length, 1);
    assert.deepEqual(JSON.parse(reports[0][1]), {
      pid: 321,
      code: "session_guard",
    });
    assert.ok(!JSON.stringify(f.writes).includes("SYNTHETIC_PRIVATE"));
  }
  const f = fixture(async (_electron, _runtime, value) =>
    value.onReject("main_import", valid),
  );
  await f.run(() => Promise.resolve());
  const reports = f.writes.filter(([path]) =>
    path.includes("native-rejection-"),
  );
  assert.deepEqual(JSON.parse(reports[0][1]), {
    pid: 321,
    code: "main_import",
  });
});

test("actual common selects primary ESM and preserves default CJS bytes", async () => {
  const source = await readFile(
    new URL("./client-native-enterprise.mjs", import.meta.url),
    "utf8",
  );
  const marker =
    'await writeFile(\n  join(appRoot, primaryLoginEnabled ? "entry.mjs" : "entry.cjs"),';
  const start = source.indexOf(marker),
    end = source.indexOf("\n);", start) + 3;
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const primary of [true, false]) {
    let path, content;
    await new AsyncFunction(
      "writeFile",
      "join",
      "appRoot",
      "root",
      "origin",
      "evidence",
      "pathToFileURL",
      "primaryLoginEnabled",
      "createPrimaryMainEntry",
      source.slice(start, end),
    )(
      async (name, bytes) => {
        path = name;
        content = bytes;
      },
      join,
      options.appRoot,
      options.ownedRoot,
      options.origin,
      "evidence/owned",
      pathToFileURL,
      primary,
      createPrimaryMainEntry,
    );
    assert.equal(
      path,
      join(options.appRoot, primary ? "entry.mjs" : "entry.cjs"),
    );
    if (primary)
      assert.equal(
        content,
        createPrimaryMainEntry({
          ...options,
          evidenceDirectory: join(process.cwd(), "evidence/owned"),
        }),
      );
    else {
      new Script(content);
      assert.equal(
        createHash("sha256").update(content).digest("hex"),
        "1f86a75afc2d11b69a1071711ca98c01942fb7f77b88005b9f8d3a0711425519",
      );
    }
  }
  assert.ok(
    source.includes('main: primaryLoginEnabled ? "entry.mjs" : "entry.cjs"'),
  );
});
