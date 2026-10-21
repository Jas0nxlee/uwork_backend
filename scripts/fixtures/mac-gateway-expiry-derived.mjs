/** Initial controlled TTL only. Original Identity owner, timer, encrypted store and HTTP hold remain authoritative. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveMountedFixture } from "./mac-gateway-mounted-derived.mjs";
import { deriveMacGatewayExpirySetup } from "./mac-gateway-expiry-setup.mjs";
export function deriveExpiryFixture(original) {
  let source = deriveMacGatewayExpirySetup(deriveMountedFixture(original));
  const anchor =
    "const facts={hold:gatewayUsageHold.command({op:'gatewayUsageHoldStatus'}),";
  assert.equal(
    source.split(anchor).length,
    2,
    "One readonly snapshot boundary",
  );
  source = source.replace(
    anchor,
    "const facts={identityRecord:await readMacGatewayExpiryIdentity(ownedMacExpiryStore,ownedMacExpiryIssuedExpiresAt),sessionExpiresAt:me.expiresAt,sessionRemainingMs:me.expiresAt-Date.now(),hold:gatewayUsageHold.command({op:'gatewayUsageHoldStatus'}),",
  );
  return source;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const path = resolve("scripts/fixtures/client-native-enterprise.mjs"),
    url = pathToFileURL(path).href,
    original = readFileSync(path, "utf8"),
    derived = deriveExpiryFixture(original);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  writeFileSync(
    resolve(
      "evidence",
      process.env.UWORK_NATIVE_FIXTURE_NAME,
      "expiry-derived-source.json",
    ),
    JSON.stringify(
      {
        originalSha256: hash(original),
        derivedSha256: hash(derived),
        initialControlledTtlMs: 60000,
        clockMutation: false,
        originalIdentityOwnerAndTimer: true,
        originalEncryptedStoreWrite: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  let loaded = false;
  registerHooks({
    load(target, context, next) {
      const result = next(target, context);
      if (target !== url) return result;
      assert.equal(loaded, false);
      loaded = true;
      return { ...result, source: derived };
    },
  });
  await import(url);
}
