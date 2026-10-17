import assert from "node:assert/strict";
import test from "node:test";
import { enterpriseModelErrorMessageId } from "../src/lib/enterpriseModelErrorCopy.js";

test("enterprise model errors use exact stable codes without rewriting arbitrary text", () => {
  assert.equal(
    enterpriseModelErrorMessageId({ code: "MODEL_ERROR", message: "enterprise_identity_changed" }),
    "chat.error.enterpriseSessionChanged",
  );
  assert.equal(
    enterpriseModelErrorMessageId({
      code: "enterprise_model_relay_unavailable",
      message: "unavailable",
    }),
    "chat.error.enterpriseServiceUnavailable",
  );
  assert.equal(
    enterpriseModelErrorMessageId({ code: "enterprise_response_private", message: "blocked" }),
    "chat.error.enterpriseResponseBlocked",
  );
  assert.equal(
    enterpriseModelErrorMessageId({
      code: "OTHER",
      message: "provider text mentions enterprise_identity_changed",
    }),
    undefined,
  );
  assert.equal(
    enterpriseModelErrorMessageId({ code: "__proto__", message: "constructor" }),
    undefined,
  );
});
