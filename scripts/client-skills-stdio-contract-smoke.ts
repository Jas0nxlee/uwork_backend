import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

test(
  "actual packaged CLI stdio binds draft skills to the Host workspace and current HTTP policy",
  { timeout: 30000 },
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
    const f = await fixture(t, "https://upstream.example.test/v1");
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const temporary = await realpath(
      await mkdtemp(join(tmpdir(), "uwork-skills-stdio-")),
    );
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const workspacePath = join(temporary, "workspace-a"),
      foreignPath = join(temporary, "workspace-b"),
      home = join(temporary, "home"),
      storageDirectory = join(temporary, "host");
    for (const path of [workspacePath, home, storageDirectory])
      await mkdir(path);
    await mkdir(join(foreignPath, ".zcode", "skills", "foreign"), {
      recursive: true,
    });
    await writeFile(
      join(foreignPath, ".zcode", "skills", "foreign", "SKILL.md"),
      "---\nname: ControlledForeign\ndescription: Must not be scanned under another workspace binding\n---\nControlled foreign body",
    );
    const configure = async (kind: string, data: Record<string, unknown>) => {
      const url = `${f.p}/configurations/${kind}`,
        old = (await f.app.inject({ url, headers: f.headers })).json();
      const saved = await f.app.inject({
        method: "PUT",
        url,
        headers: f.headers,
        payload: {
          revision: old.revision,
          data: { ...old.published, ...data },
        },
      });
      assert.equal(saved.statusCode, 200, saved.body);
      const published = await f.app.inject({
        method: "POST",
        url: `${url}/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      });
      assert.equal(published.statusCode, 200, published.body);
    };
    await configure("security", {
      allowFilesystem: true,
      dangerousSkills: false,
    });
    const created = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled",
        kind: "skill",
        scope: { all: true },
        content: {
          files: [
            {
              path: "SKILL.md",
              content:
                "---\nname: controlled-enterprise\ndescription: Controlled stdio fixture\n---\nApproved stdio instructions",
            },
          ],
          highRisk: false,
        },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id: string = created.json().id;
    for (const operation of ["review", "publish"]) {
      const response = await f.app.inject({
        method: "POST",
        url: `${f.p}/assets/${id}/${operation}`,
        headers: f.headers,
        payload: {
          version: 1,
          ...(operation === "review" ? { approved: true } : {}),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const expertBody = {
      instructions: "Approved stdio expert instructions",
      profession: "受控专家",
    };
    const expertCreated = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Expert",
        kind: "expert",
        scope: { all: true },
        content: expertBody,
      },
    });
    assert.equal(expertCreated.statusCode, 201, expertCreated.body);
    const expertId: string = expertCreated.json().id;
    for (const operation of ["review", "publish"]) {
      const response = await f.app.inject({
        method: "POST",
        url: `${f.p}/assets/${expertId}/${operation}`,
        headers: f.headers,
        payload: {
          version: 1,
          ...(operation === "review" ? { approved: true } : {}),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    // 自定义指令没有 UWork 终端所有者：服务端矩阵本身就必须拒绝下发给 uwork。
    const unsupported = await f.app.inject({
      method: "POST",
      url: `${f.p}/assets`,
      headers: f.headers,
      payload: {
        name: "Controlled Instruction",
        kind: "instruction",
        scope: { all: true },
        content: { instructions: "Must never reach the client" },
        supportedClients: ["uwork"],
      },
    });
    assert.equal(unsupported.statusCode, 400, unsupported.body);
    assert.equal(unsupported.json().error.code, "CLIENT_UNSUPPORTED");
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
    const workspace = {
      workspacePath,
      workspaceIdentity: "controlled-stdio",
      workspaceKey: "controlled-stdio",
    };
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
        [shared.ZCODE_WORKSPACE_IDENTITY_ENV]: workspace.workspaceIdentity,
      },
    });
    const stderr: string[] = [];
    const transport = new ZCodeStdioTransport(child, {
      onStderrLine: (line: string) => {
        if (stderr.length < 100) stderr.push(line);
      },
      ...(process.platform !== "win32"
        ? {
            ownedProcessGroupId: child.pid,
            ownedProcessStartedAtMs: Date.now(),
          }
        : {}),
    });
    const client = new ZCodeProtocolClient(transport, {
      requestTimeoutMs: 20000,
    });
    let catalogs = 0,
      admissions = 0;
    const expertAdmissions: {
      id: string;
      version: number;
      checksum: string;
    }[] = [];
    const bridge = createEnterpriseToolAuthorizationBridge({
      assets,
      resolver: createUWorkToolAuthorizationResolver({ backendSession }),
      isCurrent: () => !client.isDisposed,
    });
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
          catalogs++;
          void bridge
            .handleCatalog(
              client,
              workspace,
              request.id,
              request.params,
              request.trace?.traceId,
            )
            .catch(() => {});
        } else if (
          request.method ===
          shared.zcodeProtocolMethods.interactionAuthorizeEnterpriseTool
        ) {
          admissions++;
          const params = request.params as {
            phase?: string;
            asset?: {
              asset?: {
                id: string;
                kind: string;
                version: number;
                checksum: string;
              };
            };
          };
          if (
            params.phase === "asset_load" &&
            params.asset?.asset?.kind === "expert"
          )
            expertAdmissions.push(structuredClone(params.asset.asset));
          void bridge
            .handle(
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
    const cleanup = async () => {
      owner.abort();
      await client.disposeAndWait();
      await assets.disposeAllAndWait();
    };
    t.after(cleanup);
    const catalog = (value = workspace) =>
      client.request(
        shared.zcodeProtocolMethods.skillsReferenceCatalog,
        { workspace: value },
        shared.zcodeSkillsReferenceCatalogResultSchema,
        {
          timeoutMs: 20000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
    try {
      const first = await catalog();
      assert.equal(first.authority, "workspace");
      assert.deepEqual(
        first.skills.map((item: { name: string }) => item.name),
        [`enterprise:${id}`],
        stderr.join("\n"),
      );
      assert.ok(catalogs >= 1);
      assert.ok(admissions >= 2);
      const revoke = await f.app.inject({
        method: "POST",
        url: `${f.p}/policies`,
        headers: f.headers,
        payload: {
          name: "Revoke",
          family: "skill",
          mode: "deny",
          resourceIds: [id],
          scope: { all: true },
        },
      });
      assert.equal(revoke.statusCode, 201, revoke.body);
      assert.equal((await catalog()).skills.length, 0);
      await configure("personal", { skills: true });
      await configure("security", {
        allowFilesystem: true,
        dangerousSkills: true,
      });
      const before = catalogs;
      await assert.rejects(async () => {
        const result = await catalog({
          workspacePath: foreignPath,
          workspaceIdentity: "controlled-foreign",
          workspaceKey: "controlled-foreign",
        });
        assert.fail(
          `Forged workspace unexpectedly returned: ${JSON.stringify(result.skills.map((item: { name: string }) => item.name))}`,
        );
      }, /enterprise_workspace_mismatch/);
      assert.equal(
        catalogs,
        before,
        "a forged draft must be rejected before any private catalog or filesystem read",
      );
      assert.equal(
        (await catalog()).skills.some(
          (item: { name: string }) => item.name === "ControlledForeign",
        ),
        false,
      );
      const currentExpert = (
        await f.app.inject({
          url: `/api/client/assets/${expertId}/download`,
          headers: f.headers,
        })
      ).json();
      assert.equal(
        expertAdmissions.length,
        0,
        "the draft catalog never loads expert bodies",
      );
      await client.request(
        shared.zcodeProtocolMethods.sessionCreate,
        { workspace },
        shared.zcodeSessionStateSnapshotSchema,
        {
          timeoutMs: 30000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
      assert.ok(
        expertAdmissions.length >= 2,
        `the managed runtime must load the expert through the reverse RPC: ${stderr.join("\n")}`,
      );
      for (const admission of expertAdmissions)
        assert.deepEqual(admission, {
          id: expertId,
          kind: "expert",
          version: 1,
          checksum: currentExpert.checksum,
        });
      const revokeExpert = await f.app.inject({
        method: "POST",
        url: `${f.p}/policies`,
        headers: f.headers,
        payload: {
          name: "Revoke expert",
          family: "expert",
          mode: "deny",
          resourceIds: [expertId],
          scope: { all: true },
        },
      });
      assert.equal(revokeExpert.statusCode, 201, revokeExpert.body);
      const catalogReads = catalogs,
        admitted = expertAdmissions.length;
      const after = await client.request(
        shared.zcodeProtocolMethods.sessionCreate,
        { workspace },
        shared.zcodeSessionStateSnapshotSchema,
        {
          timeoutMs: 30000,
          lifecycle: "observation",
          trace: { traceId: "controlled-stdio" },
        },
      );
      assert.equal(typeof after.session.sessionId, "string");
      assert.ok(
        catalogs > catalogReads,
        "a new managed runtime re-reads the current catalog before applying experts",
      );
      assert.equal(
        expertAdmissions.length,
        admitted,
        "a revoked expert is never requested again",
      );
    } catch (error) {
      throw new Error(
        `Controlled CLI verification failed: ${error instanceof Error ? error.message : String(error)}\n${stderr.join("\n")}`,
        { cause: error },
      );
    } finally {
      await cleanup();
    }
  },
);
