import { createHash, randomBytes } from "node:crypto";
import { request } from "node:https";

const FLAG = "UWORK_NATIVE_VIEWER_AUTH";
const CORP = "ww-synthetic-never-called";
const AGENT = "1";
const EXTERNAL = "controlled-native-viewer-reader";
const EMAIL = "native-viewer-reader@example.test";
const LIMIT = 16384;
const DEADLINE_MS = 10000;

function rejected(code) {
  return Object.assign(Error("Controlled viewer authentication rejected"), {
    code,
  });
}
export function viewerAuthModeEnabled(experience, workflow, flag) {
  if (flag === undefined) return false;
  if (
    flag !== "controlled" ||
    experience !== "enabled" ||
    workflow !== undefined
  )
    throw rejected("invalid_mode");
  return true;
}
export function stripViewerAuthFlag(environment) {
  const child = { ...environment };
  delete child[FLAG];
  return child;
}
export function viewerAuthSafePath(value) {
  const path = typeof value === "string" ? value.split(/[?#]/u, 1)[0] : "";
  if (path.startsWith("/api/auth/wecom/attempts/")) {
    const action =
      /^\/api\/auth\/wecom\/attempts\/[^/]+(?:\/(claim|cancel|complete))?$/u.exec(
        path,
      );
    return (
      "/api/auth/wecom/attempts/:id" +
      (action ? (action[1] ? "/" + action[1] : "") : "/other")
    );
  }
  return path.startsWith("/") ? path : null;
}
export function assertViewerAuthCommand(command, op) {
  if (
    !command ||
    Array.isArray(command) ||
    typeof command !== "object" ||
    Object.keys(command).length !== 1 ||
    command.op !== op ||
    !["completeViewerAuth", "viewerAuthStatus"].includes(op)
  )
    throw rejected("invalid_command");
}
function ownedOrigin(value) {
  if (
    typeof value !== "string" ||
    !/^https:\/\/127\.0\.0\.1:\d{1,5}$/u.test(value)
  )
    throw rejected("origin_scope");
  const url = new URL(value);
  if (
    url.origin !== value ||
    +url.port < 1 ||
    +url.port > 65535 ||
    +url.port === 3000
  )
    throw rejected("origin_scope");
  return value;
}
function callbackRequest(url, ca, signal) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", ca, rejectUnauthorized: true, signal },
      (res) => {
        res.on("error", reject);
        res.on("aborted", () => reject(rejected("callback_aborted")));
        res.on("end", () => resolve(res.statusCode));
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Test-only controller: importing it performs no IO and creates no fixture. */
export function createNativeControlledViewerAuth(dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const sendCallback = dependencies.callbackRequest ?? callbackRequest;
  let syntheticSecret = randomBytes(24).toString("hex");
  let callbackCode = randomBytes(24).toString("hex");
  let binding,
    origin,
    pending,
    readerHash = null,
    seeded = false,
    disposed = false,
    completing = false;
  let attempts = 0,
    callbacks = 0,
    identityCalls = 0,
    error = null;
  let callbackStatus = null,
    activeCallback,
    callbackTimer;
  const cleanups = new Set();
  let server, listener;
  const fail = (code) => {
    error ??= code;
    pending = undefined;
    return rejected(code);
  };
  const usable = () => {
    if (disposed || error) throw rejected("controller_stopped");
  };

  const provider = {
    async identity(config, credential, code) {
      identityCalls++;
      if (
        !seeded ||
        disposed ||
        error ||
        !completing ||
        identityCalls !== 1 ||
        config?.tenant_id !== binding?.tenantId ||
        config?.corp_id !== CORP ||
        config?.agent_id !== AGENT ||
        config?.credential_id !== binding?.credentialId ||
        credential !== syntheticSecret ||
        code !== callbackCode
      )
        throw fail("identity_rejected");
      return EXTERNAL;
    },
    async directory() {
      throw fail("directory_disabled");
    },
  };

  async function seed({ api, tenantPrefix, tenantId }) {
    usable();
    if (
      seeded ||
      typeof tenantId !== "string" ||
      tenantPrefix !== `/api/tenants/${tenantId}`
    )
      throw fail("seed_scope");
    try {
      const current = await api(tenantPrefix + "/wecom");
      if (
        current?.configuration?.corp_id !== CORP ||
        current.configuration.agent_id !== AGENT
      )
        throw rejected("seed_corp");
      const credential = await api(tenantPrefix + "/credentials", "POST", {
        name: "Controlled viewer provider",
        value: syntheticSecret,
      });
      await api(tenantPrefix + "/wecom", "PUT", {
        corpId: CORP,
        agentId: AGENT,
        credentialId: credential.id,
      });
      const reader = await api(tenantPrefix + "/members", "POST", {
        email: EMAIL,
        name: "Controlled viewer reader",
        password: randomBytes(24).toString("hex"),
        role: "member",
        seat: false,
      });
      await api(`${tenantPrefix}/members/${reader.id}/wecom`, "PUT", {
        externalId: EXTERNAL,
      });
      const listed = await api(
        tenantPrefix + "/members?q=" + encodeURIComponent(EMAIL),
      );
      const member = listed.items?.find((item) => item.id === reader.id);
      if (
        !member ||
        member.role !== "member" ||
        ![false, 0].includes(member.seat) ||
        member.status !== "active" ||
        member.external_id !== EXTERNAL
      )
        throw rejected("seed_member");
      binding = { tenantId, credentialId: credential.id };
      readerHash = createHash("sha256").update(reader.id).digest("hex");
      seeded = true;
    } catch {
      throw fail("seed_rejected");
    }
  }

  function observeOwnAttempts(target, options) {
    usable();
    if (!seeded || server) throw fail("observer_scope");
    origin = ownedOrigin(options.origin);
    server = target;
    listener = (req, res) => {
      if (
        disposed ||
        error ||
        req.method !== "POST" ||
        req.url?.split("?", 1)[0] !== "/api/auth/wecom/attempts"
      )
        return;
      if (cleanups.size) {
        fail("observer_busy");
        for (const cleanup of [...cleanups]) cleanup();
        return;
      }
      let chunks = [],
        bytes = 0,
        done = false;
      let timer;
      const write = res.write,
        end = res.end;
      const cleanup = () => {
        if (done) return;
        done = true;
        chunks = [];
        clearTimeout(timer);
        if (res.write === wrappedWrite) res.write = write;
        if (res.end === wrappedEnd) res.end = end;
        res.off("finish", finish);
        res.off("close", aborted);
        res.off("error", aborted);
        cleanups.delete(cleanup);
      };
      const append = (args) => {
        try {
          if (
            done ||
            error ||
            res.statusCode !== 201 ||
            args[0] == null ||
            typeof args[0] === "function"
          )
            return;
          if (typeof args[0] !== "string" && !(args[0] instanceof Uint8Array))
            throw rejected("response_type");
          const encoding = typeof args[1] === "string" ? args[1] : "utf8";
          bytes +=
            typeof args[0] === "string"
              ? Buffer.byteLength(args[0], encoding)
              : args[0].byteLength;
          if (bytes > LIMIT) {
            fail("response_limit");
            cleanup();
            return;
          }
          const value =
            typeof args[0] === "string"
              ? Buffer.from(args[0], encoding)
              : Buffer.from(args[0]);
          chunks.push(value);
        } catch {
          fail("response_capture");
          cleanup();
        }
      };
      function wrappedWrite(...args) {
        append(args);
        try {
          return Reflect.apply(write, this, args);
        } catch (failure) {
          fail("response_write_error");
          cleanup();
          throw failure;
        }
      }
      function wrappedEnd(...args) {
        append(args);
        try {
          return Reflect.apply(end, this, args);
        } catch (failure) {
          fail("response_write_error");
          cleanup();
          throw failure;
        }
      }
      const finish = () => {
        try {
          if (res.statusCode !== 201 || disposed || error) return;
          attempts++;
          if (attempts !== 1) throw rejected("attempt_limit");
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const url = new URL(body.authorizeUrl);
          if (
            url.origin !== "https://login.work.weixin.qq.com" ||
            url.pathname !== "/wwlogin/sso/login" ||
            url.username ||
            url.password ||
            url.hash ||
            url.searchParams.get("appid") !== CORP ||
            url.searchParams.get("agentid") !== AGENT ||
            url.searchParams.get("redirect_uri") !==
              origin + "/api/auth/wecom/callback"
          )
            throw rejected("attempt_scope");
          if (
            ["appid", "agentid", "redirect_uri", "state"].some(
              (key) => url.searchParams.getAll(key).length !== 1,
            )
          )
            throw rejected("attempt_scope");
          const state = url.searchParams.get("state"),
            expiresAt = body.expiresAt;
          if (
            !state ||
            state.length > 200 ||
            !Number.isSafeInteger(expiresAt) ||
            expiresAt <= now() ||
            expiresAt > now() + 300000
          )
            throw rejected("attempt_expired");
          pending = { state, expiresAt };
        } catch {
          fail("attempt_response");
        } finally {
          cleanup();
        }
      };
      const aborted = () => {
        if (!done && res.statusCode === 201) fail("response_aborted");
        cleanup();
      };
      res.write = wrappedWrite;
      res.end = wrappedEnd;
      res.once("finish", finish);
      res.once("close", aborted);
      res.once("error", aborted);
      cleanups.add(cleanup);
      timer = setTimeout(() => {
        fail("response_timeout");
        cleanup();
      }, DEADLINE_MS);
    };
    server.prependListener("request", listener);
  }

  async function complete(options) {
    usable();
    if (!seeded || !pending || callbacks !== 0 || pending.expiresAt <= now())
      throw fail("no_pending_attempt");
    if (ownedOrigin(options.origin) !== origin) throw fail("origin_scope");
    const state = pending.state;
    pending = undefined;
    callbacks++;
    completing = true;
    const url = new URL("/api/auth/wecom/callback", origin);
    url.searchParams.set("state", state);
    url.searchParams.set("code", callbackCode);
    const abort = new AbortController();
    activeCallback = abort;
    callbackTimer = setTimeout(() => abort.abort(), DEADLINE_MS);
    try {
      const status = await sendCallback(url, options.ca, abort.signal);
      callbackStatus =
        Number.isInteger(status) && status >= 100 && status <= 599
          ? status
          : null;
      if (status !== 200 || identityCalls !== 1 || disposed)
        throw rejected("callback_rejected");
    } catch {
      throw fail("callback_rejected");
    } finally {
      clearTimeout(callbackTimer);
      callbackTimer = undefined;
      activeCallback = undefined;
      completing = false;
      callbackCode = undefined;
    }
  }
  function safeStatus() {
    return {
      enabled: true,
      seeded,
      attemptPending: !!pending,
      attemptCount: attempts,
      callbackCount: callbacks,
      identityCallCount: identityCalls,
      callbackStatus,
      readerHash,
      seat: seeded ? false : null,
      error,
      disposed,
    };
  }
  function dispose() {
    if (server && listener) server.off("request", listener);
    for (const cleanup of [...cleanups]) cleanup();
    clearTimeout(callbackTimer);
    callbackTimer = undefined;
    activeCallback?.abort();
    activeCallback = undefined;
    pending = undefined;
    callbackCode = undefined;
    syntheticSecret = undefined;
    binding = undefined;
    disposed = true;
  }
  return { provider, seed, observeOwnAttempts, complete, safeStatus, dispose };
}
