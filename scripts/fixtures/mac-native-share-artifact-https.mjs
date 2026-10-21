/** One owned HTTPS download with an explicit private CA; never changes global TLS or follows redirects. */
import assert from "node:assert/strict";
import { Agent, request } from "node:https";
function failure(code) {
  return Object.assign(new Error("Owned share HTTPS request failed"), { code });
}
function safeError(error) {
  return failure(
    typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code
      : "OWNED_SHARE_HTTPS_ERROR",
  );
}
export async function requestOwnedShareArtifact({
  url,
  origin,
  expectedPath,
  ca,
  identity,
  maxBytes = 4096,
  timeoutMs = 15000,
}) {
  assert.ok(
    typeof origin === "string" &&
      /^https:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(origin),
    "Owned HTTPS origin required",
  );
  const parsed = new URL(url),
    base = new URL(origin);
  assert.ok(
    base.origin === origin &&
      +base.port > 0 &&
      +base.port <= 65535 &&
      +base.port !== 3000,
    "Owned ephemeral port required",
  );
  assert.ok(
    parsed.origin === origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash,
    "Own origin without URL credentials or query required",
  );
  assert.ok(
    typeof expectedPath === "string" &&
      /^\/api\/client\/shares\/[A-Za-z0-9._~-]+\/artifacts\/[A-Za-z0-9._~-]+\/content$/.test(
        expectedPath,
      ),
    "Owned artifact content path required",
  );
  assert.ok(
    !expectedPath.split("/").some((part) => part === "." || part === "..") &&
      parsed.pathname === expectedPath,
    "Exact owned artifact path required",
  );
  assert.ok(
    (typeof ca === "string" || Buffer.isBuffer(ca)) &&
      Buffer.byteLength(ca) > 32 &&
      Buffer.byteLength(ca) < 32768,
    "Explicit case certificate required",
  );
  assert.ok(
    typeof identity === "string" &&
      identity.length > 0 &&
      identity.length < 16384,
    "Original case identity required",
  );
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 4096);
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000,
  );
  const agent = new Agent({ ca, rejectUnauthorized: true, keepAlive: false });
  let req,
    res,
    sock,
    timer,
    primaryError,
    result,
    socketClosed = false,
    resolveClose;
  const closed = new Promise((resolve) => {
    resolveClose = resolve;
  });
  try {
    result = await new Promise((resolve, reject) => {
      const chunks = [];
      let count = 0,
        ended = false;
      req = request(
        parsed,
        {
          method: "GET",
          agent,
          headers: { authorization: "Bearer " + identity, connection: "close" },
        },
        (response) => {
          res = response;
          res.on("data", (chunk) => {
            count += chunk.length;
            if (count > maxBytes) {
              const e = failure("OWNED_SHARE_BODY_LIMIT");
              reject(e);
              res.destroy(e);
              req.destroy(e);
              return;
            }
            chunks.push(chunk);
          });
          res.on("aborted", () =>
            reject(failure("OWNED_SHARE_RESPONSE_ABORTED")),
          );
          res.on("error", (e) => reject(safeError(e)));
          res.on("end", () => {
            ended = true;
            const headers = {};
            for (const name of [
              "content-type",
              "content-length",
              "content-disposition",
              "x-content-type-options",
              "cache-control",
            ]) {
              const value = res.headers[name];
              if (value !== undefined)
                headers[name] = Array.isArray(value) ? value.join(",") : value;
            }
            resolve({
              status: res.statusCode,
              headers,
              body: Buffer.concat(chunks),
              bodyFullyConsumed: res.complete && ended,
            });
          });
        },
      );
      req.once("socket", (socket) => {
        sock = socket;
        socket.once("close", () => {
          socketClosed = true;
          resolveClose(true);
        });
      });
      req.on("error", (e) => reject(safeError(e)));
      timer = setTimeout(() => {
        const e = failure("OWNED_SHARE_TIMEOUT");
        reject(e);
        req.destroy(e);
      }, timeoutMs);
      req.end();
    });
  } catch (error) {
    primaryError = error;
  } finally {
    clearTimeout(timer);
    res?.destroy();
    req?.destroy();
    agent.destroy();
    let closeTimer;
    const didClose =
      !sock ||
      socketClosed ||
      (await Promise.race([
        closed,
        new Promise((resolve) => {
          closeTimer = setTimeout(() => resolve(false), 1000);
        }),
      ]));
    clearTimeout(closeTimer);
    if (!didClose) {
      const cleanup = failure("OWNED_SHARE_SOCKET_NOT_CLOSED");
      primaryError = primaryError
        ? new AggregateError(
            [primaryError, cleanup],
            "Owned share HTTPS request and cleanup failed",
          )
        : cleanup;
    }
  }
  if (primaryError) throw primaryError;
  assert.ok(
    result.bodyFullyConsumed && socketClosed,
    "Completed body and owned socket closure required",
  );
  return { ...result, socketClosed: true, explicitCaseCa: true };
}
