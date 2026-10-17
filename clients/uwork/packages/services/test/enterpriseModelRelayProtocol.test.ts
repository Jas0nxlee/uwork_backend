import assert from "node:assert/strict";
import test from "node:test";
import {
  zcodeEnterpriseModelRequestParamsSchema as params,
  zcodeEnterpriseModelRequestResultSchema as result,
} from "@zcode/shared";

test("model relay protocol only carries bounded bodies and response bytes", () => {
  const request = {
    requestId: "request-1",
    sessionId: "session-1",
    workspace: { workspaceKey: "/owned", workspacePath: "/owned" },
    request: {
      kind: "open",
      url: "https://backend.example.test/v1/chat/completions",
      body: '{"model":"managed","messages":[]}',
    },
  };
  assert.equal(params.safeParse(request).success, true);
  for (const field of ["headers", "token", "apiKey", "userId"])
    assert.equal(
      params.safeParse({ ...request, request: { ...request.request, [field]: "forged" } }).success,
      false,
    );
  assert.equal(
    params.safeParse({ ...request, request: { ...request.request, body: "中".repeat(350000) } })
      .success,
    false,
  );
  assert.equal(result.safeParse({ status: "ok", chunk: "YQ==", done: false }).success, true);
  for (const extra of [
    { token: "secret" },
    { headers: { authorization: "secret" } },
    { chunk: "!" },
    { chunk: "a".repeat(87388) },
  ])
    assert.equal(result.safeParse({ status: "ok", ...extra }).success, false);
  assert.equal(
    result.safeParse({ status: "denied", code: "enterprise_model_denied" }).success,
    true,
  );
  assert.equal(
    result.safeParse({ status: "denied", code: "arbitrary upstream error body" }).success,
    false,
  );
});
