import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

async function fixture(t: TestContext) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 21),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const account = {
    email: "settings-owner@example.test",
    password: "controlled-settings-password",
  };
  const { tenantId } = await bootstrap(app.services.db, {
    ...account,
    name: "Settings regression",
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  assert.equal(login.status, 200);
  const token = ((await login.json()) as { token: string }).token;
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${origin}/api/tenants/${tenantId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as Record<string, unknown>;
  };
  return { request };
}

test("enterprise contact updates preserve independently configured retention over real HTTP", async (t) => {
  const f = await fixture(t);
  await f.request("/retention", "PUT", { days: 14 });
  await f.request("", "PATCH", {
    name: "Renamed enterprise",
    contact: "Controlled contact",
  });
  assert.deepEqual(await f.request("/retention"), {
    days: 14,
    configured: true,
  });
  const enterprise = await f.request("");
  assert.equal(enterprise.name, "Renamed enterprise");
  assert.equal(
    JSON.parse(String(enterprise.settings)).contact,
    "Controlled contact",
  );
  const audit = await f.request("/audit?q=directory.enterprise.update");
  assert.equal(audit.total, 1);
});

test("a name-only enterprise patch keeps the existing contact and retention over real HTTP", async (t) => {
  const f = await fixture(t);
  await f.request("", "PATCH", {
    name: "Initial enterprise",
    contact: "Keep this contact",
  });
  await f.request("/retention", "PUT", { days: 44 });
  await f.request("", "PATCH", { name: "Name-only update" });
  const enterprise = await f.request("");
  assert.equal(
    JSON.parse(String(enterprise.settings)).contact,
    "Keep this contact",
  );
  assert.deepEqual(await f.request("/retention"), {
    days: 44,
    configured: true,
  });
});
