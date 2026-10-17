import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

test(
  "real backend HTTP and client console preserve publication, current menu gates and run ownership",
  { timeout: 15000 },
  async (t) => {
    const root = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { createUWorkBackendSession } = await load(
      "packages/services/src/enterprise-identity/uworkBackendSession.ts",
    );
    const { createEnterpriseConsoleService } = await load(
      "packages/services/src/enterprise-console/module.ts",
    );
    const { createClientPresentationReader } = await load(
      "packages/services/src/enterprise-identity/clientPresentation.ts",
    );
    let upstreamCalls = 0;
    const upstream = createServer(async (_request, response) => {
      upstreamCalls++;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "controlled",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "controlled console answer",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    await new Promise<void>((resolveListen) =>
      upstream.listen(0, "127.0.0.1", resolveListen),
    );
    t.after(
      () =>
        new Promise<void>((resolveClose, reject) => {
          upstream.closeAllConnections();
          upstream.close((error) => (error ? reject(error) : resolveClose()));
        }),
    );
    const address = upstream.address();
    assert(address && typeof address !== "string");
    const f = await fixture(t, `http://127.0.0.1:${address.port}/v1`);
    const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    let authority = {
      generation: 1,
      revision: 1,
      signal: controller.signal,
      session: {
        token: f.headers.authorization.slice("Bearer ".length),
        issuerOrigin: origin,
        expiresAt: Date.now() + 60000,
        profile: {
          id: f.userId,
          tenantId: f.tenantId,
          provider: "wecom",
          displayName: "Controlled",
        },
      },
    };
    let invalidateAfterResponse = false;
    let onAccepted: (() => Promise<void>) | undefined;
    const privateSession = createUWorkBackendSession({
      resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
      readAuthority: () => authority,
      readPersistedSession: async () => ({
        revision: authority.revision,
        session: authority.session,
      }),
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const result = await fetch(input, init);
        if (
          result.status === 202 &&
          new URL(String(input)).pathname === "/api/client/runs" &&
          onAccepted
        ) {
          const callback = onAccepted;
          onAccepted = undefined;
          await callback();
        }
        if (invalidateAfterResponse)
          authority = { ...authority, generation: authority.generation + 1 };
        return result;
      },
    });
    const consoleService = createEnterpriseConsoleService(privateSession);
    const readPresentation = createClientPresentationReader(privateSession);
    assert.deepEqual(await consoleService.getNavigation(), {
      status: "ready",
      version: 0,
      items: [
        {
          id: "chat",
          name: "对话",
          nameEn: "Chat",
          enabled: true,
          builtin: true,
          icon: "message",
        },
        {
          id: "agents",
          name: "自动化",
          nameEn: "Automations",
          enabled: true,
          builtin: true,
          icon: "bot",
        },
        {
          id: "assets",
          name: "插件商店",
          nameEn: "Plugin Store",
          enabled: true,
          builtin: true,
          icon: "library",
        },
      ],
    });
    const initialPresentation = await readPresentation();
    assert.equal(initialPresentation.status, "ready");
    assert.equal(initialPresentation.version, 0);
    assert.equal(initialPresentation.riskPrefix, "内容由 AI 生成");
    assert.deepEqual(await consoleService.listAgents(), [
      { id: f.agent, name: "Test", publishedVersion: 1 },
    ]);
    assert.deepEqual(await consoleService.listAssets(), []);
    const run = await consoleService.createRun({
      agentId: f.agent,
      input: "controlled request",
    });
    assert.equal(run.status, "queued");
    await f.app.services.runtime.drain();
    const completed = await consoleService.readRun(run.id);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.output, "controlled console answer");
    assert.equal(upstreamCalls, 1);
    const page = await consoleService.listRuns(1);
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.id, run.id);
    const publish = async (kind: string, data: unknown) => {
      const url = `${f.p}/configurations/${kind}`;
      const old = (await f.app.inject({ url, headers: f.headers })).json();
      const saved = await f.app.inject({
        method: "PUT",
        url,
        headers: f.headers,
        payload: { revision: old.revision, data },
      });
      assert.equal(saved.statusCode, 200, saved.body);
      const result = await f.app.inject({
        method: "POST",
        url: `${url}/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      });
      assert.equal(result.statusCode, 200, result.body);
    };
    const navigation = await consoleService.getNavigation();
    onAccepted = () =>
      publish("menus", {
        items: [
          {
            id: "custom",
            name: "企业门户",
            nameEn: "Portal",
            enabled: true,
            builtin: false,
            url: "https://portal.example.test/",
            icon: "globe",
          },
          ...navigation.items.map((item: { id: string }) => ({
            ...item,
            enabled: item.id !== "agents",
          })),
        ],
      });
    const queued = await consoleService.createRun({
      agentId: f.agent,
      input: "cancel without execution",
    });
    assert.equal(
      queued.status,
      "queued",
      "menu revocation after backend acceptance preserves the stop receipt",
    );
    const published = await consoleService.getNavigation();
    assert.equal(published.items[0].id, "custom");
    assert(
      !published.items.some((item: { id: string }) => item.id === "agents"),
    );
    assert.equal(
      (await consoleService.authorizeMenu("custom")).url,
      "https://portal.example.test/",
    );
    await assert.rejects(
      consoleService.authorizeMenu("agents"),
      /enterprise_console_unavailable/,
    );
    assert.equal(
      (await consoleService.listAgents()).length,
      1,
      "automation navigation does not revoke the separate backend Agent API",
    );
    assert.equal((await consoleService.readRun(run.id)).status, "succeeded");
    const assistants = (
      await f.app.inject({
        url: `${f.p}/configurations/assistants`,
        headers: f.headers,
      })
    ).json().published;
    await publish("assistants", { ...assistants, agents: false, local: true });
    await assert.rejects(
      consoleService.listAgents(),
      /enterprise_console_unavailable/,
    );
    await assert.rejects(
      consoleService.createRun({ agentId: f.agent, input: "blocked" }),
      /enterprise_console_unavailable/,
    );
    await assert.rejects(
      consoleService.readRun(run.id),
      /enterprise_console_unavailable/,
    );
    await consoleService.cancelRun(queued.id);
    assert.equal(
      f.app.services.db.get<{ status: string }>(
        "SELECT status FROM runs WHERE id=?",
        queued.id,
      )?.status,
      "cancelled",
    );
    assert.equal(upstreamCalls, 1);
    await publish("new-chat", {
      welcome: "已发布欢迎",
      riskNotice: "请核实结论",
    });
    assert.equal((await readPresentation()).welcome, "已发布欢迎");
    invalidateAfterResponse = true;
    assert.deepEqual(await consoleService.getNavigation(), {
      status: "unavailable",
    });
    assert.deepEqual(await readPresentation(), { status: "unavailable" });
  },
);
