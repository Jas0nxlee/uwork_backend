import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixture } from "./fixtures.js";
test("drive adapter routes tenant-bound reads and capacity writes to a real HTTP service", async (t) => {
  let stored = 1024;
  const upstream = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-only");
    res.setHeader("content-type", "application/json");
    if (req.method === "PUT") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        assert.ok(body.tenantId);
        stored = body.defaultBytes;
        res.end(JSON.stringify({ applied: true }));
      });
    } else res.end(JSON.stringify({ defaultBytes: stored, members: [] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const f = await fixture(t, "https://provider.example.test/v1");
  const r = await f.app.inject({
    method: "PUT",
    url: `${f.p}/integrations/drive`,
    headers: f.headers,
    payload: {
      baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      credentialId: f.credential,
      enabled: true,
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (
      await f.app.inject({
        url: `${f.p}/integrations/drive/capacity`,
        headers: f.headers,
      })
    ).json().defaultBytes,
    1024,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "PUT",
        url: `${f.p}/integrations/drive/capacity`,
        headers: f.headers,
        payload: {
          defaultBytes: 2048,
          members: [{ userId: f.userId, bytes: 512 }],
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(stored, 2048);
  assert.equal(
    (
      await f.app.inject({ url: `${f.p}/integrations`, headers: f.headers })
    ).json().capabilities.drive,
    "configured-adapter",
  );
});
