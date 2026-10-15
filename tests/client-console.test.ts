import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.js";
import { issueSession } from "../src/identity.js";

async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: string,
  update: Record<string, unknown>,
) {
  const url = `${f.p}/configurations/${kind}`;
  const current = (await f.app.inject({ url, headers: f.headers })).json();
  const saved = await f.app.inject({
    method: "PUT",
    url,
    headers: f.headers,
    payload: {
      revision: current.revision,
      data: { ...current.published, ...update },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const result = await f.app.inject({
    method: "POST",
    url: `${url}/publish`,
    headers: f.headers,
    payload: { revision: saved.json().revision },
  });
  assert.equal(result.statusCode, 200, result.body);
}

test("client menus authorize only the current published enabled entry and bind it to the tenant", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const authorize = () =>
    f.app.inject({
      method: "POST",
      url: "/api/client/menus/agents/authorize",
      headers: f.headers,
    });
  const initial = await authorize();
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().tenantId, f.tenantId);
  assert.equal(initial.json().allowed, true);
  assert.equal(initial.json().menu.id, "agents");
  assert.equal(initial.json().version, 0);
  const url = `${f.p}/configurations/menus`;
  const current = (await f.app.inject({ url, headers: f.headers })).json();
  const items = current.published.items.map((item: { id: string }) => ({
    ...item,
    ...(item.id === "agents" ? { enabled: false } : {}),
  }));
  const saved = await f.app.inject({
    method: "PUT",
    url,
    headers: f.headers,
    payload: { revision: current.revision, data: { items } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (await authorize()).json().allowed,
    true,
    "draft must not disable a menu",
  );
  await f.app.inject({
    method: "POST",
    url: `${url}/publish`,
    headers: f.headers,
    payload: { revision: saved.json().revision },
  });
  assert.deepEqual((await authorize()).json(), {
    allowed: false,
    tenantId: f.tenantId,
    version: 1,
  });
  const hidden = await f.app.inject({
    url: "/api/client/agents",
    headers: f.headers,
  });
  assert.equal(hidden.statusCode, 403, hidden.body);
});

test("client agent catalog and run history expose only authorized metadata and the caller's own runs", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const member = await f.app.inject({
    method: "POST",
    url: `${f.p}/members`,
    headers: f.headers,
    payload: {
      name: "Member",
      email: "console-member@example.test",
      password: "controlled-password-long",
      role: "member",
      seat: true,
    },
  });
  assert.equal(member.statusCode, 201, member.body);
  const device = issueSession(
    f.app.services.db,
    member.json().id,
    f.tenantId,
    "device",
    ["execute"],
  );
  const headers = { authorization: `Bearer ${device.token}` };
  const catalog = await f.app.inject({ url: "/api/client/agents", headers });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.deepEqual(catalog.json().items, [
    { id: f.agent, name: "Test", publishedVersion: 1 },
  ]);
  assert.equal(catalog.body.includes("instructions"), false);
  const ownerRun = await f.app.inject({
    method: "POST",
    url: "/api/client/runs",
    headers: f.headers,
    payload: { agentId: f.agent, input: "owner private input" },
  });
  assert.equal(ownerRun.statusCode, 202, ownerRun.body);
  const created = await f.app.inject({
    method: "POST",
    url: "/api/client/runs",
    headers,
    payload: { agentId: f.agent, input: "member input" },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(created.json().agentId, f.agent);
  assert.equal(created.json().status, "queued");
  const list = await f.app.inject({ url: "/api/client/runs", headers });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().total, 1);
  assert.equal(list.body.includes("owner private input"), false);
  const foreign = await f.app.inject({
    url: `/api/client/runs/${ownerRun.json().id}`,
    headers,
  });
  assert.equal(foreign.statusCode, 404, foreign.body);
  const denied = await f.app.inject({
    method: "POST",
    url: `/api/client/runs/${ownerRun.json().id}/cancel`,
    headers,
  });
  assert.equal(denied.statusCode, 404, denied.body);
  await publish(f, "menus", {
    items: [
      {
        id: "chat",
        name: "对话",
        nameEn: "Chat",
        enabled: true,
        builtin: true,
        icon: "message",
      },
      {
        id: "agents",
        name: "智能体",
        nameEn: "Agents",
        enabled: false,
        builtin: true,
        icon: "bot",
      },
      {
        id: "assets",
        name: "资产",
        nameEn: "Assets",
        enabled: true,
        builtin: true,
        icon: "library",
      },
    ],
  });
  const blocked = await f.app.inject({
    method: "POST",
    url: "/api/client/runs",
    headers,
    payload: { agentId: f.agent, input: "blocked" },
  });
  assert.equal(blocked.statusCode, 403, blocked.body);
  const cancelled = await f.app.inject({
    method: "POST",
    url: `/api/client/runs/${created.json().id}/cancel`,
    headers,
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(
    cancelled.json().ok,
    true,
    "existing own work can still be stopped after the entry is disabled",
  );
});
