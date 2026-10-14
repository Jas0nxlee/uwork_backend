import type { TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
export async function fixture(t: TestContext, baseUrl: string) {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 10),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(() => app.close());
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Fixture",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const headers = {
    authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password: "test-password-long" } })).json().token}`,
  };
  const p = `/api/tenants/${tenantId}`;
  const credential = (
    await app.inject({
      method: "POST",
      url: `${p}/credentials`,
      headers,
      payload: { name: "Test", value: "synthetic-only" },
    })
  ).json().id;
  const model = (
    await app.inject({
      method: "POST",
      url: `${p}/models`,
      headers,
      payload: {
        name: "Test",
        upstreamModel: "test",
        baseUrl,
        credentialId: credential,
        scope: { all: true },
        maxOutputTokens: 128,
      },
    })
  ).json().id;
  const agent = (
    await app.inject({
      method: "POST",
      url: `${p}/agents`,
      headers,
      payload: {
        name: "Test",
        modelId: model,
        instructions: "Test",
        scope: { all: true },
        maxOutputTokens: 128,
      },
    })
  ).json().id;
  await app.inject({
    method: "POST",
    url: `${p}/agents/${agent}/publish`,
    headers,
    payload: { version: 1 },
  });
  return { app, headers, p, tenantId, userId, model, agent, credential };
}
