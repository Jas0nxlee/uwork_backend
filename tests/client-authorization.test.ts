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

test("execution admission projects published personal skill policy together with security, never a draft or hub address", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const admission = async () => {
    const result = await f.app.inject({
      method: "POST",
      url: "/api/client/authorize",
      headers: f.headers,
      payload: { action: "execution" },
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json();
  };
  assert.deepEqual((await admission()).personal, {
    models: false,
    skills: false,
    connectors: false,
  });
  const url = `${f.p}/configurations/personal`;
  const old = (await f.app.inject({ url, headers: f.headers })).json();
  const saved = await f.app.inject({
    method: "PUT",
    url,
    headers: f.headers,
    payload: {
      revision: old.revision,
      data: {
        ...old.published,
        skills: true,
        mcpHub: "https://hub.example.test/private",
      },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (await admission()).personal.skills,
    false,
    "an unpublished draft cannot enable personal reads",
  );
  const published = await f.app.inject({
    method: "POST",
    url: `${url}/publish`,
    headers: f.headers,
    payload: { revision: saved.json().revision },
  });
  assert.equal(published.statusCode, 200, published.body);
  const current = await admission();
  assert.deepEqual(current.personal, {
    models: false,
    skills: true,
    connectors: false,
  });
  assert.equal(current.security.dangerousSkills, false);
  assert.equal(current.security.allowFilesystem, false);
  assert.equal(JSON.stringify(current).includes("hub.example.test"), false);
});
