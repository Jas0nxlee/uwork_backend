// A finite owned OS-process launcher. This module never calls product RPC.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

export function createOwnedMacosUriLaunchers({
  executable,
  cwd,
  candidate,
  primary,
  validate,
  environment,
  emit,
  spawnProcess = spawn,
}) {
  const entries = new Map();
  const used = new Set();
  const roles = new Set(["cancel", "parallel-unknown", "confirm"]);
  function currentMain() {
    const value = primary();
    assert.ok(
      value &&
        Number.isInteger(value.pid) &&
        value.pid > 0 &&
        value.exitCode === null &&
        value.signalCode === null,
      "Owned original Main must be alive",
    );
    return value;
  }
  async function launch(role) {
    assert.ok(roles.has(role), "Finite owned URI role required");
    assert.ok(!used.has(role), "Each owned URI role may launch once");
    used.add(role);
    const owner = currentMain();
    const target =
      role === "parallel-unknown" ? null : await validate(candidate);
    assert.equal(
      currentMain(),
      owner,
      "Owned Main changed while validating candidate",
    );
    const uri = target
      ? "zcode://workspace/open?path=" + encodeURIComponent(target)
      : "zcode://unrecognized-owned-protocol-test";
    const child = spawnProcess(executable, [uri], {
      cwd,
      env: environment(),
      stdio: "ignore",
    });
    const entry = {
      role,
      pid: child.pid,
      primaryPid: owner.pid,
      exitCode: null,
      signal: null,
      timedOut: false,
      closed: false,
    };
    let timer;
    const settled = new Promise((resolve) => {
      child.once("error", () => {
        entry.spawnError = true;
        entry.closed = true;
        clearTimeout(timer);
        resolve();
        emit({ event: "owned-uri-exit", ...entry });
      });
      child.once("exit", (code, signal) => {
        entry.exitCode = code;
        entry.signal = signal;
        entry.closed = true;
        clearTimeout(timer);
        resolve();
        emit({
          event: "owned-uri-exit",
          ...entry,
          originalMainStillOwned:
            primary() === owner &&
            owner.exitCode === null &&
            owner.signalCode === null,
        });
      });
    });
    entries.set(role, {
      entry,
      child,
      settled,
      stop: () => clearTimeout(timer),
    });
    timer = setTimeout(() => {
      if (!entry.closed) {
        entry.timedOut = true;
        child.kill("SIGKILL");
      }
    }, 10000);
    emit({
      event: "owned-uri-started",
      role,
      pid: child.pid,
      primaryPid: owner.pid,
      kind: target ? "workspace" : "unknown",
      ...(target ? { target } : {}),
    });
    return { role, pid: child.pid, primaryPid: owner.pid };
  }
  function status() {
    return [...entries.values()].map(({ entry }) => ({ ...entry }));
  }
  async function dispose() {
    for (const { entry, child, settled, stop } of entries.values()) {
      stop();
      if (!entry.closed) {
        child.kill("SIGTERM");
        let timer;
        await Promise.race([
          settled,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
        clearTimeout(timer);
      }
      if (!entry.closed) {
        child.kill("SIGKILL");
        let timer;
        await Promise.race([
          settled,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
        clearTimeout(timer);
      }
      assert.ok(entry.closed, "Owned secondary did not settle during cleanup");
    }
  }
  return { launch, status, dispose };
}
