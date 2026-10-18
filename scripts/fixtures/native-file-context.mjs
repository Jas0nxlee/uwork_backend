import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FILE_CONTEXT_PROMPTS = Object.freeze({
  a: "NATIVE_G07C_READ_A 请读取引用文件后简短回复",
  b: "NATIVE_G07C_READ_B 请读取引用文件后简短回复",
});
export const FILE_CONTEXT_CALLS = Object.freeze({
  a: "native-file-context-read-a",
  b: "native-file-context-read-b",
});
export const FILE_CONTEXT_NAMES = Object.freeze({
  a: "G07_CONTEXT_A.txt",
  b: "G07_CONTEXT_B.txt",
});
const fail = () => {
  throw Error("NATIVE_FILE_CONTEXT_REJECTED");
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const text = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
      : "";
function paths(root) {
  if (
    typeof root !== "string" ||
    root.length > 4096 ||
    /[\x00-\x1f\x7f]/u.test(root) ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !/\/data\/client-native-file-context-[a-z0-9-]+$/u.test(root)
  )
    fail();
  const workspacePath = join(root, "project-file-context");
  return {
    workspacePath,
    a: join(workspacePath, FILE_CONTEXT_NAMES.a),
    b: join(workspacePath, FILE_CONTEXT_NAMES.b),
  };
}

export function fileContextModeEnabled(
  experience,
  workflow,
  viewer,
  primary,
  mode,
) {
  if (mode === undefined) return false;
  if (
    mode !== "controlled" ||
    experience !== "enabled" ||
    [workflow, viewer, primary].some((v) => v !== undefined)
  )
    fail();
  return true;
}

export function createNativeFileContextScenario(options) {
  if (
    !exact(options, ["root", "runTag"]) ||
    !/^[a-f0-9]{24}$/u.test(options.runTag)
  )
    fail();
  const owned = paths(options.root),
    markers = {
      a: "NATIVE_G07C_FILE_A_" + options.runTag,
      b: "NATIVE_G07C_FILE_B_" + options.runTag,
    };
  const state = {
    bootstrapRequests: 0,
    titleRequests: 0,
    aMainRequests: 0,
    bMainRequests: 0,
    aReadIssued: false,
    aResultMatched: false,
    bReadIssued: false,
    bDeniedMatched: false,
    bMarkerAbsent: false,
    rejectedRequests: 0,
  };
  const reject = () => {
    state.rejectedRequests = Math.min(128, state.rejectedRequests + 1);
    fail();
  };
  return {
    workspacePath: owned.workspacePath,
    files: ["a", "b"].map((stage) => ({
      path: owned[stage],
      name: FILE_CONTEXT_NAMES[stage],
      content: markers[stage] + "\nowned native Read fixture",
    })),
    selectReply(body) {
      if (
        !body ||
        body.model !== "controlled" ||
        !Array.isArray(body.messages) ||
        body.messages.length > 256 ||
        body.messages.some((m) => !m || typeof m.role !== "string") ||
        typeof body.stream !== "boolean"
      )
        reject();
      const messages = body.messages,
        last = messages.findLastIndex((m) => m.role === "user"),
        user = text(messages[last]);
      const all = messages.map(text).join("\n");
      if (Buffer.byteLength(all) > 512 * 1024 || all.includes(markers.b))
        reject();
      if (!body.stream) {
        if (
          user === "other-user-test" &&
          state.bootstrapRequests < 2 &&
          !state.aReadIssued
        ) {
          state.bootstrapRequests++;
          return { text: "Controlled bootstrap" };
        }
        if (
          user.includes(FILE_CONTEXT_PROMPTS.a) &&
          state.bootstrapRequests === 2 &&
          state.titleRequests === 0 &&
          !state.bReadIssued
        ) {
          state.titleRequests++;
          return { text: "Native file context" };
        }
        reject();
      }
      const stage = user.includes(FILE_CONTEXT_PROMPTS.a)
        ? "a"
        : user.includes(FILE_CONTEXT_PROMPTS.b)
          ? "b"
          : null;
      if (
        !stage ||
        state.bootstrapRequests !== 2 ||
        !user.includes(
          `[${FILE_CONTEXT_NAMES[stage]}](./${FILE_CONTEXT_NAMES[stage]})`,
        )
      )
        reject();
      if (stage === "b" && (!state.aResultMatched || state.titleRequests !== 1))
        reject();
      const toolResults = messages
        .slice(last + 1)
        .filter((m) => m.role === "tool");
      const issued = stage === "a" ? "aReadIssued" : "bReadIssued",
        matched = stage === "a" ? "aResultMatched" : "bDeniedMatched",
        count = stage === "a" ? "aMainRequests" : "bMainRequests";
      if (state[matched]) reject();
      if (!toolResults.length) {
        if (
          state[issued] ||
          (stage === "a" && all.includes(markers.a)) ||
          !Array.isArray(body.tools) ||
          !body.tools.some((tool) => tool?.function?.name === "Read")
        )
          reject();
        state[issued] = true;
        state[count]++;
        if (stage === "b") state.bMarkerAbsent = true;
        return {
          toolCall: {
            id: FILE_CONTEXT_CALLS[stage],
            name: "Read",
            arguments: JSON.stringify({ file_path: owned[stage] }),
          },
        };
      }
      if (
        !state[issued] ||
        toolResults.length !== 1 ||
        toolResults[0].tool_call_id !== FILE_CONTEXT_CALLS[stage]
      )
        reject();
      const result = text(toolResults[0]);
      if (
        stage === "a"
          ? !result.includes("1\t" + markers.a)
          : !result.includes("enterprise_filesystem_denied")
      )
        reject();
      state[matched] = true;
      state[count]++;
      if (stage === "b") state.bMarkerAbsent = true;
      return {
        text:
          stage === "a"
            ? "NATIVE_G07C_READ_CONFIRMED"
            : "NATIVE_G07C_DENIAL_CONFIRMED",
      };
    },
    safeFacts: () => ({ ...state }),
  };
}

export function assertNativeFileContextCommand(command, workspacePath) {
  if (exact(command, ["op"]) && ["launch", "stopNative"].includes(command.op))
    return;
  if (
    exact(command, ["op", "workspacePath"]) &&
    command.op === "openWorkspace" &&
    command.workspacePath === workspacePath
  )
    return;
  if (
    exact(command, ["op", "name"]) &&
    command.op === "experienceSnapshot" &&
    ["file-baseline", "file-positive", "file-denied", "file-final"].includes(
      command.name,
    )
  )
    return;
  if (
    exact(command, ["op", "kind", "data"]) &&
    command.op === "configure" &&
    command.kind === "security" &&
    exact(command.data, ["allowFilesystem"]) &&
    typeof command.data.allowFilesystem === "boolean"
  )
    return;
  fail();
}

export function projectNativeFileContextAccounting(
  ledger,
  traces,
  memberId,
  modelId,
) {
  if (
    !Array.isArray(ledger) ||
    !Array.isArray(traces) ||
    ledger.length > 32 ||
    traces.length > 32
  )
    fail();
  const mine = ledger.filter((r) => r.user_id === memberId),
    others = ledger.filter((r) => r.user_id !== memberId),
    myTraces = traces.filter((r) => r.user_id === memberId);
  const sum = (rows, field) =>
    rows.reduce((n, row) => {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0) fail();
      return n + row[field];
    }, 0);
  return {
    ledgerRows: ledger.length,
    nativeLedgerRows: mine.length,
    baselineOtherRows: others.length,
    baselineOtherCredits: sum(others, "amount"),
    nativeCredits: sum(mine, "amount"),
    nativeInputTokens: sum(mine, "input_tokens"),
    nativeOutputTokens: sum(mine, "output_tokens"),
    nativeLedgerSettled: mine.every((r) => r.status === "settled"),
    nativeLedgerModelMatches: mine.every(
      (r) => r.model_id === modelId && r.application === "uwork",
    ),
    traceRows: traces.length,
    nativeTraceRows: myTraces.length,
    nativeTraceSucceeded: myTraces.every(
      (r) => r.status === "succeeded" && r.error_code === null,
    ),
    nativeTraceModelMatches: myTraces.every(
      (r) => r.model_id === modelId && r.application === "uwork",
    ),
  };
}

export function createNativeFileContextOutputCounter() {
  let stdoutBytes = 0,
    stderrBytes = 0,
    outputLimitExceeded = false;
  return {
    count(stream, size) {
      if (
        !["stdout", "stderr"].includes(stream) ||
        !Number.isSafeInteger(size) ||
        size < 0
      )
        fail();
      if (stream === "stdout")
        stdoutBytes = Math.min(2 ** 21, stdoutBytes + size);
      else stderrBytes = Math.min(2 ** 21, stderrBytes + size);
      if (stdoutBytes + stderrBytes >= 2 ** 21) outputLimitExceeded = true;
    },
    safeFacts: () => ({ stdoutBytes, stderrBytes, outputLimitExceeded }),
  };
}

export function createNativeFileContextEntry(options) {
  if (!exact(options, ["root", "origin"])) fail();
  const { root, origin } = options;
  paths(root);
  if (
    typeof origin !== "string" ||
    !/^https:\/\/127\.0\.0\.1:\d{1,5}$/u.test(origin)
  )
    fail();
  try {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !url.port ||
      url.port === "0" ||
      url.port === "3000"
    )
      fail();
  } catch {
    fail();
  }
  const appRoot = join(root, "runtime/app"),
    evidence = resolve(root, "../..", "evidence", basename(root));
  return `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require('./env-guard.cjs');
const electron = require('electron'), {app} = electron, fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(evidence, "native-runtime-info.json"))},JSON.stringify({pid:process.pid,isPackaged:app.isPackaged,appPath:app.getAppPath(),helpFallbackPath:require('node:path').join(app.getAppPath(),'../../config/default.json'),dynamicWorkflowMode:process.env.ZCODE_DYNAMIC_WORKFLOW_MODE??null,defaultProtocolRegistrationSuppressed:true,recentDocumentsClearSuppressed:true}),{mode:0o600});
fs.writeFileSync(${JSON.stringify(join(evidence, "native-runtime-info-"))}+process.pid+'.json',JSON.stringify({pid:process.pid,ppid:process.ppid,isPackaged:app.isPackaged,appPath:app.getAppPath()}),{flag:'wx',mode:0o600});
app.setAsDefaultProtocolClient=()=>false;app.clearRecentDocuments=()=>{};
try {
 const {installPrimaryMainGuard,scrubPrimaryControlEnvironment}=await import('./native-primary-login-adapter.mjs');
 installPrimaryMainGuard(electron,{appRoot:${JSON.stringify(appRoot)},origin:${JSON.stringify(origin)},onFailure:()=>{try{fs.writeFileSync(${JSON.stringify(join(evidence, "native-file-context-rejection-"))}+process.pid+'.json',JSON.stringify({pid:process.pid,code:'session_guard'}),{flag:'wx',mode:0o600});}catch{}app.exit(70);}});
 scrubPrimaryControlEnvironment(process.env);
 await import(${JSON.stringify(pathToFileURL(join(appRoot, "out/main/index.js")).href)});
} catch {try{fs.writeFileSync(${JSON.stringify(join(evidence, "native-file-context-rejection-"))}+process.pid+'.json',JSON.stringify({pid:process.pid,code:'main_import'}),{flag:'wx',mode:0o600});}catch{}app.exit(70);}
`;
}
