import { createHash, randomBytes } from "node:crypto";
import { request } from "node:https";

export const TWO_ORG_FLAG = "UWORK_NATIVE_TWO_ORGANIZATION_LOGIN";
export const TWO_ORG_PROFILES = Object.freeze({
  A: Object.freeze({
    email: "g04k-member-a@example.test",
    externalId: "controlled-g04k-member-a",
    name: "G04k 普通成员 A",
    label: "G04k 组织 A",
    department: "G04k 部门 A",
    model: "G04k Model A",
    creditBaseline: 7,
    memberLimit: 100007,
  }),
  B: Object.freeze({
    email: "g04k-member-b@example.test",
    externalId: "controlled-g04k-member-b",
    name: "G04k 普通成员 B",
    label: "G04k 组织 B",
    department: "G04k 部门 B",
    model: "G04k Model B",
    creditBaseline: 11,
    memberLimit: 200011,
  }),
});
const CORP = "ww-synthetic-never-called",
  AGENT = "1",
  MAX_BYTES = 65536;
const PRIVATE_PATHS = Object.freeze({
  "/v1/models": "models",
  "/api/client/configuration": "configuration",
  "/api/client/entitlement": "entitlement",
  "/api/client/usage": "usage",
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
const goodId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(value);
const reject = (code) =>
  Object.assign(Error("Two organization fixture rejected"), { code });
const need = (value, code) => {
  if (!value) throw reject(code);
};
function originOnly(value) {
  need(
    typeof value === "string" &&
      /^https:\/\/127\.0\.0\.1:\d{1,5}$/u.test(value),
    "origin",
  );
  const parsed = new URL(value);
  need(
    parsed.origin === value &&
      +parsed.port > 0 &&
      +parsed.port <= 65535 &&
      parsed.port !== "3000",
    "origin",
  );
  return value;
}
function bearerHash(value) {
  if (
    typeof value !== "string" ||
    !/^Bearer [A-Za-z0-9_-]{16,256}$/u.test(value)
  )
    return null;
  return digest(value.slice(7));
}
function json(payload) {
  need(
    typeof payload === "string" && Buffer.byteLength(payload) <= MAX_BYTES,
    "payload",
  );
  try {
    const value = JSON.parse(payload);
    need(
      value && typeof value === "object" && !Array.isArray(value),
      "payload",
    );
    return value;
  } catch {
    throw reject("payload");
  }
}
function callbackHttp(url, ca, signal) {
  return new Promise((resolve, failed) => {
    const req = request(
      url,
      { method: "GET", ca, rejectUnauthorized: true, signal },
      (res) => {
        res.on("error", failed);
        res.on("aborted", () => failed(reject("callback_aborted")));
        res.on("end", () => resolve(res.statusCode));
        res.resume();
      },
    );
    req.on("error", failed);
    req.end();
  });
}
export function twoOrganizationModeEnabled(
  experience,
  workflow,
  flag,
  singleFlag,
  viewerFlag,
  fileFlag,
  usageFlag,
) {
  if (flag === undefined) return false;
  need(
    flag === "controlled" &&
      experience === "enabled" &&
      workflow === undefined &&
      singleFlag === undefined &&
      viewerFlag === undefined &&
      fileFlag === undefined &&
      usageFlag === undefined,
    "mode",
  );
  return true;
}
export function twoOrganizationExecutionModeEnabled(dualLogin, flag) {
  if (flag === undefined) return false;
  need(dualLogin === true && flag === "controlled", "execution-mode");
  return true;
}
export function twoOrganizationPublicConfig(
  origin,
  ids,
  makePublicConfig,
  parseConfig,
) {
  originOnly(origin);
  need(
    goodId(ids.A) &&
      goodId(ids.B) &&
      ids.A !== ids.B &&
      typeof makePublicConfig === "function" &&
      typeof parseConfig === "function",
    "configuration",
  );
  const a = makePublicConfig(origin, ids.A),
    b = makePublicConfig(origin, ids.B);
  const raw = {
    ...a,
    defaultOrgId: ids.A,
    organizations: [
      { ...a.organizations[0], label: TWO_ORG_PROFILES.A.label },
      { ...b.organizations[0], label: TWO_ORG_PROFILES.B.label },
    ],
  };
  const parsed = parseConfig(raw);
  need(
    parsed.defaultOrgId === ids.A &&
      parsed.organizations.length === 2 &&
      parsed.organizations[0].orgId === ids.A &&
      parsed.organizations[1].orgId === ids.B,
    "configuration",
  );
  return parsed;
}

/** Two test slots, no production identity owner. No IO until seed/callback is explicitly called. */
export function createTwoOrganizationAuth({
  origin,
  nonce,
  makeHold,
  now = Date.now,
  sendCallback = callbackHttp,
}) {
  originOnly(origin);
  need(
    typeof nonce === "string" &&
      /^[A-Za-z0-9_-]{32,128}$/u.test(nonce) &&
      typeof makeHold === "function",
    "binding",
  );
  const slots = {},
    order = ["A", "B"];
  let active = 0,
    seeded = false,
    disposed = false,
    failed = null,
    ca,
    logoutAOwnerMatched = false;
  let retiredDenied = 0;
  const safeFailures = new Set([
    "binding",
    "callback_once",
    "callback_result",
    "idp_binding",
    "directory_disabled",
    "attempt_slot",
    "attempt_binding",
    "claim_slot",
    "claim_owner",
    "claim_replay",
    "retired_guest",
    "guest_owner_changed",
    "logout_owner",
    "host_read_status",
    "host_read_before_me",
    "me_owner",
    "payload",
    "nonce",
    "guest_before_attempt",
    "observer_failed",
    "guest_binding",
    "sso_binding",
    "sso_url",
    "attempt_replay",
    "claim_binding",
    "pending_response",
    "claim_delivery",
    "callback_not_ready",
    "guest_closed_before_claim",
    "auth_without_claim",
    "request_binding",
    "response_limit",
    "response_invalid",
  ]);
  const fail = (code) => {
    failed ??= safeFailures.has(code) ? code : "contract_rejected";
    for (const slot of Object.values(slots)) slot.hold?.abort();
    return reject(code);
  };
  const usable = () => {
    if (disposed || failed) throw reject("stopped");
  };
  const current = () => {
    usable();
    need(seeded, "unseeded");
    return slots[order[active]];
  };
  const scopeMessage = (message) => {
    need(message?.nonce === nonce, "nonce");
    return message;
  };
  async function complete(slot) {
    usable();
    need(
      current() === slot &&
        slot.pending &&
        slot.callbackCount === 0 &&
        slot.identityCount === 0 &&
        slot.expiresAt > now(),
      "callback_once",
    );
    slot.callbackCount++;
    slot.completing = true;
    const url = new URL("/api/auth/wecom/callback", origin);
    url.searchParams.set("state", slot.pending);
    url.searchParams.set("code", slot.code);
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 10000);
    slot.abort = abort;
    try {
      need(
        (await sendCallback(url, ca, abort.signal)) === 200 &&
          slot.identityCount === 1,
        "callback_result",
      );
    } catch {
      throw fail("callback_result");
    } finally {
      clearTimeout(timer);
      slot.completing = false;
      slot.abort = undefined;
      slot.code = undefined;
    }
  }
  const provider = {
    async identity(config, credential, code) {
      const s = current();
      if (
        !s.completing ||
        s.identityCount !== 0 ||
        config?.tenant_id !== s.tenantId ||
        config?.corp_id !== CORP ||
        config?.agent_id !== AGENT ||
        config?.credential_id !== s.credentialId ||
        credential !== s.secret ||
        code !== s.code
      )
        throw fail("idp_binding");
      s.identityCount++;
      return s.externalId;
    },
    async directory() {
      throw fail("directory_disabled");
    },
  };
  async function seed({ A, B, certificate }) {
    usable();
    need(
      !seeded &&
        A &&
        B &&
        goodId(A.tenantId) &&
        goodId(B.tenantId) &&
        A.tenantId !== B.tenantId &&
        typeof A.api === "function" &&
        typeof B.api === "function",
      "seed",
    );
    ca = certificate;
    for (const key of order) {
      const setup = key === "A" ? A : B,
        profile = TWO_ORG_PROFILES[key];
      const secret = randomBytes(24).toString("hex"),
        code = randomBytes(24).toString("hex"),
        p = `/api/tenants/${setup.tenantId}`;
      const credential = await setup.api(p + "/credentials", "POST", {
        name: `G04k IdP ${key}`,
        value: secret,
      });
      need(goodId(credential?.id), "seed_credential");
      await setup.api(p + "/wecom", "PUT", {
        corpId: CORP,
        agentId: AGENT,
        credentialId: credential.id,
      });
      const department = await setup.api(p + "/departments", "POST", {
        name: profile.department,
      });
      need(goodId(department?.id), "seed_department");
      const member = await setup.api(p + "/members", "POST", {
        email: profile.email,
        name: profile.name,
        password: randomBytes(24).toString("hex"),
        role: "member",
        seat: true,
        departmentId: department.id,
      });
      need(goodId(member?.id), "seed_member");
      await setup.api(`${p}/members/${member.id}/wecom`, "PUT", {
        externalId: profile.externalId,
      });
      const listed = await setup.api(
        p + "/members?q=" + encodeURIComponent(profile.email),
      );
      const rows = listed.items?.filter(
        (item) =>
          item.id === member.id &&
          item.email === profile.email &&
          item.name === profile.name &&
          item.role === "member" &&
          item.status === "active" &&
          [true, 1].includes(item.seat) &&
          item.external_id === profile.externalId &&
          item.department_id === department.id,
      );
      need(rows?.length === 1, "seed_member_readback");
      const slot = {
        key,
        tenantId: setup.tenantId,
        memberId: member.id,
        departmentId: department.id,
        email: profile.email,
        externalId: profile.externalId,
        credentialId: credential.id,
        secret,
        code,
        pending: null,
        expiresAt: 0,
        attemptCount: 0,
        callbackCount: 0,
        identityCount: 0,
        completing: false,
        claimHash: null,
        meMatched: false,
        logoutMatched: false,
        hostReads: {
          me: 0,
          models: 0,
          configuration: 0,
          entitlement: 0,
          usage: 0,
        },
      };
      slot.hold = makeHold({
        origin,
        tenantId: slot.tenantId,
        nonce,
        now,
        completeBackend: () => complete(slot),
      });
      slots[key] = slot;
    }
    need(
      slots.A.memberId !== slots.B.memberId &&
        slots.A.credentialId !== slots.B.credentialId &&
        slots.A.email !== slots.B.email &&
        slots.A.externalId !== slots.B.externalId &&
        slots.A.code !== slots.B.code,
      "seed_distinct",
    );
    seeded = true;
    return Object.fromEntries(
      order.map((key) => [
        key,
        {
          organizationId: slots[key].tenantId,
          memberId: slots[key].memberId,
          departmentId: slots[key].departmentId,
          ...TWO_ORG_PROFILES[key],
        },
      ]),
    );
  }
  function observeResponse(message) {
    if (!seeded || disposed || failed) return false;
    const { path, status, payload, method } = message;
    const s = current();
    try {
      if (
        method === "POST" &&
        path === "/api/auth/wecom/attempts" &&
        status === 201
      ) {
        need(
          message.requestTenantId === s.tenantId &&
            s.attemptCount === 0 &&
            (s.key === "A" || logoutAOwnerMatched),
          "attempt_slot",
        );
        const body = json(payload);
        need(
          goodId(body.id) &&
            body.id !== slots.A.pending &&
            typeof body.proof === "string" &&
            body.proof.length > 0,
          "attempt_binding",
        );
        // Original hold validates the exact original URL/state/Corp/agent/callback; no DTO rewriting.
        s.hold.observeResponse({ path, status, payload });
        s.pending = body.id;
        s.expiresAt = body.expiresAt;
        s.attemptCount++;
        return true;
      }
      if (
        method === "POST" &&
        /^\/api\/auth\/wecom\/attempts\/[^/]+\/claim$/u.test(path)
      ) {
        if (path !== `/api/auth/wecom/attempts/${s.pending}/claim`) {
          if (
            status !== 200 &&
            path === `/api/auth/wecom/attempts/${slots.A.pending}/claim` &&
            slots.A.logoutMatched
          ) {
            retiredDenied++;
            return false;
          }
          throw reject("claim_slot");
        }
        const body = status === 200 ? json(payload) : null;
        if (body?.status === "authorized")
          need(s.claimHash === null, "claim_replay");
        s.hold.observeResponse({ path, status, payload });
        if (body?.status === "authorized") {
          need(
            body.tenantId === s.tenantId &&
              typeof body.token === "string" &&
              /^[A-Za-z0-9_-]{16,256}$/u.test(body.token),
            "claim_owner",
          );
          s.claimHash = digest(body.token);
        }
        return true;
      }
      const hash = bearerHash(message.authorization);
      if (method === "POST" && path === "/api/auth/logout" && status === 204) {
        if (hash !== slots.A.claimHash || !hash) return false; // An admin/control-plane logout is not evidence.
        need(
          active === 0 &&
            slots.A.meMatched &&
            slots.A.hold.safeStatus().guardSatisfied &&
            !logoutAOwnerMatched,
          "logout_owner",
        );
        logoutAOwnerMatched = slots.A.logoutMatched = true;
        active = 1;
        return true;
      }
      if (
        method === "GET" &&
        (path === "/api/auth/me" || Object.hasOwn(PRIVATE_PATHS, path))
      ) {
        if (
          slots.A.logoutMatched &&
          hash &&
          hash === slots.A.claimHash &&
          status !== 200
        ) {
          retiredDenied++;
          return false;
        }
        if (!hash || hash !== s.claimHash) return false; // Never count admin reads as the Host's claimed session.
        need(status === 200, "host_read_status");
        const body = json(payload);
        if (path === "/api/auth/me") {
          need(
            body.user?.id === s.memberId &&
              body.user?.email === s.email &&
              body.tenant?.id === s.tenantId &&
              body.role === "member" &&
              body.seat === true &&
              body.kind === "session",
            "me_owner",
          );
          s.meMatched = true;
          s.hostReads.me++;
        } else {
          need(s.meMatched, "host_read_before_me");
          s.hostReads[PRIVATE_PATHS[path]]++;
        }
        return true;
      }
      return false;
    } catch (error) {
      throw fail(error?.code ?? "observation");
    }
  }
  const hold = {
    observeResponse,
    bindGuest(message) {
      try {
        const s = current();
        need(s.pending, "guest_before_attempt");
        scopeMessage(message);
        if (s.key === "B") {
          need(
            slots.A.guest && message.ownerId === slots.A.guest.ownerId,
            "guest_owner_changed",
          );
          need(
            message.webContentsId !== slots.A.guest.webContentsId,
            "retired_guest",
          );
        }
        s.hold.bindGuest(message);
        s.guest = {
          ownerId: message.ownerId,
          webContentsId: message.webContentsId,
        };
      } catch (e) {
        throw fail(e.code ?? "guest");
      }
    },
    captureSso(message, callback) {
      try {
        current().hold.captureSso(scopeMessage(message), callback);
      } catch (e) {
        throw fail(e.code ?? "sso");
      }
    },
    guestClosed(message) {
      try {
        current().hold.guestClosed(scopeMessage(message));
      } catch (e) {
        throw fail(e.code ?? "guest_closed");
      }
    },
    observePublicAuthenticated(message) {
      try {
        current().hold.observePublicAuthenticated(scopeMessage(message));
      } catch (e) {
        throw fail(e.code ?? "authenticated");
      }
    },
    completeCallback() {
      throw reject("callback_scope_required");
    },
    safeStatus() {
      const s = slots[order[active]],
        h = s?.hold.safeStatus();
      return {
        slot: order[active],
        held: h?.held ?? false,
        pendingObserved: h?.pendingObserved ?? false,
        callbackCount: h?.callbackCount ?? 0,
        failed: failed ?? h?.failed ?? null,
        disposed: disposed || (h?.disposed ?? false),
      };
    },
    abort() {
      fail("observer_failed");
    },
    dispose,
  };
  function safeStatus() {
    return {
      schema: "g04k-dual-auth-v1",
      seeded,
      disposed,
      failed,
      activeSlot: order[active],
      logoutAOwnerMatched,
      callbackCount: Object.values(slots).reduce(
        (sum, s) => sum + s.callbackCount,
        0,
      ),
      retiredDenied,
      slots: Object.fromEntries(
        order.map((key) => {
          const s = slots[key];
          return [
            key,
            s
              ? {
                  ...s.hold.safeStatus(),
                  attemptCount: s.attemptCount,
                  idpCallbackCount: s.callbackCount,
                  identityCount: s.identityCount,
                  meMatched: s.meMatched,
                  logoutMatched: s.logoutMatched,
                  hostReads: { ...s.hostReads },
                }
              : null,
          ];
        }),
      ),
    };
  }
  function dispose() {
    disposed = true;
    for (const s of Object.values(slots)) {
      s.abort?.abort();
      s.hold.dispose();
      s.secret = s.code = s.claimHash = undefined;
    }
    nonce = undefined;
    ca = undefined;
  }
  return {
    provider,
    seed,
    observeResponse,
    hold,
    safeStatus,
    dispose,
    completeCallback(slot) {
      need(slot === "A" || slot === "B", "callback_slot");
      need(current().key === slot, "callback_slot");
      return current().hold.completeCallback();
    },
  };
}

export function assertTwoOrganizationCommand(command, legacy) {
  need(
    command &&
      typeof command === "object" &&
      !Array.isArray(command) &&
      typeof legacy === "function",
    "command",
  );
  if (
    ["completeTwoOrganizationA", "completeTwoOrganizationB"].includes(
      command.op,
    )
  ) {
    need(Object.keys(command).length === 1, "command");
    return;
  }
  need(
    [
      "launch",
      "stopNative",
      "openWorkspace",
      "experienceSnapshot",
      "primaryLoginStatus",
    ].includes(command.op),
    "command",
  );
  legacy(command);
}

/** Explicit synthetic ledger baseline only; it creates no trace, gateway call or model request. */
export function seedTwoOrganizationLedgerBaseline(
  db,
  metadata,
  models,
  billingPeriod,
  at = Date.now(),
) {
  const result = {};
  for (const key of ["A", "B"]) {
    const m = metadata[key],
      profile = TWO_ORG_PROFILES[key];
    const subscription = db.get(
      "SELECT starts_at,metering FROM subscriptions WHERE tenant_id=?",
      m.organizationId,
    );
    need(subscription && goodId(m.memberId) && goodId(models[key]), "baseline");
    const period = billingPeriod(
      at,
      subscription.starts_at,
      subscription.metering,
    );
    db.run(
      "INSERT INTO ledger(id,tenant_id,request_key,user_id,department_id,application,model_id,period,amount,reserved,status,input_tokens,output_tokens,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,'settled',0,0,?,?)",
      `g04k-baseline-${key}`,
      m.organizationId,
      `g04k-synthetic-baseline-${key}`,
      m.memberId,
      m.departmentId,
      "uwork",
      models[key],
      period,
      profile.creditBaseline,
      profile.creditBaseline,
      at,
      at,
    );
    result[key] = {
      rows: 1,
      amount: profile.creditBaseline,
      traceRows: 0,
      requestAssociationClaimed: false,
      syntheticBaselineOnly: true,
    };
  }
  return result;
}
export function projectTwoOrganizationBaseline(db, metadata) {
  const slots = {};
  for (const key of ["A", "B"]) {
    const m = metadata[key],
      expected = TWO_ORG_PROFILES[key].creditBaseline;
    const rows = db.all(
      "SELECT user_id,status,amount,input_tokens,output_tokens,request_key FROM ledger WHERE tenant_id=?",
      m.organizationId,
    );
    const traces = db.get(
      "SELECT count(*) n FROM traces WHERE tenant_id=?",
      m.organizationId,
    ).n;
    const calls = db.get(
      "SELECT count(*) n FROM gateway_calls WHERE tenant_id=?",
      m.organizationId,
    ).n;
    slots[key] = {
      ledgerRows: rows.length,
      allBelongExpectedMember: rows.every((r) => r.user_id === m.memberId),
      baselineOnly:
        rows.length === 1 &&
        rows[0].request_key === `g04k-synthetic-baseline-${key}` &&
        rows[0].status === "settled" &&
        rows[0].amount === expected &&
        rows[0].input_tokens === 0 &&
        rows[0].output_tokens === 0,
      amount: rows.reduce((n, r) => n + r.amount, 0),
      traceRows: traces,
      gatewayCallRows: calls,
    };
  }
  return {
    schema: "g04k-baseline-projection-v1",
    syntheticBaselineOnly: true,
    newCallsClaimed: false,
    slots,
  };
}
