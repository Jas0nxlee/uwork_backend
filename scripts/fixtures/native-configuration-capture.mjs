/** Pure, test-only projections. No environment, filesystem, network or clock access. */
export const MAX_NATIVE_CONFIGURATION_BYTES = 512 * 1024;
const MAX_RECEIPTS = 128;
const MAX_TIME_MS = 8_640_000_000_000_000;
const groups = new Set([
  "core",
  "settings",
  "workbench",
  "extensions",
  "automation",
  "account",
]);
const outcomes = new Set([
  "complete",
  "invalid_json",
  "body_limit",
  "upstream_aborted",
  "upstream_error",
  "downstream_closed",
]);
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, min, max) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const time = (value) => (integer(value, 0, MAX_TIME_MS) ? value : null);
const keys = (value, expected) =>
  record(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

export function isNativeConfigurationWitnessEnabled(experienceMode, flag) {
  return experienceMode === "enabled" && flag === "enabled";
}

function projectConfiguration(body) {
  const desktop = body?.configuration?.desktop;
  const context = desktop?.desktopContextPrompt;
  const trace = desktop?.rendererActionTrace;
  if (
    !keys(desktop, ["desktopContextPrompt", "rendererActionTrace"]) ||
    !keys(context, ["enabled"]) ||
    typeof context.enabled !== "boolean" ||
    !keys(trace, ["enabled", "sampleRatio", "enabledGroups"]) ||
    typeof trace.enabled !== "boolean" ||
    !Number.isFinite(trace.sampleRatio) ||
    trace.sampleRatio < 0 ||
    trace.sampleRatio > 0.2 ||
    !Array.isArray(trace.enabledGroups) ||
    trace.enabledGroups.length > 6 ||
    !trace.enabledGroups.every((group) => groups.has(group)) ||
    new Set(trace.enabledGroups).size !== trace.enabledGroups.length ||
    !integer(body?.versions?.desktop, 0, Number.MAX_SAFE_INTEGER) ||
    typeof body?.fetchedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.fetchedAt) ||
    !Number.isFinite(Date.parse(body.fetchedAt)) ||
    new Date(body.fetchedAt).toISOString() !== body.fetchedAt
  )
    return undefined;
  return {
    desktopVersion: body.versions.desktop,
    desktopContextEnabled: context.enabled,
    traceEnabled: trace.enabled,
    traceSampleRatio: trace.sampleRatio,
    traceEnabledGroups: [...trace.enabledGroups],
    fetchedAt: body.fetchedAt,
  };
}

export function projectNativeConfigurationReceipt(sequence, input) {
  const safe = {
    sequence: integer(sequence, 1, MAX_RECEIPTS) ? sequence : null,
    status: "invalid_metadata",
    requestStartedAtMs: null,
    upstreamEndedAtMs: null,
    responseFinishedAtMs: null,
    observedAtMs: null,
    upstreamEnded: false,
    downstreamFinished: false,
    clientRemoteAddress: null,
    clientRemotePort: null,
    replyStatus: null,
  };
  try {
    safe.requestStartedAtMs = time(input.requestStartedAtMs);
    safe.upstreamEndedAtMs = time(input.upstreamEndedAtMs);
    safe.responseFinishedAtMs = time(input.responseFinishedAtMs);
    safe.observedAtMs = time(input.observedAtMs);
    safe.upstreamEnded = input.upstreamEnded === true;
    safe.downstreamFinished = input.downstreamFinished === true;
    safe.clientRemoteAddress =
      input.clientRemoteAddress === "127.0.0.1" ||
      input.clientRemoteAddress === "::ffff:127.0.0.1"
        ? "127.0.0.1"
        : null;
    safe.clientRemotePort = integer(input.clientRemotePort, 1, 65535)
      ? input.clientRemotePort
      : null;
    safe.replyStatus = integer(input.replyStatus, 100, 599)
      ? input.replyStatus
      : null;
    if (
      safe.sequence === null ||
      safe.requestStartedAtMs === null ||
      safe.observedAtMs === null ||
      safe.clientRemoteAddress === null ||
      safe.clientRemotePort === null ||
      safe.replyStatus === null ||
      typeof input.upstreamEnded !== "boolean" ||
      typeof input.downstreamFinished !== "boolean" ||
      typeof input.closedBeforeFinish !== "boolean" ||
      !integer(input.bodyBytes, 0, Number.MAX_SAFE_INTEGER) ||
      !outcomes.has(input.outcome) ||
      (input.upstreamEndedAtMs !== null && safe.upstreamEndedAtMs === null) ||
      (input.responseFinishedAtMs !== null &&
        safe.responseFinishedAtMs === null) ||
      safe.upstreamEnded !== (safe.upstreamEndedAtMs !== null) ||
      safe.downstreamFinished !== (safe.responseFinishedAtMs !== null) ||
      safe.observedAtMs < safe.requestStartedAtMs ||
      (safe.upstreamEndedAtMs !== null &&
        (safe.upstreamEndedAtMs < safe.requestStartedAtMs ||
          safe.upstreamEndedAtMs > safe.observedAtMs)) ||
      (safe.responseFinishedAtMs !== null &&
        (safe.responseFinishedAtMs <
          (safe.upstreamEndedAtMs ?? safe.requestStartedAtMs) ||
          safe.responseFinishedAtMs > safe.observedAtMs))
    )
      return safe;
    if (input.bodyBytes > MAX_NATIVE_CONFIGURATION_BYTES)
      return { ...safe, status: "body_limit" };
    if (input.outcome !== "complete") return { ...safe, status: input.outcome };
    if (
      safe.replyStatus !== 200 ||
      !safe.upstreamEnded ||
      !safe.downstreamFinished ||
      input.closedBeforeFinish
    )
      return { ...safe, status: "unconfirmed" };
    const configuration = projectConfiguration(input.body);
    return configuration
      ? { ...safe, status: "sent", ...configuration }
      : { ...safe, status: "invalid_configuration" };
  } catch {
    return { ...safe, status: "invalid_configuration" };
  }
}

/** Reservations bound in-flight observers as well as completed receipts. */
export function createNativeConfigurationCapture({
  enabled = false,
  maxReceipts = MAX_RECEIPTS,
} = {}) {
  if (enabled === true && !integer(maxReceipts, 1, MAX_RECEIPTS))
    throw Error("Invalid witness receipt limit");
  const receipts = [];
  let reserved = 0,
    completed = 0,
    observed = 0,
    dropped = 0,
    saturated = false;
  const increment = (value) => {
    if (value === Number.MAX_SAFE_INTEGER) {
      saturated = true;
      return value;
    }
    return value + 1;
  };
  return {
    reserve() {
      if (enabled !== true) return undefined;
      observed = increment(observed);
      if (reserved === maxReceipts) {
        dropped = increment(dropped);
        return undefined;
      }
      const sequence = ++reserved;
      let finished = false;
      return (input) => {
        if (finished) return;
        finished = true;
        receipts.push(projectNativeConfigurationReceipt(sequence, input));
        completed++;
      };
    },
    snapshot() {
      return {
        configurationReceipts: receipts
          .toSorted((a, b) => a.sequence - b.sequence)
          .map((receipt) => ({
            ...receipt,
            ...(receipt.traceEnabledGroups
              ? { traceEnabledGroups: [...receipt.traceEnabledGroups] }
              : {}),
          })),
        configurationWitnessMetadata: {
          enabled: enabled === true,
          maxBodyBytes: MAX_NATIVE_CONFIGURATION_BYTES,
          maxReceipts: enabled === true ? maxReceipts : MAX_RECEIPTS,
          observedRequests: observed,
          reservedReceipts: reserved,
          pendingReceipts: reserved - completed,
          droppedReceipts: dropped,
          countSaturated: saturated,
        },
      };
    },
  };
}

function nanoseconds(value) {
  let number;
  if (typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value))
    number = BigInt(value);
  else if (
    record(value) &&
    integer(value.low, -2147483648, 2147483647) &&
    integer(value.high, -2147483648, 2147483647) &&
    value.unsigned === true
  )
    number = (BigInt(value.high >>> 0) << 32n) | BigInt(value.low >>> 0);
  return number !== undefined && number > 0n && number <= 18446744073709551615n
    ? number
    : undefined;
}

export function projectNativeTraceLifecycle(span) {
  try {
    const attributes = span?.attributes;
    if (!Array.isArray(attributes) || attributes.length > 128)
      return { status: "invalid_action_id" };
    const ids = attributes.filter((entry) => entry?.key === "action_id");
    const actionId = ids[0]?.value?.stringValue;
    if (
      ids.length !== 1 ||
      typeof actionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        actionId,
      )
    )
      return { status: "invalid_action_id" };
    const start = nanoseconds(span.startTimeUnixNano),
      end = nanoseconds(span.endTimeUnixNano);
    if (start === undefined || end === undefined || end < start)
      return { status: "invalid_span_time" };
    return {
      status: "valid",
      actionId,
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
    };
  } catch {
    return { status: "invalid_span_time" };
  }
}

export function projectNativeTraceRequestLifecycle(input) {
  const safe = {
    status: "invalid_timing",
    requestStartedAtMs: null,
    bodyEndedAtMs: null,
    responseFinishedAtMs: null,
    downstreamFinished: false,
  };
  try {
    safe.requestStartedAtMs = time(input.requestStartedAtMs);
    safe.bodyEndedAtMs = time(input.bodyEndedAtMs);
    safe.responseFinishedAtMs = time(input.responseFinishedAtMs);
    safe.downstreamFinished = input.downstreamFinished === true;
    if (
      safe.requestStartedAtMs === null ||
      safe.bodyEndedAtMs === null ||
      safe.bodyEndedAtMs < safe.requestStartedAtMs ||
      typeof input.downstreamFinished !== "boolean" ||
      typeof input.closedBeforeFinish !== "boolean" ||
      (input.responseFinishedAtMs !== null &&
        safe.responseFinishedAtMs === null) ||
      safe.downstreamFinished !== (safe.responseFinishedAtMs !== null) ||
      (safe.responseFinishedAtMs !== null &&
        safe.responseFinishedAtMs < safe.bodyEndedAtMs)
    )
      return safe;
    return {
      ...safe,
      status:
        safe.downstreamFinished && !input.closedBeforeFinish
          ? "sent"
          : "unconfirmed",
    };
  } catch {
    return safe;
  }
}
