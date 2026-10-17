import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  projectNativeTraceLifecycle,
  projectNativeTraceRequestLifecycle,
} from "./native-configuration-capture.mjs";

const unzip = promisify(gunzip);
const MAX_TRACE_BYTES = 1024 * 1024;
const fields = new Set([
  "feature_id",
  "action",
  "catalog_group",
  "operation_kind",
  "surface",
  "trigger",
  "outcome",
  "result_source",
  "section_id",
]);

/** Test-only OTLP receiver; never stores headers, raw payload, or user content. */
export function createNativeTraceCapture(
  client,
  { lifecycleWitness = false } = {},
) {
  const require = createRequire(join(client, "packages/desktop/package.json"));
  const exporterPath = require.resolve(
    "@opentelemetry/exporter-trace-otlp-proto",
  );
  const transformer = createRequire(exporterPath).resolve(
    "@opentelemetry/otlp-transformer",
  );
  const root = require(join(dirname(transformer), "generated/root.js"));
  const requestType =
    root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
  const batches = [];
  const finalizedRequests = new WeakSet();
  return {
    batches,
    ...(lifecycleWitness === true
      ? {
          finishRequest(batch, completion) {
            if (!batches.includes(batch) || finalizedRequests.has(batch))
              return;
            finalizedRequests.add(batch);
            batch.requestLifecycle = projectNativeTraceRequestLifecycle({
              requestStartedAtMs: batch.requestLifecycle.requestStartedAtMs,
              bodyEndedAtMs: batch.requestLifecycle.bodyEndedAtMs,
              responseFinishedAtMs: completion.responseFinishedAtMs,
              downstreamFinished: completion.downstreamFinished,
              closedBeforeFinish: completion.closedBeforeFinish,
            });
          },
        }
      : {}),
    async capture(input, encoding, timing) {
      if (input.length > MAX_TRACE_BYTES)
        throw Error("Trace batch is too large");
      if (encoding && encoding !== "identity" && encoding !== "gzip")
        throw Error("Unsupported trace encoding");
      const bytes =
        encoding === "gzip"
          ? await unzip(input, { maxOutputLength: MAX_TRACE_BYTES })
          : input;
      const decoded = requestType.decode(bytes);
      const spans = [];
      let otherSpanCount = 0;
      for (const resource of decoded.resourceSpans ?? []) {
        const instance = resource.resource?.attributes?.find(
          (entry) => entry.key === "service.instance.id",
        )?.value?.stringValue;
        for (const scope of resource.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            if (
              scope.scope?.name !== "@zcode/desktop-renderer-action-trace" ||
              span.name !== "ui_action"
            ) {
              otherSpanCount++;
              continue;
            }
            spans.push({
              rendererInstanceId:
                typeof instance === "string" &&
                /^[A-Za-z0-9._:-]{1,128}$/.test(instance)
                  ? instance
                  : null,
              attributes: Object.fromEntries(
                (span.attributes ?? []).flatMap((entry) => {
                  const value = entry.value?.stringValue;
                  return fields.has(entry.key) &&
                    typeof value === "string" &&
                    /^[A-Za-z0-9._:-]{1,128}$/.test(value)
                    ? [[entry.key, value]]
                    : [];
                }),
              ),
              ...(lifecycleWitness === true
                ? { lifecycle: projectNativeTraceLifecycle(span) }
                : {}),
            });
          }
        }
      }
      const batch = {
        at: new Date().toISOString(),
        bytes: input.length,
        sha256: createHash("sha256").update(input).digest("hex"),
        rendererSpans: spans,
        otherSpanCount,
        ...(lifecycleWitness === true
          ? {
              requestLifecycle: projectNativeTraceRequestLifecycle({
                requestStartedAtMs: timing?.requestStartedAtMs,
                bodyEndedAtMs: timing?.bodyEndedAtMs,
                responseFinishedAtMs: null,
                downstreamFinished: false,
                closedBeforeFinish: false,
              }),
            }
          : {}),
      };
      batches.push(batch);
      return batch;
    },
  };
}
