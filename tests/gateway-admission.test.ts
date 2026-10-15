import { test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { fixture } from "./fixtures.js";
import { currentActor } from "../src/access.js";
import { completionSchema } from "../src/gateway.js";
import { ApiError } from "../src/core.js";

for (const mode of [
  "dns-failure",
  "cancelled-before-dns",
  "cancelled-during-dns",
] as const) {
  test(`gateway releases its reservation when ${mode} prevents dispatch`, async (t) => {
    const f = await fixture(t, "https://controlled.example.test/v1");
    const actor = currentActor(f.app.services.db, f.tenantId, f.userId);
    const controller = new AbortController();
    let lookups = 0;
    let entered!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finishLookup!: () => void;
    const dnsMock = t.mock.method(dns, "lookup", async () => {
      lookups++;
      entered();
      if (mode === "dns-failure")
        throw Object.assign(new Error("controlled DNS failure"), {
          code: "ENOTFOUND",
        });
      await new Promise<void>((resolve) => {
        finishLookup = resolve;
      });
      return [{ address: "8.8.8.8", family: 4 }];
    });
    syncBuiltinESMExports();
    t.after(() => {
      dnsMock.mock.restore();
      syncBuiltinESMExports();
    });
    if (mode === "cancelled-before-dns") controller.abort();
    const pending = f.app.services.gateway.complete(
      actor,
      completionSchema.parse({
        model: f.model,
        messages: [{ role: "user", content: "controlled" }],
      }),
      mode,
      "uwork",
      controller.signal,
    );
    const rejected = assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof ApiError &&
        error.code ===
          (mode === "dns-failure" ? "UPSTREAM_FAILURE" : "CANCELLED"),
    );
    if (mode === "cancelled-during-dns") {
      await lookupStarted;
      controller.abort();
      finishLookup();
    }
    await rejected;
    assert.equal(lookups, mode === "cancelled-before-dns" ? 0 : 1);
    const ledger = f.app.services.db.get<{
      status: string;
      amount: number;
      reserved: number;
    }>(
      "SELECT status,amount,reserved FROM ledger WHERE tenant_id=? AND request_key=?",
      f.tenantId,
      mode,
    );
    assert.ok(ledger);
    assert.equal(ledger.status, "released");
    assert.equal(ledger.amount, 0);
    assert.ok(ledger.reserved > 0);
    const trace = f.app.services.db.get<{ status: string }>(
      "SELECT status FROM traces",
    );
    assert.equal(trace?.status, "failed");
  });
}
