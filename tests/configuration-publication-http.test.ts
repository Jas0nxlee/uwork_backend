import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("fresh configuration publication rejects without inventing history, then publishes a saved draft over real disk/TCP", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "uwork-config-http-test-"));
  const app = await createApp({
    database: join(directory, "configuration.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  });
  let token = "";
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = await bootstrap(app.services.db, {
    name: "Configuration HTTP regression",
    email: "configuration-http@example.test",
    password: "Configuration-synthetic-password!",
  });
  const origin = await app.listen({ port: 0, host: "127.0.0.1" });
  const request = (path: string, method = "GET", body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = await request("/api/auth/login", "POST", {
    email: "configuration-http@example.test",
    password: "Configuration-synthetic-password!",
  });
  assert.equal(login.status, 200);
  token = ((await login.json()) as { token: string }).token;
  for (const kind of [
    "menus",
    "new-chat",
    "assistants",
    "sharing",
    "personal",
    "security",
    "network",
  ]) {
    await t.test(
      `${kind}: repeated missing-draft requests remain 409 and a saved draft publishes`,
      async () => {
        const path = `/api/tenants/${owner.tenantId}/configurations/${kind}`;
        const before = (await (await request(path)).json()) as {
          draft: unknown;
          published: unknown;
          revision: number;
          version: number;
        };
        assert.equal(before.revision, 0);
        assert.equal(before.version, 0);
        const historyCount = () =>
          app.services.db.get<{ n: number }>(
            "SELECT count(*) n FROM configuration_history WHERE tenant_id=? AND kind=?",
            owner.tenantId,
            kind,
          )!.n;
        for (let attempt = 0; attempt < 2; attempt++) {
          const rejected = await request(`${path}/publish`, "POST", {
            revision: 0,
          });
          assert.equal(rejected.status, 409);
          assert.equal(
            ((await rejected.json()) as { error: { code: string } }).error.code,
            "DRAFT_NOT_FOUND",
          );
          assert.deepEqual(await (await request(path)).json(), before);
          assert.equal(historyCount(), 0);
        }
        const saved = await request(path, "PUT", {
          revision: 0,
          data: before.draft,
        });
        assert.equal(saved.status, 200);
        const revision = ((await saved.json()) as { revision: number })
          .revision;
        const published = await request(`${path}/publish`, "POST", {
          revision,
        });
        assert.equal(published.status, 200);
        const receipt = (await published.json()) as {
          version: number;
          revision: number;
        };
        assert.equal(receipt.version, 1);
        const current = (await (await request(path)).json()) as {
          published: unknown;
          version: number;
          revision: number;
        };
        assert.equal(current.version, receipt.version);
        assert.equal(current.revision, receipt.revision);
        assert.deepEqual(current.published, before.draft);
        assert.equal(historyCount(), 1);
        const stale = await request(`${path}/publish`, "POST", { revision });
        assert.equal(stale.status, 409);
        assert.deepEqual(await (await request(path)).json(), current);
        assert.equal(historyCount(), 1);
      },
    );
  }
  assert.equal((await request("/api/auth/logout", "POST")).status, 204);
});
