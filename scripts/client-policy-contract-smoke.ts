import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

test("actual protocol admission bounds input and cancels late responses with trace propagation", async () => {
  const root = resolve(
    process.env.UWORK_CLIENT_PATH ?? "../uwork_backend-client",
  );
  const { createProtocolEnterpriseToolAuthorization } = await import(
    pathToFileURL(
      join(
        root,
        "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/enterprise-tool-authorization.ts",
      ),
    ).href
  );
  const { createRootTraceContext } = await import(
    pathToFileURL(join(root, "apps/zcode-cli/packages/contracts/src/index.ts"))
      .href
  );
  const controller = new AbortController(),
    notifications: { trace: { traceId: string } }[] = [];
  let calls = 0;
  const traceContext = createRootTraceContext();
  const request = {
    sessionId: "controlled",
    toolCallId: "controlled",
    toolName: "Read",
    workspacePath: "/controlled",
    workingDirectory: "/controlled",
    phase: "before_dispatch",
    input: {},
    capability: {
      permission: "read",
      sideEffectScope: "none",
      readOnly: true,
      destructive: false,
    },
    traceContext,
  };
  const port = createProtocolEnterpriseToolAuthorization({
    workspace: () => ({
      workspaceKey: "/controlled",
      workspacePath: "/controlled",
    }),
    context: () => ({
      requestClient: async (
        _method: string,
        _params: unknown,
        _schema: unknown,
        options: {
          signal: AbortSignal;
          timeoutMs: number;
          trace: { traceId: string };
        },
      ) => {
        calls++;
        assert.equal(options.timeoutMs, 15000);
        assert.equal(options.trace.traceId, traceContext.traceId);
        assert.equal(options.signal, controller.signal);
        controller.abort();
        return { allowed: true, code: "allowed" };
      },
      notify: (notification: { trace: { traceId: string } }) =>
        notifications.push(notification),
    }),
  });
  assert.deepEqual(
    await port.authorize({
      ...request,
      input: { oversized: "x".repeat(262145) },
    }),
    { allowed: false, code: "enterprise_input_limit" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(await port.authorize(request, controller.signal), {
    allowed: false,
    code: "enterprise_authorization_cancelled",
  });
  assert.equal(calls, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]!.trace.traceId, traceContext.traceId);
  const unavailable = createProtocolEnterpriseToolAuthorization({
    workspace: () => ({
      workspaceKey: "/controlled",
      workspacePath: "/controlled",
    }),
    context: () => undefined,
  });
  assert.deepEqual(await unavailable.authorize(request), {
    allowed: false,
    code: "enterprise_policy_unavailable",
  });
});

test("actual CLI admission, Host private identity and backend publication gate native execution", async (t) => {
  const root = resolve(
    process.env.UWORK_CLIENT_PATH ?? "../uwork_backend-client",
  );
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const { createUWorkToolAuthorizationResolver } = await load(
    "packages/services/src/enterprise-identity/uworkToolAuthorization.ts",
  );
  const { createEnterpriseToolAuthorizationBridge } = await load(
    "packages/services/src/zcode-agent/enterpriseToolAuthorizationBridge.ts",
  );
  const { createEnterpriseIdentityService, disposeEnterpriseIdentityService } =
    await load(
      "packages/services/src/enterprise-identity/enterpriseIdentityService.ts",
    );
  const { readEnterpriseIdentityAuthority } = await load(
    "packages/services/src/enterprise-identity/identityServiceLifecycle.ts",
  );
  const { createSharedIdentitySessionStore } = await load(
    "packages/services/src/enterprise-identity/identitySessionStore.ts",
  );
  const { createProtocolEnterpriseToolAuthorization } = await load(
    "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/enterprise-tool-authorization.ts",
  );
  const { withEnterpriseExecutionAuthorization } = await load(
    "apps/zcode-cli/packages/adapters/src/exec/enterprise-execution.ts",
  );
  const { createNodeExecutionAdapter } = await load(
    "apps/zcode-cli/packages/adapters/src/exec/index.ts",
  );
  const { createToolRegistry } = await load(
    "apps/zcode-cli/packages/core/src/tool/registry.ts",
  );
  const { createToolExecutor } = await load(
    "apps/zcode-cli/packages/core/src/tool/executor.ts",
  );
  const { PermissionService, defaultPermissionConfig } = await load(
    "apps/zcode-cli/packages/core/src/permission/service.ts",
  );
  const { createRootTraceContext } = await load(
    "apps/zcode-cli/packages/contracts/src/index.ts",
  );
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 23),
    publicUrl: "http://127.0.0.1",
  });
  t.after(() => app.close());
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Controlled",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const token = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.test", password: "test-password-long" },
    })
  ).json().token;
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const directory = await mkdtemp(join(tmpdir(), "uwork-client-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const values = new Map<string, string>();
  const credentials = {
    load: async (key: string) => values.get(key) ?? null,
    save: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  let queue: Promise<unknown> = Promise.resolve();
  const store = createSharedIdentitySessionStore(
    credentials,
    <T>(operation: () => Promise<T>) => {
      const result = queue.then(operation, operation);
      queue = result.catch(() => {});
      return result;
    },
  );
  const callbackUrl = "https://auth.example.test/controlled-callback",
    state = "controlled-state";
  const session = {
    token,
    issuerOrigin: origin,
    expiresAt: Date.now() + 60000,
    profile: {
      id: userId,
      tenantId,
      provider: "wecom",
      displayName: "Controlled",
    },
  };
  const identity = createEnterpriseIdentityService({
    credentials,
    sessionStore: store,
    adapter: {
      listOrganizations: () => [{ id: tenantId }],
      resolveOrganization: () => ({ id: tenantId }),
      start: async () => ({
        id: state,
        callbackUrl,
        authorizationUrl: `https://login.example.test/?state=${state}`,
        expiresAt: Date.now() + 60000,
      }),
      complete: async () => session,
      restore: async () => session,
    },
  });
  t.after(() => disposeEnterpriseIdentityService(identity));
  const login = await identity.beginLogin();
  await identity.completeLogin(
    login.id,
    `${callbackUrl}?state=${state}&code=controlled`,
  );
  const resolver = createUWorkToolAuthorizationResolver({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => store.read(),
  });
  const workspace = {
    workspacePath: directory,
    workspaceIdentity: "controlled",
    workspaceKey: "controlled",
  };
  const pending = new Map<
    string | number,
    { resolve(value: unknown): void; reject(reason: unknown): void }
  >();
  let nextId = 0;
  const client = {
    isDisposed: false,
    onClose: () => () => {},
    respond: async (id: string | number, result: unknown) => {
      pending.get(id)!.resolve(JSON.parse(JSON.stringify(result)));
    },
    respondError: async (id: string | number, error: unknown) => {
      pending.get(id)!.reject(error);
    },
  };
  const bridge = createEnterpriseToolAuthorizationBridge({
    resolver,
    isCurrent: () => true,
  });
  const authorization = createProtocolEnterpriseToolAuthorization({
    workspace: () => workspace,
    context: () => ({
      requestClient: async (
        _method: string,
        params: unknown,
        schema: { parse(value: unknown): unknown },
      ) => {
        const id = ++nextId;
        const result = new Promise((resolve, reject) =>
          pending.set(id, { resolve, reject }),
        );
        try {
          await bridge.handle(
            client,
            workspace,
            id,
            JSON.parse(JSON.stringify(params)),
          );
          return schema.parse(await result);
        } finally {
          pending.delete(id);
        }
      },
      notify: (notification: { params: unknown }) =>
        bridge.cancel(client, workspace, notification.params),
    }),
  });
  const native = createNodeExecutionAdapter({
    outputRootDir: join(directory, "output"),
    processEnv: {},
  });
  t.after(() => native.close?.());
  const traceContext = createRootTraceContext();
  const execution = withEnterpriseExecutionAuthorization(native, {
    authorization,
    sessionId: "controlled",
    workspacePath: directory,
    workingDirectory: directory,
    workspaceIdentity: "controlled",
    traceContext,
  });
  let dispatches = 0;
  const registry = createToolRegistry();
  registry.register({
    capability: "controlled.native",
    inputSchema: { type: "object" },
    outputSchema: { type: "string" },
    metadata: {
      name: "Bash",
      readOnly: false,
      destructive: false,
      concurrentSafe: false,
      sideEffectScope: "system",
      riskLevel: "high",
      needsApproval: true,
    },
    permission: {
      permission: "bash",
      reason: "Controlled",
      riskLevel: "high",
      sideEffectScope: "system",
      needsApproval: true,
      patternSources: [],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: 1024,
      maxModelBytes: 1024,
      strategy: "truncate",
    },
    timeout: { defaultMs: 5000, allowCallOverride: false },
    cancellation: {
      supported: true,
      cleanup: "none",
      userVisibleMessage: "Cancelled",
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "none",
      recordOutput: "none",
    },
    handler: async () => {
      dispatches++;
      const result = await execution.run({
        command: {
          mode: "argv",
          file: process.execPath,
          args: ["-e", "console.log(42)"],
        },
      });
      assert.equal(result.exitCode, 0);
      return result.stdout.text.trim();
    },
  });
  const publish = async (allowShell: boolean) => {
    const url = `/api/tenants/${tenantId}/configurations/security`;
    const headers = { authorization: `Bearer ${token}` };
    const old = (await app.inject({ url, headers })).json();
    const saved = await app.inject({
      method: "PUT",
      url,
      headers,
      payload: {
        revision: old.revision,
        data: {
          ...old.published,
          allowShell,
          allowFilesystem: true,
          allowNetwork: true,
          allowedDomains: [],
        },
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const published = await app.inject({
      method: "POST",
      url: `${url}/publish`,
      headers,
      payload: { revision: saved.json().revision },
    });
    assert.equal(published.statusCode, 200, published.body);
  };
  const run = async (hook?: () => Promise<void>) => {
    const events: { type: string }[] = [];
    const executor = createToolExecutor({
      registry,
      permissionService: new PermissionService(
        defaultPermissionConfig,
        authorization,
      ),
      sessionId: "controlled",
      workingDirectory: directory,
      workspaceRoot: directory,
      workspaceIdentity: "controlled",
      mode: "yolo",
      emitEvent: async (event: { type: string }) => {
        events.push(event);
      },
      ...(hook
        ? {
            hookRunner: {
              async run() {
                await hook();
                return { additionalContexts: [], permissionBehavior: "allow" };
              },
            },
          }
        : {}),
    });
    return {
      result: await executor.execute({
        id: `controlled-${nextId}`,
        name: "Bash",
        input: {},
      }),
      events,
    };
  };
  assert.equal((await run()).result.success, false);
  assert.equal(dispatches, 0);
  await publish(true);
  const allowed = await run();
  assert.equal(allowed.result.success, true, JSON.stringify(allowed.result));
  assert.equal(dispatches, 1);
  const changed = await run(() => publish(false));
  assert.equal(changed.result.success, false);
  assert.equal(
    dispatches,
    1,
    "a PreToolUse allow cannot override a newly published denial",
  );
  await publish(true);
  await identity.logout();
  assert.equal((await run()).result.success, false);
  assert.equal(dispatches, 1, "logout prevents new native processes");
  assert.equal(pending.size, 0);
});
