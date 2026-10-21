/** Exact owned secondary passive sampler; never changes or waits on the product deadline. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { open, mkdir, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { X64_APP_PATH } from "./native-packaged-macos-x64-runtime.mjs";
const EXE = join(X64_APP_PATH, "Contents/MacOS/UWork Preview");
async function identity(pid, executable, stillOwned) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.ok(stillOwned(), "Owned child exited before identity read");
  const run = promisify(execFile);
  const birth = (
    await run("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      timeout: 1000,
    })
  ).stdout.trim();
  assert.ok(stillOwned(), "Owned child changed during identity read");
  const txt = (
    await run(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fn"],
      { timeout: 1000, maxBuffer: 262144 },
    )
  ).stdout;
  assert.ok(stillOwned(), "Owned child changed after identity read");
  assert.ok(
    birth && txt.split("\n").includes("n" + executable),
    "Exact owned child executable mapping required",
  );
  return { pid, birth, executable };
}
export function scheduleOwnedSecondarySample(
  { child, currentChild, expectedExecutable, evidence, spawnAtMs },
  dependencies = {},
) {
  assert.equal(expectedExecutable, EXE);
  const pid = child.pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && Number.isFinite(spawnAtMs));
  const readIdentity = dependencies.identity ?? identity,
    spawnSample = dependencies.spawn ?? spawn;
  const now = dependencies.now ?? (() => performance.now());
  const after = dependencies.setTimeout ?? setTimeout,
    cancelTimer = dependencies.clearTimeout ?? clearTimeout;
  const openFile = dependencies.open ?? open,
    makeDir = dependencies.mkdir ?? mkdir,
    write = dependencies.writeFile ?? writeFile;
  const warn = dependencies.warn ?? ((text) => process.stderr.write(text));
  const report = {
    scope:
      "Only original owned secondary, sample1s at spawn+8s; no environment capture",
    childPid: pid,
    spawnAtMs,
    scheduledAtMs: spawnAtMs + 8000,
    durationSeconds: 1,
    status: "scheduled",
    envRecorded: false,
  };
  let active = true,
    timer,
    running,
    sampler,
    sampleClosed = true;
  let stdout, stderr, stackOutput;
  let signalClosed;
  const closedSignal = new Promise((resolve) => {
    signalClosed = resolve;
  });
  function same() {
    return (
      currentChild() === child &&
      child.pid === pid &&
      child.exitCode === null &&
      child.signalCode === null
    );
  }
  function kind(error) {
    try {
      return String(error?.constructor?.name ?? "Unknown").slice(0, 80);
    } catch {
      return "Unknown";
    }
  }
  async function persist() {
    try {
      await write(
        join(evidence, "workspace-secondary-sample.json"),
        JSON.stringify(report, null, 2) + "\n",
        { mode: 0o600 },
      );
    } catch (error) {
      try {
        warn("owned sample observer unavailable: " + kind(error) + "\n");
      } catch {}
    }
  }
  const initial = Promise.resolve()
    .then(async () => {
      assert.ok(same(), "Owned child already exited");
      return readIdentity(pid, expectedExecutable, same);
    })
    .catch((error) => {
      report.initialIdentityError = kind(error);
      return null;
    });
  function stop() {
    active = false;
    cancelTimer(timer);
    if (sampler && !sampleClosed) {
      try {
        sampler.kill("SIGTERM");
      } catch {}
    }
  }
  child.once("exit", stop);
  child.once("error", stop);
  async function fire() {
    let watchdog, hardStop;
    try {
      if (!active || !same()) {
        report.status = "canceled-before-sample";
        return;
      }
      await makeDir(join(evidence, "sample-home"), {
        mode: 0o700,
        recursive: true,
      });
      await makeDir(join(evidence, "sample-tmp"), {
        mode: 0o700,
        recursive: true,
      });
      stdout = await openFile(
        join(evidence, "workspace-secondary-sample.stdout.log"),
        "wx",
        0o600,
      );
      stderr = await openFile(
        join(evidence, "workspace-secondary-sample.stderr.log"),
        "wx",
        0o600,
      );
      const path = join(evidence, "workspace-secondary.sample.txt");
      // Node spawn 不支持子进程umask；预建wx0600文件并实测sample覆写保权限。
      stackOutput = await openFile(path, "wx", 0o600);
      await stackOutput.close();
      stackOutput = undefined;
      const original = await initial;
      assert.ok(original, "Initial child identity unavailable");
      const before = await readIdentity(pid, expectedExecutable, same);
      assert.ok(
        active &&
          same() &&
          before.pid === pid &&
          before.birth === original.birth &&
          before.executable === expectedExecutable,
        "Child exited or was reused before sample",
      );
      report.before = before;
      // 最后一次文件IO后重新核原句柄，采样只读且从不阻塞/延长原10秒计时器。
      assert.ok(active && same(), "Owned child changed before sampler spawn");
      report.startedAtMs = now();
      sampler = spawnSample(
        "/usr/bin/sample",
        [String(pid), "1", "-file", path],
        {
          cwd: evidence,
          env: {
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            HOME: join(evidence, "sample-home"),
            TMPDIR: join(evidence, "sample-tmp"),
          },
          stdio: ["ignore", stdout.fd, stderr.fd],
        },
      );
      sampleClosed = false;
      report.samplerPid = sampler.pid;
      const exit = await new Promise((resolve) => {
        sampler.once("error", (error) => {
          sampleClosed = true;
          signalClosed();
          resolve({ error: kind(error) });
        });
        sampler.once("exit", (code, signal) => {
          sampleClosed = true;
          signalClosed();
          resolve({ code, signal });
        });
        watchdog = after(() => {
          report.observerTimedOut = true;
          try {
            sampler.kill("SIGTERM");
          } catch {}
        }, 1500);
        hardStop = after(() => {
          if (!sampleClosed) {
            try {
              sampler.kill("SIGKILL");
            } catch {}
            report.samplerReapExpired = true;
            resolve({ error: "owned-sampler-reap-timeout" });
          }
        }, 2000);
      });
      report.samplerExit = exit;
      const final = await readIdentity(pid, expectedExecutable, same);
      assert.ok(
        active &&
          same() &&
          final.pid === pid &&
          final.birth === original.birth &&
          final.executable === expectedExecutable,
        "Child exited or was reused after sample",
      );
      report.after = final;
      const info = await lstat(path);
      assert.ok(info.isFile() && (info.mode & 0o777) === 0o600);
      report.sampleFile = "workspace-secondary.sample.txt";
      report.status =
        exit.code === 0 && !exit.signal && !report.observerTimedOut
          ? "captured-exact-owned-stack"
          : "sample-tool-failed";
    } catch (error) {
      report.status = "observer-unavailable";
      report.errorType = kind(error);
    } finally {
      cancelTimer(watchdog);
      cancelTimer(hardStop);
      for (const handle of [stdout, stderr, stackOutput])
        if (handle) {
          try {
            await handle.close();
          } catch (error) {
            (report.closeErrors ??= []).push(kind(error));
          }
        }
      report.finishedAtMs = now();
      report.samplerClosed = sampleClosed;
      await persist();
    }
  }
  timer = after(
    () => {
      running = fire().catch((error) => {
        report.status = "observer-unavailable";
        report.errorType = kind(error);
        return persist();
      });
    },
    Math.max(0, spawnAtMs + 8000 - now()),
  );
  return {
    async dispose() {
      stop();
      child.off("exit", stop);
      child.off("error", stop);
      if (running) await running;
      else {
        report.status = "canceled-before-sample";
        report.samplerClosed = true;
        report.finishedAtMs = now();
      }
      if (sampler && !sampleClosed) {
        report.cleanupAttempt = "SIGKILL exact spawned sampler handle";
        try {
          sampler.kill("SIGKILL");
        } catch (error) {
          report.cleanupErrorType = kind(error);
        }
        let limit;
        await Promise.race([
          closedSignal,
          new Promise((resolve) => {
            limit = after(resolve, 500);
          }),
        ]);
        cancelTimer(limit);
      }
      report.samplerClosed = sampleClosed;
      if (!sampleClosed) {
        report.status = "owned-sampler-cleanup-failed";
        report.cleanupErrorType = "OwnedSamplerNotReaped";
      }
      await persist();
      return report;
    },
  };
}
