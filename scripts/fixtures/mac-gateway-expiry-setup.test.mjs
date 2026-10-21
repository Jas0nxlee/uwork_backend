import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveMacGatewayExpirySetup,
  readMacGatewayExpiryIdentity,
} from "./mac-gateway-expiry-setup.mjs";
const original = readFileSync(
  "scripts/fixtures/client-native-enterprise.mjs",
  "utf8",
);
test("actual original fixture derives one current A short issuer and preserves Bob plus original me/store", () => {
  const result = deriveMacGatewayExpirySetup(original);
  assert.equal(
    (
      result.match(
        /issueOwnedMacExpirySession\(app.services.db, member.id, owner.tenantId, "session", \["execute"\], 60000\)/g,
      ) || []
    ).length,
    1,
  );
  assert.ok(
    result.includes('email: "journey-b@example.test", password: bobPassword'),
  );
  assert.ok(
    result.includes(
      'me = await api("/api/auth/me", "GET", undefined, identity);',
    ),
  );
  assert.ok(result.includes("expiresAt: me.expiresAt,"));
  assert.ok(result.includes("ownedMacExpiryStore = store;"));
  assert.ok(!result.includes("UPDATE sessions"));
  assert.ok(!result.includes("Date.now ="));
});
test("missing or duplicate A login anchor rejects instead of silently retaining 12h", () => {
  assert.throws(() =>
    deriveMacGatewayExpirySetup(
      original.replace(
        'email: "journey-a@example.test", password: memberPassword',
        'email: "foreign@example.test", password: memberPassword',
      ),
    ),
  );
  assert.throws(() => deriveMacGatewayExpirySetup(original + "\n" + original));
});
test("observer reads existing store only and emits no token or profile", async () => {
  let reads = 0;
  const result = await readMacGatewayExpiryIdentity(
    {
      read: async () => {
        reads++;
        return {
          revision: 1,
          session: {
            expiresAt: 60001,
            token: "DO_NOT_OUTPUT",
            profile: { id: "private" },
          },
        };
      },
      write: () => assert.fail("observer wrote"),
    },
    60001,
  );
  assert.deepEqual(result, {
    expiresAt: 60001,
    revision: 1,
    sessionPresent: true,
  });
  assert.equal(reads, 1);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_OUTPUT"));
});
test("original owner tombstone is observed without creating another owner or rewriting expiry", async () => {
  assert.deepEqual(
    await readMacGatewayExpiryIdentity(
      { read: async () => ({ revision: 2, session: null }) },
      60001,
    ),
    { expiresAt: null, revision: 2, sessionPresent: false },
  );
});
test("wrong expiry or malformed revision fails closed", async () => {
  await assert.rejects(
    readMacGatewayExpiryIdentity(
      { read: async () => ({ revision: 1, session: { expiresAt: 70000 } }) },
      60001,
    ),
  );
  await assert.rejects(
    readMacGatewayExpiryIdentity(
      { read: async () => ({ revision: -1, session: null }) },
      60001,
    ),
  );
});
test("real original issuer persists exactly60000ms in isolated in-memory SQLite with no listener", async () => {
  const { Db } = await import("../../src/db.ts");
  const { bootstrap, issueSession } = await import("../../src/identity.ts");
  const { hash } = await import("../../src/core.ts");
  const db = new Db(":memory:");
  try {
    const actor = await bootstrap(db, {
      name: "Expiry controlled test",
      email: "expiry-test@example.test",
      password: "controlled-test-password-only",
    });
    const before = Date.now();
    const issued = issueSession(
      db,
      actor.userId,
      actor.tenantId,
      "session",
      ["execute"],
      60000,
    );
    const after = Date.now();
    const row = db.get(
      "SELECT hash,user_id,tenant_id,expires_at,kind,scopes,created_at FROM sessions",
    );
    assert.ok(row.created_at >= before && row.created_at <= after);
    assert.ok(row.expires_at - row.created_at <= 60000);
    assert.ok(row.expires_at - row.created_at >= 60000 - (after - before));
    assert.ok(
      issued.expiresAt >= before + 60000 && issued.expiresAt <= after + 60000,
    );
    assert.equal(row.expires_at, issued.expiresAt);
    assert.equal(row.hash, hash(issued.token));
    assert.equal(row.user_id, actor.userId);
    assert.equal(row.kind, "session");
    assert.equal(row.scopes, '["execute"]');
  } finally {
    db.close();
  }
});
