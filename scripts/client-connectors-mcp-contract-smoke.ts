import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

async function delay(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 30000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${message}`);
}

/** 受控远端 MCP：只接受经后端代理转发的帧，并记录工具发现与会话。 */
async function remote(t: { after: (fn: () => unknown) => void }) {
  const seen: { method: string; session?: string; version?: string }[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      seen.push({ method: `HTTP:${req.method}` });
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    seen.push({
      method: body.method,
      ...(typeof req.headers["mcp-session-id"] === "string"
        ? { session: req.headers["mcp-session-id"] }
        : {}),
      ...(typeof req.headers["mcp-protocol-version"] === "string"
        ? { version: req.headers["mcp-protocol-version"] }
        : {}),
    });
    res.setHeader("content-type", "application/json");
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "remote-session");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: body.params?.protocolVersion ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "controlled", version: "1" },
          },
        }),
      );
      return;
    }
    if (body.method === "tools/list") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "multiply",
                description: "Multiply integers",
                inputSchema: {
                  type: "object",
                  properties: {
                    left: { type: "number" },
                    right: { type: "number" },
                  },
                },
              },
            ],
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "42" }] },
      }),
    );
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  return { seen, url: `http://127.0.0.1:${port}/mcp` };
}

test(
  "actual packaged CLI connects an enterprise connector through the Host-only backend proxy",
  { timeout: 60000 },
  async (t) => {
    const root = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { createUWorkBackendSession } = await load(
      "packages/services/src/enterprise-identity/uworkBackendSession.ts",
    );
    const { createUWorkToolAuthorizationResolver } = await load(
      "packages/services/src/enterprise-identity/uworkToolAuthorization.ts",
    );
    const { createEnterpriseAssetsHost } = await load(
      "packages/services/src/enterprise-assets/enterpriseAssetsHost.ts",
    );
    const { createEnterpriseConnectorRelay } = await load(
      "packages/services/src/enterprise-assets/connectorRelay.ts",
    );
    const { createEnterpriseToolAuthorizationBridge } = await load(
      "packages/services/src/zcode-agent/enterpriseToolAuthorizationBridge.ts",
    );
    const { ZCodeProtocolClient } = await load(
      "packages/services/src/zcode-agent/zcodeProtocolClient.ts",
    );
    const { ZCodeStdioTransport } = await load(
      "packages/services/src/zcode-agent/zcodeStdioTransport.ts",
    );
    const shared = await load("packages/shared/src/index.ts");
    const bundle = join(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
    await access(bundle);
    const endpoint = await remote(t);
    const personalEndpoint = await remote(t);
    const f = await fixture(t, "https://upstream.example.test/v1");
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const temporary = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-connector-stdio-")),
    );
    const workspacePath = join(temporary, "workspace"),
      home = join(temporary, "home"),
      storageDirectory = join(temporary, "host");
    for (const path of [workspacePath, home, storageDirectory])
      await mkdir(path);
    const credential = f.app.services.db.get<{ id: string }>(
      "SELECT id FROM credentials WHERE tenant_id=?",
      f.tenantId,
    )!.id;
    const created = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Connector",
        kind: "connector",
        scope: { all: true },
        content: {
          url: "https://controlled.example.test/mcp",
          transport: "streamable-http",
          credentialId: credential,
          description: "受控连接器",
          allowedTools: ["multiply"],
        },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const connectorId: string = created.json().id;
    // 只有受控夹具把生产 HTTPS 形态换成 loopback 远端。
    const version = f.app.services.db.get<{ data: string }>(
      "SELECT data FROM resource_versions WHERE resource_id=?",
      connectorId,
    )!;
    const versionData = JSON.parse(version.data);
    versionData.content.url = endpoint.url;
    f.app.services.db.run(
      "UPDATE resource_versions SET data=? WHERE resource_id=?",
      JSON.stringify(versionData),
      connectorId,
    );
    for (const [action, payload] of [
      ["review", { version: 1, approved: true }],
      ["publish", { version: 1 }],
    ] as const)
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: `${f.p}/assets/${connectorId}/${action}`,
            headers: f.headers,
            payload,
          })
        ).statusCode,
        200,
      );
    const masked = (
      await f.app.inject({
        url: `/api/client/assets/${connectorId}/download?version=1`,
        headers: f.headers,
      })
    ).json();

    const owner = new AbortController();
    const authority = {
      generation: 1,
      revision: 1,
      signal: owner.signal,
      session: {
        token: f.headers.authorization.slice("Bearer ".length),
        issuerOrigin: origin,
        expiresAt: Date.now() + 60000,
        profile: {
          id: f.userId,
          tenantId: f.tenantId,
          displayName: "Controlled",
          provider: "wecom",
        },
      },
    };
    const backendSession = createUWorkBackendSession({
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => authority,
      readPersistedSession: async () => ({
        revision: authority.revision,
        session: authority.session,
      }),
    });
    const assets = createEnterpriseAssetsHost({
      backendSession,
      storageDirectory,
    });
    const relay = createEnterpriseConnectorRelay({ backendSession, assets });
    const child = spawn(process.execPath, [bundle, "app-server", "--stdio"], {
      cwd: workspacePath,
      detached: process.platform !== "win32",
      stdio: "pipe",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: process.env.TMPDIR,
        TMP: process.env.TMP,
        TEMP: process.env.TEMP,
        ZCODE_STORAGE_DIR: join(temporary, "client-storage"),
        ZCODE_BASE_URL: origin,
        ZCODE_MODEL_TELEMETRY_ENABLED: "false",
        [shared.ZCODE_ENTERPRISE_POLICY_REQUIRED_ENV_KEY]: "1",
        [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: "controlled-connector",
      },
    });
    const stderr: string[] = [];
    const transport = new ZCodeStdioTransport(child, {
      onStderrLine: (line: string) => {
        if (stderr.length < 5000) stderr.push(line);
      },
      ...(process.platform !== "win32"
        ? {
            ownedProcessGroupId: child.pid,
            ownedProcessStartedAtMs: Date.now(),
          }
        : {}),
    });
    const client = new ZCodeProtocolClient(transport, {
      requestTimeoutMs: 25000,
    });
    const workspace = {
      workspacePath,
      workspaceIdentity: "controlled-connector",
      workspaceKey: "controlled-connector",
    };
    const bridge = createEnterpriseToolAuthorizationBridge({
      assets,
      connectors: relay,
      resolver: createUWorkToolAuthorizationResolver({ backendSession }),
      isCurrent: () => !client.isDisposed,
    });
    const observed = {
      catalogs: 0,
      connectorAdmissions: 0,
      connectorFrames: [] as unknown[],
      connectorReleases: 0,
      admissionsSeen: [] as string[],
      personalAdmissions: 0,
    };
    client.onRequest(
      (request: {
        id: string | number;
        method: string;
        params: unknown;
        trace?: { traceId: string };
      }) => {
        if (
          request.method ===
          shared.zcodeProtocolMethods.interactionReadEnterpriseSkills
        ) {
          observed.catalogs++;
          void bridge
            .handleCatalog(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => undefined);
        } else if (
          request.method ===
          shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
        ) {
          const params = request.params as {
            phase?: string;
            asset?: { asset?: { kind?: string } };
            capability?: { permission?: string };
          };
          if (params.capability?.permission === "personal_connector")
            observed.personalAdmissions++;
          observed.admissionsSeen.push(
            `${params.phase ?? "?"}:${params.asset?.asset?.kind ?? "none"}`,
          );
          if (
            params.phase === "asset_load" &&
            params.asset?.asset?.kind === "connector"
          )
            observed.connectorAdmissions++;
          void bridge
            .handle(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => {});
        } else if (
          request.method ===
          shared.zcodeProtocolMethods.interactionRequestEnterpriseConnector
        ) {
          const params = request.params as {
            request?: { kind?: string; frame?: unknown };
          };
          if (params.request?.kind === "release") observed.connectorReleases++;
          else
            observed.connectorFrames.push(
              structuredClone(params.request?.frame),
            );
          void bridge
            .handleConnector(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => {});
        } else
          void client
            .respondError(request.id, {
              code: -32601,
              message: "Unexpected controlled reverse RPC",
            })
            .catch(() => {});
      },
    );
    client.onNotification((message: { method: string; params: unknown }) => {
      if (
        message.method ===
        shared.zcodeProtocolNotifications.enterpriseToolAuthorizationCancelled
      )
        bridge.cancel(client, workspace, message.params);
    });
    t.after(async () => {
      owner.abort();
      await client.disposeAndWait();
      await assets.disposeAllAndWait();
      // 清理必须晚于 CLI 子进程退出：它仍在写自己的 provider runtime 目录。
      await rm(temporary, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    });
    const createSession = () =>
      client.request(
        shared.zcodeProtocolMethods.sessionCreate,
        // 同一真实pool lease同时承载受管relay与个人HTTP服务器；personal默认关闭。
        {
          workspace,
          mcpServers: [
            {
              name: "controlled-personal",
              type: "http",
              url: personalEndpoint.url,
              headers: [],
              protocolVersion: "legacy",
            },
          ],
        },
        shared.zcodeSessionStateSnapshotSchema,
        {
          timeoutMs: 30000,
          lifecycle: "observation",
          trace: { traceId: "controlled-connector" },
        },
      );
    await createSession();
    // MCP 启动本身是异步的：受管运行时会并行读取企业目录并连接连接器。
    await waitFor(
      () => observed.connectorAdmissions >= 2,
      `connector load must be admitted before and after: ${JSON.stringify({ ...observed, connectorFrames: observed.connectorFrames.length })} ${stderr.join("\n")}`,
    );
    await waitFor(
      () => endpoint.seen.length >= 3,
      `the connector handshake must reach the controlled remote: ${JSON.stringify({ ...observed, connectorFrames: observed.connectorFrames.length })} ${stderr.join("\n")}`,
    );
    assert.ok(observed.catalogs >= 1, stderr.join("\n"));
    await waitFor(
      () => observed.personalAdmissions > 0,
      "actual pooled personal MCP must ask its Host before connecting",
    );
    assert.deepEqual(
      personalEndpoint.seen,
      [],
      "disabled personal connectors must never initialize even while enterprise relay succeeds",
    );
    const methods = endpoint.seen.map((entry) => entry.method);
    assert.deepEqual(methods, [
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    // 帧里只有 MCP 协议内容：远端地址、凭据与后端会话都不出 Host。
    const frames = JSON.stringify(observed.connectorFrames);
    assert.equal(frames.includes(endpoint.url), false);
    assert.equal(frames.includes("synthetic-only"), false);
    assert.equal(frames.includes("remote-session"), false);
    assert.equal(frames.includes(origin), false);
    assert.notEqual(masked.content.url, endpoint.url);
    assert.equal(JSON.stringify(masked).includes(endpoint.url), false);

    // 撤权后新建会话不得再连接该连接器：远端不会再收到握手，准入也必须被拒绝。
    const revoke = await f.app.inject({
      method: "POST",
      url: `${f.p}/policies`,
      headers: f.headers,
      payload: {
        name: "Revoke connector",
        family: "connector",
        mode: "deny",
        resourceIds: [connectorId],
        scope: { all: true },
      },
    });
    assert.equal(revoke.statusCode, 201, revoke.body);
    const framesBefore = observed.connectorFrames.length,
      admissionsBefore = observed.connectorAdmissions,
      seenBefore = endpoint.seen.length,
      catalogsBefore = observed.catalogs;
    await createSession();
    // 撤权后的目录必须被重新读取（否则“没连接”可能只是因为还没开始）。
    await waitFor(
      () => observed.catalogs > catalogsBefore,
      "the managed runtime must re-read the catalog for the new session",
    );
    await delay(1500);
    assert.equal(
      observed.connectorFrames.length,
      framesBefore,
      "a revoked connector must not be dialled again",
    );
    assert.equal(endpoint.seen.length, seenBefore);
    assert.equal(observed.connectorAdmissions, admissionsBefore);
    assert.ok(observed.catalogs >= 2);
  },
);
