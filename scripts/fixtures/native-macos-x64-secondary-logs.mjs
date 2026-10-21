/** Owned secondary diagnostics only; product bytes and shared fixture stay unchanged. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const ORIGINAL_SHA =
  "1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6";
const digest = (text) => createHash("sha256").update(text).digest("hex");
function once(source, anchor, replacement) {
  assert.equal(
    source.split(anchor).length,
    2,
    "One exact owned secondary anchor required",
  );
  return source.replace(anchor, replacement);
}
export function instrumentOwnedWorkspaceChild(source) {
  const marker = "async function openWorkspace(workspacePath) {";
  const stop = "async function stopNative() {";
  assert.equal(source.split(marker).length, 2);
  assert.equal(source.split(stop).length, 2);
  const start = source.indexOf(marker),
    end = source.indexOf(stop, start);
  assert.ok(end > start);
  const original = source.slice(start, end);
  assert.equal(
    digest(original),
    ORIGINAL_SHA,
    "Original openWorkspace body changed",
  );
  let body = original.slice(marker.length, original.lastIndexOf("}"));
  body = once(
    body,
    "  if (\n    electron !== primary ||",
    // 日志 open 会让出事件循环，必须保留原 Main 守卫在最后一次 await 之后。
    `  ownedWorkspaceStdout = await openOwnedWorkspaceLog(join(evidence, "workspace-secondary.stdout.log"), "wx", 0o600);
  ownedWorkspaceStderr = await openOwnedWorkspaceLog(join(evidence, "workspace-secondary.stderr.log"), "wx", 0o600);
  if (
    electron !== primary ||`,
  );
  body = once(
    body,
    '      stdio: "ignore",',
    '      stdio: ["ignore", ownedWorkspaceStdout.fd, ownedWorkspaceStderr.fd],',
  );
  const started =
    '  console.log(\n    JSON.stringify({\n      event: "workspace-secondary-started",';
  body = once(
    body,
    started,
    `  const ownedWorkspaceSpawnAt = performance.now();
  ownedWorkspaceMarks.push({ phase: "spawned", atMs: ownedWorkspaceSpawnAt, pid: child.pid });
  try {
    ownedWorkspaceSampler = scheduleOwnedSecondarySample({ child, currentChild: () => child,
      expectedExecutable: runtime.electron, evidence, spawnAtMs: ownedWorkspaceSpawnAt });
  } catch (error) {
    ownedWorkspaceMarks.push({ phase: "sample-observer-error", atMs: performance.now(), type: error?.constructor?.name ?? "Unknown" });
  }
${started}`,
  );
  body = once(
    body,
    "  const primaryStillExists =",
    `  ownedWorkspaceMarks.push({ phase: "exit", atMs: performance.now(), pid: child.pid, exit: { ...exit }, timedOut });
  const primaryStillExists =`,
  );
  const instrumented = `${marker}
  const ownedWorkspaceMarks = [{ phase: "command", atMs: performance.now() }];
  let ownedWorkspaceStdout, ownedWorkspaceStderr, ownedWorkspaceSampler;
  const ownedWorkspaceCloseErrors = [];
  try {
${body}
  } catch (ownedWorkspaceError) {
    ownedWorkspaceMarks.push({ phase: "command-error", atMs: performance.now(), type: ownedWorkspaceError?.constructor?.name ?? "Unknown" });
    throw ownedWorkspaceError;
  } finally {
    try { await ownedWorkspaceSampler?.dispose(); }
    catch (error) { ownedWorkspaceCloseErrors.push("sample-observer:" + (error?.constructor?.name ?? "Unknown")); }
    for (const handle of [ownedWorkspaceStdout, ownedWorkspaceStderr]) {
      if (!handle) continue;
      try { await handle.close(); }
      catch (error) { ownedWorkspaceCloseErrors.push(error?.constructor?.name ?? "Unknown"); }
    }
    try {
      await writeFile(join(evidence, "workspace-secondary-timing.json"), JSON.stringify({
        clock: "controller performance.now monotonic", timeOriginEpochMs: performance.timeOrigin, marks: ownedWorkspaceMarks,
        closeErrors: ownedWorkspaceCloseErrors, envRecorded: false,
        stdout: "workspace-secondary.stdout.log", stderr: "workspace-secondary.stderr.log",
      }, null, 2), { flag: "wx", mode: 0o600 });
    } catch (error) {
      try { process.stderr.write("owned secondary timing unavailable: " + (error?.constructor?.name ?? "Unknown").slice(0, 80) + "\\n"); }
      catch {}
    }
  }
}
`;
  const derived =
    'import {open as openOwnedWorkspaceLog} from "node:fs/promises";\nimport {scheduleOwnedSecondarySample} from "./native-macos-x64-secondary-sample.mjs";\n' +
    source.slice(0, start) +
    instrumented +
    source.slice(end);
  return {
    source: derived,
    originalFunction: original,
    instrumentedFunction: instrumented,
    originalFunctionSha256: ORIGINAL_SHA,
    instrumentedFunctionSha256: digest(instrumented),
  };
}
