import assert from "node:assert/strict";
import test from "node:test";
import { applyEnterpriseMetadata } from "../admin/src/adminIdentityView.js";

function identity() {
  return {
    user: { id: "user", name: "Person" },
    tenant: { id: "current", name: "Old", seat: 12 },
    role: "operator",
    expiresAt: 123,
    organizations: [
      { id: "current", name: "Old", role: "operator" },
      { id: "other", name: "Other", role: "member" },
    ],
  };
}

test("enterprise metadata updates both current labels and preserves identity", () => {
  const before = identity();
  const after = applyEnterpriseMetadata(before, { id: "current", name: "New" });
  assert.deepEqual(after, {
    ...before,
    tenant: { ...before.tenant, name: "New" },
    organizations: [
      { ...before.organizations[0], name: "New" },
      before.organizations[1],
    ],
  });
  assert.equal(after!.user, before.user);
  assert.equal(after!.organizations[1], before.organizations[1]);
  assert.equal(before.tenant.name, "Old");
  assert.equal(before.organizations[0]!.name, "Old");
});

test("metadata from another tenant cannot update the current identity", () => {
  const before = identity();
  assert.equal(
    applyEnterpriseMetadata(before, { id: "other", name: "Wrong" }),
    before,
  );
  assert.equal(
    applyEnterpriseMetadata(null, { id: "current", name: "New" }),
    null,
  );
});

test("identical metadata is a no-op but repairs an independently stale menu", () => {
  const before = identity();
  assert.equal(
    applyEnterpriseMetadata(before, { id: "current", name: "Old" }),
    before,
  );
  before.organizations[0]!.name = "Stale menu";
  const after = applyEnterpriseMetadata(before, { id: "current", name: "Old" });
  assert.equal(after!.organizations[0]!.name, "Old");
  assert.equal(before.organizations[0]!.name, "Stale menu");
});
