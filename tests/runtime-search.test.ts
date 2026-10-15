import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fixture } from "./fixtures.js";
import { bootstrap } from "../src/identity.js";

type Page = {
  items: { id: string; session_id?: string; run_count?: number }[];
  total: number;
};
async function setup(t: TestContext) {
  const f = await fixture(t, "https://example.test/v1");
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  async function request<T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
    headers = f.headers,
  ): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return (await response.json()) as T;
  }
  async function agent(prefix: string, modelId: string, headers = f.headers) {
    const created = await request(
      `${prefix}/agents`,
      "POST",
      {
        name: "Search fixture",
        modelId,
        instructions: "Search metadata only",
        scope: { all: true },
      },
      headers,
    );
    await request(
      `${prefix}/agents/${created.id}/publish`,
      "POST",
      { version: 1 },
      headers,
    );
    return String(created.id);
  }
  async function run(
    prefix: string,
    agentId: string,
    sessionId?: string,
    headers = f.headers,
  ) {
    const created = await request(
      `${prefix}/runs`,
      "POST",
      {
        agentId,
        input: "private-input-search-needle",
        ...(sessionId ? { sessionId } : {}),
      },
      headers,
    );
    return request<{ id: string; session_id: string }>(
      `${prefix}/runs/${created.id}`,
      "GET",
      undefined,
      headers,
    );
  }
  const first = await run(f.p, f.agent);
  await run(f.p, f.agent, first.session_id);
  await run(f.p, f.agent);
  await run(f.p, await agent(f.p, f.model));
  const other = await bootstrap(f.app.services.db, {
    name: "Other search tenant",
    email: "other-search@example.test",
    password: "controlled-search-password",
  });
  const login = await request("/api/auth/login", "POST", {
    email: "other-search@example.test",
    password: "controlled-search-password",
  });
  const otherHeaders = { authorization: `Bearer ${login.token}` },
    otherPrefix = `/api/tenants/${other.tenantId}`;
  const credential = await request(
    `${otherPrefix}/credentials`,
    "POST",
    { name: "Search setup", value: "synthetic-search-only" },
    otherHeaders,
  );
  const model = await request(
    `${otherPrefix}/models`,
    "POST",
    {
      name: "Search setup",
      upstreamModel: "test",
      baseUrl: "https://example.test/v1",
      credentialId: credential.id,
      scope: { all: true },
    },
    otherHeaders,
  );
  const foreign = await run(
    otherPrefix,
    await agent(otherPrefix, String(model.id), otherHeaders),
    undefined,
    otherHeaders,
  );
  return { ...f, request, first, foreign };
}

test("real HTTP run search filters metadata, count and pages without matching encrypted text or another tenant", async (t) => {
  const f = await setup(t);
  for (const q of [
    "definitely-not-present",
    "private-input-search-needle",
    "%",
    f.foreign.id,
  ]) {
    const page = await f.request<Page>(
      `${f.p}/runs?q=${encodeURIComponent(q)}`,
    );
    assert.equal(page.total, 0, q);
    assert.deepEqual(page.items, [], q);
  }
  const one = await f.request<Page>(
    `${f.p}/runs?q=${f.first.id.toUpperCase()}`,
  );
  assert.equal(one.total, 1);
  assert.equal(one.items[0]?.id, f.first.id);
  const session = await f.request<Page>(`${f.p}/runs?q=${f.first.session_id}`);
  assert.equal(session.total, 2);
  const empty = await f.request<Page>(
    `${f.p}/runs?status=failed&q=${f.first.id}`,
  );
  assert.equal(empty.total, 0);
  const first = await f.request<Page>(
    `${f.p}/runs?q=${f.agent}&status=queued&pageSize=1&page=1`,
  );
  const second = await f.request<Page>(
    `${f.p}/runs?q=${f.agent}&status=queued&pageSize=1&page=2`,
  );
  assert.equal(first.total, 3);
  assert.equal(second.total, 3);
  assert.notEqual(first.items[0]?.id, second.items[0]?.id);
  assert.ok(!("input" in first.items[0]!) && !("output" in first.items[0]!));
});

test("real HTTP session search keeps full run counts and tenant-isolated pagination", async (t) => {
  const f = await setup(t);
  for (const q of [
    "definitely-not-present",
    "private-input-search-needle",
    "%",
    f.foreign.session_id,
  ]) {
    const page = await f.request<Page>(
      `${f.p}/sessions?q=${encodeURIComponent(q)}`,
    );
    assert.equal(page.total, 0, q);
    assert.deepEqual(page.items, [], q);
  }
  const one = await f.request<Page>(
    `${f.p}/sessions?q=${f.first.session_id.toUpperCase()}`,
  );
  assert.equal(one.total, 1);
  assert.equal(one.items[0]?.run_count, 2);
  const member = await f.request<Page>(`${f.p}/sessions?q=${f.userId}`);
  assert.equal(member.total, 3);
  const first = await f.request<Page>(
    `${f.p}/sessions?q=${f.agent}&pageSize=1&page=1`,
  );
  const second = await f.request<Page>(
    `${f.p}/sessions?q=${f.agent}&pageSize=1&page=2`,
  );
  assert.equal(first.total, 2);
  assert.equal(second.total, 2);
  assert.notEqual(first.items[0]?.id, second.items[0]?.id);
});
