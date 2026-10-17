import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { clientExperienceSchemas } from "../src/client-experience.js";

type Row = Record<string, unknown>;
const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/client-experience.json", import.meta.url),
    "utf8",
  ),
) as {
  defaults: Row;
  published: Row;
  cron: { accepted: string[]; rejected: string[] };
};

test("public form contract rejects raw category keys that Zod would otherwise silently drop", () => {
  const input = {
    order: {
      code: {
        pluginOrder: Object.fromEntries([["__proto__", ["owned-plugin"]]]),
      },
    },
  };
  const result = clientExperienceSchemas["plugin-store"].safeParse(input);
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(input.order.code.pluginOrder), ["__proto__"]);
});

async function setup(t: TestContext) {
  const app = await createApp({
    database: ":memory:",
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3016",
    worker: false,
  });
  t.after(() => app.close());
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Owned config",
    email: "experience@example.test",
    password,
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "experience@example.test", password },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    authorization: `Bearer ${login.json<{ token: string }>().token}`,
  };
  const base = `/api/tenants/${owner.tenantId}/configurations`;
  const request = (
    url: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    payload?: unknown,
  ) =>
    app.inject({
      url,
      method,
      headers: {
        ...headers,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  return { app, owner, base, request, headers };
}

test("owned client experience kinds reuse draft/version/history and never expose drafts to the client", async (t) => {
  const f = await setup(t);
  for (const kind of Object.keys(fixtures.defaults)) {
    const path = `${f.base}/${kind}`;
    const initial = await f.request(path);
    assert.equal(initial.statusCode, 200, kind);
    assert.deepEqual(initial.json().published, fixtures.defaults[kind]);
    assert.equal(initial.json().version, 0);
    const missing = await f.request(path + "/publish", "POST", { revision: 0 });
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.json().error.code, "DRAFT_NOT_FOUND");
    const before = await f.request("/api/client/configuration");
    const saved = await f.request(path, "PUT", {
      revision: 0,
      data: fixtures.published[kind],
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      (await f.request("/api/client/configuration")).json().configuration[kind],
      fixtures.defaults[kind],
    );
    assert.equal(
      (await f.request("/api/client/configuration")).headers.etag,
      before.headers.etag,
    );
    const published = await f.request(path + "/publish", "POST", {
      revision: saved.json().revision,
    });
    assert.equal(published.statusCode, 200, published.body);
    const clientResponse = await f.request("/api/client/configuration");
    const client = clientResponse.json();
    assert.notEqual(clientResponse.headers.etag, before.headers.etag);
    assert.equal(client.versions[kind], 1);
    assert.deepEqual(client.configuration[kind], fixtures.published[kind]);
    const history = f.app.services.db.get<{ n: number }>(
      "SELECT count(*) n FROM configuration_history WHERE tenant_id=? AND kind=?",
      f.owner.tenantId,
      kind,
    );
    assert.equal(history?.n, 1);
    const stale = await f.request(path, "PUT", {
      revision: 0,
      data: fixtures.defaults[kind],
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(
      (await f.request(path)).json().published,
      fixtures.published[kind],
    );
  }
});

test("scheduled template golden cases remain valid without changing their expression", async (t) => {
  const f = await setup(t);
  const scenes = fixtures.published.scenes as Row;
  let revision = 0;
  for (const cronExpr of fixtures.cron.accepted) {
    const data = {
      ...scenes,
      scheduledTemplates: [
        { ...(scenes.scheduledTemplates as Row[])[0], cronExpr },
      ],
    };
    const response = await f.request(`${f.base}/scenes`, "PUT", {
      revision,
      data,
    });
    assert.equal(response.statusCode, 200, cronExpr);
    revision = response.json().revision;
    assert.equal(
      (await f.request(`${f.base}/scenes`)).json().draft.scheduledTemplates[0]
        .cronExpr,
      cronExpr,
    );
  }
});

test("new configuration kinds preserve tenant and member write isolation and discard semantics", async (t) => {
  const f = await setup(t);
  const password = randomBytes(24).toString("hex");
  const other = await bootstrap(f.app.services.db, {
    name: "Other owned tenant",
    email: "other-experience@example.test",
    password,
  });
  const member = await f.request(
    `/api/tenants/${f.owner.tenantId}/members`,
    "POST",
    {
      email: "member-experience@example.test",
      name: "Ordinary member",
      password,
      role: "member",
      seat: true,
    },
  );
  assert.equal(member.statusCode, 201);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "member-experience@example.test", password },
  });
  assert.equal(login.statusCode, 200);
  const headers = { authorization: `Bearer ${login.json().token}` };
  for (const kind of Object.keys(fixtures.defaults)) {
    const path = `${f.base}/${kind}`;
    assert.equal(
      (await f.request(`/api/tenants/${other.tenantId}/configurations/${kind}`))
        .statusCode,
      403,
    );
    const denied = await f.app.inject({
      method: "PUT",
      url: path,
      headers,
      payload: { revision: 0, data: fixtures.published[kind] },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal((await f.request(path)).json().revision, 0);
    const saved = await f.request(path, "PUT", {
      revision: 0,
      data: fixtures.published[kind],
    });
    assert.equal(saved.statusCode, 200);
    assert.equal((await f.request(path + "/draft", "DELETE")).statusCode, 200);
    assert.deepEqual(
      (await f.request(path)).json().draft,
      fixtures.defaults[kind],
    );
    assert.deepEqual(
      (await f.request("/api/client/configuration")).json().configuration[kind],
      fixtures.defaults[kind],
    );
  }
});

test("client experience saves reject unrenderable cron, reserved templates and unsafe controls without a row", async (t) => {
  const f = await setup(t);
  assert.equal((await f.request(`${f.base}/scenes`)).statusCode, 200);
  const scenes = fixtures.published.scenes as Row;
  const scheduled = (scenes.scheduledTemplates as Row[])[0]!;
  const cases: Array<[string, unknown]> = [
    ...["", "not-a-url", "https://"].map((url): [string, unknown] => [
      "help",
      {
        communityUrls: { "zh-CN": url, "en-US": null },
        feedback: { mode: "disabled", url: null },
      },
    ]),
    ...["9-icon", "https://example.test/icon.svg"].map(
      (icon): [string, unknown] => [
        "scenes",
        {
          ...scenes,
          draftSuggestions: [
            { ...(scenes.draftSuggestions as Row[])[0], icon },
          ],
        },
      ],
    ),
    ...fixtures.cron.rejected.map((cronExpr): [string, unknown] => [
      "scenes",
      { ...scenes, scheduledTemplates: [{ ...scheduled, cronExpr }] },
    ]),
    ...["customize", "item-customize", "ITEM_Customize", "itemcustomize"].map(
      (id): [string, unknown] => [
        "scenes",
        {
          ...scenes,
          offPeakTemplates: [{ ...(scenes.offPeakTemplates as Row[])[0], id }],
        },
      ],
    ),
    [
      "scenes",
      {
        ...scenes,
        draftSuggestions: Array.from({ length: 21 }, (_, i) => ({
          ...(scenes.draftSuggestions as Row[])[0],
          id: `id-${i}`,
        })),
      },
    ],
    [
      "scenes",
      {
        ...scenes,
        draftSuggestions: [
          (scenes.draftSuggestions as Row[])[0],
          (scenes.draftSuggestions as Row[])[0],
        ],
      },
    ],
    [
      "scenes",
      {
        ...scenes,
        draftSuggestions: Array.from({ length: 20 }, (_, i) => ({
          id: `budget-${i}`,
          title: { cn: "字节预算" },
          prompt: { cn: "汉".repeat(4000), en: "文".repeat(4000) },
        })),
      },
    ],
    [
      "scenes",
      {
        ...scenes,
        draftSuggestions: [
          {
            ...(scenes.draftSuggestions as Row[])[0],
            on_finish: "EXECUTE:arbitrary",
          },
        ],
      },
    ],
    [
      "help",
      {
        communityUrls: { "zh-CN": "javascript:alert(1)", "en-US": null },
        feedback: { mode: "disabled", url: null },
      },
    ],
    [
      "help",
      {
        communityUrls: {
          "zh-CN": "https://user:password@example.test/",
          "en-US": null,
        },
        feedback: { mode: "disabled", url: null },
      },
    ],
    [
      "help",
      {
        communityUrls: { "zh-CN": null, "en-US": null },
        feedback: { mode: "external", url: null },
      },
    ],
    [
      "desktop",
      {
        desktopContextPrompt: { enabled: true },
        rendererActionTrace: {
          enabled: true,
          sampleRatio: 1,
          enabledGroups: ["core"],
        },
      },
    ],
    [
      "desktop",
      {
        desktopContextPrompt: { enabled: true },
        rendererActionTrace: {
          enabled: true,
          sampleRatio: 0.1,
          enabledGroups: ["core", "core"],
        },
      },
    ],
    [
      "desktop",
      {
        ...(fixtures.published.desktop as Row),
        exporterUrl: "https://example.test/collect",
      },
    ],
    [
      "plugin-store",
      { order: { code: { categoryOrder: ["duplicate", "duplicate"] } } },
    ],
    [
      "plugin-store",
      {
        order: {
          code: {
            categoryOrder: Array.from(
              { length: 65 },
              (_, i) => `category-${i}`,
            ),
          },
        },
      },
    ],
    [
      "plugin-store",
      {
        order: {
          code: {
            pluginOrder: {
              category: Array.from({ length: 101 }, (_, i) => `plugin-${i}`),
            },
          },
        },
      },
    ],
    [
      "plugin-store",
      {
        order: {
          code: {
            pluginOrder: Object.fromEntries(
              Array.from({ length: 65 }, (_, i) => [`cat-${i}`, []]),
            ),
          },
        },
      },
    ],
    [
      "plugin-store",
      {
        order: {
          code: {
            pluginOrder: Object.fromEntries(
              Array.from({ length: 64 }, (_, i) => [
                `category-${i}`,
                Array.from(
                  { length: 100 },
                  (_, j) => `plugin-${i}-${j}-${"a".repeat(40)}`,
                ),
              ]),
            ),
          },
        },
      },
    ],
  ];
  for (const [kind, data] of cases) {
    const response = await f.request(`${f.base}/${kind}`, "PUT", {
      revision: 0,
      data,
    });
    assert.equal(response.statusCode, 400, `${kind}: ${response.body}`);
    assert.equal(
      f.app.services.db.get<{ n: number }>(
        "SELECT count(*) n FROM configurations WHERE tenant_id=? AND kind=?",
        f.owner.tenantId,
        kind,
      )?.n,
      0,
    );
  }
});
