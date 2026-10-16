import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
import { environment } from "../src/config.js";
import { safeRequest, upstreamAddressAllowed } from "../src/network.js";

test("private model origin configuration defaults closed and rejects non-origin or non-HTTPS entries", () => {
  const saved = { ...process.env };
  try {
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    process.env.PUBLIC_URL = "http://localhost:3000";
    delete process.env.PRIVATE_MODEL_ORIGINS;
    assert.deepEqual(environment().privateModelOrigins, []);
    for (const value of [
      "http://model.example.test",
      "https://user:password@model.example.test",
      "https://model.example.test/v1",
      "https://model.example.test?key=synthetic",
      "https://model.example.test#fragment",
    ]) {
      process.env.PRIVATE_MODEL_ORIGINS = value;
      assert.throws(() => environment(), value);
    }
    process.env.PRIVATE_MODEL_ORIGINS =
      " https://MODEL.example.test:15000/,https://model.example.test:15000 ";
    assert.deepEqual(environment().privateModelOrigins, [
      "https://model.example.test:15000",
    ]);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("invalid programmatic private model origins fail before creating a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-private-origins-"));
  const database = join(directory, "backend.sqlite");
  try {
    await assert.rejects(
      createApp({
        database,
        masterKey: randomBytes(32),
        publicUrl: "http://localhost:3000",
        privateModelOrigins: ["https://model.example.test/v1"],
      }),
    );
    await assert.rejects(access(database));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exact model origins allow only RFC1918 or ULA exceptions and keep reserved networks closed", () => {
  const target = new URL("https://model.example.test:15000/v1/models");
  const origins = [target.origin];
  for (const address of [
    "10.1.2.3",
    "172.16.3.4",
    "192.168.1.2",
    "fd00::1234",
    "::ffff:192.168.1.2",
  ]) {
    assert.equal(upstreamAddressAllowed(address, target), false);
    assert.equal(upstreamAddressAllowed(address, target, origins), true);
    assert.equal(
      upstreamAddressAllowed(
        address,
        new URL("https://model.example.test:15001"),
        origins,
      ),
      false,
    );
    assert.equal(
      upstreamAddressAllowed(
        address,
        new URL("https://other.example.test:15000"),
        origins,
      ),
      false,
    );
    assert.equal(
      upstreamAddressAllowed(
        address,
        new URL("http://model.example.test:15000"),
        origins,
      ),
      false,
    );
  }
  for (const address of [
    "127.0.0.1",
    "::1",
    "169.254.169.254",
    "fe80::1",
    "0.0.0.0",
    "192.0.2.1",
    "100.64.1.1",
    "224.0.0.1",
    "::ffff:169.254.169.254",
  ]) {
    assert.equal(
      upstreamAddressAllowed(address, target, origins),
      false,
      address,
    );
  }
  assert.equal(upstreamAddressAllowed("8.8.8.8", target), true);
});

test("matching loopback and link-local origins are rejected before HTTP dispatch", async () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "192.0.2.1"]) {
    const url = `https://${address}/v1/models`;
    let dispatched = false;
    await assert.rejects(
      safeRequest(url, {
        method: "GET",
        privateOrigins: [new URL(url).origin],
        onDispatch: () => {
          dispatched = true;
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PRIVATE_UPSTREAM",
    );
    assert.equal(dispatched, false);
  }
});
