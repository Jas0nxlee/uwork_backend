import assert from "node:assert/strict";
import { test } from "node:test";
import { UWorkBackendClient } from "../src/backend-client.js";

test("Host backend origin accepts HTTPS and explicit loopback HTTP only", () => {
  for (const origin of [
    "https://backend.example.test",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ]) {
    assert.doesNotThrow(() => new UWorkBackendClient(origin, async () => ""));
  }
  for (const origin of [
    "ftp://localhost/",
    "ws://127.0.0.1/",
    "wss://localhost/",
    "custom://[::1]/",
    "http://backend.example.test/",
    "https://user:password@backend.example.test/",
    "https://backend.example.test/path",
    "https://backend.example.test/?key=synthetic",
    "https://backend.example.test/#fragment",
  ]) {
    assert.throws(
      () => new UWorkBackendClient(origin, async () => ""),
      /HTTPS origin/,
      origin,
    );
  }
});
