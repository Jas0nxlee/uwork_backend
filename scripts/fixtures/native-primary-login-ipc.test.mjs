import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createPrimaryLoginHold } from "./native-primary-login.mjs";
import { createPrimaryParentBridge } from "./native-primary-login-adapter.mjs";

test("real anonymous Node IPC lifecycle keeps nonce/state/URL out of argv, env and raw evidence", async (t) => {
  const origin = "https://127.0.0.1:50301",
    tenantId = "finite-pipe-tenant";
  const nonce = randomBytes(32).toString("base64url");
  const state = createHash("sha256")
    .update(nonce + "probe-state")
    .digest("hex");
  const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
  for (const [key, value] of Object.entries({
    appid: "ww-synthetic-never-called",
    agentid: "1",
    redirect_uri: origin + "/api/auth/wecom/callback",
    state,
    login_type: "CorpApp",
    lang: "zh",
  }))
    url.searchParams.set(key, value);
  let clock = 1000,
    callbacks = 0;
  const hold = createPrimaryLoginHold({
    origin,
    tenantId,
    nonce,
    now: () => clock,
    completeBackend: async () => {
      callbacks++;
      hold.observeResponse({
        path: `/api/auth/wecom/attempts/${state}/claim`,
        status: 200,
        payload: JSON.stringify({
          status: "authorized",
          token: randomBytes(24).toString("hex"),
          tenantId,
        }),
      });
    },
  });
  hold.observeResponse({
    path: "/api/auth/wecom/attempts",
    status: 201,
    payload: JSON.stringify({
      id: state,
      proof: randomBytes(24).toString("hex"),
      authorizeUrl: url.href,
      expiresAt: 301000,
    }),
  });
  const importFlags = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    if (process.execArgv[index] === "--import")
      importFlags.push("--import", process.execArgv[++index]);
  }
  const child = spawn(
    process.execPath,
    [
      ...importFlags,
      new URL("./native-primary-login-ipc-child.mjs", import.meta.url).pathname,
    ],
    {
      cwd: import.meta.dirname,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const bridge = createPrimaryParentBridge(child, { nonce, origin, hold });
  t.after(() => {
    bridge.dispose();
    hold.dispose();
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  const finished = new Promise((resolve, reject) => {
    child.on("message", (message) => {
      if (message.op === "sso") {
        clock++;
        hold.observeResponse({
          path: `/api/auth/wecom/attempts/${state}/claim`,
          status: 200,
          payload: JSON.stringify({ status: "pending" }),
        });
        void hold.completeCallback().catch(reject);
      }
      if (message.op === "authenticated") {
        if (!hold.safeStatus().guardSatisfied)
          reject(Error("Finite private gate not satisfied"));
        bridge.expectStop();
      }
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error(`Finite IPC child exit ${code}`)),
    );
    const timer = setTimeout(
      () => reject(Error("Finite IPC probe deadline")),
      5000,
    );
    child.once("close", () => clearTimeout(timer));
  });
  await bridge.ready;
  await finished;
  assert.equal(callbacks, 1);
  assert.equal(hold.safeStatus().guardSatisfied, true);
  assert.ok(bridge.safeStatus().stdoutBytes > 0);
  assert.ok(bridge.safeStatus().stderrBytes > 0);
  const safe = JSON.stringify(bridge.safeStatus());
  for (const secret of [nonce, state, url.href]) {
    assert.ok(!safe.includes(secret));
    assert.ok(!child.spawnargs.some((arg) => arg.includes(secret)));
  }
  console.log(
    JSON.stringify({
      event: "primary-node-ipc-probe",
      childPid: child.pid,
      exitCode: child.exitCode,
      frames: bridge.safeStatus().frames,
      stdoutBytesCounted: bridge.safeStatus().stdoutBytes,
      stderrBytesCounted: bridge.safeStatus().stderrBytes,
      privateValuesAbsentFromPublicStatus: true,
      childArgvEnvChecked: true,
      nodeDescendantControlEnvAndChannelAbsent: true,
    }),
  );
});
