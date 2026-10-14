import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";
import {
  UWorkBackendClient,
  BackendClientError,
} from "../src/backend-client.js";
test("Host adapter synchronizes actual API snapshots with scoped device credentials and revocation", async (t) => {
  const f = await fixture(t, "https://provider.example.test/v1");
  const device = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers: f.headers,
      payload: { ttlHours: 1 },
    })
  ).json();
  await f.app.listen({ host: "127.0.0.1", port: 0 });
  const address = f.app.server.address() as { port: number };
  const client = new UWorkBackendClient(
    `http://127.0.0.1:${address.port}`,
    async () => device.token,
  );
  let applied = false;
  const result = await client.synchronize({
    async applyPolicy(snapshot) {
      assert.equal(snapshot.tenantId, f.tenantId);
    },
    async applyModels(input) {
      assert.equal(input.models[0]?.id, f.model);
      assert.equal(input.deviceToken, device.token);
      applied = true;
    },
    async applyAssets() {},
  });
  assert.ok(applied);
  assert.equal(result.modelCount, 1);
  assert.equal(await client.authorize("shell", "echo"), false);
  assert.equal(
    (
      await f.app.inject({
        url: `${f.p}/credentials`,
        headers: { authorization: `Bearer ${device.token}` },
      })
    ).statusCode,
    403,
  );
  await f.app.inject({
    method: "DELETE",
    url: `/api/auth/device-tokens/${device.id}`,
    headers: f.headers,
  });
  await assert.rejects(
    () => client.models(),
    (e) => e instanceof BackendClientError && e.status === 401,
  );
});
