// Execute the actual Main singleton block; only Electron, logger and monotonic clock are boundaries.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";
const mainPath = new URL("../src/main/index.ts", import.meta.url);
const main = await readFile(mainPath, "utf8");
const start = main.indexOf("registerDeepLinkProtocol(logger,");
const end = main.indexOf("app.whenReady().then(async () => {", start);
assert.ok(start > 0 && end > start, "Original native singleton block anchors required");
const block = main.slice(start, end);
const helperImport =
  main.match(/import\s*\{[^}]*\}\s*from\s*"\.\/desktopSingleInstanceStartupLog\.js";/)?.[0] ?? "";
const { outputFiles } = await build({
  stdin: {
    contents: helperImport + "\n" + block + "\nglobalThis.capturedLock = gotTheLock;",
    loader: "ts",
    resolveDir: new URL("../src/main/", import.meta.url).pathname,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "owned-clock-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^node:perf_hooks$/ }, () => ({
          path: "clock",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const performance = globalThis.fixture.clock;",
        }));
      },
    },
  ],
});
function execute({
  acquired = true,
  loggerFailsAt,
  clockFailsAt,
  apiError,
  factoryError,
  quitError,
} = {}) {
  const calls = [],
    rows = [],
    payload = { deepLinkUrl: "PRIVATE_URI", openWorkspacePath: "PRIVATE_PATH" };
  const argv = ["PRIVATE_ARGV"],
    clockValues = [10, 25, 30, 41];
  let clockCalls = 0;
  const app = {
    on(name) {
      calls.push("on:" + name);
      return this;
    },
    requestSingleInstanceLock(value) {
      assert.equal(this, app);
      assert.equal(value, payload);
      calls.push("request");
      if (apiError) throw apiError;
      return acquired;
    },
    quit() {
      assert.equal(this, app);
      calls.push("quit");
      if (quitError) throw quitError;
    },
  };
  const fixture = {
    clock: {
      now() {
        clockCalls++;
        if (clockCalls === clockFailsAt) throw Error("PRIVATE_CLOCK_ERROR");
        return clockValues[clockCalls - 1];
      },
    },
  };
  const context = createContext({
    fixture,
    app,
    process: { argv },
    linuxDesktopIntegrationIconPath: undefined,
    logger: {
      info(message, data) {
        calls.push("log:" + data.phase);
        if (data.phase === loggerFailsAt) throw Error("PRIVATE_LOG_ERROR");
        rows.push([message, JSON.parse(JSON.stringify(data))]);
      },
    },
    registerDeepLinkProtocol() {
      calls.push("register-protocol");
    },
    createDeepLinkSingleInstanceData(value) {
      assert.equal(value, argv);
      calls.push("factory");
      if (factoryError) throw factoryError;
      return payload;
    },
    Date: class {
      static now() {
        throw Error("Wall clock must not measure singleton operations");
      }
    },
  });
  let thrown;
  try {
    new Script(outputFiles[0].text).runInContext(context);
  } catch (error) {
    thrown = error;
  }
  return { calls, rows, clockCalls, result: context.capturedLock, thrown };
}
const phases = [
  "lock-request-start",
  "lock-request-return",
  "secondary-quit-start",
  "secondary-quit-return",
];
test("actual primary Main returns original true and logs only request stages in place", () => {
  const value = execute();
  assert.equal(value.thrown, undefined);
  assert.equal(value.result, true);
  assert.deepEqual(value.calls, [
    "register-protocol",
    "on:open-url",
    "log:lock-request-start",
    "factory",
    "request",
    "log:lock-request-return",
    "on:second-instance",
  ]);
  assert.deepEqual(
    value.rows.map(([, row]) => row.phase),
    phases.slice(0, 2),
  );
  assert.equal(value.rows[1][1].acquired, true);
  assert.equal(value.rows[1][1].elapsedMs, 15);
});
test("actual secondary Main keeps false then exactly one original quit and registration order", () => {
  const value = execute({ acquired: false });
  assert.equal(value.thrown, undefined);
  assert.equal(value.result, false);
  assert.deepEqual(value.calls, [
    "register-protocol",
    "on:open-url",
    "log:lock-request-start",
    "factory",
    "request",
    "log:lock-request-return",
    "log:secondary-quit-start",
    "quit",
    "log:secondary-quit-return",
    "on:second-instance",
  ]);
  assert.deepEqual(
    value.rows.map(([, row]) => row.phase),
    phases,
  );
  assert.equal(value.rows[3][1].elapsedMs, 11);
  assert.doesNotMatch(JSON.stringify(value.rows), /PRIVATE/);
});
for (const phase of phases)
  test(`actual Main preserves original false and quit if logger throws at ${phase}`, () => {
    const value = execute({ acquired: false, loggerFailsAt: phase });
    assert.equal(value.thrown, undefined);
    assert.equal(value.result, false);
    assert.equal(value.calls.filter((v) => v === "factory").length, 1);
    assert.equal(value.calls.filter((v) => v === "request").length, 1);
    assert.equal(value.calls.filter((v) => v === "quit").length, 1);
  });
for (const boundary of ["apiError", "factoryError", "quitError"])
  test(`actual Main preserves ${boundary} identity without false return stages`, () => {
    const original = new Error("PRIVATE_ORIGINAL_ERROR"),
      value = execute({ acquired: false, [boundary]: original });
    assert.equal(value.thrown, original);
    assert.equal(value.result, undefined);
    const observed = value.rows.map(([, row]) => row.phase);
    assert.deepEqual(observed, boundary === "quitError" ? phases.slice(0, 3) : phases.slice(0, 1));
  });
for (const clockFailsAt of [1, 2, 3, 4])
  test(`actual Main diagnostic clock failure${clockFailsAt} cannot block or fabricate original result`, () => {
    const value = execute({ acquired: false, clockFailsAt });
    assert.equal(value.thrown, undefined);
    assert.equal(value.result, false);
    assert.equal(value.calls.filter((v) => v === "request").length, 1);
    assert.equal(value.calls.filter((v) => v === "quit").length, 1);
    const returned = value.rows[clockFailsAt <= 2 ? 1 : 3][1];
    assert.equal("elapsedMs" in returned, false);
  });
test("original Main direct API expressions and downstream gates remain", () => {
  assert.equal(
    block.split("app.requestSingleInstanceLock(createDeepLinkSingleInstanceData(process.argv))")
      .length,
    2,
  );
  assert.equal(block.split("app.quit();").length, 2);
  assert.match(main.slice(end, end + 240), /if \(!gotTheLock\) return;/);
  assert.match(main, /app\.on\("before-quit", \(event\) => \{/);
});

const parsedMain = ts.createSourceFile(
  mainPath.pathname,
  main,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const readyStatement = parsedMain.statements.find((node) =>
  node.getText(parsedMain).startsWith("app.whenReady().then(async () => {"),
);
assert.ok(readyStatement && ts.isExpressionStatement(readyStatement));
const readyCall = readyStatement.expression;
assert.ok(ts.isCallExpression(readyCall));
const readyCallbackSource = readyCall.arguments[0].getText(parsedMain);
async function executeReady(acquired, source = readyCallbackSource) {
  const sentinel = new Error("First actual startup marker reached"),
    calls = [];
  const built = await build({
    stdin: { contents: "globalThis.readyCallback = " + source + ";", loader: "ts" },
    write: false,
    platform: "node",
    format: "cjs",
  });
  const context = createContext({
    gotTheLock: acquired,
    markMainLaunchAppReady() {
      calls.push("first-bootstrap-marker");
      throw sentinel;
    },
  });
  new Script(built.outputFiles[0].text).runInContext(context);
  let thrown;
  try {
    await context.readyCallback();
  } catch (error) {
    thrown = error;
  }
  return { calls, thrown, sentinel };
}
test("actual complete whenReady callback without lock performs no Window Host Agent bootstrap", async () => {
  const value = await executeReady(false);
  assert.equal(value.thrown, undefined);
  assert.deepEqual(value.calls, []);
});
test("actual complete whenReady callback with lock reaches first bootstrap marker", async () => {
  const value = await executeReady(true);
  assert.equal(value.thrown, value.sentinel);
  assert.deepEqual(value.calls, ["first-bootstrap-marker"]);
});
test("in-memory missing guard control is detected by actual false-lock callback", async () => {
  assert.equal(readyCallbackSource.split("if (!gotTheLock) return;").length, 2);
  const value = await executeReady(
    false,
    readyCallbackSource.replace("if (!gotTheLock) return;", ""),
  );
  assert.equal(value.thrown, value.sentinel);
  assert.deepEqual(value.calls, ["first-bootstrap-marker"]);
});
