/** Controlled internal-issuer setup only; not a public TTL setting or UI authentication. */
import assert from "node:assert/strict";
const LOGIN_ANCHOR = `  identity = (
    await api(
      "/api/auth/login",
      "POST",
      { email: "journey-a@example.test", password: memberPassword },
      undefined,
    )
  ).token;`;
const STORE_ANCHOR = `  const store = createSharedIdentitySessionStore(credentials, (operation) =>
    operation(),
  );`;
const ME_ANCHOR =
  '  me = await api("/api/auth/me", "GET", undefined, identity);';
export function deriveMacGatewayExpirySetup(source) {
  assert.equal(typeof source, "string");
  const once = (anchor, replacement) => {
    assert.equal(
      source.split(anchor).length,
      2,
      "One exact original expiry setup anchor required",
    );
    source = source.replace(anchor, replacement);
  };
  once(
    LOGIN_ANCHOR,
    `  const issued = issueOwnedMacExpirySession(app.services.db, member.id, owner.tenantId, "session", ["execute"], 60000);
  ownedMacExpiryIssuedExpiresAt = issued.expiresAt;
  identity = issued.token;`,
  );
  once(
    ME_ANCHOR,
    ME_ANCHOR +
      "\n  assertOwnedMacExpiryEqual(me.expiresAt, ownedMacExpiryIssuedExpiresAt);",
  );
  once(STORE_ANCHOR, STORE_ANCHOR + "\n  ownedMacExpiryStore = store;");
  return (
    `import { issueSession as issueOwnedMacExpirySession } from "../../src/identity.ts";
import { strictEqual as assertOwnedMacExpiryEqual } from "node:assert";
import { readMacGatewayExpiryIdentity } from "./mac-gateway-expiry-setup.mjs";
let ownedMacExpiryIssuedExpiresAt, ownedMacExpiryStore;
` + source
  );
}
/** Reuse the original bootstrap instance. Its read only loads/parses the encrypted record. */
export async function readMacGatewayExpiryIdentity(store, expectedExpiresAt) {
  assert.equal(
    typeof store?.read,
    "function",
    "Existing bootstrap store required",
  );
  assert.ok(Number.isSafeInteger(expectedExpiresAt) && expectedExpiresAt > 0);
  const record = await store.read();
  assert.ok(Number.isSafeInteger(record.revision) && record.revision >= 0);
  assert.ok(
    record.session === null ||
      (typeof record.session === "object" && record.session !== null),
  );
  if (record.session !== null)
    assert.equal(
      record.session.expiresAt,
      expectedExpiresAt,
      "Original issuer expiry must match original stored session",
    );
  return {
    expiresAt: record.session?.expiresAt ?? null,
    revision: record.revision,
    sessionPresent: record.session !== null,
  };
}
