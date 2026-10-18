import { createHash } from "node:crypto";

const CORP = "ww-synthetic-never-called";
const AGENT = "1";
const BYTES = 16384;
const HOLD_MS = 20000;
const reject = (code) => Error(`Primary login rejected: ${code}`);

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
    throw reject("origin_scope");
  return value;
}

export function primaryLoginModeEnabled(experience, workflow, viewer, flag) {
  if (flag === undefined) return false;
  if (
    flag !== "controlled" ||
    experience !== "enabled" ||
    workflow !== undefined ||
    viewer !== undefined
  )
    throw reject("invalid_mode");
  return true;
}

// 空身份模式不调用旧初始化闭包，避免 email 会话、对照模型和加密 store 被预种。
export async function runNativeEmailBootstrap(primary, operation) {
  if (primary) return null;
  return operation();
}

export function primaryLoginPublicConfig(origin, tenantId) {
  ownedOrigin(origin);
  if (typeof tenantId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(tenantId))
    throw reject("tenant_scope");
  return {
    backend: "uwork",
    apiBaseUrl: origin,
    callbackUrl: origin + "/api/auth/wecom/callback",
    organizations: [
      {
        orgId: tenantId,
        corpId: CORP,
        agentId: AGENT,
        label: "本机原生登录测试",
      },
    ],
  };
}

export function primaryLimitMemberId(primary, legacyId, currentId) {
  if (!primary) return legacyId;
  if (typeof currentId !== "string" || !currentId) throw reject("limit_member");
  return currentId;
}

/** Supplier key remains in this RAM closure; only exact-match counts may leave. */
export function createPrimarySupplierWitness(value) {
  if (typeof value !== "string" || !value) throw reject("supplier_key");
  let key = value,
    chatMatched = 0,
    modelsMatched = 0,
    rejected = 0;
  return {
    check(path, authorization) {
      if (path === "/v1/traces") return true;
      // 旧夹具将未知URL也当chat；primary先拒绝别名与query变体，禁止绕过Key见证。
      if (!["/v1/chat/completions", "/v1/models"].includes(path)) {
        rejected++;
        return false;
      }
      if (!key || authorization !== `Bearer ${key}`) {
        rejected++;
        return false;
      }
      if (path === "/v1/models") modelsMatched++;
      else chatMatched++;
      return true;
    },
    safeStatus: () => ({ chatMatched, modelsMatched, rejected }),
    dispose() {
      key = undefined;
    },
  };
}

export async function preparePrimaryLoginMember({
  controller,
  api,
  tenantId,
  tenantPrefix,
  departmentId,
}) {
  if (
    tenantPrefix !== `/api/tenants/${tenantId}` ||
    typeof departmentId !== "string" ||
    !departmentId
  )
    throw reject("member_scope");
  // 复用已审 controller 原样 seed，再通过正式 PATCH 升席位；不重标旧 viewer 快照。
  await controller.seed({ api, tenantPrefix, tenantId });
  const hash = controller.safeStatus().readerHash;
  const path =
    tenantPrefix +
    "/members?q=" +
    encodeURIComponent("native-viewer-reader@example.test");
  const read = async () => {
    const rows = (await api(path)).items?.filter(
      (member) =>
        typeof member.id === "string" &&
        createHash("sha256").update(member.id).digest("hex") === hash,
    );
    if (rows?.length !== 1) throw reject("member_readback");
    return rows[0];
  };
  const before = await read();
  if (
    before.role !== "member" ||
    before.status !== "active" ||
    ![false, 0].includes(before.seat) ||
    !before.external_id
  )
    throw reject("member_readback");
  await api(`${tenantPrefix}/members/${before.id}`, "PATCH", {
    seat: true,
    departmentId,
  });
  const after = await read();
  if (
    after.role !== "member" ||
    after.status !== "active" ||
    ![true, 1].includes(after.seat) ||
    after.department_id !== departmentId ||
    after.external_id !== before.external_id
  )
    throw reject("member_readback");
  return Object.freeze({
    id: after.id,
    role: "member",
    seat: true,
    departmentId,
  });
}

/** 只在测试进程持有短期观察值；不签发身份、不主动 claim、不安装/覆盖 Session listener。 */
export function createPrimaryLoginHold(options) {
  const origin = ownedOrigin(options.origin);
  const tenantId = options.tenantId;
  const now = options.now ?? Date.now;
  let nonce = options.nonce;
  if (
    typeof tenantId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/u.test(tenantId) ||
    typeof nonce !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/u.test(nonce) ||
    typeof options.completeBackend !== "function"
  )
    throw reject("private_binding");
  let attempt, guest, held, timer;
  let failed = null,
    disposed = false,
    pendingObserved = false;
  let callbackCount = 0,
    callbackSucceeded = false,
    successfulClaim = false;
  let guestWasClosed = false,
    publicAuthenticated = false;
  const cancel = (callback) => {
    try {
      callback({ cancel: true });
    } catch {
      failed ??= "request_cancel_failed";
    }
  };
  const release = (natural = false) => {
    clearTimeout(timer);
    timer = undefined;
    const callback = held?.callback;
    held = undefined;
    // guest 已由原 Main 销毁时，网络请求随之结束；不再调用失效 callback制造 ERR_ABORTED 竞态。
    if (callback && !natural) cancel(callback);
  };
  const fail = (code) => {
    failed ??= code;
    release();
    attempt = undefined;
    guest = undefined;
    nonce = undefined;
    return reject(code);
  };
  const active = () => {
    if (disposed || failed) throw reject("controller_stopped");
  };
  const parse = (payload) => {
    if (typeof payload !== "string" || Buffer.byteLength(payload) > BYTES)
      throw fail("response_limit");
    try {
      return JSON.parse(payload);
    } catch {
      throw fail("response_invalid");
    }
  };
  const matchScope = (value) =>
    !!guest &&
    value.nonce === nonce &&
    value.ownerId === guest.ownerId &&
    value.webContentsId === guest.webContentsId &&
    value.sessionId === guest.sessionId;
  const validateUrl = (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw fail("sso_url");
    }
    const keys = [
      "appid",
      "agentid",
      "redirect_uri",
      "state",
      "login_type",
      "lang",
    ];
    if (
      url.origin !== "https://login.work.weixin.qq.com" ||
      url.pathname !== "/wwlogin/sso/login" ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].length !== keys.length ||
      keys.some((key) => url.searchParams.getAll(key).length !== 1) ||
      url.searchParams.get("appid") !== CORP ||
      url.searchParams.get("agentid") !== AGENT ||
      url.searchParams.get("redirect_uri") !==
        origin + "/api/auth/wecom/callback" ||
      url.searchParams.get("login_type") !== "CorpApp" ||
      url.searchParams.get("lang") !== "zh"
    )
      throw fail("sso_binding");
    return url;
  };
  return {
    observeResponse(message) {
      const path = message.path;
      if (
        path !== "/api/auth/wecom/attempts" &&
        !/^\/api\/auth\/wecom\/attempts\/[^/]+\/claim$/u.test(path)
      )
        return false;
      active();
      if (path === "/api/auth/wecom/attempts") {
        if (message.status !== 201) return false;
        if (attempt) throw fail("attempt_replay");
        const body = parse(message.payload),
          url = validateUrl(body.authorizeUrl);
        const state = url.searchParams.get("state");
        if (
          !state ||
          state !== body.id ||
          !/^[A-Za-z0-9_-]{1,200}$/u.test(state) ||
          !Number.isSafeInteger(body.expiresAt) ||
          body.expiresAt <= now() ||
          body.expiresAt > now() + 300000
        )
          throw fail("attempt_binding");
        attempt = { url: url.href, state, expiresAt: body.expiresAt };
        return true;
      }
      if (
        !attempt ||
        path !== `/api/auth/wecom/attempts/${attempt.state}/claim`
      )
        throw fail("claim_binding");
      if (message.status !== 200) return false;
      const body = parse(message.payload);
      if (
        body.status === "pending" &&
        held &&
        now() > held.at &&
        callbackCount === 0
      ) {
        if (Object.keys(body).length !== 1) throw fail("pending_response");
        pendingObserved = true;
      }
      if (body.status === "authorized") {
        if (
          callbackCount !== 1 ||
          typeof body.token !== "string" ||
          !body.token ||
          body.tenantId !== tenantId
        )
          throw fail("claim_delivery");
        successfulClaim = true;
      }
      return true;
    },
    bindGuest(value) {
      active();
      if (
        !attempt ||
        guest ||
        value.nonce !== nonce ||
        !Number.isSafeInteger(value.ownerId) ||
        value.ownerId < 1 ||
        !Number.isSafeInteger(value.webContentsId) ||
        value.webContentsId < 1 ||
        value.ownerId === value.webContentsId ||
        typeof value.sessionId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(value.sessionId)
      )
        throw fail("guest_binding");
      guest = {
        ownerId: value.ownerId,
        webContentsId: value.webContentsId,
        sessionId: value.sessionId,
      };
    },
    captureSso(details, callback) {
      if (typeof callback !== "function") throw fail("request_callback");
      try {
        active();
        if (
          !attempt ||
          held ||
          !matchScope(details) ||
          details.method !== "GET" ||
          details.resourceType !== "mainFrame" ||
          !Number.isSafeInteger(details.id) ||
          details.id < 1 ||
          attempt.expiresAt <= now() ||
          validateUrl(details.url).href !== attempt.url
        )
          throw reject("request_binding");
      } catch {
        cancel(callback);
        throw fail("request_binding");
      }
      held = { id: details.id, at: now(), callback };
      timer = setTimeout(() => {
        fail("hold_deadline");
      }, HOLD_MS);
      return true;
    },
    async completeCallback() {
      active();
      if (
        !held ||
        !pendingObserved ||
        callbackCount !== 0 ||
        !attempt ||
        attempt.expiresAt <= now()
      )
        throw reject("callback_not_ready");
      callbackCount++;
      try {
        await options.completeBackend();
        active();
        callbackSucceeded = true;
      } catch {
        throw fail("callback_failed");
      }
    },
    guestClosed(value) {
      active();
      if (!matchScope(value)) throw fail("guest_binding");
      if (!successfulClaim) throw fail("guest_closed_before_claim");
      guestWasClosed = true;
      release(true);
      attempt = undefined;
    },
    observePublicAuthenticated(value) {
      active();
      if (
        value.nonce !== nonce ||
        value.ownerId !== guest?.ownerId ||
        value.authenticated !== true ||
        !successfulClaim
      )
        throw fail("auth_without_claim");
      publicAuthenticated = true;
    },
    safeStatus() {
      return {
        held: !!held,
        pendingObserved,
        callbackCount,
        callbackSucceeded,
        successfulClaim,
        guestClosed: guestWasClosed,
        publicAuthenticated,
        guardSatisfied:
          !failed &&
          callbackSucceeded &&
          successfulClaim &&
          guestWasClosed &&
          publicAuthenticated,
        failed,
        disposed,
      };
    },
    abort() {
      fail("observer_failed");
    },
    dispose() {
      release();
      attempt = undefined;
      guest = undefined;
      nonce = undefined;
      disposed = true;
    },
  };
}
