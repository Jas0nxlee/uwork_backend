import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/core.js";
import { createWecomProvider } from "../src/wecom.js";

const config = {
  tenant_id: "owned-tenant",
  corp_id: "owned-corp",
  agent_id: "1",
  credential_id: "owned-credential",
};
for (const [errcode, hint] of [
  [60020, "可信 IP"],
  [60011, "可见范围"],
] as const) {
  test(`real upstream rejection ${errcode} retains its code and actionable guidance`, async () => {
    const provider = createWecomProvider(async (path) =>
      path === "gettoken"
        ? { errcode: 0, access_token: "synthetic-unused-token" }
        : { errcode, errmsg: "synthetic rejection" },
    );
    await assert.rejects(
      provider.directory(config, "synthetic-unused-secret"),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        assert.equal(error.code, "WECOM_REJECTED");
        assert.ok(error.message.includes(String(errcode)));
        assert.ok(error.message.includes(hint));
        return true;
      },
    );
  });
}
