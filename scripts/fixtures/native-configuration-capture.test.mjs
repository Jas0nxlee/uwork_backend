import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  MAX_NATIVE_CONFIGURATION_BYTES,
  createNativeConfigurationCapture,
  isNativeConfigurationWitnessEnabled,
  projectNativeConfigurationReceipt,
  projectNativeTraceLifecycle,
  projectNativeTraceRequestLifecycle,
} from "./native-configuration-capture.mjs";
import { createNativeTraceCapture } from "./native-trace-capture.mjs";

const secret = "DO_NOT_PERSIST_PRIVATE_CREDENTIAL";
const actionId = "c663fe2b-a71e-456b-820f-57f02c9566c1";
function configuration() {
  return {
    tenantId: secret,
    versions: { desktop: 17, menus: 2 },
    configuration: {
      desktop: {
        desktopContextPrompt: { enabled: true },
        rendererActionTrace: {
          enabled: false,
          sampleRatio: 0.2,
          enabledGroups: ["settings", "core"],
        },
      },
      model: { token: secret },
    },
    security: { secret },
    fetchedAt: 1792285323456,
  };
}
function receipt(overrides = {}) {
  return {
    requestStartedAtMs: 1000,
    upstreamEndedAtMs: 1010,
    responseFinishedAtMs: 1011,
    observedAtMs: 1012,
    upstreamEnded: true,
    downstreamFinished: true,
    closedBeforeFinish: false,
    clientRemoteAddress: "127.0.0.1",
    clientRemotePort: 54321,
    replyStatus: 200,
    bodyBytes: 512,
    outcome: "complete",
    body: configuration(),
    ...overrides,
  };
}
function noSecret(value) {
  assert.equal(JSON.stringify(value).includes(secret), false);
}
function span(overrides = {}) {
  return {
    attributes: [
      { key: "action_id", value: { stringValue: actionId } },
      { key: "token", value: { stringValue: secret } },
    ],
    startTimeUnixNano: "1792285323456000000",
    endTimeUnixNano: "1792285323457000000",
    ...overrides,
  };
}

test("configuration witness requires both exact opt-ins", () => {
  assert.equal(isNativeConfigurationWitnessEnabled("enabled", "enabled"), true);
  for (const [experience, witness] of [
    [undefined, undefined],
    ["enabled", undefined],
    [undefined, "enabled"],
    [true, true],
    ["enabled", "true"],
  ]) {
    assert.equal(
      isNativeConfigurationWitnessEnabled(experience, witness),
      false,
    );
  }
  for (const enabled of [undefined, false, "enabled", 1]) {
    const capture = createNativeConfigurationCapture({ enabled });
    assert.equal(capture.reserve(), undefined);
    assert.equal(capture.snapshot().configurationReceipts.length, 0);
    assert.equal(
      capture.snapshot().configurationWitnessMetadata.observedRequests,
      0,
    );
  }
});

test("complete response projects only safe configuration fields", () => {
  const projected = projectNativeConfigurationReceipt(1, receipt());
  assert.deepEqual(projected, {
    sequence: 1,
    status: "sent",
    requestStartedAtMs: 1000,
    upstreamEndedAtMs: 1010,
    responseFinishedAtMs: 1011,
    observedAtMs: 1012,
    upstreamEnded: true,
    downstreamFinished: true,
    clientRemoteAddress: "127.0.0.1",
    clientRemotePort: 54321,
    replyStatus: 200,
    desktopVersion: 17,
    desktopContextEnabled: true,
    traceEnabled: false,
    traceSampleRatio: 0.2,
    traceEnabledGroups: ["settings", "core"],
    fetchedAt: 1792285323456,
  });
  noSecret(projected);
  const body = configuration();
  const detached = projectNativeConfigurationReceipt(2, receipt({ body }));
  body.configuration.desktop.rendererActionTrace.enabledGroups.push("account");
  assert.deepEqual(detached.traceEnabledGroups, ["settings", "core"]);
});

test("body end alone or early downstream close never proves configuration sent", () => {
  for (const input of [
    receipt({ downstreamFinished: false, responseFinishedAtMs: null }),
    receipt({
      outcome: "downstream_closed",
      downstreamFinished: false,
      responseFinishedAtMs: null,
      closedBeforeFinish: true,
    }),
    receipt({ closedBeforeFinish: true }),
    receipt({ upstreamEnded: false, upstreamEndedAtMs: null }),
  ]) {
    const projected = projectNativeConfigurationReceipt(1, input);
    assert.notEqual(projected.status, "sent");
    assert.equal(Object.hasOwn(projected, "desktopVersion"), false);
    noSecret(projected);
  }
});

test("parse, size and transport failures retain only fixed finite status", () => {
  for (const outcome of [
    "invalid_json",
    "body_limit",
    "upstream_aborted",
    "upstream_error",
    "downstream_closed",
  ]) {
    const projected = projectNativeConfigurationReceipt(
      1,
      receipt({ outcome, error: secret }),
    );
    assert.equal(projected.status, outcome);
    assert.equal(Object.hasOwn(projected, "desktopVersion"), false);
    noSecret(projected);
  }
  const oversized = projectNativeConfigurationReceipt(
    1,
    receipt({ bodyBytes: MAX_NATIVE_CONFIGURATION_BYTES + 1 }),
  );
  assert.equal(oversized.status, "body_limit");
  assert.equal(
    projectNativeConfigurationReceipt(1, receipt({ outcome: secret })).status,
    "invalid_metadata",
  );
  assert.equal(
    projectNativeConfigurationReceipt(1, receipt({ replyStatus: 304 })).status,
    "unconfirmed",
  );
});

test("desktop subtree, versions, ratio, groups and dates are strict and bounded", () => {
  const cases = [
    (body) => {
      delete body.configuration.desktop.desktopContextPrompt;
    },
    (body) => {
      body.configuration.desktop.credential = secret;
    },
    (body) => {
      body.configuration.desktop.desktopContextPrompt.token = secret;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.privateKey = secret;
    },
    (body) => {
      body.configuration.desktop.desktopContextPrompt.enabled = "true";
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.enabled = 0;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.sampleRatio = NaN;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.sampleRatio = Infinity;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.sampleRatio = -0.01;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.sampleRatio = 0.200001;
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.enabledGroups = [secret];
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.enabledGroups = [
        "core",
        "core",
      ];
    },
    (body) => {
      body.configuration.desktop.rendererActionTrace.enabledGroups =
        Array(7).fill("core");
    },
    (body) => {
      body.versions.desktop = -1;
    },
    (body) => {
      body.versions.desktop = Number.MAX_SAFE_INTEGER + 1;
    },
    (body) => {
      body.fetchedAt = "2026-02-30T00:00:00.000Z";
    },
    (body) => {
      body.fetchedAt = "2026-10-18T01:02:03.456Z";
    },
    (body) => {
      body.fetchedAt = "1792285323456";
    },
    (body) => {
      body.fetchedAt = NaN;
    },
    (body) => {
      body.fetchedAt = Infinity;
    },
    (body) => {
      body.fetchedAt = -1;
    },
    (body) => {
      body.fetchedAt = 0.5;
    },
    (body) => {
      body.fetchedAt = Number.MAX_SAFE_INTEGER + 1;
    },
    (body) => {
      delete body.fetchedAt;
    },
    (body) => {
      body.fetchedAt = {
        valueOf() {
          throw Error(secret);
        },
      };
    },
    (body) => {
      body.fetchedAt = secret.repeat(1000);
    },
  ];
  for (const mutate of cases) {
    const body = configuration();
    mutate(body);
    const projected = projectNativeConfigurationReceipt(1, receipt({ body }));
    assert.equal(projected.status, "invalid_configuration");
    assert.equal(Object.hasOwn(projected, "desktopVersion"), false);
    noSecret(projected);
  }
});

test("fetchedAt uses own numeric milliseconds and ignores sensitive prototype keys", () => {
  for (const fetchedAt of [0, Number.MAX_SAFE_INTEGER]) {
    const body = configuration();
    body.fetchedAt = fetchedAt;
    assert.equal(
      projectNativeConfigurationReceipt(1, receipt({ body })).fetchedAt,
      fetchedAt,
    );
  }
  const body = configuration();
  Object.defineProperty(body, "__proto__", {
    enumerable: true,
    value: { token: secret },
  });
  body.constructor = { token: secret };
  body.prototype = { token: secret };
  const safe = projectNativeConfigurationReceipt(1, receipt({ body }));
  assert.equal(safe.status, "sent");
  assert.equal(Object.hasOwn(safe, "__proto__"), false);
  assert.equal(Object.hasOwn(safe, "constructor"), false);
  noSecret(safe);
  const inherited = configuration();
  delete inherited.fetchedAt;
  Object.setPrototypeOf(inherited, { fetchedAt: 1792285323456, token: secret });
  const rejected = projectNativeConfigurationReceipt(
    1,
    receipt({ body: inherited }),
  );
  assert.equal(rejected.status, "invalid_configuration");
  noSecret(rejected);
  const nested = configuration();
  Object.defineProperty(nested.configuration.desktop, "__proto__", {
    enumerable: true,
    value: { token: secret },
  });
  const rejectedNested = projectNativeConfigurationReceipt(
    1,
    receipt({ body: nested }),
  );
  assert.equal(rejectedNested.status, "invalid_configuration");
  noSecret(rejectedNested);
});

test("invalid receipt metadata cannot leak unknown values or fabricate completion", () => {
  for (const override of [
    { requestStartedAtMs: NaN },
    { observedAtMs: Infinity },
    { responseFinishedAtMs: 1001 },
    { clientRemotePort: 0 },
    { clientRemotePort: 65536 },
    { clientRemoteAddress: secret },
    { clientRemoteAddress: "203.0.113.1" },
    { clientRemoteAddress: "::1" },
    { replyStatus: 600 },
    { bodyBytes: -1 },
    { upstreamEnded: "true" },
    { closedBeforeFinish: secret },
  ]) {
    const projected = projectNativeConfigurationReceipt(1, receipt(override));
    assert.equal(projected.status, "invalid_metadata");
    noSecret(projected);
  }
});

test("actual observed loopback address is normalized, never invented", () => {
  assert.equal(
    projectNativeConfigurationReceipt(
      1,
      receipt({ clientRemoteAddress: "::ffff:127.0.0.1" }),
    ).clientRemoteAddress,
    "127.0.0.1",
  );
  for (const clientRemoteAddress of [
    undefined,
    null,
    "127.0.0.2",
    "127.0.0.1 ",
    secret.repeat(1000),
  ]) {
    const projected = projectNativeConfigurationReceipt(
      1,
      receipt({ clientRemoteAddress }),
    );
    assert.equal(projected.status, "invalid_metadata");
    assert.equal(projected.clientRemoteAddress, null);
    noSecret(projected);
  }
});

test("receipt reservation bounds active plus completed observers and records drops", () => {
  const capture = createNativeConfigurationCapture({
    enabled: true,
    maxReceipts: 2,
  });
  const first = capture.reserve();
  const second = capture.reserve();
  assert.equal(capture.reserve(), undefined);
  assert.equal(
    capture.snapshot().configurationWitnessMetadata.pendingReceipts,
    2,
  );
  second(receipt());
  first(receipt());
  first(receipt({ body: secret }));
  const snapshot = capture.snapshot();
  assert.deepEqual(
    snapshot.configurationReceipts.map((value) => value.sequence),
    [1, 2],
  );
  assert.deepEqual(snapshot.configurationWitnessMetadata, {
    enabled: true,
    maxBodyBytes: 524288,
    maxReceipts: 2,
    observedRequests: 3,
    reservedReceipts: 2,
    pendingReceipts: 0,
    droppedReceipts: 1,
    countSaturated: false,
  });
  snapshot.configurationReceipts[0].traceEnabledGroups.push("account");
  assert.deepEqual(
    capture.snapshot().configurationReceipts[0].traceEnabledGroups,
    ["settings", "core"],
  );
  noSecret(snapshot);
  for (const maxReceipts of [0, 129, Infinity, "2"])
    assert.throws(
      () => createNativeConfigurationCapture({ enabled: true, maxReceipts }),
      /Invalid witness receipt limit/,
    );
});

test("trace lifecycle accepts canonical UUID and exact uint64 or protobuf Long times", () => {
  assert.deepEqual(projectNativeTraceLifecycle(span()), {
    status: "valid",
    actionId,
    startTimeUnixNano: "1792285323456000000",
    endTimeUnixNano: "1792285323457000000",
  });
  const long = { low: -1, high: -1, unsigned: true };
  assert.equal(
    projectNativeTraceLifecycle(
      span({ startTimeUnixNano: long, endTimeUnixNano: long }),
    ).endTimeUnixNano,
    "18446744073709551615",
  );
  noSecret(projectNativeTraceLifecycle(span()));
});

test("trace lifecycle rejects malformed, missing, duplicate, unsafe or oversized values", () => {
  for (const attributes of [
    [],
    [{ key: "action_id", value: { stringValue: secret } }],
    [{ key: "action_id", value: { stringValue: actionId.toUpperCase() } }],
    [...span().attributes, span().attributes[0]],
  ]) {
    const projected = projectNativeTraceLifecycle(span({ attributes }));
    assert.equal(projected.status, "invalid_action_id");
    noSecret(projected);
  }
  for (const startTimeUnixNano of [
    "0",
    "-1",
    "01",
    "1.5",
    "18446744073709551616",
    "9".repeat(10000),
    1792285323456000000,
    NaN,
    Infinity,
    { low: -1, high: -1, unsigned: false },
    { low: Infinity, high: 0, unsigned: true },
    {
      toString() {
        throw Error(secret);
      },
    },
  ]) {
    const projected = projectNativeTraceLifecycle(span({ startTimeUnixNano }));
    assert.equal(projected.status, "invalid_span_time");
    noSecret(projected);
  }
  assert.equal(
    projectNativeTraceLifecycle(span({ endTimeUnixNano: "1" })).status,
    "invalid_span_time",
  );
});

test("trace request timeline distinguishes body end and actual response finish", () => {
  const input = {
    requestStartedAtMs: 1000,
    bodyEndedAtMs: 1001,
    responseFinishedAtMs: 1002,
    downstreamFinished: true,
    closedBeforeFinish: false,
    token: secret,
  };
  assert.equal(projectNativeTraceRequestLifecycle(input).status, "sent");
  assert.equal(
    projectNativeTraceRequestLifecycle({
      ...input,
      downstreamFinished: false,
      responseFinishedAtMs: null,
    }).status,
    "unconfirmed",
  );
  assert.equal(
    projectNativeTraceRequestLifecycle({ ...input, closedBeforeFinish: true })
      .status,
    "unconfirmed",
  );
  assert.equal(
    projectNativeTraceRequestLifecycle({ ...input, responseFinishedAtMs: 999 })
      .status,
    "invalid_timing",
  );
  noSecret(projectNativeTraceRequestLifecycle(input));
});

function encodedTrace() {
  const client = resolve("clients/uwork");
  const require = createRequire(join(client, "packages/desktop/package.json"));
  const exporter = require.resolve("@opentelemetry/exporter-trace-otlp-proto");
  const transformer = createRequire(exporter).resolve(
    "@opentelemetry/otlp-transformer",
  );
  const root = require(join(dirname(transformer), "generated/root.js"));
  const type =
    root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
  const message = type.fromObject({
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.instance.id",
              value: { stringValue: "renderer-test-1" },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "@zcode/desktop-renderer-action-trace" },
            spans: [{ name: "ui_action", ...span() }],
          },
        ],
      },
    ],
  });
  return { client, bytes: Buffer.from(type.encode(message).finish()) };
}

test("default real OTLP decoder output stays unchanged; explicit witness adds safe lifecycle", async () => {
  const { client, bytes } = encodedTrace();
  const disabled = createNativeTraceCapture(client);
  const hostileTiming = new Proxy(
    {},
    {
      get() {
        throw Error(secret);
      },
    },
  );
  const original = await disabled.capture(bytes, undefined, hostileTiming);
  assert.deepEqual(Object.keys(original).sort(), [
    "at",
    "bytes",
    "otherSpanCount",
    "rendererSpans",
    "sha256",
  ]);
  assert.deepEqual(Object.keys(original.rendererSpans[0]).sort(), [
    "attributes",
    "rendererInstanceId",
  ]);
  const enabled = createNativeTraceCapture(client, { lifecycleWitness: true });
  const witnessed = await enabled.capture(bytes, undefined, {
    requestStartedAtMs: 1000,
    bodyEndedAtMs: 1001,
  });
  assert.equal(witnessed.rendererSpans[0].lifecycle.actionId, actionId);
  assert.equal(witnessed.requestLifecycle.status, "unconfirmed");
  enabled.finishRequest(witnessed, {
    responseFinishedAtMs: 1002,
    downstreamFinished: true,
    closedBeforeFinish: false,
  });
  assert.equal(witnessed.requestLifecycle.status, "sent");
  noSecret(witnessed);
});
