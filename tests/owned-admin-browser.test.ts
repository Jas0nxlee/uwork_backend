import assert from "node:assert/strict";
import test from "node:test";
import { OwnedAdminBrowser } from "../scripts/fixtures/owned-admin-browser.js";

const options = {
  root: "/tmp/owned-admin-browser-unit-only",
  evidence: "/tmp/owned-admin-browser-unit-only/evidence",
  name: "unit-only-no-launch",
  redact: (value: string) => value,
};

test("owned browser accepts no trust override or one canonical SHA256 SPKI", () => {
  assert.doesNotThrow(() => new OwnedAdminBrowser(options));
  const digest = Buffer.alloc(32, 255).toString("base64");
  assert.doesNotThrow(
    () => new OwnedAdminBrowser({ ...options, trustSpkiSha256: digest }),
  );
});

test("owned browser rejects malformed, noncanonical, or multiple SPKI values before launch", () => {
  const digest = Buffer.alloc(32, 255).toString("base64");
  for (const value of [
    "",
    " ",
    digest + "\n",
    " " + digest,
    digest + "," + digest,
    digest.slice(0, -1),
    digest.replaceAll("/", "_"),
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64"),
    "A".repeat(42) + "B=",
  ])
    assert.throws(
      () => new OwnedAdminBrowser({ ...options, trustSpkiSha256: value }),
      /single canonical SHA256 SPKI/,
    );
});
