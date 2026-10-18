import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateOwnedNativeWorkspace } from "./native-owned-workspace.mjs";

// Root已完成独立代码审查；只解除受控夹具启动锁，实际Native验收仍需单独运行证据。
export const PRIMARY_ADAPTER_REVIEWED = true;
export const PRIMARY_AUTH_EXPRESSION =
  "(()=>{const shown=s=>{const e=document.querySelector(s);return!!e&&e.getClientRects().length>0};return{authenticated:shown('[data-testid=enterprise-identity-name]'),signedOut:shown('[data-testid=enterprise-identity-entry]'),loginVisible:shown('[data-testid=enterprise-login-page]')};})()";
const error = () => Error("Primary private adapter rejected");
const exact = (value, fields) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const validNonce = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(value);
const guardReasons = new Set([
  "auth_deadline",
  "auth_exhausted",
  "auth_read_rejected",
  "auth_projection_invalid",
  "request_denied",
  "external_open_denied",
  "channel_send_failed",
  "private_control_rejected",
]);
const dataRecord = (value, fields) =>
  exact(value, fields) &&
  Reflect.ownKeys(value).length === fields.length &&
  fields.every((field) =>
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, field), "value"),
  );
function publicAuthProjection(value) {
  const fields = ["authenticated", "signedOut", "loginVisible"];
  if (
    !dataRecord(value, fields) ||
    !fields.every((field) => typeof value[field] === "boolean")
  )
    return null;
  return {
    authenticated: value.authenticated,
    signedOut: value.signedOut,
    loginVisible: value.loginVisible,
  };
}

// Diagnostic input is untrusted. Copy only the fixed fields; never serialize its source object.
export function projectPrimarySessionGuardDiagnostic(value) {
  try {
    if (
      !dataRecord(value, [
        "reason",
        "lastProjection",
        "completedReads",
        "inFlight",
      ]) ||
      !guardReasons.has(value.reason) ||
      !Number.isSafeInteger(value.completedReads) ||
      value.completedReads < 0 ||
      value.completedReads > 25 ||
      typeof value.inFlight !== "boolean"
    )
      return null;
    const lastProjection =
      value.lastProjection === null
        ? null
        : publicAuthProjection(value.lastProjection);
    if (value.lastProjection !== null && !lastProjection) return null;
    if (value.completedReads === 0 && lastProjection !== null) return null;
    if (
      value.reason === "auth_exhausted" &&
      (value.completedReads !== 25 ||
        value.inFlight ||
        !lastProjection ||
        (lastProjection.authenticated &&
          !lastProjection.signedOut &&
          !lastProjection.loginVisible))
    )
      return null;
    if (
      ["auth_read_rejected", "auth_projection_invalid"].includes(
        value.reason,
      ) &&
      (value.completedReads === 0 || value.inFlight)
    )
      return null;
    return {
      reason: value.reason,
      lastProjection,
      completedReads: value.completedReads,
      inFlight: value.inFlight,
    };
  } catch {
    return null;
  }
}

export function scrubPrimaryControlEnvironment(environment) {
  if (!environment) return;
  // Main现有IPC已初始化；禁止Host/CLI继承私有descriptor bootstrap或夹具模式配置。
  for (const key of Object.keys(environment))
    if (
      key === "NODE_CHANNEL_FD" ||
      key === "NODE_CHANNEL_SERIALIZATION_MODE" ||
      key.startsWith("UWORK_NATIVE_")
    )
      delete environment[key];
}
function ownedOrigin(value) {
  const match =
    typeof value === "string" &&
    /^https:\/\/127\.0\.0\.1:(\d{1,5})$/u.exec(value);
  if (
    !match ||
    +match[1] < 1 ||
    +match[1] > 65535 ||
    +match[1] === 3000 ||
    new URL(value).origin !== value
  )
    throw error();
  return value;
}

export function assertPrimaryCommand(command) {
  if (
    exact(command, ["op", "workspacePath"]) &&
    command.op === "openWorkspace" &&
    typeof command.workspacePath === "string" &&
    command.workspacePath.length <= 4096 &&
    !command.workspacePath.includes("\0") &&
    isAbsolute(command.workspacePath) &&
    resolve(command.workspacePath) === command.workspacePath
  )
    return;
  if (
    exact(command, ["op", "name"]) &&
    command.op === "experienceSnapshot" &&
    typeof command.name === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/u.test(command.name)
  )
    return;
  if (
    exact(command, ["op"]) &&
    [
      "launch",
      "stopNative",
      "close",
      "completePrimaryLogin",
      "primaryLoginStatus",
    ].includes(command.op)
  )
    return;
  throw error();
}

/** Fixed private messages only; values never become argv/env/logs or a business RPC. */
export function createPrimaryParentBridge(
  child,
  { nonce, origin, hold, onFailure = () => {} },
) {
  ownedOrigin(origin);
  if (!validNonce(nonce) || typeof child.send !== "function") throw error();
  let initialized = false,
    hello = false,
    stopping = false,
    failed = false;
  let frames = 0,
    stdoutBytes = 0,
    stderrBytes = 0,
    resolveReady,
    rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  const send = (message) => {
    if (!child.connected) throw error();
    child.send(message, (cause) => {
      if (cause && !stopping) fail();
    });
  };
  const fail = () => {
    if (failed || stopping) return;
    failed = true;
    clearTimeout(timer);
    hold.abort();
    rejectReady(error());
    try {
      onFailure();
    } catch {}
    try {
      child.kill("SIGTERM");
    } catch {}
  };
  const timer = setTimeout(fail, 5000);
  const onMessage = (message) => {
    if (stopping) return;
    try {
      if (++frames > 32) throw error();
      if (exact(message, ["op"]) && message.op === "hello" && !hello) {
        hello = true;
        send({ op: "init", nonce, origin });
        return;
      }
      if (!hello || message?.nonce !== nonce) throw error();
      if (
        exact(message, ["op", "nonce"]) &&
        message.op === "ready" &&
        !initialized
      ) {
        initialized = true;
        clearTimeout(timer);
        resolveReady();
        return;
      }
      if (!initialized) throw error();
      if (
        exact(message, [
          "op",
          "nonce",
          "ownerId",
          "webContentsId",
          "sessionId",
          "id",
          "method",
          "resourceType",
          "url",
        ]) &&
        message.op === "sso"
      ) {
        hold.bindGuest(message);
        hold.captureSso(message, () =>
          send({ op: "cancel", nonce, id: message.id }),
        );
        return;
      }
      if (
        exact(message, [
          "op",
          "nonce",
          "ownerId",
          "webContentsId",
          "sessionId",
        ]) &&
        message.op === "guest-closed"
      ) {
        hold.guestClosed(message);
        return;
      }
      if (
        exact(message, ["op", "nonce", "ownerId", "authenticated"]) &&
        message.op === "authenticated"
      ) {
        hold.observePublicAuthenticated(message);
        return;
      }
      throw error();
    } catch {
      fail();
    }
  };
  const onDisconnect = () => {
    if (!stopping) fail();
  };
  child.on("message", onMessage);
  child.on("disconnect", onDisconnect);
  child.on("error", onDisconnect);
  child.on("exit", onDisconnect);
  const count = (stream, bytes) => {
    if (stream === "stdout") stdoutBytes += bytes.length;
    else stderrBytes += bytes.length;
    if (stdoutBytes + stderrBytes > 2 * 1024 * 1024) fail();
  };
  const stdout = (bytes) => count("stdout", bytes),
    stderr = (bytes) => count("stderr", bytes);
  child.stdout?.on("data", stdout);
  child.stderr?.on("data", stderr);
  return {
    ready,
    safeStatus: () => ({
      initialized,
      failed,
      stopping,
      frames,
      stdoutBytes,
      stderrBytes,
    }),
    expectStop() {
      stopping = true;
      clearTimeout(timer);
      try {
        send({ op: "stop", nonce });
      } catch {}
    },
    dispose() {
      stopping = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("disconnect", onDisconnect);
      child.off("error", onDisconnect);
      child.off("exit", onDisconnect);
      // Keep draining raw output until the owned child exits; never persist or decode it.
    },
  };
}

/** Installs the sole test Session guard before production Main is imported. */
export function installPrimaryMainGuard(
  electron,
  { origin, nonce, channel, appRoot, onFailure = () => {} },
) {
  ownedOrigin(origin);
  if (channel && !validNonce(nonce)) throw error();
  const { app, session, BrowserWindow, webContents, shell } = electron;
  const root = realpathSync(appRoot);
  const seen = new WeakMap();
  let held,
    failed = false,
    stopping = false,
    sessions = 0,
    blocked = 0,
    authTimer,
    authDeadline,
    lastProjection = null,
    completedReads = 0,
    inFlight = false;
  const send = (message) => {
    try {
      channel.send({ ...message, nonce }, (cause) => {
        if (cause && !stopping) fail("channel_send_failed");
      });
    } catch {
      fail("channel_send_failed");
    }
  };
  const cancelHeld = () => {
    const callback = held?.callback;
    held = undefined;
    if (callback) {
      try {
        callback({ cancel: true });
      } catch {}
    }
  };
  const fail = (reason) => {
    if (failed || stopping) return;
    failed = true;
    blocked++;
    clearTimeout(authTimer);
    clearTimeout(authDeadline);
    cancelHeld();
    try {
      onFailure(
        projectPrimarySessionGuardDiagnostic({
          reason,
          lastProjection,
          completedReads,
          inFlight,
        }),
      );
    } catch {}
  };
  const authWitness = (owner, ownerId) => {
    let attempts = 0;
    // executeJavaScript 本身也可悬挂；独立绝对截止覆盖整个只读见证，不靠后续轮询计数兜底。
    authDeadline = setTimeout(() => fail("auth_deadline"), 3000);
    const read = async () => {
      if (stopping || failed) return;
      let value;
      inFlight = true;
      try {
        value = await owner.executeJavaScript(PRIMARY_AUTH_EXPRESSION);
      } catch {
        inFlight = false;
        if (stopping || failed) return;
        completedReads++;
        fail("auth_read_rejected");
        return;
      }
      inFlight = false;
      if (stopping || failed) return;
      completedReads++;
      try {
        const projection = publicAuthProjection(value);
        if (!projection) {
          fail("auth_projection_invalid");
          return;
        }
        lastProjection = projection;
        if (
          projection.authenticated &&
          !projection.signedOut &&
          !projection.loginVisible
        ) {
          clearTimeout(authDeadline);
          send({ op: "authenticated", ownerId, authenticated: true });
          return;
        }
        if (++attempts >= 25) {
          fail("auth_exhausted");
          return;
        }
        authTimer = setTimeout(read, 100);
      } catch {
        fail("auth_projection_invalid");
      }
    };
    void read();
  };
  const attach = (target) => {
    if (seen.has(target)) return;
    const sessionId = `session-${++sessions}-${randomBytes(8).toString("hex")}`;
    seen.set(target, sessionId);
    target.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) => {
        const deny = () => {
          callback({ cancel: true });
          fail("request_denied");
        };
        if (failed || stopping) {
          callback({ cancel: true });
          return;
        }
        try {
          if (details.url === "about:blank") {
            callback({ cancel: false });
            return;
          }
          const url = new URL(details.url);
          if (url.username || url.password) {
            deny();
            return;
          }
          if (url.protocol === "file:") {
            const file = realpathSync(fileURLToPath(url));
            const child = relative(root, file);
            if (
              child &&
              child !== ".." &&
              !child.startsWith(".." + sep) &&
              !isAbsolute(child)
            ) {
              callback({ cancel: false });
              return;
            }
            deny();
            return;
          }
          if (url.origin === origin) {
            callback({ cancel: false });
            return;
          }
          if (
            !channel ||
            held ||
            url.origin !== "https://login.work.weixin.qq.com" ||
            url.pathname !== "/wwlogin/sso/login" ||
            details.method !== "GET" ||
            details.resourceType !== "mainFrame" ||
            !integer(details.id)
          ) {
            deny();
            return;
          }
          const guest = webContents.fromId(details.webContentsId);
          const parent = BrowserWindow.getAllWindows().find((window) =>
            window.contentView.children.some(
              (view) => view.webContents === guest,
            ),
          );
          if (
            !guest ||
            guest.session !== target ||
            !parent ||
            parent.webContents === guest
          ) {
            deny();
            return;
          }
          const scope = {
            ownerId: parent.webContents.id,
            webContentsId: guest.id,
            sessionId,
          };
          held = { id: details.id, callback };
          guest.once("destroyed", () => {
            if (stopping || failed) return;
            held = undefined;
            send({ op: "guest-closed", ...scope });
            authWitness(parent.webContents, scope.ownerId);
          });
          send({
            op: "sso",
            ...scope,
            id: details.id,
            method: details.method,
            resourceType: details.resourceType,
            url: details.url,
          });
        } catch {
          deny();
        }
      },
    );
  };
  app.on("session-created", attach);
  app.on("web-contents-created", (_event, contents) =>
    attach(contents.session),
  );
  if (app.isReady()) attach(session.defaultSession);
  else app.once("ready", () => attach(session.defaultSession));
  // Do not call the OS shell or reject into production URL logging.
  shell.openExternal = () => {
    fail("external_open_denied");
    return Promise.resolve();
  };
  return {
    safeStatus: () => ({ sessions, blocked, failed, stopping, held: !!held }),
    receive(message) {
      if (!message || message.nonce !== nonce) {
        fail("private_control_rejected");
        return false;
      }
      if (exact(message, ["op", "nonce"]) && message.op === "stop") {
        stopping = true;
        clearTimeout(authTimer);
        clearTimeout(authDeadline);
        cancelHeld();
        return true;
      }
      if (
        exact(message, ["op", "nonce", "id"]) &&
        message.op === "cancel" &&
        held?.id === message.id
      ) {
        cancelHeld();
        return true;
      }
      fail("private_control_rejected");
      return false;
    },
    disconnected() {
      if (!stopping) fail("private_control_rejected");
    },
  };
}

/** No secret argument/env/file: init arrives through the inherited anonymous Node channel. */
export async function startPrimaryMainEntry(
  electron,
  runtime,
  { appRoot, ownedRoot, origin, loadMain, onStop, onReject },
) {
  const diagnostics = typeof onReject === "function";
  let rejectionReported = false;
  const reportRejection = (code, detail) => {
    if (!diagnostics || rejectionReported) return;
    rejectionReported = true;
    try {
      const diagnostic =
        code === "session_guard"
          ? projectPrimarySessionGuardDiagnostic(detail)
          : null;
      void Promise.resolve(
        diagnostic ? onReject(code, diagnostic) : onReject(code),
      ).catch(() => {});
    } catch {}
  };
  const rethrow = (code, cause) => {
    reportRejection(code);
    // Diagnostics carry one fixed code only; default callers retain the original rejection.
    throw diagnostics ? error() : cause;
  };
  if (typeof runtime.send !== "function" || !runtime.connected) {
    const args = runtime.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--open-workspace")
      rethrow("secondary_argv_shape", error());
    try {
      await validateOwnedNativeWorkspace(ownedRoot, args[1]);
    } catch (cause) {
      rethrow("owned_workspace", cause);
    }
    try {
      scrubPrimaryControlEnvironment(runtime.env);
      installPrimaryMainGuard(electron, {
        appRoot,
        origin,
        onFailure: (diagnostic) => {
          reportRejection("session_guard", diagnostic);
          electron.app.exit(70);
        },
      });
    } catch (cause) {
      rethrow("session_guard", cause);
    }
    try {
      await loadMain();
    } catch (cause) {
      rethrow("main_import", cause);
    }
    return;
  }
  await new Promise((resolveEntry, rejectEntry) => {
    let guard,
      initialized = false,
      receivingPrivateMessage = false;
    const fail = (code = "private_channel", diagnostic) => {
      reportRejection(code, diagnostic);
      clearTimeout(timer);
      rejectEntry(error());
      electron.app.exit(70);
    };
    const timer = setTimeout(fail, 5000);
    runtime.on("disconnect", () => {
      if (guard) {
        receivingPrivateMessage = true;
        try {
          guard.disconnected();
        } finally {
          receivingPrivateMessage = false;
        }
      } else fail();
    });
    runtime.on("message", (message) => {
      try {
        if (initialized) {
          // 私有stop必须先被守卫完整接受，错误nonce不能触发宽松的测试退出回调。
          receivingPrivateMessage = true;
          try {
            if (guard.receive(message) && message.op === "stop" && onStop)
              onStop();
          } finally {
            receivingPrivateMessage = false;
          }
          return;
        }
        if (
          !exact(message, ["op", "nonce", "origin"]) ||
          message.op !== "init" ||
          !validNonce(message.nonce) ||
          message.origin !== origin
        )
          throw error();
        try {
          guard = installPrimaryMainGuard(electron, {
            appRoot,
            origin,
            nonce: message.nonce,
            channel: runtime,
            onFailure: (diagnostic) =>
              fail(
                receivingPrivateMessage ? "private_channel" : "session_guard",
                diagnostic,
              ),
          });
          scrubPrimaryControlEnvironment(runtime.env);
        } catch {
          fail("session_guard");
          return;
        }
        initialized = true;
        clearTimeout(timer);
        runtime.send({ op: "ready", nonce: message.nonce });
        let importing;
        try {
          importing = loadMain(message);
        } catch {
          fail("main_import");
          return;
        }
        Promise.resolve(importing).then(resolveEntry, () =>
          fail("main_import"),
        );
      } catch {
        fail();
      }
    });
    try {
      runtime.send({ op: "hello" });
    } catch (cause) {
      if (diagnostics) fail("private_channel");
      else throw cause;
    }
  });
}
