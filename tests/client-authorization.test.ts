import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";

test("client execution authorization rejects inactive subscriptions rather than returning a usable policy decision", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  f.app.services.db.run(
    "UPDATE subscriptions SET ends_at=? WHERE tenant_id=?",
    Date.now() - 1,
    f.tenantId,
  );
  const result = await f.app.inject({
    method: "POST",
    url: "/api/client/authorize",
    headers: f.headers,
    payload: { action: "filesystem", target: "/controlled/file" },
  });
  assert.equal(result.statusCode, 402, result.body);
  assert.equal(result.json().error.code, "SUBSCRIPTION_INACTIVE");
});

test("client execution authorization checks the selected published assistant channel", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const old = (
    await f.app.inject({
      url: `${f.p}/configurations/assistants`,
      headers: f.headers,
    })
  ).json();
  const saved = await f.app.inject({
    method: "PUT",
    url: `${f.p}/configurations/assistants`,
    headers: f.headers,
    payload: {
      revision: old.revision,
      data: { ...old.published, local: false, agents: true },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `${f.p}/configurations/assistants/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      })
    ).statusCode,
    200,
  );
  const local = await f.app.inject({
    method: "POST",
    url: "/api/client/authorize",
    headers: f.headers,
    payload: { action: "filesystem", target: "/controlled/file" },
  });
  assert.equal(local.statusCode, 403, local.body);
  assert.equal(local.json().error.code, "CHANNEL_DISABLED");
  const agent = await f.app.inject({
    method: "POST",
    url: "/api/client/authorize",
    headers: f.headers,
    payload: {
      channel: "agents",
      action: "filesystem",
      target: "/controlled/file",
    },
  });
  assert.equal(agent.statusCode, 200, agent.body);
  assert.equal(typeof agent.json().allowed, "boolean");
});

test("execution admission exposes the current tenant-bound security without granting resource permissions", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const result = await f.app.inject({
    method: "POST",
    url: "/api/client/authorize",
    headers: f.headers,
    payload: { action: "execution", channel: "local" },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().allowed, true);
  assert.equal(result.json().tenantId, f.tenantId);
  assert.equal(result.json().security.allowShell, false);
  assert.equal(result.json().security.allowFilesystem, false);
});
