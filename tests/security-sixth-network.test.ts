import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("real HTTP model probes reject redirects without forwarding vault credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-redirect-security-"));
  let redirected = 0;
  const destination = createServer((_req, res) => {
    redirected++;
    res.end(JSON.stringify({ data: [{ id: "wrong-destination" }] }));
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, "127.0.0.1", resolve),
  );
  const destinationUrl = `http://127.0.0.1:${(destination.address() as { port: number }).port}/capture`;
  let status = 302;
  let sourceRequests = 0;
  const synthetic = randomBytes(24).toString("hex");
  const source = createServer((req, res) => {
    sourceRequests++;
    assert.equal(req.headers.authorization, `Bearer ${synthetic}`);
    assert.equal(req.url, "/v1/models");
    if (status !== 200) res.writeHead(status, { location: destinationUrl });
    else res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "controlled-model" }] }));
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      try {
        const closed = await Promise.allSettled(
          [source, destination].map(async (server) => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }),
        );
        for (const result of closed)
          if (result.status === "rejected") throw result.reason;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  const { tenantId } = await bootstrap(app.services.db, {
    name: "Redirect boundary",
    email: "redirect-owner@example.test",
    password: "synthetic-redirect-password",
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await fetch(address + path, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  const login = await post("/api/auth/login", {
    email: "redirect-owner@example.test",
    password: "synthetic-redirect-password",
  });
  assert.equal(login.status, 200);
  const token = (login.value as { token: string }).token;
  const p = `/api/tenants/${tenantId}`;
  const credential = await post(
    `${p}/credentials`,
    { name: "Controlled", value: synthetic },
    token,
  );
  assert.equal(credential.status, 201);
  const model = await post(
    `${p}/models`,
    {
      name: "Controlled",
      baseUrl: `http://127.0.0.1:${(source.address() as { port: number }).port}/v1`,
      upstreamModel: "controlled-model",
      credentialId: (credential.value as { id: string }).id,
      scope: { all: true },
    },
    token,
  );
  assert.equal(model.status, 201);
  const probe = `${p}/models/${(model.value as { id: string }).id}/probe`;
  for (const redirectStatus of [302, 303, 307, 308]) {
    status = redirectStatus;
    const result = await post(probe, {}, token);
    assert.equal(result.status, 502);
    assert.equal(
      (result.value as { error: { code: string } }).error.code,
      "UPSTREAM_REJECTED",
    );
    assert.equal(JSON.stringify(result.value).includes(synthetic), false);
    assert.equal(redirected, 0);
  }
  status = 200;
  const positive = await post(probe, {}, token);
  assert.equal(positive.status, 200);
  assert.equal((positive.value as { reachable: boolean }).reachable, true);
  assert.equal(sourceRequests, 5);
  assert.equal(redirected, 0);
  assert.equal(
    app.services.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM ledger",
    )!.count,
    0,
  );
});
