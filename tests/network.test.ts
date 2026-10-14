import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAddresses } from "../src/network.js";

test("DNS waiting is cancelled before a delayed resolver can return or dispatch", async () => {
  const controller = new AbortController();
  const pending = resolveAddresses(
    "delayed.example.test",
    controller.signal,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [{ address: "8.8.8.8", family: 4 }];
    },
  );
  const reason = new Error("controlled cancellation");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});

test("an already cancelled DNS request never starts its resolver", async () => {
  let resolved = false;
  await assert.rejects(() =>
    resolveAddresses("delayed.example.test", AbortSignal.abort(), async () => {
      resolved = true;
      return [];
    }),
  );
  assert.equal(resolved, false);
});
