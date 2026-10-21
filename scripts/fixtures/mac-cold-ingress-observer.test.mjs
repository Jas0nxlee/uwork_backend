import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { installMacColdIngressObserver } from "./mac-cold-ingress-observer.mjs";
test("counts every raw matching POST including identical cached retries before any response", () => {
  const server = new EventEmitter(),
    handler = [];
  server.on("request", (r) => handler.push(r));
  const seen = installMacColdIngressObserver(server);
  const request = {
    method: "POST",
    url: "/v1/chat/completions?owned=1",
    headers: { "idempotency-key": "same" },
  };
  server.emit("request", request);
  server.emit("request", request);
  assert.equal(seen.read(), 2);
  assert.deepEqual(handler, [request, request]);
  server.emit("close");
  assert.equal(server.listenerCount("request"), 1);
});
test("GET configuration reads and unrelated routes do not enter inference counter", () => {
  const server = new EventEmitter(),
    seen = installMacColdIngressObserver(server);
  for (const row of [
    { method: "GET", url: "/v1/chat/completions" },
    { method: "POST", url: "/api/auth/login" },
    { method: "GET", url: "/api/configurations" },
    { method: "POST", url: "/v1/chat/completions-extra" },
  ])
    server.emit("request", row);
  assert.equal(seen.read(), 0);
  server.emit("close");
});
test("observer failure cannot throw into original handler and cannot become a false zero", () => {
  const server = new EventEmitter(),
    seen = installMacColdIngressObserver(server);
  let originals = 0;
  server.on("request", () => originals++);
  assert.doesNotThrow(() =>
    server.emit("request", {
      method: "POST",
      get url() {
        throw Error("PRIVATE_MUST_NOT_COPY");
      },
    }),
  );
  assert.equal(originals, 1);
  assert.throws(() => seen.read(), /Ingress observation unavailable/);
  server.emit("close");
});
