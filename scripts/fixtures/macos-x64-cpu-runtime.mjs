/** Diagnostic runtime only; no entry loader, hooks, application import or top-level await. */
import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
const exec = promisify(execFile);
export function createMainCpuActorGuard({
  child,
  isCurrent,
  expectedBirth,
  inspect,
  now,
  deadline,
}) {
  return async () => {
    if (
      !isCurrent() ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      now() >= deadline
    )
      return false;
    try {
      const actual = await inspect();
      return (
        isCurrent() &&
        child.exitCode === null &&
        child.signalCode === null &&
        now() < deadline &&
        actual.birth === expectedBirth &&
        actual.mappedX64 === true &&
        actual.listenerOwned === true
      );
    } catch {
      return false;
    }
  };
}
async function readNodeList(port) {
  const { request } = await import("node:http");
  return new Promise((resolveList, reject) => {
    const chunks = [];
    let bytes = 0;
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/json/list",
        method: "GET",
        agent: false,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error("OWNED_INSPECTOR_STATUS"));
          return;
        }
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 65536) {
            res.destroy();
            reject(Error("OWNED_INSPECTOR_RESPONSE_LIMIT"));
            return;
          }
          chunks.push(chunk);
        });
        res.once("end", () => {
          try {
            resolveList(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(Error("OWNED_INSPECTOR_JSON"));
          }
        });
        res.once("error", reject);
      },
    );
    req.setTimeout(750, () =>
      req.destroy(Error("OWNED_INSPECTOR_HTTP_TIMEOUT")),
    );
    req.once("error", reject);
    req.end();
  });
}
export async function runOwnedMainCpuDiagnostic({
  child,
  isCurrent,
  expectedExecutable,
  expectedPort,
  outputFile,
  budgetMs,
  profiler,
  now = () => performance.now(),
  inspectOverride,
}) {
  assert.ok(
    Number.isSafeInteger(budgetMs) && budgetMs >= 35000 && budgetMs <= 70000,
  );
  const started = now(),
    deadline = started + budgetMs;
  const birth = () =>
    exec("ps", ["-p", String(child.pid), "-o", "lstart="], {
      timeout: 1500,
    }).then((row) => row.stdout.trim());
  const expectedBirth = await birth();
  assert.ok(expectedBirth);
  const inspect =
    inspectOverride ??
    (async () => {
      const [current, mapped, listener] = await Promise.all([
        birth(),
        exec(
          "lsof",
          ["-nP", "-a", "-p", String(child.pid), "-d", "txt", "-Fn"],
          { timeout: 1500 },
        ),
        exec(
          "lsof",
          [
            "-nP",
            "-a",
            "-p",
            String(child.pid),
            "-iTCP:" + expectedPort,
            "-sTCP:LISTEN",
            "-Fn",
          ],
          { timeout: 1500 },
        ),
      ]);
      const file = await open(expectedExecutable, "r");
      let header;
      try {
        header = Buffer.alloc(8);
        await file.read(header, 0, 8, 0);
      } finally {
        await file.close();
      }
      return {
        birth: current,
        mappedX64:
          mapped.stdout.split("\n").includes("n" + expectedExecutable) &&
          header.equals(Buffer.from("cffaedfe07000001", "hex")),
        listenerOwned: listener.stdout
          .split("\n")
          .includes("n127.0.0.1:" + expectedPort),
      };
    });
  const guarded = createMainCpuActorGuard({
    child,
    isCurrent,
    expectedBirth,
    inspect,
    now,
    deadline,
  });
  const observations = [];
  const actorOwned = async ({ stage = "owned-check" } = {}) => {
    const valid = await guarded();
    assert.ok(observations.length < 512);
    observations.push({ stage, elapsedMs: now() - started, valid });
    return valid;
  };
  const readyDeadline = Math.min(started + 40000, deadline - 35000);
  assert.ok(readyDeadline > now());
  let inspectorUrl;
  while (now() < readyDeadline) {
    if (await actorOwned({ stage: "before-json-list" })) {
      try {
        const targets = await readNodeList(expectedPort);
        assert.equal(await actorOwned({ stage: "after-json-list" }), true);
        assert.ok(now() < readyDeadline);
        assert.equal(targets.length, 1);
        const target = targets[0];
        assert.equal(target.type, "node");
        assert.match(
          target.id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        const url = new URL(target.webSocketDebuggerUrl);
        assert.equal(url.protocol, "ws:");
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(Number(url.port), expectedPort);
        assert.equal(url.pathname, "/" + target.id);
        assert.equal(url.username + url.password + url.search + url.hash, "");
        inspectorUrl = url.href;
        break;
      } catch (error) {
        if (
          !isCurrent() ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          throw error;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(inspectorUrl, "OWNED_MAIN_INSPECTOR_NOT_READY_WITHIN_BUDGET");
  const profile = await profiler({
    inspectorUrl,
    expectedPort,
    actorOwned,
    outputFile,
    durationMs: 30000,
    maxTotalMs: Math.min(45000, Math.floor(deadline - now())),
  });
  assert.ok(now() < deadline, "OWNED_MAIN_CPU_WORK_BUDGET_EXCEEDED");
  return {
    diagnosticOnly: true,
    originalRendererOrSecondaryAcceptance: false,
    actor: {
      pid: child.pid,
      birth: expectedBirth,
      mappedX64: true,
      inspectPort: expectedPort,
    },
    elapsedMs: now() - started,
    observations,
    ...profile,
  };
}
