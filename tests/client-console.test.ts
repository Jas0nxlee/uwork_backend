import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.js";
import { hash } from "../src/core.js";
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
  assert.equal(initial.json().menu.name, "自动化");
  assert.equal(initial.json().menu.nameEn, "Automations");
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
  assert.equal(hidden.statusCode, 200, hidden.body);
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
  assert.equal(blocked.statusCode, 202, blocked.body);
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

test("persisted menu publication stays authoritative when existing page mapping changes", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  const menus = {
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
        enabled: true,
        builtin: true,
        icon: "bot",
      },
      {
        id: "assets",
        name: "我的插件",
        nameEn: "My plugins",
        enabled: true,
        builtin: true,
        icon: "library",
      },
    ],
  };
  const stored = JSON.stringify(menus);
  f.app.services.db.run(
    "INSERT INTO configurations(tenant_id,kind,draft,published,version,revision,updated_at) VALUES(?,'menus',?,?,3,4,?)",
    f.tenantId,
    stored,
    stored,
    Date.now(),
  );
  const config = await f.app.inject({
    url: "/api/client/configuration",
    headers: f.headers,
  });
  assert.equal(config.statusCode, 200, config.body);
  assert.deepEqual(
    config
      .json()
      .configuration.menus.items.map(
        (item: { name: string; nameEn: string }) => [item.name, item.nameEn],
      ),
    [
      ["对话", "Chat"],
      ["智能体", "Agents"],
      ["我的插件", "My plugins"],
    ],
  );
  const row = f.app.services.db.get<{
    published: string;
    version: number;
    revision: number;
  }>(
    "SELECT published,version,revision FROM configurations WHERE tenant_id=? AND kind='menus'",
    f.tenantId,
  )!;
  assert.deepEqual({ ...row }, { published: stored, version: 3, revision: 4 });
  const oldEtag = `"${hash(JSON.stringify({ versions: config.json().versions, security: config.json().security }))}"`;
  const refreshed = await f.app.inject({
    url: "/api/client/configuration",
    headers: { ...f.headers, "if-none-match": oldEtag },
  });
  assert.equal(
    refreshed.statusCode,
    200,
    "old contract cache must refresh without a publication write",
  );
  const cached = await f.app.inject({
    url: "/api/client/configuration",
    headers: { ...f.headers, "if-none-match": String(refreshed.headers.etag) },
  });
  assert.equal(cached.statusCode, 304);
  menus.items[1]!.name = "我的自动化";
  f.app.services.db.run(
    "UPDATE configurations SET published=? WHERE tenant_id=? AND kind='menus'",
    JSON.stringify(menus),
    f.tenantId,
  );
  const custom = await f.app.inject({
    url: "/api/client/configuration",
    headers: f.headers,
  });
  assert.equal(custom.json().configuration.menus.items[1].name, "我的自动化");
  assert.equal(
    custom.json().configuration.menus.items[1].nameEn,
    "Agents",
    "a bilingual override must remain intact",
  );
});

test("existing automation menu uses the local channel while backend Agent APIs keep their separate agents channel", async (t) => {
  const f = await fixture(t, "https://upstream.example.test/v1");
  await publish(f, "assistants", { agents: false, local: true });
  const menu = await f.app.inject({
    method: "POST",
    url: "/api/client/menus/agents/authorize",
    headers: f.headers,
  });
  assert.equal(menu.statusCode, 200, menu.body);
  assert.equal(menu.json().allowed, true);
  const agents = await f.app.inject({
    url: "/api/client/agents",
    headers: f.headers,
  });
  assert.equal(agents.statusCode, 403, agents.body);
  await publish(f, "assistants", { agents: true, local: false });
  const unavailable = await f.app.inject({
    method: "POST",
    url: "/api/client/menus/agents/authorize",
    headers: f.headers,
  });
  assert.equal(unavailable.statusCode, 403, unavailable.body);
  const available = await f.app.inject({
    url: "/api/client/agents",
    headers: f.headers,
  });
  assert.equal(available.statusCode, 200, available.body);
});
