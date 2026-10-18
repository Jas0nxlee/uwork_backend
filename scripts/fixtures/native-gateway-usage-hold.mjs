const commands = new Set([
  "armGatewayUsageHold",
  "gatewayUsageHoldStatus",
  "releaseGatewayUsageHold",
  "disposeGatewayUsageHold",
]);
const reject = () => Error("NATIVE_GATEWAY_USAGE_HOLD_REJECTED");

export function gatewayUsageHoldModeEnabled(
  experience,
  conflicting,
  flag,
  name,
) {
  if (flag === undefined) return false;
  if (
    flag !== "controlled" ||
    experience !== "enabled" ||
    conflicting ||
    typeof name !== "string" ||
    !/^client-native-gateway-usage-[a-z0-9-]+$/.test(name)
  )
    throw reject();
  return true;
}

export function isNativeGatewayUsageHoldCommand(value) {
  return value !== null && typeof value === "object" && commands.has(value.op);
}

/** 只暂停本轮真实响应；不读正文/凭据，不创建计时器、HTTP 或身份 owner。 */
export function createNativeGatewayUsageHold() {
  let used = false,
    entry = null;
  const state = {
    schema: "native-gateway-usage-hold-v1",
    phase: "disarmed",
    matchedResponses: 0,
    oneShotId: 1,
    oneShotCount: 0,
    requestStartedAtMs: null,
    replyHeldAtMs: null,
    duplicateResponse: false,
    response200: false,
    releaseRequested: false,
    deliveryStarted: false,
    downstreamFinished: false,
    downstreamClosed: false,
    upstreamAborted: false,
    transportError: false,
    disposed: false,
    closedAtMs: null,
  };
  const status = () => ({
    ...state,
    armed: state.phase === "armed",
    held: state.phase === "held",
  });
  const destroy = (stream) => {
    try {
      stream.destroy();
    } catch {
      state.transportError = true;
    }
  };
  const retire = (phase, closeDownstream = false) => {
    const current = entry;
    if (!current) return;
    entry = null;
    if (!state.disposed) state.phase = phase;
    destroy(current.reply);
    if (closeDownstream) destroy(current.res);
  };
  const dispose = () => {
    if (!state.disposed) {
      state.disposed = true;
      state.phase = "disposed";
      retire("disposed", true);
    }
    return status();
  };
  const release = () => {
    if (state.releaseRequested || state.disposed) return status();
    if (!used || state.phase === "armed") return status();
    state.releaseRequested = true;
    const current = entry;
    if (!current) return status(); // 原 owner 已 abort：只保留 drop，不重放。
    if (current.res.destroyed || current.reply.destroyed) {
      retire("aborted", true);
      return status();
    }
    state.phase = "released";
    state.deliveryStarted = true;
    try {
      current.deliver();
    } catch {
      state.transportError = true;
      retire("aborted", true);
    }
    return status();
  };
  return {
    hold(req, res, reply, deliver, requestStartedAtMs) {
      if (
        !used ||
        state.disposed ||
        req.method !== "GET" ||
        req.url !== "/api/client/usage?period=month&metric=requests"
      )
        return false;
      state.matchedResponses = Math.min(2, state.matchedResponses + 1);
      if (state.matchedResponses > 1) {
        state.duplicateResponse = true;
        return false;
      }
      if (state.phase !== "armed") return false;
      state.response200 = reply.statusCode === 200;
      if (!state.response200) {
        state.phase = "response_not_200";
        return false;
      }
      if (res.destroyed || reply.destroyed) {
        state.phase = "closed_before_hold";
        return false;
      }
      const replyHeldAtMs = Date.now();
      if (
        !Number.isSafeInteger(requestStartedAtMs) ||
        requestStartedAtMs <= 0 ||
        requestStartedAtMs > replyHeldAtMs
      ) {
        state.phase = "request_time_invalid";
        return false;
      }
      const current = { res, reply, deliver };
      entry = current;
      state.phase = "held";
      state.requestStartedAtMs = requestStartedAtMs;
      state.replyHeldAtMs = replyHeldAtMs;
      // 默认路径不安装监听；只为这一个已暂停响应吸收 error/abort，避免取消成为未处理异常。
      const error = () => {
        state.transportError = true;
        if (entry === current) retire("aborted", true);
      };
      reply.on("error", error);
      res.on("error", error);
      reply.once("aborted", () => {
        state.upstreamAborted = true;
        if (entry === current) retire("aborted", true);
      });
      reply.once("close", () => {
        if (reply.aborted) state.upstreamAborted = true;
        if (!reply.readableEnded && !reply.complete && entry === current)
          retire("aborted", true);
      });
      res.once("close", () => {
        state.downstreamClosed = true;
        state.closedAtMs = Date.now();
        if (!res.writableFinished && entry === current) retire("aborted");
      });
      res.once("finish", () => {
        state.downstreamFinished = true;
        if (!state.disposed) state.phase = "finished";
        if (entry === current) entry = null;
      });
      reply.pause();
      return true;
    },
    dispose,
    command(value) {
      if (
        !isNativeGatewayUsageHoldCommand(value) ||
        Object.keys(value).length !== 1 ||
        !Object.hasOwn(value, "op")
      )
        throw reject();
      if (value.op === "armGatewayUsageHold") {
        if (used || state.disposed) throw reject();
        used = true;
        state.oneShotCount = 1;
        state.phase = "armed";
      } else if (value.op === "releaseGatewayUsageHold") return release();
      else if (value.op === "disposeGatewayUsageHold") return dispose();
      return status();
    },
  };
}
