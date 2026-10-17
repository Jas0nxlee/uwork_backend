import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTurnPresentation } from "../src/runtime/methods/turn-presentation.js";
import { createRootTraceContext } from "@zcode/contracts";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("a turn captures one current surface without altering the next turn's admission", async () => {
  let surface: "terminal" | "zcode_desktop" = "zcode_desktop",
    reads = 0;
  const runtime = {
    config: { presentationSurface: "terminal" as "terminal" | "zcode_desktop" },
    turnPresentationPort: {
      read: async () => {
        reads++;
        return surface;
      },
    },
  };
  const signal = new AbortController().signal;
  await applyTurnPresentation(runtime, signal, createRootTraceContext());
  surface = "terminal";
  assert.equal(
    runtime.config.presentationSurface,
    "zcode_desktop",
    "a later policy cannot mutate the captured turn",
  );
  assert.equal(reads, 1);
  await applyTurnPresentation(runtime, signal, createRootTraceContext());
  assert.equal(runtime.config.presentationSurface, "terminal");
  assert.equal(reads, 2, "the next executing turn reads again");
});

test("cancelled and changed-owner reads cannot apply a late desktop surface", async () => {
  const cancellation = new AbortController();
  const runtime = {
    config: { presentationSurface: "terminal" as const },
    turnPresentationPort: {
      read: async ({ signal }: { signal: AbortSignal }) => {
        assert.equal(signal, cancellation.signal);
        cancellation.abort();
        return "zcode_desktop" as const;
      },
    },
  };
  await assert.rejects(
    applyTurnPresentation(runtime, cancellation.signal, createRootTraceContext()),
  );
  assert.equal(runtime.config.presentationSurface, "terminal");
  runtime.turnPresentationPort.read = async () => {
    throw new Error("enterprise_identity_changed");
  };
  await assert.rejects(
    applyTurnPresentation(runtime, new AbortController().signal, createRootTraceContext()),
    /enterprise_identity_changed/,
  );
  assert.equal(runtime.config.presentationSurface, "terminal");
});

test("actual turn preparation reserves first, preserves terminal outcomes and releases on cancelled metadata", async () => {
  const path = new URL("../src/runtime/methods/turn.ts", import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === "executeTurnCommand",
  );
  assert.ok(declaration);
  let reserved = false,
    modelAdmissions = 0,
    reads = 0;
  const outcomes: Array<{ turnPhase: string }> = [];
  const controller = new AbortController();
  let cancel = false;
  let nextSurface: "terminal" | "zcode_desktop" = "terminal";
  const trace = createRootTraceContext();
  const runtime = {
    config: { presentationSurface: "zcode_desktop", outputStyle: undefined },
    sessionId: "controlled",
    turnNumber: 0,
    rootTraceContext: trace,
    getSessionModelSelection() {
      return undefined;
    },
    reserveTurnStart() {
      assert.equal(reserved, false);
      reserved = true;
    },
    releaseTurnStart() {
      reserved = false;
    },
    finishActiveTurn() {},
    turnPresentationPort: {
      async read() {
        reads++;
        assert.equal(reserved, true, "network read is after the one original reservation");
        if (cancel) controller.abort();
        return nextSurface;
      },
    },
    agentTelemetry: {
      turn: () => ({
        run: (fn: () => unknown) => fn(),
        finishCompleted() {},
        finishFailed() {},
        finishCancelled() {},
      }),
    },
  };
  const code = ts.transpileModule(
    `${declaration.getText(source).replace(/^export\s+/u, "")}\nexecuteTurnCommand;`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
  const execute = runInNewContext(code, {
    Date,
    performance,
    clearInterval,
    createTurnId: () => "controlled-turn",
    createQueryId: () => "controlled-query",
    createChildTraceContext: () => trace,
    parseCompactCommand: () => null,
    parseRewindCommand: () => null,
    TurnMachineImpl: { create: () => ({}) },
    beginLocalTurnPreparation: () => () => {},
    runWithContextAsync: (_trace: unknown, fn: () => unknown) => fn(),
    createTurnAbortScope: (signal?: AbortSignal) => ({
      signal: signal ?? new AbortController().signal,
      dispose() {},
    }),
    throwIfTurnAborted: (signal: AbortSignal) => signal.throwIfAborted(),
    applyTurnPresentation,
    createTurnModel: () => {
      modelAdmissions++;
      assert.equal(runtime.config.presentationSurface, nextSurface);
      throw new Error("controlled-model-stop");
    },
    createTurnFailureError: (error: Error) => error,
    appendTurnOutcomeEvent: async (_runtime: unknown, outcome: { turnPhase: string }) => {
      outcomes.push(outcome);
    },
    isTurnCancellationError: (_error: unknown, signal: AbortSignal) => signal.aborted,
    clearBrowserTurnState() {},
  }) as (
    this: typeof runtime,
    input: string,
    attachments?: unknown,
    options?: { abortSignal: AbortSignal },
  ) => Promise<unknown>;
  await assert.rejects(execute.call(runtime, "first"), /controlled-model-stop/);
  assert.equal(modelAdmissions, 1, "terminal metadata still reaches the original model admission");
  assert.equal(reserved, false);
  nextSurface = "zcode_desktop";
  await assert.rejects(execute.call(runtime, "next"), /controlled-model-stop/);
  assert.equal(modelAdmissions, 2);
  cancel = true;
  await assert.rejects(
    execute.call(runtime, "cancel", undefined, { abortSignal: controller.signal }),
  );
  assert.equal(modelAdmissions, 2);
  assert.equal(reads, 3);
  assert.equal(outcomes.at(-1)?.turnPhase, "presentation_preferences");
  assert.equal(reserved, false);
});
