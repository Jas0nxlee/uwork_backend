import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("actual CLI catalog protocol preserves trusted workspace, trace and strict cancellation/response bounds", async () => {
  const root = resolve(
    process.env.UWORK_CLIENT_PATH ?? "../uwork_backend-client",
  );
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const { createProtocolEnterpriseSkillsCatalog } = await load(
    "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/enterprise-skills-catalog.ts",
  );
  const { createRootTraceContext } = await load(
    "apps/zcode-cli/packages/contracts/src/index.ts",
  );
  const workspace = {
    workspacePath: "/controlled",
    workspaceKey: "controlled",
  };
  const traceContext = createRootTraceContext();
  const request = {
    sessionId: "controlled",
    workspacePath: "/untrusted",
    traceContext,
  };
  const controller = new AbortController(),
    notifications: unknown[] = [];
  let calls = 0;
  const protocol = createProtocolEnterpriseSkillsCatalog({
    workspace: () => workspace,
    context: () => ({
      async requestClient(
        method: string,
        params: { workspace: unknown },
        _schema: unknown,
        options: {
          timeoutMs: number;
          signal: AbortSignal;
          trace: { traceId: string };
        },
      ) {
        calls++;
        assert.equal(method, "interaction/readEnterpriseSkills");
        assert.deepEqual(params.workspace, workspace);
        assert.equal(options.timeoutMs, 65000);
        assert.equal(options.trace.traceId, traceContext.traceId);
        assert.equal(options.signal, controller.signal);
        controller.abort();
        return { status: "unmanaged" };
      },
      notify: (value: unknown) => notifications.push(value),
    }),
  });
  assert.deepEqual(
    await protocol.readCatalog({ ...request, sessionId: "x".repeat(201) }),
    { status: "denied", code: "enterprise_input_limit" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(await protocol.readCatalog(request, controller.signal), {
    status: "denied",
    code: "enterprise_authorization_cancelled",
  });
  assert.equal(calls, 1);
  assert.equal(notifications.length, 1);
  assert.match(
    JSON.stringify(notifications[0]),
    /enterpriseToolAuthorizationCancelled/,
  );
  const absent = createProtocolEnterpriseSkillsCatalog({
    workspace: () => workspace,
    context: () => undefined,
  });
  assert.deepEqual(await absent.readCatalog(request), {
    status: "denied",
    code: "enterprise_policy_unavailable",
  });
  const invalid = createProtocolEnterpriseSkillsCatalog({
    workspace: () => workspace,
    context: () => ({
      requestClient: async () => ({
        status: "unmanaged",
        unexpected: "private-echo",
      }),
      notify: () => {},
    }),
  });
  assert.deepEqual(await invalid.readCatalog(request), {
    status: "denied",
    code: "enterprise_policy_unavailable",
  });
});
